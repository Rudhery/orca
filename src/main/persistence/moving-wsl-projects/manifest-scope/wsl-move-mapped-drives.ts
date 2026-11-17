/**
 * The drive letters mapped into a distro (`net use W: \\wsl.localhost\Ubuntu`) that local
 * projects are saved under. Read fresh at preview and again at start, never from a cache: the
 * move journals this mapping, and every recovery maps the moved paths with it.
 */
import type { FolderWorkspace } from '../../../../shared/folder-workspaces/folder-workspace-types'
import type { Repo } from '../../../../shared/repository/repo-types'
import type { WslMappedDrive } from '../../../../shared/wsl-move/wsl-mapped-drive-paths'
import {
  wslMappedDriveMatches,
  type WslMappedDriveRead
} from '../../../wsl/filesystem/wsl-mapped-drive-share'
import { isLocalWslMoveRow } from '../quiescence/wsl-move-scope-guard'
import { wslMoveRepoPaths } from './wsl-move-scope'

export type WslMoveMappedDrivesRead = {
  mappedDrives: WslMappedDrive[]
  /** Windows did not answer for these letters, which local projects use. */
  unverifiableLetters: string[]
}

const DRIVE_PATH = /^([A-Za-z]):[\\/]/

/** The distinct drive letters, uppercase, every path the move's scope reads names. */
export function wslMoveDriveLettersInUse(rows: {
  repos: readonly Repo[]
  folderWorkspaces: readonly FolderWorkspace[]
}): string[] {
  const paths = [
    ...rows.repos.filter(isLocalWslMoveRow).flatMap((repo) => wslMoveRepoPaths(repo)),
    ...rows.folderWorkspaces.filter(isLocalWslMoveRow).map((folder) => folder.folderPath)
  ]
  const letters = new Set(paths.flatMap((path) => DRIVE_PATH.exec(path)?.[1].toUpperCase() ?? []))
  return [...letters].sort()
}

export async function readWslMoveMappedDrives(
  rows: { repos: readonly Repo[]; folderWorkspaces: readonly FolderWorkspace[] },
  distro: string,
  readShare: (letter: string) => Promise<WslMappedDriveRead>
): Promise<WslMoveMappedDrivesRead> {
  const letters = wslMoveDriveLettersInUse(rows)
  const reads = await Promise.all(
    letters.map(async (letter) => ({
      letter,
      read: await readShare(letter).catch((): WslMappedDriveRead => 'unverifiable')
    }))
  )
  const unverifiableLetters = reads
    .filter(({ read }) => read === 'unverifiable')
    .map(({ letter }) => letter)
  const mappedDrives = reads.flatMap(({ letter, read }) =>
    read !== 'unverifiable' && wslMappedDriveMatches(read.share, distro, undefined)
      ? [{ letter, share: read.share }]
      : []
  )
  return { mappedDrives, unverifiableLetters }
}
