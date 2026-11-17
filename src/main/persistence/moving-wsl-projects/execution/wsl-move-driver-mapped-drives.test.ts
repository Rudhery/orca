/**
 * A project saved under a drive letter mapped to the distro's share moves as it is saved: the
 * preview reads the mapping, the start re-reads it and refuses a change, and the journal keeps it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WSL_HOSTS_INTERNAL_GATE_ENV } from '../../../../shared/remote-runtime/wsl-hosts/wsl-host-internal-gate'
import type { WslMappedDriveRead } from '../../../wsl/filesystem/wsl-mapped-drive-share'
import { testState } from '../../persistence-test-harness'
import {
  createWslMoveKillRig,
  removeWslMoveRigDirs,
  wslMoveRigRetentionStore,
  type WslMoveRig
} from '../../__fixtures__/wsl-mover/wsl-move-kill-rig'
import { listWslMoveCutovers } from '../cutover-recovery/wsl-move-cutover-journal'
import { planWslMoveRetainedMarks } from '../cutover-recovery/wsl-move-retained-source'
import { runWslMoveRetentionPass } from '../cutover-recovery/wsl-move-retention'
import { resetWslMoveDesktopRewriteStoresForTests } from '../desktop-state/wsl-move-desktop-rewrite-stores'
import { moveProjectsToWslHost } from '../wsl-move-driver'
import { previewWslMove } from './wsl-move-driver-preview'

vi.mock('electron', () => ({
  app: { getPath: () => testState.dir },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (plaintext: string) => Buffer.from(`encrypted:${plaintext}`, 'utf-8'),
    decryptString: (ciphertext: Buffer) => ciphertext.toString('utf-8').slice('encrypted:'.length)
  }
}))
vi.mock('../../../telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../../../telemetry/cohort-classifier', () => ({
  getCohortAtEmit: vi.fn(() => ({ nth_repo_added: 1 }))
}))

const W = { letter: 'W', share: '\\\\wsl.localhost\\Ubuntu' }

let rig: WslMoveRig
let shares: Record<string, WslMappedDriveRead>

beforeEach(() => {
  vi.stubEnv(WSL_HOSTS_INTERNAL_GATE_ENV, '1')
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  rig = createWslMoveKillRig()
  rig.world.repos = [{ ...rig.world.repos[0], path: 'W:\\home\\dev\\app' }]
  shares = { W: { share: W.share } }
  rig.world.deps.readMappedDriveShare = async (letter) => shares[letter] ?? { share: null }
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  resetWslMoveDesktopRewriteStoresForTests()
  removeWslMoveRigDirs()
})

describe('moving a project saved under a mapped drive', () => {
  it('previews it with the mapping and moves it as journaled, keeping the local row', async () => {
    const preview = await previewWslMove(rig.world.deps, { distro: 'Ubuntu' })
    expect(preview).toMatchObject({ outcome: 'ready', repoIds: ['repo-1'], mappedDrives: [W] })
    const result = await moveProjectsToWslHost(rig.world.deps, {
      distro: 'Ubuntu',
      mappedDrives: [W]
    })
    expect(result).toMatchObject({ outcome: 'moved' })
    const [record] = listWslMoveCutovers(rig.userDataPath)
    expect(record).toMatchObject({ version: 2, mappedDrives: [W] })
    expect(record.manifest.payload.repositories[0].path).toBe('/home/dev/app')
    // The local row stays exactly as saved; its identity still matches what the move took.
    await runWslMoveRetentionPass({
      userDataPath: rig.userDataPath,
      store: wslMoveRigRetentionStore(rig)
    })
    expect(rig.world.repos[0].path).toBe('W:\\home\\dev\\app')
    const marks = planWslMoveRetainedMarks({
      chains: [listWslMoveCutovers(rig.userDataPath)],
      retaining: new Set(),
      repos: rig.world.repos,
      folderWorkspaces: [],
      now: '2026-10-21T00:00:00.000Z'
    })
    expect(marks.changed).toEqual([])
  })

  it('refuses a start whose drive maps elsewhere since the preview, before journaling', async () => {
    await previewWslMove(rig.world.deps, { distro: 'Ubuntu' })
    shares = { W: { share: '\\\\wsl.localhost\\Ubuntu\\home' } }
    expect(
      await moveProjectsToWslHost(rig.world.deps, { distro: 'Ubuntu', mappedDrives: [W] })
    ).toMatchObject({ outcome: 'refused', code: 'wsl_move_scope_changed' })
    // A start that never saw the mapping refuses as well.
    shares = { W: { share: W.share } }
    expect(await moveProjectsToWslHost(rig.world.deps, { distro: 'Ubuntu' })).toMatchObject({
      outcome: 'refused',
      code: 'wsl_move_scope_changed'
    })
    expect(listWslMoveCutovers(rig.userDataPath)).toEqual([])
  })

  it('leaves out only the projects of a drive that does not answer', async () => {
    // An offline share elsewhere must not block moving the distro's other projects.
    rig.world.repos = [
      rig.world.repos[0],
      { ...rig.world.repos[0], id: 'repo-s', path: 'S:\\shared\\tool' }
    ]
    shares = { W: { share: W.share }, S: 'unverifiable' }
    expect(await previewWslMove(rig.world.deps, { distro: 'Ubuntu' })).toMatchObject({
      outcome: 'ready',
      repoIds: ['repo-1'],
      mappedDrives: [W]
    })
  })

  it('refuses a start that can no longer read a drive the preview showed', async () => {
    await previewWslMove(rig.world.deps, { distro: 'Ubuntu' })
    shares = { W: 'unverifiable' }
    expect(
      await moveProjectsToWslHost(rig.world.deps, { distro: 'Ubuntu', mappedDrives: [W] })
    ).toMatchObject({
      outcome: 'refused',
      code: 'wsl_move_unavailable',
      detail: 'mapped-drive-unverifiable'
    })
    expect(listWslMoveCutovers(rig.userDataPath)).toEqual([])
  })

  it('lists a repo with Windows-authored worktrees as not moving', async () => {
    rig.world.deps.windowsGitWorktrees = async () => ['W:/home/dev/app-trees/x']
    expect(await previewWslMove(rig.world.deps, { distro: 'Ubuntu' })).toMatchObject({
      outcome: 'refused',
      code: 'wsl_move_nothing_new'
    })
  })
})
