/**
 * A repo saved under a mapped drive may have linked worktrees Git for Windows created: their
 * `.git` files and `.git/worktrees/<name>/gitdir` links hold `W:/…` paths. The host's Linux Git
 * can't follow those, and its `git worktree prune` would delete their metadata, so such a repo
 * stays here (the opposite of wsl-drive-project-windows-git's `wsl-authored-worktrees`).
 */
import { readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { toWindowsWslUncPath } from '../../../../shared/file-access/wsl-paths'
import type { Repo } from '../../../../shared/repository/repo-types'
import {
  wslMappedDriveOf,
  type WslMappedDrive
} from '../../../../shared/wsl-move/wsl-mapped-drive-paths'
import {
  isForeignLink,
  readWorktreeLinks
} from '../../../git/worktrees/removal/worktree-prune-guard'
import { isLocalWslMoveRow } from '../quiescence/wsl-move-scope-guard'

/** The worktrees of the repo at `repoPath` whose links Git for Windows wrote; none outside Git. */
export async function windowsGitWorktreePaths(repoPath: string, distro: string): Promise<string[]> {
  const dotGit = join(repoPath, '.git')
  const info = await stat(dotGit).catch((error: unknown) => {
    // Only "no `.git`" means no Git; any other failure fails the check closed.
    if (isMissing(error)) {
      return null
    }
    throw error
  })
  if (!info) {
    return []
  }
  let commonDir = dotGit
  if (!info.isDirectory()) {
    const link = /^gitdir:\s*(.+)$/m.exec(await readFile(dotGit, 'utf8'))?.[1]?.trim()
    if (!link) {
      return []
    }
    // The repo is itself a linked worktree Git for Windows created.
    if (isForeignLink(link, true)) {
      return [repoPath]
    }
    const gitDir = link.startsWith('/')
      ? toWindowsWslUncPath(link, distro)
      : resolve(repoPath, link)
    const common = (await readFile(join(gitDir, 'commondir'), 'utf8').catch(() => '')).trim()
    commonDir = common ? resolve(gitDir, common) : gitDir
  }
  return (await readWorktreeLinks(join(commonDir, 'worktrees')))
    .filter(({ link }) => isForeignLink(link, true))
    .map(({ link }) => link.replace(/[\\/]\.git$/, ''))
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

/**
 * The local repos on a mapped drive with worktrees the host's Git can't use. A repo whose links
 * can't be read counts as one: the check fails closed.
 */
export async function findWindowsGitWorktreeRepoIds(
  repos: readonly Repo[],
  distro: string,
  mappedDrives: readonly WslMappedDrive[],
  windowsGitWorktrees: (repoPath: string, distro: string) => Promise<string[]>
): Promise<Set<string>> {
  const onMappedDrive = repos.filter(
    (repo) => isLocalWslMoveRow(repo) && wslMappedDriveOf(repo.path, mappedDrives) !== null
  )
  const found = await Promise.all(
    onMappedDrive.map(async (repo) =>
      (await windowsGitWorktrees(repo.path, distro).catch(() => [repo.path])).length > 0
        ? [repo.id]
        : []
    )
  )
  return new Set(found.flat())
}
