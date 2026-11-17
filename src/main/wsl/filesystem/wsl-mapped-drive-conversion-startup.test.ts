import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
// Runs on Node's SQLite: the startup reopens the profile read-only, which Bun's macOS build refuses.
import '../../sqlite/sync-database'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getDefaultPersistedState } from '../../../shared/orca-profiles/constants'
import type { PersistedState } from '../../../shared/orca-profiles/persisted-state-types'
import { readProfileProjectTransferState } from '../../orca-profiles/project-transfer/profile-project-domain-state'
import { getOrcaProfileStateDatabaseFile } from '../../orca-profiles/profile-storage-paths'
import { openProfileStateDatabase } from '../../persistence/profile-state/database/profile-state-database'
import { importProfileStateJson } from '../../persistence/profile-state/documents/profile-state-documents'
import { resolveWslMoveFence } from '../../persistence/moving-wsl-projects/quiescence/wsl-move-fence'
import {
  listWslDriveUncConversions,
  writeWslDriveUncConversion,
  type WslDriveUncConversion
} from './wsl-drive-unc-conversion-journal'
import {
  runWslDriveUncConversionsAtStartup,
  wslMappedDriveMovesDueOf
} from './wsl-drive-unc-conversion-startup'
import type { WslMappedDriveRead } from './wsl-mapped-drive-share'

const PROFILE = 'profile-1'
const SHARE = String.raw`\\wsl.localhost\Ubuntu`
const MAPPED = String.raw`W:\home\me\App`
const UNC = String.raw`\\wsl.localhost\Ubuntu\home\me\App`
const OLD_ID = `repo-a::${MAPPED}`
const NEW_ID = `repo-a::${UNC}`

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'orca-mapped-drive-startup-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function profileState(): PersistedState {
  const state = getDefaultPersistedState('/home/me')
  state.repos = [{ id: 'repo-a', path: MAPPED, displayName: 'App', badgeColor: '', addedAt: 0 }]
  state.projectGroups = [
    {
      id: 'group-w',
      name: 'me',
      parentPath: String.raw`W:\home\me`,
      parentGroupId: null,
      createdFrom: 'folder-scan',
      tabOrder: 0,
      isCollapsed: false,
      color: null,
      createdAt: 0,
      updatedAt: 0
    }
  ]
  state.folderWorkspaces = [
    folder('notes', String.raw`W:\home\me\notes`),
    // Another drive's folder is not the mapped drive's, even with the same tail.
    folder('other', String.raw`X:\home\me\notes`)
  ]
  state.projects = [
    {
      id: 'repo-a',
      displayName: 'App',
      badgeColor: '',
      sourceRepoIds: ['repo-a'],
      createdAt: 0,
      updatedAt: 0
    }
  ]
  state.worktreeMeta = {
    [OLD_ID]: {
      displayName: 'App',
      comment: 'keep me',
      linkedIssue: null,
      linkedPR: null,
      linkedLinearIssue: null,
      isArchived: false,
      isUnread: false,
      isPinned: false,
      sortOrder: 0,
      lastActivityAt: 0
    }
  }
  state.workspaceSession.activeWorktreeId = OLD_ID
  state.workspaceSession.tabsByWorktree = {
    [OLD_ID]: [
      {
        id: 'tab-1',
        ptyId: `${OLD_ID}@@s1`,
        worktreeId: OLD_ID,
        title: 'shell',
        customTitle: null,
        color: null,
        sortOrder: 0,
        createdAt: 0
      }
    ]
  }
  return state
}

function folder(id: string, folderPath: string): PersistedState['folderWorkspaces'][number] {
  return {
    id,
    projectGroupId: id === 'notes' ? 'group-w' : '',
    name: id,
    folderPath,
    linkedTask: null,
    comment: '',
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 0,
    createdAt: 0,
    updatedAt: 0
  }
}

function seedProfile(state: PersistedState): void {
  const file = getOrcaProfileStateDatabaseFile(PROFILE, root)
  mkdirSync(join(file, '..'), { recursive: true })
  const opened = openProfileStateDatabase(file, PROFILE)
  try {
    importProfileStateJson(opened.db, JSON.stringify(state))
  } finally {
    opened.db.close()
  }
}

function journal(overrides: Partial<WslDriveUncConversion> = {}): void {
  writeWslDriveUncConversion(root, {
    version: 1,
    migrationId: 'conv-1',
    profileId: PROFILE,
    distro: 'Ubuntu',
    mappedDrive: { letter: 'W', share: SHARE },
    repoIds: ['repo-a'],
    folderWorkspaceIds: ['notes'],
    rootPaths: [MAPPED, String.raw`W:\home\me\notes`],
    phase: 'prepared',
    worktreeIds: [[OLD_ID, NEW_ID]],
    rewrittenStores: [],
    createdAt: '2026-11-16T00:00:00.000Z',
    updatedAt: '2026-11-16T00:00:00.000Z',
    ...overrides
  })
}

function run(read: WslMappedDriveRead = { share: SHARE }) {
  return runWslDriveUncConversionsAtStartup({
    userDataPath: root,
    profileUserDataPath: root,
    profileId: PROFILE,
    stores: [],
    now: () => new Date('2026-11-16T00:00:05.000Z'),
    readMappedDriveShare: async () => read
  })
}

describe('a mapped-drive conversion at startup', () => {
  it('respells the projects to their share path and keeps their runtime choice', async () => {
    seedProfile(profileState())
    journal()
    const outcomes = await run()
    expect(outcomes).toEqual([
      {
        migrationId: 'conv-1',
        outcome: 'converted',
        repoIds: ['repo-a'],
        folderWorkspaceIds: ['notes'],
        distro: 'Ubuntu',
        mappedDrive: true,
        respelledThisRun: true
      }
    ])
    const state = readProfileProjectTransferState(PROFILE, root).state
    expect(state.repos[0].path).toBe(UNC)
    expect(state.folderWorkspaces.map((folder) => folder.folderPath)).toEqual([
      String.raw`\\wsl.localhost\Ubuntu\home\me\notes`,
      String.raw`X:\home\me\notes`
    ])
    expect(state.worktreeMeta[NEW_ID]).toMatchObject({
      comment: 'keep me',
      priorWorktreeIds: [OLD_ID]
    })
    expect(state.workspaceSession.activeWorktreeId).toBe(NEW_ID)
    // Every member converts, so the group's parent folder is respelled with them.
    expect(state.projectGroups[0].parentPath).toBe(String.raw`\\wsl.localhost\Ubuntu\home\me`)
    expect(state.workspaceSession.tabsByWorktree[NEW_ID]?.[0]).toMatchObject({
      ptyId: `${NEW_ID}@@s1`,
      worktreeId: NEW_ID
    })
    // With nothing saved it ran the global default; the share path alone would now infer WSL.
    expect(state.projects[0].localWindowsRuntimePreference).toEqual({ kind: 'inherit-global' })
    expect(wslMappedDriveMovesDueOf(outcomes)).toEqual([
      { distro: 'Ubuntu', repoIds: ['repo-a'], folderWorkspaceIds: ['notes'] }
    ])
  })

  it('reports the move due only on the run that rewrote the profile', async () => {
    seedProfile(profileState())
    // The window's stores never recorded themselves, so the journal outlives the first run.
    journal()
    expect(wslMappedDriveMovesDueOf(await run())).toHaveLength(1)
    expect(listWslDriveUncConversions(root)).toHaveLength(1)
    expect(wslMappedDriveMovesDueOf(await run())).toEqual([])
  })

  it.each([
    ['the drive now maps elsewhere', { share: String.raw`\\wsl.localhost\Debian` }, {}],
    ['Windows cannot say where it maps', 'unverifiable' as const, {}],
    [
      'the plan is left over from long ago',
      { share: SHARE },
      { createdAt: '2026-11-01T00:00:00.000Z' }
    ]
  ])('rolls back, changing nothing, when %s', async (_why, read, overrides) => {
    seedProfile(profileState())
    journal(overrides)
    const [outcome] = await run(read)
    expect(outcome).toMatchObject({ migrationId: 'conv-1', outcome: 'rolled-back' })
    expect(readProfileProjectTransferState(PROFILE, root).state.repos[0].path).toBe(MAPPED)
    expect(listWslDriveUncConversions(root)).toEqual([])
  })

  it('keeps its journal apart from D1c so an older build never runs it as one', () => {
    journal()
    expect(existsSync(join(root, 'wsl-mapped-drive-conversions', 'conv-1.json'))).toBe(true)
    expect(existsSync(join(root, 'wsl-drive-unc-conversions'))).toBe(false)
    expect(listWslDriveUncConversions(root)).toEqual([
      expect.objectContaining({ mappedDrive: { letter: 'W', share: SHARE } })
    ])
  })

  it('fences the pending projects by their share path', () => {
    journal()
    const fence = resolveWslMoveFence(root)
    expect([...fence.fenced.repoIds]).toEqual(['repo-a'])
    expect([...fence.fenced.folderWorkspaceIds]).toEqual(['notes'])
    expect(fence.fencedRoots).toEqual([
      {
        distro: 'Ubuntu',
        roots: ['//wsl.localhost/ubuntu/home/me/App', '//wsl.localhost/ubuntu/home/me/notes']
      }
    ])
  })

  it('reports no move due for a D1c conversion', () => {
    expect(
      wslMappedDriveMovesDueOf([
        {
          migrationId: 'conv-2',
          outcome: 'converted',
          repoIds: ['repo-b'],
          folderWorkspaceIds: [],
          distro: 'Ubuntu'
        }
      ])
    ).toEqual([])
  })
})
