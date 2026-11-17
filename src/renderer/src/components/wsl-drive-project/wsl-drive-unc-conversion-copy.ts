/**
 * Plain-language copy for why a UNC Windows-drive project can't be converted right now, or why a
 * mapped-drive project (`mappedDriveLetter`) can't be reopened at its share path.
 */
import { translate } from '@/i18n/i18n'
import type {
  WslDriveUncConversionBlocker,
  WslDriveUncConversionResult
} from '../../../../shared/wsl-move/wsl-drive-unc-conversion-types'
import { wslDriveProjectBlockerMessage } from './wsl-drive-project-copy'

export function wslDriveUncConversionMessages(
  result: Exclude<WslDriveUncConversionResult, { outcome: 'restarting' }>,
  /** Where the project would reopen: its drive path, or its share path for a mapped drive. */
  drivePath: string,
  mappedDriveLetter?: string
): string[] {
  switch (result.outcome) {
    case 'refused':
      return result.blockers.map((blocker) =>
        mappedDriveLetter
          ? (mappedDriveBlockerMessage(blocker, mappedDriveLetter) ??
            blockerMessage(blocker, drivePath))
          : blockerMessage(blocker, drivePath)
      )
    case 'terminals-blocked':
      return [
        translate(
          'wslDriveUnc.terminalsBusy',
          'Some terminals in this project are busy. Let them finish or close them, then try again.'
        )
      ]
    case 'pause-failed':
      return [
        translate(
          'wslDriveUnc.pauseFailed',
          'Orca could not pause this project’s terminals, so nothing changed.'
        )
      ]
  }
}

/** The mapped-drive wording where D1c's would name the wrong place; null to use D1c's. */
function mappedDriveBlockerMessage(
  blocker: WslDriveUncConversionBlocker,
  letter: string
): string | null {
  if (blocker.kind === 'drive-unverifiable') {
    return translate(
      'wslDriveUnc.mappedDrive.unverifiable',
      'Orca couldn’t check where drive {{letter}}: points just now, so nothing changed. Try again in a moment.',
      { letter }
    )
  }
  if (blocker.kind === 'drive-not-mapped') {
    return translate(
      'wslDriveUnc.mappedDrive.notMapped',
      'Drive {{letter}}: no longer points into this distro, so nothing changed.',
      { letter }
    )
  }
  if (blocker.kind !== 'not-convertible') {
    return null
  }
  switch (blocker.reason) {
    case 'mixed-locations':
      return translate(
        'wslDriveUnc.mappedDrive.mixed',
        'Some of this project’s folders aren’t on drive {{letter}}:, so they can’t move with it.',
        { letter }
      )
    case 'not-local':
    case 'not-in-scope':
      return translate(
        'wslDriveUnc.mappedDrive.notOnDrive',
        'This project isn’t on drive {{letter}}: on this computer.',
        { letter }
      )
    default:
      return null
  }
}

function blockerMessage(blocker: WslDriveUncConversionBlocker, drivePath: string): string {
  switch (blocker.kind) {
    case 'drive-unverifiable':
      return translate(
        'wslDriveUnc.blocker.driveUnverifiable',
        'Orca couldn’t check where that drive points just now, so nothing changed. Try again in a moment.'
      )
    case 'drive-not-mapped':
      return translate(
        'wslDriveUnc.blocker.driveNotMapped',
        'That drive no longer points into this distro, so nothing changed.'
      )
    case 'conversion-pending':
      return translate(
        'wslDriveUnc.blocker.pending',
        'Orca is already converting a project. It finishes when Orca restarts.'
      )
    case 'windows-git-missing':
    case 'wsl-authored-worktrees':
      return wslDriveProjectBlockerMessage(blocker)
    case 'state-conflict':
      if (blocker.cause === 'differing-saved-data') {
        return translate(
          'wslDriveUnc.blocker.differingState',
          'Orca saved different details for this folder under both its WSL path and {{drivePath}}, so nothing changed.',
          { drivePath }
        )
      }
      if (blocker.cause === 'project-split') {
        return translate(
          'wslDriveUnc.blocker.projectSplit',
          'This project also holds a repository that isn’t converting, so nothing changed.'
        )
      }
      return translate(
        'wslDriveUnc.blocker.state',
        'Orca found saved state for this project it can’t convert safely, so nothing changed.'
      )
    case 'not-convertible':
      switch (blocker.reason) {
        case 'duplicate-windows-project':
          return translate(
            'wslDriveUnc.blocker.duplicate',
            '{{drivePath}} is already a project in Orca.',
            { drivePath }
          )
        case 'mixed-locations':
          return translate(
            'wslDriveUnc.blocker.mixed',
            'Some of this project’s folders are inside WSL, not on a Windows drive.'
          )
        case 'not-windows-drive-mount':
          return translate(
            'wslDriveUnc.blocker.notDriveMount',
            'In this distro, that folder isn’t {{drivePath}}: it isn’t mounted from that Windows drive.',
            { drivePath }
          )
        case 'overlaps-refused-project':
          return translate(
            'wslDriveUnc.blocker.overlap',
            'This project shares folders with a project Orca can’t convert, so they would split.'
          )
        case 'runtime-would-change':
          return translate(
            'wslDriveUnc.blocker.runtimeWouldChange',
            'Reopening this at {{drivePath}} would change where its terminals and Git run, so nothing changed. Choose its Project runtime first, or add the folder again at {{drivePath}}.',
            { drivePath }
          )
        case 'windows-drive-folder':
          return translate(
            'wslDriveUnc.blocker.windowsDriveFolder',
            'This folder is a Windows drive seen through WSL, so it stays on this computer.'
          )
        case 'not-local':
        case 'not-in-scope':
          return translate(
            'wslDriveUnc.blocker.notConvertible',
            'This project isn’t on a Windows drive on this computer.'
          )
      }
  }
}
