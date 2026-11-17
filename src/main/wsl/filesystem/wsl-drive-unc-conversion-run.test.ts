import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDefaultPersistedState } from '../../../shared/orca-profiles/constants'
import type { PersistedState } from '../../../shared/orca-profiles/persisted-state-types'

import '../../persistence/moving-wsl-projects/quiescence/wsl-move-fence'
import {
  listWslDriveUncConversions,
  writeWslDriveUncConversion
} from './wsl-drive-unc-conversion-journal'
import {
  startWslDriveUncConversion,
  type WslDriveUncConversionRunDeps
} from './wsl-drive-unc-conversion-run'

const UNC = String.raw`\\wsl.localhost\Ubuntu\mnt\c\src\app`
const DRIVE = String.raw`C:\src\app`

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'orca-drive-unc-run-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function state(): PersistedState {
  const value = getDefaultPersistedState('/home/me')
  value.repos = [{ id: 'repo-a', path: UNC, displayName: 'app', badgeColor: '', addedAt: 0 }]
  value.projects = [
    {
      id: 'repo-a',
      displayName: 'app',
      badgeColor: '',
      sourceRepoIds: ['repo-a'],
      createdAt: 0,
      updatedAt: 0
    }
  ]
  return value
}

function deps(overrides: Partial<WslDriveUncConversionRunDeps> = {}): WslDriveUncConversionRunDeps {
  return {
    userDataPath: root,
    profileId: 'profile-1',
    readDriveMounts: async () => [{ mountPoint: '/mnt/c', windowsRoot: 'C:\\' }],
    readMappedDriveShare: async () => ({ share: null }),
    readProfileState: async () => state(),
    pause: vi.fn(async () => ({ panes: [] })),
    runWindowsGit: vi.fn(async (args: string[]) =>
      args[0] === 'rev-parse' ? '.git\n' : 'git version 2.47'
    ),
    readWorktreeLinks: vi.fn(async () => []),
    restart: vi.fn(),
    newMigrationId: () => 'conv-1',
    now: () => new Date('2026-10-24T00:00:00.000Z'),
    ...overrides
  }
}

const REQUEST = { distro: 'Ubuntu', repoIds: ['repo-a'] }

describe('startWslDriveUncConversion', () => {
  it('converts the seeded shape: a saved UNC worktree beside the drive row discovery wrote', async () => {
    const seeded = (driveName: string): PersistedState => {
      const value = state()
      const savedId = `repo-a::${UNC}`
      const discoveredId = `repo-a::${DRIVE}`
      const row = (instanceId: string, displayName: string) => ({
        instanceId,
        displayName,
        comment: '',
        linkedIssue: null,
        linkedPR: null,
        linkedLinearIssue: null,
        isArchived: false,
        isUnread: false,
        isPinned: false,
        sortOrder: 1,
        lastActivityAt: 0,
        hostId: 'local' as const
      })
      value.worktreeMeta = {
        [savedId]: { ...row('saved', 'app'), projectId: 'repo:repo-a' },
        [discoveredId]: row('discovered', driveName)
      }
      value.worktreeIdentityAliases = {
        [`local|${savedId}`]: ['wt2:local:saved'],
        [`local|${discoveredId}`]: ['wt2:local:discovered']
      }
      value.workspaceSession.tabsByWorktree = {
        [savedId]: [
          {
            id: 'tab-1',
            ptyId: 'pty-1',
            worktreeId: savedId,
            title: 'claude',
            customTitle: null,
            color: null,
            sortOrder: 0,
            createdAt: 0
          }
        ]
      }
      return value
    }
    const differing = deps({ readProfileState: async () => seeded('renamed on C:') })
    expect(await startWslDriveUncConversion(differing, REQUEST)).toEqual({
      outcome: 'refused',
      blockers: [
        {
          kind: 'state-conflict',
          detail: `wsl_drive_unc_key_collision: repo-a::${DRIVE}`,
          cause: 'differing-saved-data',
          key: `repo-a::${DRIVE}`
        }
      ]
    })
    const run = deps({ readProfileState: async () => seeded('') })
    expect(await startWslDriveUncConversion(run, REQUEST)).toEqual({
      outcome: 'restarting',
      migrationId: 'conv-1'
    })
  })

  it('refuses a second conversion while one waits for its restart', async () => {
    await startWslDriveUncConversion(deps(), REQUEST)
    expect(await startWslDriveUncConversion(deps(), REQUEST)).toEqual({
      outcome: 'refused',
      blockers: [{ kind: 'conversion-pending' }]
    })
  })

  it('lets a new conversion start while an earlier one only has outside stores left to finish', async () => {
    await startWslDriveUncConversion(deps(), REQUEST)
    const [stuck] = listWslDriveUncConversions(root)
    // Past the profile commit, a store that keeps failing must not block every later conversion.
    writeWslDriveUncConversion(root, { ...stuck, phase: 'profile-rewritten' })
    expect(
      await startWslDriveUncConversion(deps({ newMigrationId: () => 'conv-2' }), REQUEST)
    ).toEqual({ outcome: 'restarting', migrationId: 'conv-2' })
  })

  it("lets another profile convert while this profile's conversion waits for its restart", async () => {
    await startWslDriveUncConversion(deps(), REQUEST)
    await startWslDriveUncConversion(
      deps({ profileId: 'profile-2', newMigrationId: () => 'conv-2' }),
      REQUEST
    )
    // The journal lists in directory order, which differs between filesystems.
    expect(
      listWslDriveUncConversions(root)
        .map((record) => record.profileId)
        .sort()
    ).toEqual(['profile-1', 'profile-2'])
  })
})

describe('startWslDriveUncConversion for a mapped drive', () => {
  const SHARE = String.raw`\\wsl.localhost\Ubuntu`
  const MAPPED = String.raw`W:\home\me\App`

  function mappedState(): PersistedState {
    const value = state()
    value.repos = [{ id: 'repo-a', path: MAPPED, displayName: 'App', badgeColor: '', addedAt: 0 }]
    value.folderWorkspaces = []
    return value
  }

  const MAPPED_REQUEST = {
    distro: 'Ubuntu',
    repoIds: ['repo-a'],
    mappedDriveLetter: 'w',
    mappedDriveShare: SHARE
  }

  it('journals the respelling with the drive mapping read now, and never asks Windows Git', async () => {
    const run = deps({
      readProfileState: async () => mappedState(),
      readMappedDriveShare: vi.fn(async () => ({ share: SHARE }))
    })
    expect(await startWslDriveUncConversion(run, MAPPED_REQUEST)).toEqual({
      outcome: 'restarting',
      migrationId: 'conv-1'
    })
    expect(run.readMappedDriveShare).toHaveBeenCalledWith('w')
    expect(run.runWindowsGit).not.toHaveBeenCalled()
    const [journal] = listWslDriveUncConversions(root)
    expect(journal).toMatchObject({
      mappedDrive: { letter: 'W', share: SHARE },
      repoIds: ['repo-a'],
      rootPaths: [MAPPED],
      worktreeIds: [[`repo-a::${MAPPED}`, String.raw`repo-a::\\wsl.localhost\Ubuntu\home\me\App`]]
    })
    expect(run.restart).toHaveBeenCalledOnce()
  })

  it('refuses when the drive no longer maps into the distro', async () => {
    const run = deps({
      readProfileState: async () => mappedState(),
      readMappedDriveShare: async () => ({ share: String.raw`\\wsl.localhost\Debian` })
    })
    expect(await startWslDriveUncConversion(run, MAPPED_REQUEST)).toEqual({
      outcome: 'refused',
      blockers: [{ kind: 'drive-not-mapped' }]
    })
    expect(run.pause).not.toHaveBeenCalled()
    expect(listWslDriveUncConversions(root)).toEqual([])
  })

  it('refuses a drive remapped to another folder of the distro since the window looked', async () => {
    const run = deps({
      readProfileState: async () => mappedState(),
      readMappedDriveShare: async () => ({ share: String.raw`\\wsl.localhost\Ubuntu\home` })
    })
    expect(await startWslDriveUncConversion(run, MAPPED_REQUEST)).toEqual({
      outcome: 'refused',
      blockers: [{ kind: 'drive-not-mapped' }]
    })
  })

  it('asks to try again when Windows did not answer in time, changing nothing', async () => {
    const run = deps({
      readProfileState: async () => mappedState(),
      readMappedDriveShare: async () => 'unverifiable'
    })
    expect(await startWslDriveUncConversion(run, MAPPED_REQUEST)).toEqual({
      outcome: 'refused',
      blockers: [{ kind: 'drive-unverifiable' }]
    })
    expect(run.pause).not.toHaveBeenCalled()
  })

  it('refuses a project already saved under its share path', async () => {
    const run = deps({
      readProfileState: async () => {
        const value = mappedState()
        value.repos.push({
          id: 'repo-b',
          path: String.raw`\\wsl.localhost\Ubuntu\home\me\App`,
          displayName: 'App',
          badgeColor: '',
          addedAt: 0
        })
        return value
      },
      readMappedDriveShare: async () => ({ share: SHARE })
    })
    expect(await startWslDriveUncConversion(run, MAPPED_REQUEST)).toEqual({
      outcome: 'refused',
      blockers: [{ kind: 'not-convertible', id: 'repo-a', reason: 'duplicate-windows-project' }]
    })
  })
})
