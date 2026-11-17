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
import { wslMappedDrivePathToShare } from '../../../../shared/wsl-move/wsl-mapped-drive-paths'
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

/** `only`: the projects that start checked; absent, every project of the distro does. */
export function openWslMoveDialogFor(
  distro: string,
  only?: WslMoveRowRef | readonly WslMoveRowRef[]
): void {
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
  /** Saved under a drive letter mapped to the distro's share; main reads that mapping itself. */
  viaMappedDrive?: boolean
}

const DRIVE_PATH = /^[A-Za-z]:[\\/]/
const SHARE_CACHE_TTL_MS = 60_000
// Per drive letter, so a menu opened again shows its item at once instead of after the lookup.
const shareCache = new Map<string, { share: string | null; at: number }>()

function cachedShare(letter: string): { share: string | null } | null {
  const entry = shareCache.get(letter)
  return entry && Date.now() - entry.at < SHARE_CACHE_TTL_MS ? entry : null
}

/** The share a drive letter maps to once main resolved it; null for any other drive. */
function useMappedDriveShare(path: string | null): string | null {
  const letter = path && DRIVE_PATH.test(path) ? path[0].toUpperCase() : null
  const [resolved, setResolved] = useState<{ letter: string; share: string | null } | null>(null)
  useEffect(() => {
    if (!letter || cachedShare(letter)) {
      return
    }
    let current = true
    // Main bounds and caches the lookup per drive letter.
    void resolveWslMappedDrivePath(`${letter}:\\`).then((share) => {
      shareCache.set(letter, { share, at: Date.now() })
      if (current) {
        setResolved({ letter, share })
      }
    })
    return () => {
      current = false
    }
  }, [letter])
  if (!letter) {
    return null
  }
  return cachedShare(letter)?.share ?? (resolved?.letter === letter ? resolved.share : null)
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

/** `share` is the share a drive-letter `path`'s drive maps to, else null. */
export function wslMoveTargetOfPath(
  path: string,
  share: string | null,
  environments: Parameters<typeof findWslHostForDistro>[0]
): WslMoveTarget | null {
  const uncDistro = wslHostMovableDistroOfPath(path)
  const letter = path[0]?.toUpperCase() ?? ''
  const sharePath =
    uncDistro || !share || !DRIVE_PATH.test(path)
      ? null
      : wslMappedDrivePathToShare(path, { letter, share })
  const distro = uncDistro ?? (sharePath ? wslHostMovableDistroOfPath(sharePath) : null)
  const host = distro ? findWslHostForDistro(environments, distro) : null
  if (!host) {
    return null
  }
  return sharePath ? { distro: host.distro, viaMappedDrive: true } : { distro: host.distro }
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
