// Convert only the moved distro's UNC and mapped-drive paths; unrelated paths remain unchanged.
import {
  wslMappedDriveFileUrlToLinux,
  wslMoveSourcePathToLinux,
  type WslMappedDrive
} from '../../../../shared/wsl-move/wsl-mapped-drive-paths'
import type { OrcadMigrationPathRewriter } from '../../migrating-orcad-catalog/path-rewrite/orcad-migration-path-rewrite'

export function createUncToLinuxPathRewriter(
  distro: string,
  mappedDrives: readonly WslMappedDrive[] = []
): OrcadMigrationPathRewriter {
  const fileUrl = new RegExp(`^file://(?:wsl\\.localhost|wsl\\$)/([^/]+)(/.*)?$`, 'i')
  const toLinux = (value: string): string | null =>
    wslMoveSourcePathToLinux(value, distro, mappedDrives)
  return {
    path: (value, form) => {
      switch (form) {
        case 'absolute':
          return toLinux(value) ?? value
        case 'maybe-absolute':
          return toLinux(value) ?? (isRelative(value) ? toPosix(value) : value)
        case 'relative':
          return toPosix(value)
        case 'url': {
          const match = fileUrl.exec(value)
          if (match && decodeSegment(match[1]).toLowerCase() === distro.toLowerCase()) {
            return `file://${match[2] ?? '/'}`
          }
          return wslMappedDriveFileUrlToLinux(value, distro, mappedDrives) ?? value
        }
      }
    }
  }
}

// Relative Windows paths need host-side POSIX separators.
function toPosix(value: string): string {
  return value.replace(/\\/g, '/')
}

/** Drive-relative C:trees stays on Windows. */
function isRelative(value: string): boolean {
  return !/^(?:[A-Za-z]:|[\\/])/.test(value)
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}
