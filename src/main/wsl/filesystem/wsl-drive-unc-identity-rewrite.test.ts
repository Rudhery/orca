import { describe, expect, it } from 'vitest'
import {
  createWslDriveUncRewriter,
  rewriteWslDriveUncValue
} from './wsl-drive-unc-identity-rewrite'

const ROOT = String.raw`\\wsl.localhost\Ubuntu\mnt\c\src\app`
const ID = `r1::${ROOT}`
const NEW_ID = String.raw`r1::C:\src\app`

const rewriter = createWslDriveUncRewriter({
  distro: 'Ubuntu',
  repoIds: new Set(['r1']),
  folderWorkspaceIds: new Set(['f1']),
  roots: [ROOT]
})

describe('createWslDriveUncRewriter', () => {
  it.each([
    ['a worktree id', ID, NEW_ID],
    ['a workspace key', `worktree:${ID}`, `worktree:${NEW_ID}`],
    ['a local host-qualified id', `local|${ID}`, `local|${NEW_ID}`],
    ['a minted PTY session id', `${ID}@@abc`, `${NEW_ID}@@abc`],
    ['a path inside the project', `${ROOT}\\src\\a.ts`, String.raw`C:\src\app\src\a.ts`],
    ['the older UNC spelling', String.raw`\\wsl$\ubuntu\mnt\c\src\app`, String.raw`C:\src\app`],
    ['a comparison-form path', '//wsl/ubuntu/mnt/c/src/app/x', 'c:/src/app/x'],
    [
      'a file URL',
      'file://wsl.localhost/Ubuntu/mnt/c/src/app/docs/a%20b.html?q=1#top',
      'file:///C:/src/app/docs/a%20b.html?q=1#top'
    ],
    [
      'an editor file id',
      `editor:${encodeURIComponent(ID)}:local:${encodeURIComponent(`${ROOT}\\a.ts`)}`,
      `editor:${encodeURIComponent(NEW_ID)}:local:${encodeURIComponent(String.raw`C:\src\app\a.ts`)}`
    ]
  ])('maps %s', (_name, value, expected) => {
    expect(rewriter.identity(value)).toBe(expected)
  })

  it.each([
    ['another repo', String.raw`r2::\\wsl.localhost\Ubuntu\mnt\c\src\app`],
    ['another host', `ssh:box|${ID}`],
    ['a path outside the project', String.raw`\\wsl.localhost\Ubuntu\mnt\c\src\other\a.ts`],
    ['a path inside the distro', String.raw`r1::\\wsl.localhost\Ubuntu\home\me\app`],
    ['another distro', String.raw`\\wsl.localhost\Debian\mnt\c\src\app`],
    ['a folder workspace key', 'folder:f1'],
    ['a Linux path', '/mnt/c/src/app'],
    ['plain text', 'hello world']
  ])('leaves %s', (_name, value) => {
    expect(rewriter.identity(value)).toBe(value)
  })
})

describe('rewriteWslDriveUncValue', () => {
  it('maps keys and values, skips user text and prior ids, and keeps unchanged references', () => {
    const untouched = { other: ['x'] }
    const value = {
      [ID]: { worktreeId: ID, title: ID, priorWorktreeIds: [ID] },
      untouched
    }
    const next = rewriteWslDriveUncValue(value, rewriter)
    expect(next).toEqual({
      [NEW_ID]: { worktreeId: NEW_ID, title: ID, priorWorktreeIds: [ID] },
      untouched
    })
    expect(next.untouched).toBe(untouched)
    expect(rewriteWslDriveUncValue(untouched, rewriter)).toBe(untouched)
  })
})

describe('createWslDriveUncRewriter for a mapped drive', () => {
  const mapped = createWslDriveUncRewriter({
    distro: 'Ubuntu',
    mappedDrive: { letter: 'W', share: String.raw`\\wsl.localhost\Ubuntu` },
    repoIds: new Set(['r1']),
    folderWorkspaceIds: new Set(),
    roots: [String.raw`W:\home\me\App`]
  })

  it.each([
    [
      'a saved path',
      String.raw`W:\home\me\App\src`,
      String.raw`\\wsl.localhost\Ubuntu\home\me\App\src`
    ],
    // Case is folded in the key; the root's own spelling restores it.
    ['a comparison key of the root', 'w:/home/me/app', '//wsl/ubuntu/home/me/App'],
    ['a comparison key inside it', 'w:/home/me/app/src', '//wsl/ubuntu/home/me/App/src'],
    ['a comparison key of another folder', 'w:/home/me/other', 'w:/home/me/other'],
    ['a path of another folder', String.raw`W:\home\me\other`, String.raw`W:\home\me\other`]
  ])('re-keys %s', (_label, value, expected) => {
    expect(mapped.identity(value)).toBe(expected)
  })

  it('keeps a D1c comparison key in comparison form', () => {
    expect(rewriter.identity('//wsl/ubuntu/mnt/c/src/app/lib')).toBe('c:/src/app/lib')
  })
})
