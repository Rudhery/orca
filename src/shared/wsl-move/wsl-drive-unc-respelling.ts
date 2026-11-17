/**
 * The path map of an in-place project conversion: a UNC Windows-drive project to its drive path
 * (`\\wsl.localhost\<d>\mnt\c\x` -> `C:\x`, D1c), or a project saved under a drive letter mapped
 * to a distro share to that share's UNC path (`W:\home\x` -> `\\wsl.localhost\<d>\home\x`), which
 * the WSL move can then take.
 */
import { normalizeRuntimePathForComparison } from '../file-access/cross-platform-path'
import { parseWslUncPath, wslUncDrivePathToWindows } from '../file-access/wsl-paths'

/** A drive letter mapped to a distro share, as the resolver read it when the conversion began. */
export type WslMappedDrive = { letter: string; share: string }

export type WslDriveUncRespelling = {
  /** An absolute path's converted spelling; null for a path this conversion does not take. */
  path: (value: string) => string | null
  /** A `file:` URL's converted spelling and the converted path it names; null otherwise. */
  fileUrl: (value: string) => { url: string; path: string } | null
  /**
   * A `normalizeRuntimePathForComparison` key at or inside a converted root, re-keyed in that form;
   * null otherwise. Folded case can't be unfolded, so the root's own spelling supplies it.
   */
  comparisonForm: (value: string) => string | null
}

type PathMap = Omit<WslDriveUncRespelling, 'comparisonForm'> & {
  /** A string only `normalizeRuntimePathForComparison` produces in this conversion's source form. */
  isComparisonKey: (value: string) => boolean
}

export function wslDriveUncRespelling(
  conversion: { distro: string; mappedDrive?: WslMappedDrive | null },
  /** The converting folders as saved; comparison keys are re-keyed only at or inside one. */
  roots: readonly string[] = []
): WslDriveUncRespelling {
  const map = conversion.mappedDrive
    ? mappedDriveRespelling(conversion.mappedDrive)
    : uncDriveRespelling(conversion.distro)
  const rootKeys = roots.flatMap((root) => {
    const converted = map.path(root)
    return converted ? [{ from: normalizeRuntimePathForComparison(root), to: converted }] : []
  })
  return {
    path: map.path,
    fileUrl: map.fileUrl,
    comparisonForm: (value) => {
      if (!map.isComparisonKey(value)) {
        return null
      }
      for (const { from, to } of rootKeys) {
        const prefix = from.endsWith('/') ? from : `${from}/`
        if (value === from || value.startsWith(prefix)) {
          const rest = value === from ? '' : value.slice(prefix.length)
          const joined = rest ? `${to.replace(/[\\/]+$/, '')}\\${rest.replace(/\//g, '\\')}` : to
          return normalizeRuntimePathForComparison(joined)
        }
      }
      return null
    }
  }
}

function uncDriveRespelling(distro: string): PathMap {
  const fileUrl = new RegExp(
    `^file://(?:wsl\\.localhost|wsl\\$)/${escapeRegExp(distro)}(/mnt/[a-z](?:/[^?#]*)?)([?#].*)?$`,
    'i'
  )
  const comparisonKey = new RegExp(`^//wsl/${escapeRegExp(distro.toLowerCase())}/mnt/[a-z](?:/|$)`)
  return {
    path: (value) => wslUncDrivePathToWindows(value, distro),
    fileUrl: (value) => {
      const match = fileUrl.exec(value)
      const linux = match ? safeDecode(match[1]) : null
      const drive = linux
        ? wslUncDrivePathToWindows(`//wsl.localhost/${distro}${linux}`, distro)
        : null
      if (!match || !drive) {
        return null
      }
      // `/mnt/c/x` -> `C:/x`, keeping the URL's own encoding of the tail.
      const tail = match[1].slice('/mnt/c'.length)
      return { url: `file:///${drive.slice(0, 2)}${tail || '/'}${match[2] ?? ''}`, path: drive }
    },
    isComparisonKey: (value) => comparisonKey.test(value)
  }
}

const DRIVE_ABSOLUTE = /^([A-Za-z]):[\\/]([\s\S]*)$/
const DRIVE_FILE_URL = /^file:\/\/\/([A-Za-z]):(\/[^?#]*)?([?#].*)?$/i

/** `W:\home\x` -> `\\wsl.localhost\Ubuntu\home\x`; the tail keeps its case, which Linux needs. */
export function wslMappedDrivePathToShare(value: string, drive: WslMappedDrive): string | null {
  const match = DRIVE_ABSOLUTE.exec(value)
  if (!match || match[1].toUpperCase() !== drive.letter.toUpperCase()) {
    return null
  }
  const segments: string[] = []
  for (const segment of match[2].split(/[\\/]+/)) {
    if (segment === '' || segment === '.') {
      continue
    }
    if (segment === '..') {
      // Past the drive root names no folder of the share.
      if (segments.pop() === undefined) {
        return null
      }
      continue
    }
    segments.push(segment)
  }
  const share = drive.share.replace(/[\\/]+$/, '')
  return segments.length > 0 ? `${share}\\${segments.join('\\')}` : share
}

function mappedDriveRespelling(drive: WslMappedDrive): PathMap {
  const letter = drive.letter.toLowerCase()
  const shareUrl = parseWslUncPath(drive.share) ? shareFileUrl(drive.share) : null
  return {
    path: (value) => wslMappedDrivePathToShare(value, drive),
    fileUrl: (value) => {
      const match = DRIVE_FILE_URL.exec(value)
      if (!shareUrl || !match || match[1].toUpperCase() !== drive.letter.toUpperCase()) {
        return null
      }
      const decoded = safeDecode(match[2] ?? '/')
      const path =
        decoded === null ? null : wslMappedDrivePathToShare(`${drive.letter}:${decoded}`, drive)
      // The share's own segments encoded; the tail keeps the URL's encoding.
      return path ? { url: `${shareUrl}${match[2] ?? '/'}${match[3] ?? ''}`, path } : null
    },
    // Folded: lowercase, forward slashes only. Saved paths keep their `W:\` spelling.
    isComparisonKey: (value) =>
      value.startsWith(`${letter}:/`) && value === value.toLowerCase() && !value.includes('\\')
  }
}

/** `\\wsl.localhost\Ubuntu\home` -> `file://wsl.localhost/Ubuntu/home`. */
function shareFileUrl(share: string): string {
  const [server, ...segments] = share.split(/[\\/]+/).filter(Boolean)
  return `file://${server}${segments.map((segment) => `/${encodeURIComponent(segment)}`).join('')}`
}

function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
