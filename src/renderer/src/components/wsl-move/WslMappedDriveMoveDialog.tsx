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
  useWslMappedDriveMoveStore
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
  const converting = step.kind === 'converting'
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
          <div role="alert" className="space-y-1 text-sm text-muted-foreground">
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
          <Button
            type="button"
            disabled={converting}
            onClick={() => void confirmWslMappedDriveMove()}
          >
            {converting ? <LoadingSpinner className="size-4" /> : null}
            {step.kind === 'problem'
              ? t('wslMove.mappedDrive.retry', 'Try again')
              : t('wslMove.mappedDrive.confirm', 'Restart and continue')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
