/** The move's view of drive letters mapped into a distro: Windows only, read fresh each time. */
import type { Store } from '../../persistence/loading-store/store'
import type { WslMoveDriverDeps } from '../../persistence/moving-wsl-projects/execution/wsl-move-driver-ports'
import { readWslMoveMappedDrives } from '../../persistence/moving-wsl-projects/manifest-scope/wsl-move-mapped-drives'
import { windowsGitWorktreePaths } from '../../persistence/moving-wsl-projects/manifest-scope/wsl-move-windows-git-worktrees'
import type { WslMappedDrive } from '../../../shared/wsl-move/wsl-mapped-drive-paths'
import { readWslMappedDriveShareNow } from '../../wsl/filesystem/wsl-mapped-drive-share'

export function wslMoveMappedDrivePorts(): Pick<
  WslMoveDriverDeps,
  'readMappedDriveShare' | 'windowsGitWorktrees'
> {
  return process.platform === 'win32'
    ? {
        readMappedDriveShare: (letter) => readWslMappedDriveShareNow(letter),
        windowsGitWorktrees: windowsGitWorktreePaths
      }
    : {}
}

/** For the orchestrator's prune check; absent off Windows, where no drive is mapped. */
export function readWslMoveDistroMappedDrives(
  store: Pick<Store, 'getRepos' | 'getFolderWorkspaces'>,
  distro: string
): (() => Promise<readonly WslMappedDrive[] | 'unverifiable'>) | undefined {
  if (process.platform !== 'win32') {
    return undefined
  }
  return async () => {
    const read = await readWslMoveMappedDrives(
      { repos: store.getRepos(), folderWorkspaces: store.getFolderWorkspaces() },
      distro,
      (letter) => readWslMappedDriveShareNow(letter)
    )
    // Pruning is the cautious side: an unanswered drive may still hold this distro's projects.
    return read.unverifiableLetters.length === 0 ? read.mappedDrives : 'unverifiable'
  }
}
