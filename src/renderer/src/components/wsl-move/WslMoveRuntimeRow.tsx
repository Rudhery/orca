import React from 'react'
import { useTranslate } from '@/i18n/use-translate'
import { Button } from '@/components/ui/button'
import { SettingsRow } from '../settings/form-controls/SettingsFormControls'
import type { WslMoveTarget } from './wsl-move-entry'
import { openWslMoveForProject } from './wsl-mapped-drive-move-store'

/** The project runtime setting of a WSL project whose distro has a host: a move, not a toggle. */
export function WslMoveRuntimeRow({
  target,
  repoId,
  name
}: {
  target: WslMoveTarget
  repoId: string
  name: string
}): React.JSX.Element {
  const t = useTranslate()
  const { distro } = target
  return (
    <SettingsRow
      label={t('wslMove.runtime.label', 'Project runtime')}
      description={t(
        'wslMove.runtime.description',
        'This project runs in {{distro}} through this computer. Move it to the {{distro}} host to run it there.',
        { distro }
      )}
      control={
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => openWslMoveForProject(target, { kind: 'repo', id: repoId }, name)}
        >
          {t('wslMove.runtime.move', 'Move project')}
        </Button>
      }
    />
  )
}
