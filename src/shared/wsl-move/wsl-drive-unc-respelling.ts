/**
 * The path map of an in-place project conversion: a UNC Windows-drive project to its drive path
 * (`\\wsl.localhost\<d>\mnt\c\x` -> `C:\x`, D1c), or a project saved under a drive letter mapped
 * to a distro share to that share's UNC path (`W:\home\x` -> `\\wsl.localhost\<d>\home\x`), which
 * the WSL move can then take.
 */
import { parseWslUncPath, wslUncDrivePathToWindows } from '../file-access/wsl-paths'

/** A drive letter mapped to a distro share, as the resolver read it when the conversion began. */
export type WslMappedDrive = { letter: string; share: string }

export type WslDriveUncRespelling = {
  /** An absolute path's converted spelling; null for a path this conversion does not take. */
  path: (value: string) => string | null
  /** A `file:` URL's converted spelling and the converted path it names; null otherwise. */
  fileUrl: (value: string) => { url: string; path: string } | null
  /** A `normalizeRuntimePathForComparison` key's converted spelling, in that form; null otherwise. */
  comparisonForm: (value: string) => string | null
}

export function wslDriveUncRespelling(conversion: {
  distro: string
  mappedDrive?: WslMappedDrive | null
}): WslDriveUncRespelling {
  return conversion.mappedDrive
    ? mappedDriveRespelling(conversion.mappedDrive)
    : uncDriveRespelling(conversion.distro)
}

function uncDriveRespelling(distro: string): WslDriveUncRespelling {
  const fileUrl = new RegExp(
    `^file://(?:wsl\\.localhost|wsl\\$)/${escapeRegExp(distro)}(/mnt/[a-z](?:/[^?#]*)?)([?#].*)?$`,
    'i'
  )
  const comparisonForm = new RegExp(
    `^//wsl/${escapeRegExp(distro.toLowerCase())}/mnt/([a-z])(/[\\s\\S]*)?$`
  )
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
    comparisonForm: (value) => {
      const match = comparisonForm.exec(value)
      return match ? `${match[1]}:${match[2] ?? '/'}` : null
    }
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

function mappedDriveRespelling(drive: WslMappedDrive): WslDriveUncRespelling {
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
    // A drive key in comparison form (`w:/x`) is also a real spelling, which `path` takes.
    comparisonForm: () => null
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
