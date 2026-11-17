import { ipcRenderer } from 'electron'
import type {
  WslDriveUncConversionRequest,
  WslDriveUncConversionResult,
  WslMappedDriveMoveDue
} from '../../../shared/wsl-move/wsl-drive-unc-conversion-types'
import type { WslDriveUncPendingRendererRewrite } from '../../../shared/wsl-move/wsl-drive-unc-renderer-store-keys'
import type { WslMoveRecordStoreRewrittenResult } from '../../../shared/wsl-move/wsl-move-renderer-rewrite-types'

/** Converting a UNC Windows-drive project to its drive path, or a mapped-drive one to its share; main gates every call. */
export type WslDriveUncConversionApi = {
  /** Checks, pauses the project's terminals and restarts the app to convert. */
  convert: (request: WslDriveUncConversionRequest) => Promise<WslDriveUncConversionResult>
  /** Mapped-drive projects this startup respelled, once per run, for the window to move. */
  takeMappedDriveMovesDue: () => Promise<WslMappedDriveMoveDue[]>
  listPendingRendererRewrites: () => Promise<WslDriveUncPendingRendererRewrite[]>
  recordStoreRewritten: (request: {
    migrationId: string
    storeId: string
  }) => Promise<WslMoveRecordStoreRewrittenResult>
}

export const wslDriveUncConversionApi: WslDriveUncConversionApi = {
  convert: (request) => ipcRenderer.invoke('wslDriveUnc:convert', request),
  takeMappedDriveMovesDue: () => ipcRenderer.invoke('wslDriveUnc:takeMappedDriveMovesDue'),
  listPendingRendererRewrites: () => ipcRenderer.invoke('wslDriveUnc:listPendingRendererRewrites'),
  recordStoreRewritten: (request) => ipcRenderer.invoke('wslDriveUnc:recordStoreRewritten', request)
}
