/** Why a project of the distro is listed under "Not moving", in the move dialog's words. */
import { translate } from '@/i18n/i18n'
import type { Translate } from '@/i18n/use-translate'

export function wslMoveScopeRefusalReason(reason: string, t: Translate = translate): string {
  switch (reason) {
    case 'windows-drive':
      return t(
        'wslMove.scopeRefused.windowsDrive',
        'Its folder is on a Windows drive, so it stays on this computer.'
      )
    case 'mixed-locations':
      return t(
        'wslMove.scopeRefused.mixedLocations',
        'Some of its folders are outside this distro, so it stays on this computer.'
      )
    case 'not-local':
      return t('wslMove.scopeRefused.notLocal', 'It already runs on another host.')
    case 'windows-git-worktrees':
      return t(
        'wslMove.scopeRefused.windowsGitWorktrees',
        'Git for Windows created some of its worktrees, and Git on the WSL host can’t use them. Remove those worktrees, then move it.'
      )
    default:
      return t('wslMove.scopeRefused.other', 'It cannot move.')
  }
}
