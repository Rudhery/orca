/**
 * The mapped drives a move plans with: read fresh at preview, and at start again, refusing when
 * they differ from what the preview showed (the start request carries them back). With them, the
 * mapped-drive repos whose worktrees Git for Windows created, which the plan refuses.
 */
import {
  WSL_MOVE_MAPPED_DRIVE_UNVERIFIABLE_DETAIL,
  type WslMoveRefusal
} from '../../../../shared/wsl-move/wsl-move-driver-types'
import {
  sameWslMappedDrives,
  type WslMappedDrive
} from '../../../../shared/wsl-move/wsl-mapped-drive-paths'
import { readWslMoveMappedDrives } from '../manifest-scope/wsl-move-mapped-drives'
import { findWindowsGitWorktreeRepoIds } from '../manifest-scope/wsl-move-windows-git-worktrees'
import type { WslMoveCatalogRows, WslMoveDriverDeps } from './wsl-move-driver-ports'

export type WslMoveSourceDrives = {
  mappedDrives: WslMappedDrive[]
  windowsGitWorktreeRepoIds: ReadonlySet<string>
}

export async function readWslMoveSourceDrives(
  deps: Pick<WslMoveDriverDeps, 'readMappedDriveShare' | 'windowsGitWorktrees'>,
  catalog: WslMoveCatalogRows,
  distro: string,
  /** At start: the drives the preview showed. Null for a preview. */
  expected: readonly WslMappedDrive[] | null
): Promise<WslMoveSourceDrives | WslMoveRefusal> {
  const read = deps.readMappedDriveShare
    ? await readWslMoveMappedDrives(catalog, distro, deps.readMappedDriveShare)
    : { mappedDrives: [], unverifiableLetters: [] }
  // A drive that doesn't answer (an offline network share, say) only keeps its own projects out;
  // a start loses a drive the preview showed, so it refuses rather than move without it.
  const lostLetters = (expected ?? []).filter((drive) =>
    read.unverifiableLetters.includes(drive.letter.toUpperCase())
  )
  if (lostLetters.length > 0) {
    return {
      outcome: 'refused',
      code: 'wsl_move_unavailable',
      detail: WSL_MOVE_MAPPED_DRIVE_UNVERIFIABLE_DETAIL
    }
  }
  const { mappedDrives } = read
  if (expected && !sameWslMappedDrives(expected, mappedDrives)) {
    return { outcome: 'refused', code: 'wsl_move_scope_changed', detail: 'mapped-drives-changed' }
  }
  const windowsGitWorktreeRepoIds =
    deps.windowsGitWorktrees && mappedDrives.length > 0
      ? await findWindowsGitWorktreeRepoIds(
          catalog.repos,
          distro,
          mappedDrives,
          deps.windowsGitWorktrees
        )
      : new Set<string>()
  return { mappedDrives, windowsGitWorktreeRepoIds }
}
