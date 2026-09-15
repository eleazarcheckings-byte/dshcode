/** Models settings and setup with its feature-owned generated Design brain Remote. */
import type { Context } from '@deepseek-ai/cordis'
import designBrainRemote from '@saturnai/dsh-design-brain/remote'
import { apply as registerUi, inject as uiInject } from './registration.ts'
export type { ModelsSectionInjected, ModelsSectionProps, ModelsFooterOwnerProps, ProviderCardExtrasOwnerProps, ModelsKey, ModelsSettingsState, ProviderDirectoryEntry, ProviderRow, ModelDiscoveryOutcome, ModelsOperations, SettingsWriteOutcome } from './registration.ts'
/** Required infrastructure before mounting the optional connection's wire namespace. */
export const inject = ['remote']
/** Mount the generated connection API before the dependent UI, releasing them in reverse order. */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(designBrainRemote)
  const ui = ctx.inject(uiInject, registerUi)
  try { await ui } catch (error) { await ui.dispose(); await disposeRemote(); throw error }
  return async () => { await ui.dispose(); await disposeRemote() }
}
