/** Browser entry: dictionary registration and the Settings slot seat. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { AccountSection, type AccountSectionInjected } from './AccountSection.tsx'
import {
  DISCONNECTED,
  NO_DESKTOP_UPDATES,
  type AccountFace,
  type AccountStatus,
  type UpdateCheck,
} from './contracts.ts'
import { en, zh, type AccountKey } from './locales.ts'

export type { AccountSectionInjected, AccountSectionProps } from './AccountSection.tsx'
export type { AccountFace, AccountStatus, UpdateCheck } from './contracts.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Copy for the Account settings page. */
    'settings.account': AccountKey
  }
}

const NS = 'settings.account'

/** Services required by the page registration. */
export const inject = ['slots', 'locale']

/** Minimal face of the desktop preload bridge (defined in apps/desktop). */
interface DesktopAccountBridge {
  accountStatus?: () => Promise<AccountStatus>
  accountSignIn?: () => Promise<AccountStatus>
  accountSignOut?: () => Promise<AccountStatus>
  checkForUpdates?: () => Promise<UpdateCheck>
  openRelease?: (url: string) => void
}

function desktopBridge(): DesktopAccountBridge | undefined {
  return (window as unknown as { dshDesktop?: DesktopAccountBridge }).dshDesktop
}

function faceFromBridge(bridge: DesktopAccountBridge | undefined): AccountFace {
  if (bridge === undefined) {
    return {
      status: () => Promise.resolve(DISCONNECTED),
      signIn: () => Promise.resolve(DISCONNECTED),
      signOut: () => Promise.resolve(DISCONNECTED),
      checkUpdates: () => Promise.resolve(NO_DESKTOP_UPDATES),
      openRelease: () => {},
    }
  }
  return {
    status: async () => bridge.accountStatus?.() ?? DISCONNECTED,
    signIn: async () => bridge.accountSignIn?.() ?? DISCONNECTED,
    signOut: async () => bridge.accountSignOut?.() ?? DISCONNECTED,
    checkUpdates: async () => bridge.checkForUpdates?.() ?? NO_DESKTOP_UPDATES,
    openRelease: (url) => { bridge.openRelease?.(url) },
  }
}

/**
 * Contribute the Account page to Settings.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-account: dictionaries')
  const t = ctx.locale.bind(NS)
  const injected = (): AccountSectionInjected => faceFromBridge(desktopBridge())

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'account',
    order: 8,
    label: () => t('nav'),
    locale: NS,
    inject: injected,
  }, AccountSection))
}
