/**
 * The re-key of a UNC Windows-drive project converting to its drive path (D1c): every identity
 * string that names one of its folders through the distro (`\\wsl.localhost\<d>\mnt\c\x`) becomes
 * the same folder's drive path (`C:\x`); for a mapped-drive conversion, `W:\x` becomes the share's
 * UNC path. Worktree ids, owner keys, PTY session ids and editor file ids are rebuilt by the
 * export's composite rewriters; user text is never touched.
 */
import { isDeepStrictEqual } from 'node:util'
import { normalizeRuntimePathForComparison } from '../../../shared/file-access/cross-platform-path'
import {
  LOCAL_EXECUTION_HOST_ID,
  parseExecutionHostId
} from '../../../shared/execution-host/execution-host'
import {
  PTY_SESSION_ID_SEPARATOR,
  WORKTREE_ID_SEPARATOR
} from '../../../shared/terminal/pty/lifecycle/pty-session-id-format'
import { parseWorkspaceKey } from '../../../shared/workspace/identity/workspace-scope'
import { getRepoIdFromWorktreeId } from '../../../shared/worktree/id'
import {
  parseEditorFileId,
  WSL_MOVE_FREE_TEXT_KEYS
} from '../../persistence/moving-wsl-projects/manifest-scope/wsl-move-canonical-form'
import {
  rewriteOrcadMigrationPathValue,
  type OrcadMigrationPathRewriter
} from '../../persistence/migrating-orcad-catalog/path-rewrite/orcad-migration-path-rewrite'
import {
  wslDriveUncRespelling,
  type WslMappedDrive
} from '../../../shared/wsl-move/wsl-drive-unc-respelling'

export type WslDriveUncRewriteScope = {
  distro: string
  /** Set when the conversion takes a mapped drive's paths to its share instead. */
  mappedDrive?: WslMappedDrive | null
  repoIds: ReadonlySet<string>
  folderWorkspaceIds: ReadonlySet<string>
  /** The converting projects' folders as saved; a bare path is rewritten only at or under one. */
  roots: readonly string[]
}

export type WslDriveUncRewriter = {
  /** A path, file URL, worktree id, owner key, host-qualified key, PTY session id or editor id. */
  identity: (value: string) => string
}

/** Kept as written: the ids a worktree used to have, so stragglers naming them still resolve. */
const VERBATIM_KEYS: ReadonlySet<string> = new Set(['priorWorktreeIds'])

export function createWslDriveUncRewriter(scope: WslDriveUncRewriteScope): WslDriveUncRewriter {
  const respelling = wslDriveUncRespelling(scope, scope.roots)
  const roots = scope.roots.flatMap((root) => {
    const converted = respelling.path(root)
    return converted ? [normalizeRuntimePathForComparison(converted)] : []
  })
  const inRoot = (convertedPath: string): boolean => {
    const comparable = normalizeRuntimePathForComparison(convertedPath)
    return roots.some(
      (root) => comparable === root || comparable.startsWith(root.endsWith('/') ? root : `${root}/`)
    )
  }
  // Any converted path: an id's owner was checked first.
  const drive: OrcadMigrationPathRewriter = {
    path: (value, form) => {
      if (form === 'relative') {
        return value
      }
      if (form === 'url') {
        return respelling.fileUrl(value)?.url ?? value
      }
      return respelling.path(value) ?? value
    }
  }
  const ownerInScope = (owner: string): boolean => {
    const key = parseWorkspaceKey(owner)
    if (key?.type === 'folder') {
      return scope.folderWorkspaceIds.has(key.folderWorkspaceId)
    }
    const id = key?.type === 'worktree' ? key.worktreeId : owner
    return (
      scope.folderWorkspaceIds.has(id) ||
      (id.includes(WORKTREE_ID_SEPARATOR) && scope.repoIds.has(getRepoIdFromWorktreeId(id)))
    )
  }
  const barePath = (value: string): string => {
    // A comparison key stays one; the respelling checks its root itself.
    const comparison = respelling.comparisonForm(value)
    if (comparison) {
      return comparison
    }
    const mapped = respelling.path(value)
    return mapped && inRoot(mapped) ? mapped : value
  }
  const identity = (value: string): string => {
    const bar = value.indexOf('|')
    if (bar > 0 && parseExecutionHostId(value.slice(0, bar))) {
      // Another host's copy of a workspace keeps its id there.
      return value.slice(0, bar) === LOCAL_EXECUTION_HOST_ID
        ? `${value.slice(0, bar + 1)}${identity(value.slice(bar + 1))}`
        : value
    }
    const editor = parseEditorFileId(value)
    if (editor) {
      return ownerInScope(editor[0])
        ? rewriteOrcadMigrationPathValue(value, 'editor-file-id', drive)
        : value
    }
    const session = value.lastIndexOf(PTY_SESSION_ID_SEPARATOR)
    if (session > 0) {
      return ownerInScope(value.slice(0, session))
        ? rewriteOrcadMigrationPathValue(value, 'pty-session-id', drive)
        : value
    }
    if (parseWorkspaceKey(value) || value.includes(WORKTREE_ID_SEPARATOR)) {
      return ownerInScope(value) ? rewriteOrcadMigrationPathValue(value, 'owner-key', drive) : value
    }
    if (/^file:/i.test(value)) {
      const parsed = respelling.fileUrl(value)
      return parsed && inRoot(parsed.path) ? parsed.url : value
    }
    return barePath(value)
  }
  return { identity }
}

/** Two keys of one record that both carry data, and differ, after the re-key. */
export class WslDriveUncKeyCollisionError extends Error {
  constructor(readonly key: string) {
    super(`wsl_drive_unc_key_collision: ${key}`)
    this.name = 'WslDriveUncKeyCollisionError'
  }
}

/**
 * `value` with every identity string and record key passed through `rewriter`, skipping user text
 * and the verbatim keys; unchanged subtrees keep their reference. Two keys that become one merge
 * when either is empty or both match; otherwise throws WslDriveUncKeyCollisionError.
 */
export function rewriteWslDriveUncValue<T>(value: T, rewriter: WslDriveUncRewriter): T {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: rewriteNode maps strings to strings and rebuilds arrays and records in place, so the shape of T is kept.
  return rewriteNode(value, rewriter.identity, false) as T
}

function rewriteNode(value: unknown, map: (value: string) => string, skip: boolean): unknown {
  if (skip) {
    return value
  }
  if (typeof value === 'string') {
    return map(value)
  }
  if (Array.isArray(value)) {
    let changed = false
    const next = value.map((item) => {
      const mapped = rewriteNode(item, map, false)
      changed ||= mapped !== item
      return mapped
    })
    return changed ? next : value
  }
  if (typeof value !== 'object' || value === null) {
    return value
  }
  let changed = false
  const entries = new Map<string, { child: unknown; rekeyed: boolean }>()
  for (const [key, child] of Object.entries(value)) {
    const verbatim = WSL_MOVE_FREE_TEXT_KEYS.has(key) || VERBATIM_KEYS.has(key)
    const nextKey = map(key)
    const nextChild = rewriteNode(child, map, verbatim)
    changed ||= nextKey !== key || nextChild !== child
    const rekeyed = nextKey !== key
    const other = entries.get(nextKey)
    entries.set(
      nextKey,
      other
        ? mergeWslDriveUncKeyedEntries(nextKey, other, { child: nextChild, rekeyed })
        : {
            child: nextChild,
            rekeyed
          }
    )
  }
  return changed
    ? Object.fromEntries([...entries].map(([key, entry]) => [key, entry.child]))
    : value
}

/** The re-keyed entry wins a tie: it is the one the user's UNC project wrote. */
export function mergeWslDriveUncKeyedEntries(
  key: string,
  a: { child: unknown; rekeyed: boolean },
  b: { child: unknown; rekeyed: boolean }
): { child: unknown; rekeyed: boolean } {
  const [converted, existing] = b.rekeyed && !a.rekeyed ? [b, a] : [a, b]
  if (isEmptyValue(existing.child) || isDeepStrictEqual(existing.child, converted.child)) {
    return converted
  }
  if (isEmptyValue(converted.child)) {
    return existing
  }
  throw new WslDriveUncKeyCollisionError(key)
}

function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true
  }
  if (Array.isArray(value)) {
    return value.length === 0
  }
  return typeof value === 'object' && Object.keys(value).length === 0
}
