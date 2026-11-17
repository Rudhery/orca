import { describe, expect, it } from 'vitest'
import type { FolderWorkspace } from '../../../shared/folder-workspaces/folder-workspace-types'
import type { Repo } from '../../../shared/repository/repo-types'
import { collectWslMappedDriveScope } from './wsl-mapped-drive-project-scope'

const DRIVE = { letter: 'W', share: String.raw`\\wsl.localhost\Ubuntu` }

function repo(id: string, path: string, extra: Partial<Repo> = {}): Repo {
  return { id, path, displayName: id, badgeColor: '', addedAt: 0, ...extra }
}

function folder(id: string, folderPath: string, extra: Partial<FolderWorkspace> = {}) {
  return {
    id,
    projectGroupId: '',
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
    updatedAt: 0,
    ...extra
  }
}

describe('collectWslMappedDriveScope', () => {
  it('takes local repos on the drive, and nothing elsewhere', () => {
    const scope = collectWslMappedDriveScope(
      {
        repos: [
          repo('on-drive', String.raw`W:\home\me\app`),
          repo('on-c', String.raw`C:\src\app`),
          repo('already-unc', String.raw`\\wsl.localhost\Ubuntu\home\me\other`)
        ],
        folderWorkspaces: [folder('notes', String.raw`W:\home\me\notes`)],
        projectGroups: []
      },
      DRIVE
    )
    expect(scope).toEqual({
      repoIds: ['on-drive'],
      folderWorkspaceIds: [],
      // A folder has no runtime setting, so its share path alone would switch it to WSL.
      refused: [{ kind: 'folder-workspace', id: 'notes', reason: 'runtime-would-change' }]
    })
  })

  it('accepts a worktree folder already saved under the share path', () => {
    const scope = collectWslMappedDriveScope(
      {
        repos: [
          repo('app', String.raw`W:\home\me\app`, {
            worktreeBasePath: String.raw`\\wsl.localhost\Ubuntu\home\me\trees`
          })
        ],
        folderWorkspaces: [],
        projectGroups: [],
        // Saved, so the worktrees on the share keep running where they did.
        projects: [
          { sourceRepoIds: ['app'], localWindowsRuntimePreference: { kind: 'windows-host' } }
        ]
      },
      DRIVE
    )
    expect(scope.repoIds).toEqual(['app'])
  })

  it('refuses split, remote, Windows-drive and already-saved projects', () => {
    const scope = collectWslMappedDriveScope(
      {
        repos: [
          repo('split', String.raw`W:\home\me\app`, { worktreeBasePath: String.raw`D:\trees` }),
          repo('remote', String.raw`W:\home\me\remote`, { connectionId: 'ssh-1' }),
          repo('drvfs', String.raw`W:\mnt\c\src`),
          repo('twin', String.raw`W:\home\me\twin`),
          repo('twin-unc', String.raw`\\wsl.localhost\Ubuntu\home\me\twin`)
        ],
        folderWorkspaces: [],
        projectGroups: []
      },
      DRIVE
    )
    expect(scope.repoIds).toEqual([])
    expect(scope.refused).toEqual([
      { kind: 'repo', id: 'split', reason: 'mixed-locations' },
      { kind: 'repo', id: 'remote', reason: 'not-local' },
      { kind: 'repo', id: 'drvfs', reason: 'windows-drive-folder' },
      { kind: 'repo', id: 'twin', reason: 'duplicate-windows-project' }
    ])
  })

  it('refuses a project whose single runtime could not keep every workspace where it ran', () => {
    const project = (id: string, preference?: { kind: 'wsl'; distro: string }) => ({
      sourceRepoIds: [id],
      localWindowsRuntimePreference: preference
    })
    const scope = collectWslMappedDriveScope(
      {
        repos: [
          repo('base-on-share', String.raw`W:\home\me\a`, {
            worktreeBasePath: String.raw`\\wsl.localhost\Ubuntu\home\me\trees`
          }),
          repo('linked-on-share', String.raw`W:\home\me\b`),
          repo('saved-choice', String.raw`W:\home\me\c`, {
            worktreeBasePath: String.raw`\\wsl.localhost\Ubuntu\home\me\trees`
          })
        ],
        folderWorkspaces: [],
        projectGroups: [],
        projects: [
          project('base-on-share'),
          project('linked-on-share'),
          project('saved-choice', { kind: 'wsl', distro: 'Ubuntu' })
        ],
        worktreeMeta: { [String.raw`linked-on-share::\\wsl.localhost\Ubuntu\home\me\Feature`]: {} }
      },
      DRIVE
    )
    // A saved choice already decides every workspace, so it carries over unchanged.
    expect(scope.repoIds).toEqual(['saved-choice'])
    expect(scope.refused).toEqual([
      { kind: 'repo', id: 'base-on-share', reason: 'runtime-would-change' },
      { kind: 'repo', id: 'linked-on-share', reason: 'runtime-would-change' }
    ])
  })

  it('refuses a repo nested in one it refused, whose paths would otherwise split', () => {
    const scope = collectWslMappedDriveScope(
      {
        repos: [
          repo('outer', String.raw`W:\home\me\mono`, { worktreeBasePath: String.raw`D:\trees` }),
          repo('inner', String.raw`W:\home\me\mono\packages\a`)
        ],
        folderWorkspaces: [],
        projectGroups: []
      },
      DRIVE
    )
    expect(scope.refused).toContainEqual({
      kind: 'repo',
      id: 'inner',
      reason: 'overlaps-refused-project'
    })
  })
})
