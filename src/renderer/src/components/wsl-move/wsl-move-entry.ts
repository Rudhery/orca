/**
 * The move dialog's entry points (host row, project menu, project runtime setting). Each is
 * offered only where WSL hosts are: the internal gate open (the preload omits the API otherwise)
 * and the Experimental switch on. Main refuses every call with the gate closed regardless.
 */
import { useEffect, useState } from 'react'
import { useAppStore } from '@/store'
import {
  getRepoExecutionHostId,
  LOCAL_EXECUTION_HOST_ID
} from '../../../../shared/execution-host/execution-host'
import { wslHostMovableDistroOfPath } from '../../../../shared/file-access/wsl-paths'
import type { Repo } from '../../../../shared/repository/repo-types'
import type { WslMoveRowRef } from '../../../../shared/wsl-move/wsl-move-driver-types'
import {
  useWslHostsAcceptNewWork,
  useWslHostServerFilesMissing
} from '../sidebar/use-wsl-hosts-enabled'
import { resolveWslMappedDrivePath } from '../sidebar/wsl-mapped-drive-path'
import { openWslMoveDialog } from './wsl-move-dialog-store'
import { selectFolderWorkspaces } from '@/store/workspaces/catalog/workspace-record-fields'
import { findWslHostForDistro, wslMoveCatalogCandidates } from './wsl-move-scope-rows'

export function openWslMoveDialogFor(distro: string, only?: WslMoveRowRef): void {
  void openWslMoveDialog({
    distro,
    only,
    catalogCandidates: () => {
      const state = useAppStore.getState()
      return wslMoveCatalogCandidates(
        { repos: state.repos, folders: selectFolderWorkspaces(state) },
        distro
      )
    }
  })
}

/** Where a local project can move: its distro's host, spelled as the host names the distro. */
export type WslMoveTarget = {
  distro: string
  /** Saved under a drive letter mapped to the distro's share: the move reopens it there first. */
  mappedDrive?: { letter: string; sharePath: string }
}

const DRIVE_PATH = /^[A-Za-z]:[\\/]/

/** The share path of a drive-letter path once main resolved it; null for any other path. */
function useMappedDriveShare(path: string | null): string | null {
  const [resolved, setResolved] = useState<{ path: string; share: string | null } | null>(null)
  const wanted = path && DRIVE_PATH.test(path) ? path : null
  useEffect(() => {
    if (!wanted) {
      return
    }
    let current = true
    // Main bounds and caches the lookup per drive letter.
    void resolveWslMappedDrivePath(wanted).then((share) => {
      if (current) {
        setResolved({ path: wanted, share })
      }
    })
    return () => {
      current = false
    }
  }, [wanted])
  return wanted && resolved?.path === wanted ? resolved.share : null
}

/** The host a local project's folder could move to, or null where no move is offered. */
export function useWslMoveTargetForPath(
  path: string | null | undefined,
  isLocal: boolean
): WslMoveTarget | null {
  const enabled = useWslHostsAcceptNewWork()
  const serverFilesMissing = useWslHostServerFilesMissing()
  const environments = useAppStore((s) => s.runtimeEnvironments)
  const offered = enabled && !serverFilesMissing && isLocal && path ? path : null
  const share = useMappedDriveShare(offered)
  return offered ? wslMoveTargetOfPath(offered, share, environments) : null
}

/** `share` is the resolved share path of a drive-letter `path`, else null. */
export function wslMoveTargetOfPath(
  path: string,
  share: string | null,
  environments: Parameters<typeof findWslHostForDistro>[0]
): WslMoveTarget | null {
  const uncDistro = wslHostMovableDistroOfPath(path)
  const sharePath = uncDistro || !DRIVE_PATH.test(path) ? null : share
  const distro = uncDistro ?? (sharePath ? wslHostMovableDistroOfPath(sharePath) : null)
  const host = distro ? findWslHostForDistro(environments, distro) : null
  if (!host) {
    return null
  }
  return sharePath
    ? { distro: host.distro, mappedDrive: { letter: path[0].toUpperCase(), sharePath } }
    : { distro: host.distro }
}

/** The distro host a local WSL repo can move to, or null where no move is offered. */
export function useWslMoveTargetForRepo(
  repo: Pick<Repo, 'path' | 'connectionId' | 'executionHostId'> | null | undefined
): WslMoveTarget | null {
  return useWslMoveTargetForPath(
    repo?.path,
    !!repo && getRepoExecutionHostId(repo) === LOCAL_EXECUTION_HOST_ID
  )
}
