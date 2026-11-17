/**
 * The mapped-drive half of the startup conversion: whether a respelling plan may still run, and
 * what the window hears about the ones that ran or rolled back.
 */
import type {
  WslMappedDriveMoveDue,
  WslMappedDriveRollback
} from '../../../shared/wsl-move/wsl-drive-unc-conversion-types'
import { wslMappedDrivePathToShare } from '../../../shared/wsl-move/wsl-drive-unc-respelling'
import { readProfileProjectTransferState } from '../../orca-profiles/project-transfer/profile-project-domain-state'
import type { WslDriveUncConversion } from './wsl-drive-unc-conversion-journal'
import type {
  WslDriveUncConversionOutcome,
  WslDriveUncConversionStartupDeps
} from './wsl-drive-unc-conversion-startup'
import { wslMappedDriveMatches } from './wsl-mapped-drive-share'

/** The restart follows the confirm within seconds; a plan this old was left by another run. */
const MAPPED_DRIVE_PLAN_MAX_AGE_MS = 60 * 60 * 1000

/** The workspaces the confirm slept: every re-keyed worktree, and each folder. */
export function pausedOf(record: WslDriveUncConversion): string[] {
  return [
    ...record.worktreeIds.map(([oldId]) => oldId),
    ...record.folderWorkspaceIds.map((id) => `folder:${id}`)
  ]
}

/** Any project of the plan still saved under the drive letter: the profile commit hasn't run. */
export function profileStillNamesMappedDrive(
  deps: WslDriveUncConversionStartupDeps,
  record: WslDriveUncConversion
): boolean {
  const drive = record.mappedDrive
  if (!drive) {
    return false
  }
  const { state } = readProfileProjectTransferState(deps.profileId, deps.profileUserDataPath)
  const onDrive = (path: string): boolean => wslMappedDrivePathToShare(path, drive) !== null
  return (
    state.repos.some((repo) => record.repoIds.includes(repo.id) && onDrive(repo.path)) ||
    state.folderWorkspaces.some(
      (folder) => record.folderWorkspaceIds.includes(folder.id) && onDrive(folder.folderPath)
    )
  )
}

/**
 * A mapped-drive plan names the drive's share as it was at the confirm. One left over (an older
 * build ran in between, say) or a drive remapped since rolls back instead of rewriting into the
 * wrong distro or folder.
 */
export async function assertMappedDriveStillMatches(
  deps: WslDriveUncConversionStartupDeps,
  record: WslDriveUncConversion
): Promise<void> {
  const drive = record.mappedDrive
  if (!drive) {
    return
  }
  const age = (deps.now?.() ?? new Date()).getTime() - Date.parse(record.createdAt)
  if (!(age >= 0 && age <= MAPPED_DRIVE_PLAN_MAX_AGE_MS)) {
    throw new Error('wsl_mapped_drive_plan_expired')
  }
  const read = deps.readMappedDriveShare
    ? await deps.readMappedDriveShare(drive.letter)
    : 'unverifiable'
  if (read === 'unverifiable') {
    throw new Error('wsl_mapped_drive_unverifiable')
  }
  if (!wslMappedDriveMatches(read.share, record.distro, drive.share)) {
    throw new Error('wsl_mapped_drive_remapped')
  }
}

export function wslMappedDriveRollbacksOf(
  outcomes: readonly WslDriveUncConversionOutcome[]
): WslMappedDriveRollback[] {
  return outcomes.flatMap((outcome) =>
    outcome.outcome === 'rolled-back' && outcome.mappedDrive
      ? [{ reason: rollbackReason(outcome.detail), ...outcome.mappedDrive }]
      : []
  )
}

function rollbackReason(detail: string): WslMappedDriveRollback['reason'] {
  switch (detail) {
    case 'wsl_mapped_drive_remapped':
      return 'remapped'
    case 'wsl_mapped_drive_unverifiable':
      return 'unverifiable'
    case 'wsl_mapped_drive_plan_expired':
      return 'expired'
    default:
      return 'failed'
  }
}

export function wslMappedDriveMovesDueOf(
  outcomes: readonly WslDriveUncConversionOutcome[]
): WslMappedDriveMoveDue[] {
  return outcomes.flatMap((outcome) =>
    outcome.outcome === 'converted' &&
    outcome.mappedDrive &&
    outcome.respelledThisRun &&
    outcome.distro
      ? [
          {
            distro: outcome.distro,
            repoIds: outcome.repoIds,
            folderWorkspaceIds: outcome.folderWorkspaceIds
          }
        ]
      : []
  )
}
