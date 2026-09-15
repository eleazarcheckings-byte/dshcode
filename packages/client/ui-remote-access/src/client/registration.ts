/** Remote settings page: dictionary registration and the Settings slot seat. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { RemoteSection, type RemoteSectionInjected } from './RemoteSection.tsx'
import { en, zh, type RemoteKey } from './locales.ts'
import {
  unwrap,
  type Answered,
  type RemoteMode,
  type RemotePairingPayload,
  type RemoteStatusView,
} from './contracts.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Copy for the Remote settings page. */
    'settings.remote': RemoteKey
  }
}

const NS = 'settings.remote'

/** Services required by the page registration and the Host calls behind it. */
export const inject = ['slots', 'locale', 'remoteAccess']

/** The generated Remote's shape, as this page calls it. */
interface RemoteAccessRemote {
  status: () => Promise<Answered<RemoteStatusView>>
  enable: (mode: RemoteMode) => Promise<Answered<RemoteStatusView>>
  disable: () => Promise<Answered<RemoteStatusView>>
  pairingCode: () => Promise<Answered<RemotePairingPayload>>
  revokeDevice?: (deviceId: string) => Promise<Answered<RemoteStatusView>>
  revoke?: (deviceId: string) => Promise<Answered<RemoteStatusView>>
}

/**
 * Contribute the Remote page to Settings.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-remote-access: dictionaries')
  const host = ctx.get('remoteAccess') as unknown as RemoteAccessRemote
  const t = ctx.locale.bind(NS)

  // The wire face is bound once, not per render: the page's effect depends on
  // the identity of `status`, so a fresh closure each render would re-read the
  // Host on every state change.
  const injected = (): RemoteSectionInjected => ({
    status: async () => unwrap(await host.status()),
    enable: async mode => unwrap(await host.enable(mode)),
    disable: async () => unwrap(await host.disable()),
    pairingCode: async () => unwrap(await host.pairingCode()),
    revoke: async (deviceId) => {
      const call = host.revokeDevice ?? host.revoke
      if (call === undefined) throw new Error('remote-access: the host exposes no revoke operation')
      return unwrap(await call.call(host, deviceId))
    },
  })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'remote',
    order: 45,
    label: () => t('nav'),
    locale: NS,
    inject: injected,
  }, RemoteSection))
}
