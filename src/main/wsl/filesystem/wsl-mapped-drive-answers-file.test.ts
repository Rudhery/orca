import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import type * as NodeFs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const realpathNative = vi.hoisted(() => vi.fn())
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFs>()
  return { ...actual, realpath: Object.assign(actual.realpath, { native: realpathNative }) }
})

import { wslMoveCutoverFixture as cutover } from '../../persistence/__fixtures__/wsl-mover/wsl-move-cutover-fixture'
import { wslMoveJournalDirectory } from '../../persistence/moving-wsl-projects/cutover-recovery/wsl-move-cutover-journal'
import {
  isWslMoveProjectBlocked,
  loadWslMoveFence,
  resetWslMoveFenceForTests
} from '../../persistence/moving-wsl-projects/quiescence/wsl-move-scope-guard'
import {
  loadWslMappedDriveAnswers,
  wslMappedDriveAnswersPath
} from './wsl-mapped-drive-answers-file'
import {
  clearWslMappedDriveShareCacheForTests,
  readWslMappedDriveShareNow,
  wslMappedDriveLastKnownShare
} from './wsl-mapped-drive-share'

let userDataPath: string
beforeEach(() => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
  userDataPath = mkdtempSync(join(tmpdir(), 'wsl-drive-answers-'))
})
afterEach(() => {
  vi.restoreAllMocks()
  resetWslMoveFenceForTests()
  clearWslMappedDriveShareCacheForTests()
  realpathNative.mockReset()
  rmSync(userDataPath, { recursive: true, force: true })
})

/** A fresh launch: memory gone, only the saved file left. */
function restart(): ReturnType<typeof loadWslMappedDriveAnswers> {
  clearWslMappedDriveShareCacheForTests()
  return loadWslMappedDriveAnswers(userDataPath)
}

const fake = (real: string) => ({
  platform: 'win32' as const,
  realpathRoot: async () => real,
  now: () => 1_000,
  timeoutMs: 50
})

describe('saved mapped-drive answers', () => {
  it('keep each settled answer across a restart, without reading any drive', async () => {
    const answers = restart()
    await readWslMappedDriveShareNow('C', fake('C:\\'))
    await readWslMappedDriveShareNow('W', fake('\\\\wsl.localhost\\Ubuntu\\'))
    await answers.saved()
    expect(JSON.parse(readFileSync(wslMappedDriveAnswersPath(userDataPath), 'utf8'))).toEqual({
      version: 1,
      answers: [
        { letter: 'C', share: null, at: 1_000 },
        { letter: 'W', share: '\\\\wsl.localhost\\Ubuntu', at: 1_000 }
      ]
    })
    restart()
    expect(wslMappedDriveLastKnownShare('C')).toEqual({ share: null })
    expect(wslMappedDriveLastKnownShare('W')).toEqual({ share: '\\\\wsl.localhost\\Ubuntu' })
    expect(realpathNative).not.toHaveBeenCalled()
  })

  it('ignore a malformed file', () => {
    writeFileSync(
      wslMappedDriveAnswersPath(userDataPath),
      '{"version":1,"answers":[{"letter":"cc"}]}'
    )
    restart()
    expect(wslMappedDriveLastKnownShare('C')).toBeNull()
  })

  it('let an unreadable journal’s fence pass a C: project after a restart', async () => {
    const answers = restart()
    await readWslMappedDriveShareNow('C', fake('C:\\'))
    await answers.saved()
    restart()
    mkdirSync(wslMoveJournalDirectory(userDataPath), { recursive: true })
    writeFileSync(
      join(wslMoveJournalDirectory(userDataPath), 'move-1.json'),
      JSON.stringify({ ...cutover('move-1', 'destination-committed'), version: 3 })
    )
    loadWslMoveFence(userDataPath)
    const store = {
      getRepo: (id: string) =>
        ({ c: { path: 'C:\\src\\site' }, w: { path: 'W:\\home\\me\\app' } })[id]
    }
    expect(isWslMoveProjectBlocked(store, { repoId: 'c' })).toBe(false)
    expect(isWslMoveProjectBlocked(store, { repoId: 'w' })).toBe(true)
    expect(realpathNative).not.toHaveBeenCalled()
  })
})
