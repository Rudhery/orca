// Move local repos/folders only when every path stays in one distro outside Windows drive mounts.
import { posix } from 'node:path'
import { getRepoExecutionHostId } from '../../../../shared/execution-host/execution-host'
import { resolveFolderWorkspaceHost } from '../../../../shared/folder-workspaces/folder-workspace-execution-host'
import type { FolderWorkspace } from '../../../../shared/folder-workspaces/folder-workspace-types'
import type { ProjectGroup } from '../../../../shared/project/groups/project-group-types'
import type { Repo } from '../../../../shared/repository/repo-types'
import {
  isDrvfsLinuxPath,
  resolveWslRepoWorktreeBasePath
} from '../../../../shared/file-access/wsl-paths'
import {
  toWslDistroUncPath,
  wslMoveSourcePathToLinux,
  type WslMappedDrive
} from '../../../../shared/wsl-move/wsl-mapped-drive-paths'

export type WslMoveScopeRefusal =
  /** Distro access does not make Windows-drive projects Linux-owned. */
  | 'windows-drive'
  | 'mixed-locations'
  | 'not-local'
  /** Linked worktrees Git for Windows created: the host's Git can't follow their links. */
  | 'windows-git-worktrees'

export type WslMoveScope = {
  repoIds: string[]
  folderWorkspaceIds: string[]
  refused: { kind: 'repo' | 'folder-workspace'; id: string; reason: WslMoveScopeRefusal }[]
}

type WslMoveScopeState = {
  repos: readonly Repo[]
  folderWorkspaces: readonly FolderWorkspace[]
  projectGroups: readonly ProjectGroup[]
}

export function collectWslMoveScope(
  state: WslMoveScopeState,
  distro: string,
  mappedDrives: readonly WslMappedDrive[] = [],
  /** Mapped-drive repos with worktrees Git for Windows created (wsl-move-windows-git-worktrees). */
  windowsGitWorktreeRepoIds: ReadonlySet<string> = new Set()
): WslMoveScope {
  const scope: WslMoveScope = { repoIds: [], folderWorkspaceIds: [], refused: [] }
  const toLinux = (path: string): string | null =>
    wslMoveSourcePathToLinux(path, distro, mappedDrives)
  for (const repo of state.repos) {
    const paths = wslMoveMappedRepoPaths(repo, mappedDrives)
    // Partly in-distro repos must refuse visibly rather than disappear from the preview.
    if (!paths.some((path) => toLinux(path) !== null)) {
      continue
    }
    const reason =
      refusalFor(paths, toLinux, getRepoExecutionHostId(repo) !== 'local') ??
      (windowsGitWorktreeRepoIds.has(repo.id) ? 'windows-git-worktrees' : null)
    if (reason) {
      scope.refused.push({ kind: 'repo', id: repo.id, reason })
    } else {
      scope.repoIds.push(repo.id)
    }
  }
  const hostState = {
    repos: [...state.repos],
    projectGroups: [...state.projectGroups]
  }
  for (const workspace of state.folderWorkspaces) {
    if (toLinux(workspace.folderPath) === null) {
      continue
    }
    // Isolate this row: other hosts may reuse the same folder ID.
    const remote =
      resolveFolderWorkspaceHost({ ...hostState, folderWorkspaces: [workspace] }, workspace.id)
        .kind !== 'local'
    const reason = refusalFor([workspace.folderPath], toLinux, remote)
    if (reason) {
      scope.refused.push({ kind: 'folder-workspace', id: workspace.id, reason })
    } else {
      scope.folderWorkspaceIds.push(workspace.id)
    }
  }
  return scope
}

export function wslMoveRepoPaths(repo: Repo): string[] {
  return wslMoveMappedRepoPaths(repo, [])
}

/** Every folder a repo names; relative and Linux bases resolve against its share spelling. */
export function wslMoveMappedRepoPaths(
  repo: Repo,
  mappedDrives: readonly WslMappedDrive[]
): string[] {
  const repoPath = toWslDistroUncPath(repo.path, mappedDrives)
  const base = repo.worktreeBasePath
    ? resolveWslRepoWorktreeBasePath(repoPath, repo.worktreeBasePath)
    : undefined
  return [
    repo.path,
    // Resolve relative bases before checking distro ownership.
    ...(base ? [isRelative(base) ? posixJoinUnc(repoPath, base) : base] : []),
    ...(repo.folderUpgradeGitRootPath ? [repo.folderUpgradeGitRootPath] : []),
    ...(repo.customWorktreeVisibilitySources ?? []).map((source) => source.rootPath),
    ...(repo.externalWorktreeInboxBaselinePaths ?? []),
    ...(repo.importedExternalWorktreePaths ?? [])
  ]
}

/** Drive-relative C:trees stays on Windows. */
function isRelative(path: string): boolean {
  return !/^(?:[A-Za-z]:|[\\/])/.test(path)
}

function posixJoinUnc(repoUnc: string, relative: string): string {
  return `${repoUnc.replace(/[\\/]+$/, '')}/${relative.replace(/\\/g, '/')}`
}

function refusalFor(
  paths: readonly string[],
  toLinux: (path: string) => string | null,
  remote: boolean
): WslMoveScopeRefusal | null {
  if (remote) {
    return 'not-local'
  }
  const linuxPaths: string[] = []
  for (const path of paths) {
    const linux = toLinux(path)
    if (linux === null) {
      return 'mixed-locations'
    }
    linuxPaths.push(posix.normalize(linux.replace(/\\/g, '/')))
  }
  // Windows folds the /mnt/<drive> UNC tail case-insensitively.
  return linuxPaths.some((path) => isDrvfsLinuxPath(path.toLowerCase())) ? 'windows-drive' : null
}
