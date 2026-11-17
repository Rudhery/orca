import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn() }))
const openWslMoveDialog = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('sonner', () => ({ toast }))
vi.mock('./wsl-move-dialog-store', () => ({ openWslMoveDialog }))

import { wslMoveTargetOfPath } from './wsl-move-entry'
import {
  confirmWslMappedDriveMove,
  openWslMappedDriveMovesDue,
  openWslMoveForProject,
  useWslMappedDriveMoveStore
} from './wsl-mapped-drive-move-store'

const SHARE = String.raw`\\wsl.localhost\Ubuntu`
const SHARE_PATH = String.raw`\\wsl.localhost\Ubuntu\home\u\repo`
const host = {
  id: 'env-1',
  name: 'Ubuntu host',
  orcadDeployment: { kind: 'wsl' as const, distro: 'Ubuntu', localPort: 4100, remotePort: 4200 }
}

const convert = vi.fn()
const takeMappedDriveRestartReport = vi.fn()

beforeEach(() => {
  vi.stubGlobal('window', { api: { wslDriveUnc: { convert, takeMappedDriveRestartReport } } })
})

afterEach(() => {
  convert.mockReset()
  takeMappedDriveRestartReport.mockReset()
  toast.error.mockReset()
  openWslMoveDialog.mockClear()
  toast.mockReset()
  vi.unstubAllGlobals()
  useWslMappedDriveMoveStore.setState({ request: null, step: { kind: 'review' } })
})

describe('wslMoveTargetOfPath', () => {
  it('names the mapped drive for a drive path whose share has a host', () => {
    expect(wslMoveTargetOfPath(String.raw`w:\home\u\repo`, SHARE, [host])).toEqual({
      distro: 'Ubuntu',
      mappedDrive: { letter: 'W', share: SHARE, sharePath: SHARE_PATH }
    })
  })

  it('offers nothing without a host, or for a share into a Windows drive', () => {
    expect(wslMoveTargetOfPath(String.raw`W:\home\u\repo`, SHARE, [])).toBeNull()
    expect(wslMoveTargetOfPath(String.raw`W:\mnt\c\src`, SHARE, [host])).toBeNull()
  })

  it('keeps a UNC project on the plain move', () => {
    expect(wslMoveTargetOfPath(SHARE_PATH, null, [host])).toEqual({ distro: 'Ubuntu' })
  })
})

describe('the mapped-drive move', () => {
  const target = {
    distro: 'Ubuntu',
    mappedDrive: { letter: 'W', share: SHARE, sharePath: SHARE_PATH }
  }

  it('asks main to reopen the project at its share path', async () => {
    convert.mockResolvedValue({ outcome: 'restarting', migrationId: 'conv-1' })
    openWslMoveForProject(target, { kind: 'folder', id: 'notes' }, 'notes')
    expect(openWslMoveDialog).not.toHaveBeenCalled()
    await confirmWslMappedDriveMove()
    expect(convert).toHaveBeenCalledWith({
      distro: 'Ubuntu',
      repoIds: [],
      folderWorkspaceIds: ['notes'],
      mappedDriveLetter: 'W',
      // What the window showed, so main refuses a drive remapped since.
      mappedDriveShare: SHARE
    })
    expect(useWslMappedDriveMoveStore.getState().step).toEqual({ kind: 'restarting' })
    expect(toast).toHaveBeenCalledOnce()
  })

  it('shows why main refused, worded for the mapped drive', async () => {
    convert.mockResolvedValue({ outcome: 'refused', blockers: [{ kind: 'drive-not-mapped' }] })
    openWslMoveForProject(target, { kind: 'repo', id: 'repo-w' }, 'repo')
    await confirmWslMappedDriveMove()
    expect(useWslMappedDriveMoveStore.getState().step).toEqual({
      kind: 'problem',
      messages: [expect.stringContaining('W:')]
    })
  })

  it('says to try again when the drive could not be checked in time', async () => {
    convert.mockResolvedValue({ outcome: 'refused', blockers: [{ kind: 'drive-unverifiable' }] })
    openWslMoveForProject(target, { kind: 'repo', id: 'repo-w' }, 'repo')
    await confirmWslMappedDriveMove()
    expect(useWslMappedDriveMoveStore.getState().step).toEqual({
      kind: 'problem',
      messages: [expect.stringContaining('Try again')]
    })
  })

  it('tells the user a restart that changed nothing, and opens no move', async () => {
    takeMappedDriveRestartReport.mockResolvedValue({
      moves: [],
      rolledBack: [{ reason: 'remapped', letter: 'W', workspaceIds: ['repo-w::W:\\x'] }]
    })
    await openWslMappedDriveMovesDue()
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('now points somewhere else'))
    expect(openWslMoveDialog).not.toHaveBeenCalled()
  })

  it('opens the move with every reopened project checked once the restart is done', async () => {
    takeMappedDriveRestartReport.mockResolvedValue({
      moves: [
        { distro: 'Ubuntu', repoIds: ['repo-w', 'repo-nested'], folderWorkspaceIds: ['notes'] }
      ],
      rolledBack: []
    })
    await openWslMappedDriveMovesDue()
    expect(openWslMoveDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        distro: 'Ubuntu',
        only: [
          { kind: 'repo', id: 'repo-w' },
          { kind: 'repo', id: 'repo-nested' },
          { kind: 'folder', id: 'notes' }
        ]
      })
    )
  })
})
