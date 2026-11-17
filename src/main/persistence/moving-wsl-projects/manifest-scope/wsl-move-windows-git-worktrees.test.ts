import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Repo } from '../../../../shared/repository/repo-types'
import {
  findWindowsGitWorktreeRepoIds,
  windowsGitWorktreePaths
} from './wsl-move-windows-git-worktrees'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'wsl-move-wingit-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function worktreeLink(repo: string, name: string, link: string): void {
  const entry = join(repo, '.git', 'worktrees', name)
  mkdirSync(entry, { recursive: true })
  writeFileSync(join(entry, 'gitdir'), `${link}\n`)
}

describe('windowsGitWorktreePaths', () => {
  it('names the worktrees whose links Git for Windows wrote', async () => {
    const repo = join(root, 'app')
    worktreeLink(repo, 'win', 'W:/home/me/app-trees/win/.git')
    worktreeLink(repo, 'linux', '/home/me/app-trees/linux/.git')
    expect(await windowsGitWorktreePaths(repo, 'Ubuntu')).toEqual(['W:/home/me/app-trees/win'])
  })

  it('names a repo that is itself a worktree Git for Windows created', async () => {
    const repo = join(root, 'tree')
    mkdirSync(repo)
    writeFileSync(join(repo, '.git'), 'gitdir: W:/home/me/app/.git/worktrees/tree\n')
    expect(await windowsGitWorktreePaths(repo, 'Ubuntu')).toEqual([repo])
  })

  it('finds none for a folder outside Git or a repo with Linux-only links', async () => {
    expect(await windowsGitWorktreePaths(join(root, 'none'), 'Ubuntu')).toEqual([])
    const repo = join(root, 'linux')
    worktreeLink(repo, 'a', '/home/me/a/.git')
    expect(await windowsGitWorktreePaths(repo, 'Ubuntu')).toEqual([])
  })
})

describe('findWindowsGitWorktreeRepoIds', () => {
  const repo = (id: string, path: string): Repo => ({
    id,
    path,
    displayName: id,
    badgeColor: '#000',
    addedAt: 0
  })
  const W = { letter: 'W', share: '\\\\wsl.localhost\\Ubuntu' }

  it('checks only mapped-drive repos, and fails closed on an unreadable one', async () => {
    const checked: string[] = []
    const ids = await findWindowsGitWorktreeRepoIds(
      [
        repo('win', 'W:\\home\\me\\win'),
        repo('clean', 'W:\\home\\me\\clean'),
        repo('broken', 'W:\\home\\me\\broken'),
        repo('unc', '\\\\wsl.localhost\\Ubuntu\\home\\me\\unc')
      ],
      'Ubuntu',
      [W],
      async (path) => {
        checked.push(path)
        if (path.endsWith('broken')) {
          throw new Error('EACCES')
        }
        return path.endsWith('win') ? ['W:/home/me/win-tree'] : []
      }
    )
    expect([...ids].sort()).toEqual(['broken', 'win'])
    expect(checked).not.toContain('\\\\wsl.localhost\\Ubuntu\\home\\me\\unc')
  })
})
