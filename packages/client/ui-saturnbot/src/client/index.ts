/** Browser entry for the separate-window SaturnBot manager. */
import type { Context } from '@deepseek-ai/cordis'
import saturnbotRemote from '@saturnai/dsh-saturnbot/remote'
import { mountSaturnBotUi } from './mount.ts'

export { inject } from './mount.ts'
export type { SaturnBotInjected, SaturnBotViewState } from './contracts.ts'

/** Register the generated Remote namespace and its management UI. */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  return await mountSaturnBotUi(ctx, saturnbotRemote)
}
