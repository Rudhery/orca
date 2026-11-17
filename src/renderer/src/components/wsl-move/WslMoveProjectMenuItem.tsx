import React from 'react'
import { FolderInput } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import { useAppStore } from '@/store'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { selectFolderWorkspaces } from '@/store/workspaces/catalog/workspace-record-fields'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host/execution-host'
import type { Repo } from '../../../../shared/repository/repo-types'
import type { WslMoveRowRef } from '../../../../shared/wsl-move/wsl-move-driver-types'
import { useWslMoveTargetForPath, useWslMoveTargetForRepo } from './wsl-move-entry'
import { openWslMoveForProject } from './wsl-mapped-drive-move-store'

function MoveItem({
  target,
  project,
  name
}: {
  target: ReturnType<typeof useWslMoveTargetForRepo>
  project: WslMoveRowRef
  name: string
}): React.JSX.Element | null {
  const t = useTranslate()
  if (!target) {
    return null
  }
  return (
    <DropdownMenuItem onSelect={() => openWslMoveForProject(target, project, name)}>
      <FolderInput className="size-3.5" />
      {t('wslMove.entry.projectMenu', 'Move to {{distro}} host…', { distro: target.distro })}
    </DropdownMenuItem>
  )
}

/** "Move to <distro> host…" for a local WSL project; nothing where no move is offered. */
export function WslMoveProjectMenuItem({ repo }: { repo: Repo }): React.JSX.Element | null {
  const target = useWslMoveTargetForRepo(repo)
  return (
    <MoveItem target={target} project={{ kind: 'repo', id: repo.id }} name={repo.displayName} />
  )
}

/** The same for a local folder workspace, from its row's menu. */
export function WslMoveFolderWorkspaceMenuItem({
  folderWorkspaceId
}: {
  folderWorkspaceId: string
}): React.JSX.Element | null {
  const folder = useAppStore((s) =>
    selectFolderWorkspaces(s).find(
      (entry) =>
        entry.id === folderWorkspaceId &&
        (entry.executionHostId ?? LOCAL_EXECUTION_HOST_ID) === LOCAL_EXECUTION_HOST_ID &&
        !entry.connectionId
    )
  )
  const target = useWslMoveTargetForPath(folder?.folderPath, !!folder)
  return folder ? (
    <MoveItem target={target} project={{ kind: 'folder', id: folder.id }} name={folder.name} />
  ) : null
}
