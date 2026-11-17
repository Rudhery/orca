import { describe, expect, it } from 'vitest'
import { wslDriveUncRespelling, wslMappedDrivePathToShare } from './wsl-drive-unc-respelling'
import {
  convertedQuickOpenHistoryScope,
  wslDriveUncRendererKeys
} from './wsl-drive-unc-renderer-store-keys'

const DRIVE = { letter: 'W', share: String.raw`\\wsl.localhost\Ubuntu` }

describe('wslMappedDrivePathToShare', () => {
  it('respells either separator and drive case, keeping the Linux tail as written', () => {
    expect(wslMappedDrivePathToShare(String.raw`W:\home\Me\App`, DRIVE)).toBe(
      String.raw`\\wsl.localhost\Ubuntu\home\Me\App`
    )
    expect(wslMappedDrivePathToShare('w:/home/me/app/', DRIVE)).toBe(
      String.raw`\\wsl.localhost\Ubuntu\home\me\app`
    )
    expect(wslMappedDrivePathToShare('W:\\', DRIVE)).toBe(DRIVE.share)
  })

  it('takes nothing off the mapped drive, drive-relative, or past its root', () => {
    expect(wslMappedDrivePathToShare(String.raw`C:\home\me`, DRIVE)).toBeNull()
    expect(wslMappedDrivePathToShare('W:home', DRIVE)).toBeNull()
    expect(wslMappedDrivePathToShare(String.raw`\\wsl.localhost\Ubuntu\home`, DRIVE)).toBeNull()
    expect(wslMappedDrivePathToShare(String.raw`W:\..\etc`, DRIVE)).toBeNull()
    expect(wslMappedDrivePathToShare(String.raw`W:\home\me\..\you\.\x`, DRIVE)).toBe(
      String.raw`\\wsl.localhost\Ubuntu\home\you\x`
    )
  })

  it('respells a drive mapped to a folder inside the distro', () => {
    const home = { letter: 'H', share: String.raw`\\wsl$\Ubuntu\home\me` }
    expect(wslMappedDrivePathToShare(String.raw`H:\App`, home)).toBe(
      String.raw`\\wsl$\Ubuntu\home\me\App`
    )
  })
})

describe('wslDriveUncRespelling for a mapped drive', () => {
  const respelling = wslDriveUncRespelling({ distro: 'Ubuntu', mappedDrive: DRIVE })

  it('respells a file URL on the drive, keeping its own encoding and suffix', () => {
    expect(respelling.fileUrl('file:///W:/home/me/My%20App/a.ts#L3')).toEqual({
      url: 'file://wsl.localhost/Ubuntu/home/me/My%20App/a.ts#L3',
      path: String.raw`\\wsl.localhost\Ubuntu\home\me\My App\a.ts`
    })
    expect(respelling.fileUrl('file:///C:/home/me/a.ts')).toBeNull()
  })

  it('leaves the D1c respelling as it was', () => {
    const d1c = wslDriveUncRespelling({ distro: 'Ubuntu' }, [
      String.raw`\\wsl.localhost\Ubuntu\mnt\c\src`
    ])
    expect(d1c.path(String.raw`\\wsl.localhost\Ubuntu\mnt\c\src`)).toBe(String.raw`C:\src`)
    expect(d1c.comparisonForm('//wsl/ubuntu/mnt/c/src')).toBe('c:/src')
    expect(d1c.path(String.raw`W:\home`)).toBeNull()
  })
})

describe('wslDriveUncRendererKeys for a mapped drive', () => {
  it('re-keys a quick-open history inside a converted folder only', () => {
    const keys = wslDriveUncRendererKeys({
      distro: 'Ubuntu',
      mappedDrive: DRIVE,
      worktreeIds: [
        [String.raw`r::W:\home\me\app`, String.raw`r::\\wsl.localhost\Ubuntu\home\me\app`]
      ],
      rootPaths: [String.raw`W:\home\me\app`]
    })
    const route = { executionHostId: 'local' }
    expect(
      convertedQuickOpenHistoryScope(
        JSON.stringify([route, String.raw`r::W:\home\me\app`, 'w:/home/me/app']),
        keys
      )
    ).toBe(
      JSON.stringify([
        route,
        String.raw`r::\\wsl.localhost\Ubuntu\home\me\app`,
        '//wsl/ubuntu/home/me/app'
      ])
    )
    expect(keys.path(String.raw`W:\home\me\other`)).toBeNull()
  })

  it("keeps the root's case for a mixed-case folder, whose key is folded", () => {
    const oldId = String.raw`r::W:\home\me\App`
    const newId = String.raw`r::\\wsl.localhost\Ubuntu\home\me\App`
    const keys = wslDriveUncRendererKeys({
      distro: 'Ubuntu',
      mappedDrive: DRIVE,
      worktreeIds: [[oldId, newId]],
      rootPaths: [String.raw`W:\home\me\App`]
    })
    const route = { executionHostId: 'local' }
    expect(
      convertedQuickOpenHistoryScope(JSON.stringify([route, oldId, 'w:/home/me/app']), keys)
    ).toBe(JSON.stringify([route, newId, '//wsl/ubuntu/home/me/App']))
  })
})
