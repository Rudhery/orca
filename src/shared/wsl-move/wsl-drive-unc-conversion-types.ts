/**
 * Converting a UNC Windows-drive project to its drive path (D1c), or a mapped-drive project to its
 * share path; desktop-only IPC.
 */
import type { WslMoveBlocker } from './wsl-move-driver-types'

export type WslDriveUncConversionRequest = {
  distro: string
  /** The repos to convert; each must be a local UNC project on one of the distro's drives. */
  repoIds: string[]
  folderWorkspaceIds?: string[]
  /**
   * Respell projects saved under this drive letter, mapped to a share of `distro`, to the share's
   * UNC path instead, so the WSL move can take them. Absent: the D1c conversion.
   */
  mappedDriveLetter?: string
  /** The share the window showed for that drive; a drive remapped since is refused. */
  mappedDriveShare?: string
}

export type WslDriveUncConversionBlocker =
  /** A conversion is waiting for the restart that runs it. */
  | { kind: 'conversion-pending' }
  /** Not a UNC Windows-drive project Orca can convert in place (wsl-drive-unc-project-scope.ts). */
  | {
      kind: 'not-convertible'
      id: string
      reason:
        | 'not-in-scope'
        | 'mixed-locations'
        | 'not-local'
        | 'duplicate-windows-project'
        | 'overlaps-refused-project'
        | 'not-windows-drive-mount'
        | 'windows-drive-folder'
        | 'runtime-would-change'
    }
  /** The mapped drive no longer points where the window showed (`mappedDriveShare`). */
  | { kind: 'drive-not-mapped' }
  /** Windows didn't say in time where the drive points (a distro still starting, say). */
  | { kind: 'drive-unverifiable' }
  | { kind: 'windows-git-missing' }
  /** WSL Git made these worktrees; their links are Linux paths Windows Git can't follow. */
  | { kind: 'wsl-authored-worktrees'; repoId: string; paths: string[] }
  /** Its saved state can't be re-keyed; `cause` is optional for older hosts. */
  | {
      kind: 'state-conflict'
      detail: string
      /** A project also holds an unconverted repo, or a drive key already holds different data. */
      cause?: 'project-split' | 'differing-saved-data'
      /** The key whose UNC and drive entries differ. */
      key?: string
    }

/** Mapped-drive projects this startup respelled to their share; the window opens their move. */
export type WslMappedDriveMoveDue = {
  distro: string
  repoIds: string[]
  folderWorkspaceIds: string[]
}

/** A mapped-drive plan the restart rolled back: nothing changed, and its panes were asleep. */
export type WslMappedDriveRollback = {
  reason: 'remapped' | 'unverifiable' | 'expired' | 'failed'
  letter: string
  /** The workspaces whose terminals the confirm put to sleep. */
  workspaceIds: string[]
}

/** What this startup did with mapped-drive plans, handed to the window once. */
export type WslMappedDriveRestartReport = {
  moves: WslMappedDriveMoveDue[]
  rolledBack: WslMappedDriveRollback[]
}

export type WslDriveUncConversionResult =
  /** Journaled with the panes asleep; the app restarts and converts before the window opens. */
  | { outcome: 'restarting'; migrationId: string }
  | { outcome: 'refused'; blockers: WslDriveUncConversionBlocker[] }
  /** Terminals in scope are busy, or could not be put to sleep; nothing changed. */
  | { outcome: 'terminals-blocked'; blockers: WslMoveBlocker[] }
  | { outcome: 'pause-failed'; detail: string }
