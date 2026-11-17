/**
 * The journal of a UNC Windows-drive project conversion (D1c): `wsl-drive-unc-conversions/<id>.json`
 * beside the profile. Written once the scope's panes are asleep, and read at the next startup,
 * before the profile loads, which runs the conversion. Its own directory, so an older build never
 * reads it as a move. A mapped-drive respelling (`mappedDrive`) has a directory of its own too, so
 * an older build never runs it as a D1c conversion.
 *
 * - `prepared`: nothing outside the journal changed yet; a failed profile rewrite drops the record.
 * - `profile-rewritten`: the profile names the drive paths; the other stores only go forward.
 */
import { isRecord } from '../../../shared/orcad-migration/orcad-migration-manifest-fields'
import type { WslMappedDrive } from '../../../shared/wsl-move/wsl-drive-unc-respelling'
import { createMigrationJournalDirectory } from '../../persistence/migrating-orcad-catalog/cutover-journals/migration-journal-directory'

export const WSL_DRIVE_UNC_CONVERSION_PHASES = ['prepared', 'profile-rewritten'] as const
export type WslDriveUncConversionPhase = (typeof WSL_DRIVE_UNC_CONVERSION_PHASES)[number]

export type WslDriveUncConversion = {
  version: 1
  migrationId: string
  /** The profile the conversion rewrites; null in a journal written before it was recorded. */
  profileId: string | null
  distro: string
  /** Set for a mapped drive respelled to its share path; absent for D1c. */
  mappedDrive?: WslMappedDrive
  repoIds: string[]
  folderWorkspaceIds: string[]
  /**
   * The converting projects' folders as saved (UNC, or on the mapped drive), for a spawn that
   * names no workspace.
   */
  rootPaths: string[]
  phase: WslDriveUncConversionPhase
  /** Old → new worktree ids, from the profile rewrite; empty before it. */
  worktreeIds: [string, string][]
  /** The stores outside the profile already converted, so a resumed run skips them. */
  rewrittenStores: string[]
  createdAt: string
  updatedAt: string
}

export class WslDriveUncConversionJournalUnreadableError extends Error {
  constructor(detail: string) {
    super(`The Windows-drive conversion journal cannot be read: ${detail}`)
    this.name = 'WslDriveUncConversionJournalUnreadableError'
  }
}

const changeListeners = new Set<(userDataPath: string) => void>()

/** Runs after every durable write or removal; returns the unsubscribe. */
export function onWslDriveUncConversionJournalChange(
  listener: (userDataPath: string) => void
): () => void {
  changeListeners.add(listener)
  return () => changeListeners.delete(listener)
}

const journalOptions = {
  maxFileBytes: 4 * 1024 * 1024,
  unreadable: (detail: string) => new WslDriveUncConversionJournalUnreadableError(detail),
  onChange: (userDataPath: string) => {
    for (const listener of changeListeners) {
      listener(userDataPath)
    }
  }
}

const journals = createMigrationJournalDirectory({
  ...journalOptions,
  directoryName: 'wsl-drive-unc-conversions',
  parse: (value) => withoutMappedDrive(parseWslDriveUncConversion(value))
})

const mappedDriveJournals = createMigrationJournalDirectory({
  ...journalOptions,
  directoryName: 'wsl-mapped-drive-conversions',
  parse: (value) => withMappedDrive(parseWslDriveUncConversion(value))
})

export function listWslDriveUncConversions(userDataPath: string): WslDriveUncConversion[] {
  return [...journals.list(userDataPath), ...mappedDriveJournals.list(userDataPath)].map((record) =>
    structuredClone(record)
  )
}

/** A profile's conversions; one journaled before profiles were recorded counts for every profile. */
export function listWslDriveUncConversionsForProfile(
  userDataPath: string,
  profileId: string
): WslDriveUncConversion[] {
  return listWslDriveUncConversions(userDataPath).filter(
    (record) => record.profileId === null || record.profileId === profileId
  )
}

export function writeWslDriveUncConversion(
  userDataPath: string,
  record: WslDriveUncConversion
): void {
  ;(record.mappedDrive ? mappedDriveJournals : journals).write(userDataPath, record)
}

export function removeWslDriveUncConversion(userDataPath: string, migrationId: string): void {
  journals.remove(userDataPath, migrationId)
  mappedDriveJournals.remove(userDataPath, migrationId)
}

function withoutMappedDrive(record: WslDriveUncConversion): WslDriveUncConversion {
  if (record.mappedDrive) {
    throw new Error('wsl_drive_unc_conversion_mapped_drive_misplaced')
  }
  return record
}

function withMappedDrive(record: WslDriveUncConversion): WslDriveUncConversion {
  if (!record.mappedDrive) {
    throw new Error('wsl_drive_unc_conversion_mapped_drive_missing')
  }
  return record
}

function parseWslDriveUncConversion(value: unknown): WslDriveUncConversion {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !isText(value.migrationId) ||
    !isText(value.distro) ||
    !isTextList(value.repoIds) ||
    !isTextList(value.folderWorkspaceIds) ||
    !isTextList(value.rootPaths) ||
    !WSL_DRIVE_UNC_CONVERSION_PHASES.some((phase) => phase === value.phase) ||
    !Array.isArray(value.worktreeIds) ||
    !value.worktreeIds.every(
      (pair) => Array.isArray(pair) && pair.length === 2 && pair.every(isText)
    ) ||
    !isTextList(value.rewrittenStores) ||
    !isText(value.createdAt) ||
    !isText(value.updatedAt)
  ) {
    throw new Error('wsl_drive_unc_conversion_malformed')
  }
  return {
    version: 1,
    migrationId: value.migrationId,
    profileId: isText(value.profileId) ? value.profileId : null,
    distro: value.distro,
    ...(isMappedDrive(value.mappedDrive)
      ? { mappedDrive: { letter: value.mappedDrive.letter, share: value.mappedDrive.share } }
      : {}),
    repoIds: [...value.repoIds],
    folderWorkspaceIds: [...value.folderWorkspaceIds],
    rootPaths: [...value.rootPaths],
    phase: WSL_DRIVE_UNC_CONVERSION_PHASES.find((phase) => phase === value.phase) ?? 'prepared',
    worktreeIds: value.worktreeIds.map((pair: [string, string]) => [pair[0], pair[1]]),
    rewrittenStores: [...value.rewrittenStores],
    createdAt: value.createdAt,
    updatedAt: value.updatedAt
  }
}

function isMappedDrive(value: unknown): value is WslMappedDrive {
  return (
    isRecord(value) &&
    typeof value.letter === 'string' &&
    /^[A-Za-z]$/.test(value.letter) &&
    isText(value.share)
  )
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isTextList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isText)
}
