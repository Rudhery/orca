/** What an unreadable WSL move journal still fences: folders its moves could have taken. */
import { isWslUncPath } from '../../../../shared/file-access/wsl-paths'
import { wslMappedDriveLastKnownShare } from '../../../wsl/filesystem/wsl-mapped-drive-share'

/**
 * Without the journal, any folder a move could have taken: a UNC path, or a drive letter not
 * known (from this launch or a saved answer) to point outside WSL. A moved `W:\` row has nothing
 * else marking it as moved.
 */
export function mayBeInWsl(path: string): boolean {
  if (isWslUncPath(path)) {
    return true
  }
  const letter = /^([A-Za-z]):[\\/]/.exec(path)?.[1]
  // Off Windows a drive letter names no share, so it's never in WSL.
  if (!letter || process.platform !== 'win32') {
    return false
  }
  // Never read here: it runs on background paths too. A user's preview or add learns the drive.
  const known = wslMappedDriveLastKnownShare(letter)
  return !known || (known.share !== null && isWslUncPath(known.share))
}
