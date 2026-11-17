/**
 * Projects saved under a drive letter mapped to a distro share (`W:\home\x` with `W:` ->
 * `\\wsl.localhost\Ubuntu`). The WSL move only takes a project by its share path, so the
 * conversion respells each in place first. This is the scope; nothing here writes.
 */
import {
  getRepoExecutionHostId,
  LOCAL_EXECUTION_HOST_ID
} from '../../../shared/execution-host/execution-host'
import { normalizeRuntimePathForComparison } from '../../../shared/file-access/cross-platform-path'
import { resolveFolderWorkspaceHost } from '../../../shared/folder-workspaces/folder-workspace-execution-host'
import type { FolderWorkspace } from '../../../shared/folder-workspaces/folder-workspace-types'
import type { ProjectGroup } from '../../../shared/project/groups/project-group-types'
import type { Repo } from '../../../shared/repository/repo-types'
import {
  isWslUncPath,
  parseWslUncPath,
  wslHostMovableDistroOfPath,
  wslUncPathToLinux
} from '../../../shared/file-access/wsl-paths'
import type { Project } from '../../../shared/project/project-types'
import { getRepoIdFromWorktreeId, splitWorktreeIdForFilesystem } from '../../../shared/worktree/id'
import {
  wslMappedDrivePathToShare,
  type WslMappedDrive
} from '../../../shared/wsl-move/wsl-drive-unc-respelling'
import { wslMoveRepoPaths } from '../../persistence/moving-wsl-projects/manifest-scope/wsl-move-scope'
import {
  refuseWslDriveUncOverlaps,
  type WslDriveUncRefusal,
  type WslDriveUncScope
} from './wsl-drive-unc-project-scope'

type WslMappedDriveScopeState = {
  repos: readonly Repo[]
  folderWorkspaces: readonly FolderWorkspace[]
  projectGroups: readonly ProjectGroup[]
  projects?: readonly Pick<Project, 'sourceRepoIds' | 'localWindowsRuntimePreference'>[]
  /** Saved worktree rows, keyed by worktree id, which names each worktree's folder. */
  worktreeMeta?: Readonly<Record<string, unknown>>
}

export function collectWslMappedDriveScope(
  state: WslMappedDriveScopeState,
  drive: WslMappedDrive
): WslDriveUncScope {
  const scope: WslDriveUncScope = { repoIds: [], folderWorkspaceIds: [], refused: [] }
  const toShare = (path: string): string | null => wslMappedDrivePathToShare(path, drive)
  const distro = parseWslUncPath(drive.share)?.distro ?? ''
  const refusalOf = (paths: readonly string[]): WslDriveUncRefusal | null => {
    // A folder already saved under the share path (a worktree, say) needs no respelling.
    const shares = paths.map((path) =>
      wslUncPathToLinux(path, distro) === null ? toShare(path) : path
    )
    if (shares.some((share) => share === null)) {
      return 'mixed-locations'
    }
    // A Windows drive seen through the distro (`W:\mnt\c`) is not the distro's, so it can't move.
    return shares.every((share) => share !== null && wslHostMovableDistroOfPath(share))
      ? null
      : 'windows-drive-folder'
  }
  // Share paths already taken: the same folder saved under its share path is that project.
  const claimedRepoPaths = new Set(
    state.repos
      .filter((repo) => getRepoExecutionHostId(repo) === LOCAL_EXECUTION_HOST_ID)
      .map((repo) => normalizeRuntimePathForComparison(repo.path))
  )
  for (const repo of state.repos) {
    const target = toShare(repo.path)
    if (!target) {
      continue
    }
    const key = normalizeRuntimePathForComparison(target)
    const reason =
      getRepoExecutionHostId(repo) !== LOCAL_EXECUTION_HOST_ID
        ? 'not-local'
        : (refusalOf(wslMoveRepoPaths(repo)) ??
          (claimedRepoPaths.has(key)
            ? 'duplicate-windows-project'
            : runtimeWouldChange(state, repo.id)
              ? 'runtime-would-change'
              : null))
    if (reason) {
      scope.refused.push({ kind: 'repo', id: repo.id, reason })
    } else {
      claimedRepoPaths.add(key)
      scope.repoIds.push(repo.id)
    }
  }
  refuseWslDriveUncOverlaps(scope, state.repos, toShare)
  const hostState = { repos: [...state.repos], projectGroups: [...state.projectGroups] }
  // This row alone: another host may hold a folder workspace with the same id.
  const isLocal = (workspace: FolderWorkspace): boolean =>
    resolveFolderWorkspaceHost({ ...hostState, folderWorkspaces: [workspace] }, workspace.id)
      .kind === 'local'
  const claimedFolderPaths = new Set(
    state.folderWorkspaces
      .filter(isLocal)
      .map((workspace) => normalizeRuntimePathForComparison(workspace.folderPath))
  )
  for (const workspace of state.folderWorkspaces) {
    const target = toShare(workspace.folderPath)
    if (!target) {
      continue
    }
    const key = normalizeRuntimePathForComparison(target)
    // A folder has no runtime setting: its share path alone would switch its terminals to WSL.
    const reason = !isLocal(workspace)
      ? 'not-local'
      : (refusalOf([workspace.folderPath]) ??
        (claimedFolderPaths.has(key) ? 'duplicate-windows-project' : 'runtime-would-change'))
    if (reason) {
      scope.refused.push({ kind: 'folder-workspace', id: workspace.id, reason })
    } else {
      claimedFolderPaths.add(key)
      scope.folderWorkspaceIds.push(workspace.id)
    }
  }
  return scope
}

/**
 * A project with no saved runtime runs each workspace by its own path: a drive path on the global
 * default, a share path in the distro. The respelling pins the global default, which would move a
 * workspace already on the share out of the distro, so a project with one is refused instead.
 */
function runtimeWouldChange(state: WslMappedDriveScopeState, repoId: string): boolean {
  const project = state.projects?.find((entry) => entry.sourceRepoIds.includes(repoId))
  if (project?.localWindowsRuntimePreference !== undefined) {
    return false
  }
  const repoIds = new Set(project?.sourceRepoIds ?? [repoId])
  const paths = [
    ...state.repos.filter((repo) => repoIds.has(repo.id)).flatMap(wslMoveRepoPaths),
    ...Object.keys(state.worktreeMeta ?? {}).flatMap((worktreeId) => {
      const split = splitWorktreeIdForFilesystem(worktreeId)
      return split && repoIds.has(getRepoIdFromWorktreeId(worktreeId)) ? [split.worktreePath] : []
    })
  ]
  return paths.some(isWslUncPath)
}
