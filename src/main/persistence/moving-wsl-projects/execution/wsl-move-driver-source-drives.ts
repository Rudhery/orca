/**
 * The mapped drives a move plans with: read fresh at preview, and at start again, refusing when
 * the drives the selection names differ from what the preview showed (the start request carries
 * them back). With them, the mapped-drive repos the host's Git can't take, which the plan refuses.
 */
import {
  WSL_MOVE_MAPPED_DRIVE_UNVERIFIABLE_DETAIL,
  type WslMoveRefusal,
  type WslMoveRequest
} from '../../../../shared/wsl-move/wsl-move-driver-types'
import {
  sameWslMappedDrives,
  type WslMappedDrive
} from '../../../../shared/wsl-move/wsl-mapped-drive-paths'
import {
  readWslMoveMappedDrives,
  wslMoveDriveLettersInUse
} from '../manifest-scope/wsl-move-mapped-drives'
import type { WslMoveScopeDrives, WslMoveScopeRefusal } from '../manifest-scope/wsl-move-scope'
import { findWindowsGitRefusals } from '../manifest-scope/wsl-move-windows-git-worktrees'
import type { WslMoveCatalogRows, WslMoveDriverDeps } from './wsl-move-driver-ports'

export type WslMoveSourceDrives = Required<WslMoveScopeDrives> & {
  mappedDrives: WslMappedDrive[]
  windowsGitRefusals: ReadonlyMap<string, WslMoveScopeRefusal>
}

/** The letters the request's rows name; every local row's when it names none. */
function requestedLetters(
  catalog: WslMoveCatalogRows,
  request: Pick<WslMoveRequest, 'repoIds' | 'folderWorkspaceIds'>
): string[] {
  const whole = !request.repoIds && !request.folderWorkspaceIds
  return wslMoveDriveLettersInUse({
    repos: catalog.repos.filter((repo) => whole || request.repoIds?.includes(repo.id)),
    folderWorkspaces: catalog.folderWorkspaces.filter(
      (folder) => whole || request.folderWorkspaceIds?.includes(folder.id)
    )
  })
}

export async function readWslMoveSourceDrives(
  deps: Pick<WslMoveDriverDeps, 'driveShares' | 'windowsGitVerdict'>,
  catalog: WslMoveCatalogRows,
  request: WslMoveRequest,
  /** At start: the drives the preview showed. Null for a preview. */
  expected: readonly WslMappedDrive[] | null
): Promise<WslMoveSourceDrives | WslMoveRefusal> {
  const read = deps.driveShares
    ? await readWslMoveMappedDrives(catalog, request.distro, deps.driveShares)
    : { mappedDrives: [], unverifiableLetters: [] }
  if (expected) {
    // Only drives this selection names count: an unrelated W: never stops a UNC-only start.
    const relevant = new Set([
      ...expected.map((drive) => drive.letter.toUpperCase()),
      ...requestedLetters(catalog, request)
    ])
    if (read.unverifiableLetters.some((letter) => relevant.has(letter))) {
      return {
        outcome: 'refused',
        code: 'wsl_move_unavailable',
        detail: WSL_MOVE_MAPPED_DRIVE_UNVERIFIABLE_DETAIL
      }
    }
    const fresh = read.mappedDrives.filter((drive) => relevant.has(drive.letter.toUpperCase()))
    if (!sameWslMappedDrives(expected, fresh)) {
      return { outcome: 'refused', code: 'wsl_move_scope_changed', detail: 'mapped-drives-changed' }
    }
  }
  const windowsGitRefusals =
    deps.windowsGitVerdict && read.mappedDrives.length > 0
      ? await findWindowsGitRefusals(
          catalog.repos,
          request.distro,
          read.mappedDrives,
          deps.windowsGitVerdict
        )
      : new Map<string, WslMoveScopeRefusal>()
  return { ...read, windowsGitRefusals }
}

/** The drives a move journals: only those its exported paths named, so a UNC move stays v1. */
export function journaledWslMoveDrives(
  mappedDrives: readonly WslMappedDrive[],
  exportedLetters: readonly string[] | undefined
): WslMappedDrive[] {
  if (!exportedLetters) {
    return [...mappedDrives]
  }
  const named = new Set(exportedLetters)
  return mappedDrives.filter((drive) => named.has(drive.letter.toUpperCase()))
}
