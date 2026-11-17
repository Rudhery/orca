/** What an unreadable WSL move journal still fences: folders its moves could have taken. */
import { isWslUncPath } from '../../../../shared/file-access/wsl-paths'
import {
  classifyWslMappedDrive,
  wslMappedDriveLastKnownShare
} from '../../../wsl/filesystem/wsl-mapped-drive-share'

/**
 * Without the journal, any folder a move could have taken: a UNC path, or a drive letter not
 * known to point outside WSL (a moved `W:\` row has nothing else marking it as moved).
 */
export function mayBeInWsl(path: string): boolean {
  if (isWslUncPath(path)) {
    return true
  }
  const letter = /^([A-Za-z]):[\\/]/.exec(path)?.[1]
  if (!letter) {
    return false
  }
  const known = wslMappedDriveLastKnownShare(letter)
  if (!known) {
    // One bounded, cached lookup, so a local drive's projects unblock once it answers.
    void classifyWslMappedDrive(letter).catch(() => {})
  }
  return !known || (known.share !== null && isWslUncPath(known.share))
}
