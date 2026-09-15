/** Browser entry: mount the generated remote-access namespace, then the page. */
import type { Context } from '@deepseek-ai/cordis'
import remoteAccessRemote from '@saturnai/dsh-remote-access/remote'
import { apply as registerPage, inject as pageInject } from './registration.ts'

export type { RemoteSectionInjected, RemoteSectionProps } from './RemoteSection.tsx'
export type { RemoteStatusView, RemotePairingPayload, RemoteMode } from './contracts.ts'

/** Required infrastructure before the wire namespace can be mounted. */
export const inject = ['remote']

/**
 * Mount the Host connection API, then the page that consumes it.
 * @param ctx - the browser plugin context.
 * @returns the disposer releasing the page before the namespace.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  // The Remote contribution is emitted by the Typert generator during the
  // build, so this specifier only resolves in a built workspace; before then
  // its type is an error type the checker cannot narrow.
  // oxlint-disable-next-line typescript/no-unsafe-argument -- generated artifact, typed after the build emits it.
  const disposeRemote = await ctx.remote.$mount(remoteAccessRemote)
  const page = ctx.inject(pageInject, registerPage)
  try {
    await page
  } catch (error) {
    await page.dispose()
    await disposeRemote()
    throw error
  }
  return async () => { await page.dispose(); await disposeRemote() }
}
