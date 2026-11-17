import React from 'react'
import { useTranslate } from '@/i18n/use-translate'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import {
  closeWslMappedDriveMove,
  confirmWslMappedDriveMove,
  useWslMappedDriveMoveStore,
  wslMappedDriveMoveBusy
} from './wsl-mapped-drive-move-store'

/** The step before moving a mapped-drive project: reopen it at its share path, which restarts Orca. */
export function WslMappedDriveMoveDialog(): React.JSX.Element | null {
  const t = useTranslate()
  const request = useWslMappedDriveMoveStore((s) => s.request)
  const step = useWslMappedDriveMoveStore((s) => s.step)
  if (!request) {
    return null
  }
  const { distro, letter, sharePath, name } = request
  const converting = wslMappedDriveMoveBusy(step)
  const confirmLabel =
    step.kind === 'converting'
      ? t('wslMove.mappedDrive.pausing', 'Pausing terminals…')
      : step.kind === 'restarting'
        ? t('wslMove.mappedDrive.restartingLabel', 'Restarting…')
        : step.kind === 'problem'
          ? t('wslMove.mappedDrive.retry', 'Try again')
          : t('wslMove.mappedDrive.confirm', 'Restart and continue')
  return (
    <Dialog open onOpenChange={(open) => !open && closeWslMappedDriveMove()}>
      <DialogContent
        className="sm:max-w-lg"
        showCloseButton={!converting}
        data-testid="wsl-mapped-drive-move-dialog"
        onEscapeKeyDown={(event) => converting && event.preventDefault()}
        onInteractOutside={(event) => converting && event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>
            {t('wslMove.mappedDrive.title', 'Move {{name}} to the {{distro}} host', {
              name,
              distro
            })}
          </DialogTitle>
          <DialogDescription>
            {t(
              'wslMove.mappedDrive.description',
              'Orca opens this project through drive {{letter}}:. To move it, Orca first reopens it at {{sharePath}} and restarts. Tabs, terminals with their history, chats and settings come along. After the restart, the move opens so you can review it.',
              { letter, sharePath }
            )}
          </DialogDescription>
        </DialogHeader>
        {step.kind === 'problem' ? (
          <div role="alert" className="space-y-1 text-sm text-destructive">
            {step.messages.map((message) => (
              <p key={message}>{message}</p>
            ))}
          </div>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            disabled={converting}
            onClick={closeWslMappedDriveMove}
          >
            {t('wslMove.mappedDrive.cancel', 'Cancel')}
          </Button>
          {/* Fixed width: the label changes with each stage, and the footer must not shift. */}
          <Button
            type="button"
            className="w-48"
            disabled={converting}
            onClick={() => void confirmWslMappedDriveMove()}
          >
            {converting ? <LoadingSpinner className="size-4" /> : null}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
