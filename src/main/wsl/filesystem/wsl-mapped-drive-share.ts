/**
 * A drive letter mapped to a distro share (`net use W: \\wsl.localhost\Ubuntu`) names a WSL path
 * Orca only recognises in its UNC spelling. Windows resolves a mapped drive's root to its share.
 */
import { realpath } from 'node:fs'
import { win32 } from 'node:path'
import { normalizeRuntimePathForComparison } from '../../../shared/file-access/cross-platform-path'
import { parseWslUncPath } from '../../../shared/file-access/wsl-paths'

const RESOLVE_TIMEOUT_MS = 2_000
const CACHE_TTL_MS = 60_000
const DRIVE_PATH = /^([A-Za-z]):(?:[\\/](.*))?$/

export type WslMappedDriveShareDeps = {
  platform: NodeJS.Platform
  /** The drive root's final path; a mapped network drive answers with its UNC share. */
  realpathRoot: (root: string) => Promise<string>
  now: () => number
  timeoutMs: number
}

/** `settledAt` is null while the lookup is in flight; an in-flight lookup never expires. */
type CacheEntry = { settledAt: number | null; lookup: Promise<string | null> }

const cache = new Map<string, CacheEntry>()
// Each letter's last settled answer from either lookup; background paths read only this.
const lastKnown = new Map<string, string | null>()

const defaultDeps: WslMappedDriveShareDeps = {
  platform: process.platform,
  // The native call asks Windows for the final path; the JS one keeps the drive letter.
  realpathRoot: (root) =>
    new Promise((resolve, reject) =>
      realpath.native(root, (error, real) => (error ? reject(error) : resolve(real)))
    ),
  now: Date.now,
  timeoutMs: RESOLVE_TIMEOUT_MS
}

/** The UNC share a drive letter maps into a distro, or null for any other drive. */
function resolveDriveShare(letter: string, deps: WslMappedDriveShareDeps): Promise<string | null> {
  const key = letter.toUpperCase()
  const cached = cache.get(key)
  const entry =
    cached && (cached.settledAt === null || deps.now() - cached.settledAt < CACHE_TTL_MS)
      ? cached
      : startDriveLookup(key, deps)
  let timer: ReturnType<typeof setTimeout> | undefined
  // A slow share (a cold distro boots its VM) answers null now; its late answer serves the next add.
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), deps.timeoutMs)
  })
  return Promise.race([entry.lookup, timeout]).finally(() => clearTimeout(timer))
}

/** One lookup per drive: a hung share pins one fs thread, never one per add. */
function startDriveLookup(key: string, deps: WslMappedDriveShareDeps): CacheEntry {
  const entry: CacheEntry = { settledAt: null, lookup: Promise.resolve(null) }
  entry.lookup = deps.realpathRoot(`${key}:\\`).then(
    (real) => {
      entry.settledAt = deps.now()
      return remember(key, real)
    },
    () => {
      // A failed lookup is asked again by the next add.
      if (cache.get(key) === entry) {
        cache.delete(key)
      }
      return null
    }
  )
  cache.set(key, entry)
  return entry
}

/**
 * The UNC spelling of a path on a drive mapped to a distro share (`W:\home\u` ->
 * `\\wsl.localhost\Ubuntu\home\u`); null for local drives, other shares, and off Windows.
 */
export async function resolveWslMappedDrivePath(
  path: unknown,
  deps: WslMappedDriveShareDeps = defaultDeps
): Promise<string | null> {
  if (deps.platform !== 'win32' || typeof path !== 'string') {
    return null
  }
  const match = DRIVE_PATH.exec(path)
  if (!match) {
    return null
  }
  const share = await resolveDriveShare(match[1], deps)
  if (!share) {
    return null
  }
  const tail = win32.normalize(match[2] || '.').replace(/^\\+|\\+$/g, '')
  // `..` past the drive root names no folder of the share.
  if (tail === '..' || tail.startsWith('..\\')) {
    return null
  }
  return tail === '' || tail === '.' ? share : `${share}\\${tail}`
}

/** What a drive letter maps to right now; `unverifiable` when Windows didn't answer in time. */
export type WslMappedDriveRead = { share: string | null } | 'unverifiable'

function remember(key: string, real: string): string | null {
  const share = parseWslUncPath(real) ? real.replace(/[\\/]+$/, '') : null
  lastKnown.set(key, share)
  return share
}

type FreshLookup = { serial: number; settled: Promise<{ share: string | null }> }
// Serials order fresh lookups, so a request can tell one started after it from an older one.
let freshSerial = 0
const freshLookups = new Map<string, FreshLookup>()

function startFreshLookup(key: string, deps: WslMappedDriveShareDeps): FreshLookup {
  const entry: FreshLookup = {
    serial: ++freshSerial,
    settled: deps.realpathRoot(`${key}:\\`).then(
      (real) => ({ share: remember(key, real) }),
      // No such drive, or not one Windows can resolve: nothing is mapped there.
      () => ({ share: null })
    )
  }
  freshLookups.set(key, entry)
  void entry.settled.finally(() => {
    if (freshLookups.get(key) === entry) {
      freshLookups.delete(key)
    }
  })
  return entry
}

/** Joins a lookup started after `after`; waits out an older one rather than stack another. */
async function freshAnswer(
  key: string,
  deps: WslMappedDriveShareDeps,
  after: number
): Promise<{ share: string | null }> {
  for (;;) {
    const current = freshLookups.get(key)
    if (!current) {
      return startFreshLookup(key, deps).settled
    }
    if (current.serial > after) {
      return current.settled
    }
    await current.settled
  }
}

/**
 * Asks Windows again, bypassing the cache, for a decision that rewrites saved state: a drive
 * remapped within the cache's minute must not move a project into another distro or folder.
 * Concurrent reads of a letter share one lookup, so a hung share pins one fs thread.
 */
export async function readWslMappedDriveShareNow(
  letter: string,
  deps: WslMappedDriveShareDeps = defaultDeps,
  timeoutMs: number = deps.timeoutMs
): Promise<WslMappedDriveRead> {
  if (deps.platform !== 'win32' || !/^[A-Za-z]$/.test(letter)) {
    return { share: null }
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<'unverifiable'>((resolve) => {
    timer = setTimeout(() => resolve('unverifiable'), timeoutMs)
  })
  const answer = freshAnswer(letter.toUpperCase(), deps, freshSerial)
  return Promise.race([answer, timeout]).finally(() => clearTimeout(timer))
}

/** The letter's last answer, never read here; null before any lookup of it settled. */
export function wslMappedDriveLastKnownShare(letter: string): { share: string | null } | null {
  const key = letter.toUpperCase()
  return lastKnown.has(key) ? { share: lastKnown.get(key) ?? null } : null
}

/**
 * The letter's last answer, classifying an unknown letter with one bounded, cached lookup; null
 * when that lookup did not settle in time.
 */
export async function classifyWslMappedDrive(
  letter: string,
  deps: WslMappedDriveShareDeps = defaultDeps
): Promise<{ share: string | null } | null> {
  if (deps.platform !== 'win32' || !/^[A-Za-z]$/.test(letter)) {
    return { share: null }
  }
  const known = wslMappedDriveLastKnownShare(letter)
  if (known) {
    return known
  }
  await resolveDriveShare(letter, deps)
  return wslMappedDriveLastKnownShare(letter)
}

/**
 * The drive still maps into `distro`, to the share the window showed when it was given one.
 * A drive may map a folder inside the distro; the share is that folder's UNC path.
 */
export function wslMappedDriveMatches(
  share: string | null,
  distro: string,
  expectedShare: string | undefined
): share is string {
  return (
    share !== null &&
    parseWslUncPath(share)?.distro.toLowerCase() === distro.toLowerCase() &&
    (expectedShare === undefined ||
      normalizeRuntimePathForComparison(share) === normalizeRuntimePathForComparison(expectedShare))
  )
}

export function clearWslMappedDriveShareCacheForTests(): void {
  cache.clear()
  lastKnown.clear()
  freshLookups.clear()
}
