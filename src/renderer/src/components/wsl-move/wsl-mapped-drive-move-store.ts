/**
 * Moving a project saved under a drive letter mapped to a distro share (`W:\home\x`). The WSL move
 * takes a project only by its share path, so Orca first reopens it there, which restarts the app;
 * the move then opens with that project (openWslMappedDriveMovesDue).
 */
import { create } from 'zustand'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import type {
  WslDriveUncConversionResult,
  WslMappedDriveMoveDue
} from '../../../../shared/wsl-move/wsl-drive-unc-conversion-types'
import type { WslMoveRowRef } from '../../../../shared/wsl-move/wsl-move-driver-types'
import { wslDriveUncConversionMessages } from '../wsl-drive-project/wsl-drive-unc-conversion-copy'
import { openWslMoveDialogFor, type WslMoveTarget } from './wsl-move-entry'

export type WslMappedDriveMoveRequest = {
  distro: string
  /** The drive letter the project is saved under, and the share it showed. */
  letter: string
  share: string
  /** Where the project reopens: its folder on the distro share. */
  sharePath: string
  ref: WslMoveRowRef
  name: string
}

type Step =
  | { kind: 'review' }
  /** Main is checking the drive and putting the project's terminals to sleep. */
  | { kind: 'converting' }
  /** Main accepted; the app is about to restart. */
  | { kind: 'restarting' }
  | { kind: 'problem'; messages: string[] }

export function wslMappedDriveMoveBusy(step: Step): boolean {
  return step.kind === 'converting' || step.kind === 'restarting'
}

type State = { request: WslMappedDriveMoveRequest | null; step: Step }

export const useWslMappedDriveMoveStore = create<State>()(() => ({
  request: null,
  step: { kind: 'review' }
}))

export function openWslMappedDriveMove(request: WslMappedDriveMoveRequest): void {
  useWslMappedDriveMoveStore.setState({ request, step: { kind: 'review' } })
}

/** One project's move: the dialog, or for a mapped drive the reopen that comes first. */
export function openWslMoveForProject(
  target: WslMoveTarget,
  ref: WslMoveRowRef,
  name: string
): void {
  if (target.mappedDrive) {
    openWslMappedDriveMove({ distro: target.distro, ...target.mappedDrive, ref, name })
    return
  }
  openWslMoveDialogFor(target.distro, ref)
}

export function closeWslMappedDriveMove(): void {
  if (!wslMappedDriveMoveBusy(useWslMappedDriveMoveStore.getState().step)) {
    useWslMappedDriveMoveStore.setState({ request: null, step: { kind: 'review' } })
  }
}

export async function confirmWslMappedDriveMove(): Promise<void> {
  const { request } = useWslMappedDriveMoveStore.getState()
  if (!request) {
    return
  }
  useWslMappedDriveMoveStore.setState({ step: { kind: 'converting' } })
  let result: WslDriveUncConversionResult
  try {
    result = await window.api.wslDriveUnc.convert({
      distro: request.distro,
      repoIds: request.ref.kind === 'repo' ? [request.ref.id] : [],
      folderWorkspaceIds: request.ref.kind === 'folder' ? [request.ref.id] : [],
      mappedDriveLetter: request.letter,
      mappedDriveShare: request.share
    })
  } catch {
    useWslMappedDriveMoveStore.setState({
      step: {
        kind: 'problem',
        messages: [
          translate(
            'wslMove.mappedDrive.failed',
            'Orca could not reopen this project, so nothing changed.'
          )
        ]
      }
    })
    return
  }
  if (useWslMappedDriveMoveStore.getState().request !== request) {
    return
  }
  if (result.outcome === 'restarting') {
    // The dialog stays until the window goes away.
    useWslMappedDriveMoveStore.setState({ step: { kind: 'restarting' } })
    toast(translate('wslMove.mappedDrive.restarting', 'Restarting Orca to reopen this project…'))
    return
  }
  useWslMappedDriveMoveStore.setState({
    step: {
      kind: 'problem',
      messages: wslDriveUncConversionMessages(result, request.sharePath, request.letter)
    }
  })
}

/** After the restart that reopened them: the move, with only those projects checked. */
export async function openWslMappedDriveMovesDue(): Promise<void> {
  let due: WslMappedDriveMoveDue[]
  try {
    due = await window.api.wslDriveUnc.takeMappedDriveMovesDue()
  } catch {
    return
  }
  // One dialog at a time; a second distro's projects are listed on its host row.
  const first = due[0]
  if (!first) {
    return
  }
  const refs: WslMoveRowRef[] = [
    ...first.repoIds.map((id) => ({ kind: 'repo' as const, id })),
    ...first.folderWorkspaceIds.map((id) => ({ kind: 'folder' as const, id }))
  ]
  openWslMoveDialogFor(first.distro, refs)
}
