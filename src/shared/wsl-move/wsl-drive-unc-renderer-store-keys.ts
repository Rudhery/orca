/**
 * The converted key of a renderer-stored entry of a UNC Windows-drive project (D1c), or null when
 * the entry is not one. Same stores and key shapes as the WSL move's renderer rewrite
 * (renderer/src/lib/wsl-move-renderer-store-keys.ts), but the project stays on this computer.
 */
import { normalizeRuntimePathForComparison } from '../file-access/cross-platform-path'
import { LOCAL_EXECUTION_HOST_ID } from '../execution-host/execution-host'
import type { PythonEnvironment } from '../editor/notebooks/notebook-kernel-types'
import { wslDriveUncRespelling, type WslMappedDrive } from './wsl-drive-unc-respelling'

/** A converted conversion's renderer half, as main lists it. */
export type WslDriveUncPendingRendererRewrite = {
  migrationId: string
  distro: string
  /** Set for a mapped drive respelled to its share path. */
  mappedDrive?: WslMappedDrive
  worktreeIds: [string, string][]
  /** The converted projects' folders, as saved before the conversion. */
  rootPaths: string[]
  /** Renderer stores still to record. */
  storeIds: string[]
}

export type WslDriveUncRendererKeys = {
  worktreeId: (worktreeId: string) => string | null
  /** A path inside a converted folder, in its converted form; null for any other path. */
  path: (path: string) => string | null
  /** A comparison-form key inside a converted folder, re-keyed in comparison form; else null. */
  comparisonKey: (key: string) => string | null
}

export function wslDriveUncRendererKeys(
  conversion: Pick<
    WslDriveUncPendingRendererRewrite,
    'distro' | 'mappedDrive' | 'worktreeIds' | 'rootPaths'
  >
): WslDriveUncRendererKeys {
  const ids = new Map(conversion.worktreeIds)
  const respelling = wslDriveUncRespelling(conversion, conversion.rootPaths)
  const roots = conversion.rootPaths.flatMap((root) => {
    const converted = respelling.path(root)
    return converted ? [normalizeRuntimePathForComparison(converted)] : []
  })
  const path = (value: string): string | null => {
    const converted = respelling.path(value)
    if (!converted) {
      return null
    }
    const comparable = normalizeRuntimePathForComparison(converted)
    const inRoot = roots.some(
      (root) => comparable === root || comparable.startsWith(root.endsWith('/') ? root : `${root}/`)
    )
    return inRoot ? converted : null
  }
  return {
    worktreeId: (worktreeId) => ids.get(worktreeId) ?? null,
    path,
    comparisonKey: respelling.comparisonForm
  }
}

function parseArray(value: string): unknown[] | null {
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** `[route, worktreeId, comparison-form root]`, as quick-open-file-history.ts keys a history. */
export function convertedQuickOpenHistoryScope(
  scope: string,
  keys: WslDriveUncRendererKeys
): string | null {
  const parsed = parseArray(scope)
  if (!parsed || parsed.length !== 3) {
    return null
  }
  const [route, worktreeId, root] = parsed
  if (
    typeof route !== 'object' ||
    route === null ||
    !('executionHostId' in route) ||
    route.executionHostId !== LOCAL_EXECUTION_HOST_ID ||
    typeof worktreeId !== 'string' ||
    typeof root !== 'string'
  ) {
    return null
  }
  const nextId = keys.worktreeId(worktreeId)
  // Quick-open keeps its roots in comparison form, which folds both UNC spellings into one.
  const nextRoot = keys.comparisonKey(root)
  return nextId !== null && nextRoot !== null ? JSON.stringify([route, nextId, nextRoot]) : null
}

/** `[worktreeId, environment, sshTarget, filePath]`, as buildFileViewPreferenceKey writes it. */
export function convertedFileViewPreferenceKey(
  fileKey: string,
  keys: WslDriveUncRendererKeys
): string | null {
  const parsed = parseArray(fileKey)
  if (!parsed || parsed.length !== 4) {
    return null
  }
  const [worktreeId, environment, sshTarget, filePath] = parsed
  if (
    typeof worktreeId !== 'string' ||
    environment !== 'local' ||
    sshTarget !== null ||
    typeof filePath !== 'string'
  ) {
    return null
  }
  const nextId = keys.worktreeId(worktreeId)
  const nextPath = keys.path(filePath)
  return nextId !== null && nextPath !== null
    ? JSON.stringify([nextId, environment, sshTarget, nextPath])
    : null
}

/** CSV widths are keyed by `[file key, delimiter]` around the file-view key. */
export function convertedCsvColumnWidthsKey(
  storedKey: string,
  keys: WslDriveUncRendererKeys
): string | null {
  const parsed = parseArray(storedKey)
  if (!parsed || parsed.length !== 2 || typeof parsed[0] !== 'string') {
    return null
  }
  const fileKey = convertedFileViewPreferenceKey(parsed[0], keys)
  return fileKey === null ? null : JSON.stringify([fileKey, parsed[1]])
}

/** A notebook's interpreter choice, keyed by its path; the interpreter's own path still names it. */
export function convertedNotebookEnvironment(
  filePath: string,
  environment: PythonEnvironment,
  keys: WslDriveUncRendererKeys
): [string, PythonEnvironment] | null {
  const nextPath = keys.path(filePath)
  return nextPath === null ? null : [nextPath, environment]
}
