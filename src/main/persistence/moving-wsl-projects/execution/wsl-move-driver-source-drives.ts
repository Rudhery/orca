/**
 * The mapped drives a move plans with: read fresh at preview, and at start again. The start then
 * refuses when the drives its own planned rows name differ from what the preview showed (the start
 * request carries them back). With them, the mapped-drive repos the host's Git can't take.
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

/** The letters of the rows a request names; null when it names none (the whole distro). */
function namedLetters(
  catalog: WslMoveCatalogRows,
  request: Pick<WslMoveRequest, 'repoIds' | 'folderWorkspaceIds'>
): string[] | null {
  if (!request.repoIds && !request.folderWorkspaceIds) {
    return null
  }
  return wslMoveDriveLettersInUse({
    repos: catalog.repos.filter((repo) => request.repoIds?.includes(repo.id)),
    folderWorkspaces: catalog.folderWorkspaces.filter((folder) =>
      request.folderWorkspaceIds?.includes(folder.id)
    )
  })
}

export async function readWslMoveSourceDrives(
  deps: Pick<WslMoveDriverDeps, 'driveShares' | 'windowsGitVerdict'>,
  catalog: WslMoveCatalogRows,
  request: WslMoveRequest
): Promise<WslMoveSourceDrives> {
  const read = deps.driveShares
    ? await readWslMoveMappedDrives(catalog, request.distro, deps.driveShares)
    : { mappedDrives: [], unverifiableLetters: [], unknownLetters: [] }
  const named = namedLetters(catalog, request) ?? []
  // An unclassified drive (an offline share, say) is this distro's to list only when picked.
  const unverifiableLetters = [
    ...read.unverifiableLetters,
    ...read.unknownLetters.filter((letter) => named.includes(letter))
  ]
  const windowsGitRefusals =
    deps.windowsGitVerdict && read.mappedDrives.length > 0
      ? await findWindowsGitRefusals(
          catalog.repos,
          request.distro,
          read.mappedDrives,
          deps.windowsGitVerdict
        )
      : new Map<string, WslMoveScopeRefusal>()
  return { mappedDrives: read.mappedDrives, unverifiableLetters, windowsGitRefusals }
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

/**
 * At start: the drives this start will journal, and those of the rows it names, must map where
 * the preview showed. Hidden, retained, refused or unrelated rows never count.
 */
export function wslMoveStartDriveRefusal(
  catalog: WslMoveCatalogRows,
  request: WslMoveRequest,
  drives: Pick<WslMoveSourceDrives, 'mappedDrives' | 'unverifiableLetters'>,
  journaled: readonly WslMappedDrive[],
  expected: readonly WslMappedDrive[]
): WslMoveRefusal | null {
  const named = namedLetters(catalog, request)
  // A drive the preview showed, or one a picked row uses, that no longer answers.
  const needed = new Set([...expected.map((drive) => drive.letter.toUpperCase()), ...(named ?? [])])
  if (drives.unverifiableLetters.some((letter) => needed.has(letter))) {
    return {
      outcome: 'refused',
      code: 'wsl_move_unavailable',
      detail: WSL_MOVE_MAPPED_DRIVE_UNVERIFIABLE_DETAIL
    }
  }
  const relevant = new Set([
    ...journaled.map((drive) => drive.letter.toUpperCase()),
    ...(named ?? [])
  ])
  const only = (list: readonly WslMappedDrive[]): WslMappedDrive[] =>
    list.filter((drive) => relevant.has(drive.letter.toUpperCase()))
  return sameWslMappedDrives(only(expected), only(drives.mappedDrives))
    ? null
    : { outcome: 'refused', code: 'wsl_move_scope_changed', detail: 'mapped-drives-changed' }
}
