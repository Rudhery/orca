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
  parseWslUncPath,
  wslHostMovableDistroOfPath,
  wslUncPathToLinux
} from '../../../shared/file-access/wsl-paths'
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
          (claimedRepoPaths.has(key) ? 'duplicate-windows-project' : null))
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
    const reason = !isLocal(workspace)
      ? 'not-local'
      : (refusalOf([workspace.folderPath]) ??
        (claimedFolderPaths.has(key) ? 'duplicate-windows-project' : null))
    if (reason) {
      scope.refused.push({ kind: 'folder-workspace', id: workspace.id, reason })
    } else {
      claimedFolderPaths.add(key)
      scope.folderWorkspaceIds.push(workspace.id)
    }
  }
  return scope
}
