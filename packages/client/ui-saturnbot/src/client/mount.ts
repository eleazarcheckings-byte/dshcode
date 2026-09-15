/** Source-safe SaturnBot browser registration and generated Remote lifecycle. */
import type { Context } from '@deepseek-ai/cordis'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the `ctx.uiWorkspace` service merge (host-native directory picker).
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@saturnai/dsh-saturnbot/remote'
import { SaturnBotController } from './controller.ts'
import { SaturnBotEntry } from './Entry.tsx'
import type { SaturnBotInjected } from './contracts.ts'
import { en, NS, zh, type SaturnBotKey } from './locales.ts'
import { createSaturnBotWindowLauncher } from './window-launcher.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Separate-window SaturnBot management and agent conversation copy. */
    saturnbot: SaturnBotKey
  }
}

/** Required services before mounting the generated Remote contribution. */
export const inject = ['remote', 'slots', 'locale', 'uiWorkspace']

function registerUi(ctx: Context): void {
  const standalone = new URLSearchParams(window.location.search).get('saturnbot') === '1'
  const controller = new SaturnBotController(ctx.remote.saturnbot)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-saturnbot: dictionaries')
  if (standalone) ctx.effect(() => controller.start(), 'ui-saturnbot: visible dashboard data')
  const injected: SaturnBotInjected = {
    hooks: { bot: controller.state }, standalone,
    refresh: controller.refresh, configure: controller.configure, runNow: controller.runNow,
    pause: controller.pause, cancel: controller.cancel, approve: controller.approve,
    message: controller.message, loadMoreEvents: controller.loadMoreEvents, loadRecords: controller.loadRecords,
    openWindow: createSaturnBotWindowLauncher(),
    pickDirectory: () => ctx.uiWorkspace.pickDirectory(),
  }
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'saturnbot', order: 90, locale: NS, inject: () => injected }, SaturnBotEntry))
}

/**
 * Mount the generated Remote and dispose registrations before releasing its namespace.
 * @param ctx - Client plugin context with Remote, locale, and slot services.
 * @param contribution - Generated SaturnBot Host Remote contribution.
 * @returns Disposer for the UI registrations and mounted Remote contribution.
 */
export async function mountSaturnBotUi(ctx: Context, contribution: TypertRemoteContribution): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(contribution)
  const ui = ctx.inject(['remote.saturnbot', 'slots', 'locale', 'uiWorkspace'], registerUi)
  try { await ui } catch (error) { await ui.dispose(); await disposeRemote(); throw error }
  return async () => { await ui.dispose(); await disposeRemote() }
}
