/** Host loader entry for the browser implementation exported from `./client`. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-settings'

/** Durable settings namespace for product-wide GUI onboarding facts. */
const ONBOARDING_SETTINGS_NAMESPACE = 'ui-onboarding'

interface OnboardingSettings {
  /** Last version acknowledged by the current product welcome step. */
  welcomeNoticeVersion?: string
}

const OnboardingSettingsSchema: z<OnboardingSettings> = z.object({
  welcomeNoticeVersion: z.string(),
})

/**
 * Durable settings namespace for the First Light setup sequence. The literal is
 * restated rather than imported because the Host face cannot reach a Client
 * source file (client sources sit outside this program), exactly as the sealed
 * shape is restated by the seal test in
 * `packages/api/settings-controller/tests/first-light-seal.host.spec.ts`.
 *
 * Registration is what makes the namespace real to a client: `settings.describe`
 * lists the settings service's registrations, so an unregistered namespace is
 * absent from the describe view and the bound First Light scope derives its
 * terminal `unavailable` state -- which the setup dialog renders as its
 * "needs the settings document" error branch, with Retry unable to recover.
 */
const FIRST_LIGHT_SETTINGS_NAMESPACE = 'ui-first-light'

interface FirstLightSettings {
  /** Sealed sequence version, compared for exact equality. */
  complete?: string
  /** The local profile the You step collects. */
  profile?: { name?: string; building?: string; language?: string }
  /** The voice preferences the Voice step collects. */
  voice?: { tone?: string }
}

const FirstLightSettingsSchema: z<FirstLightSettings> = z.object({
  complete: z.string(),
  profile: z.object({
    name: z.string(),
    building: z.string(),
    language: z.string(),
  }),
  voice: z.object({ tone: z.string() }),
})

/** Register the durable GUI-onboarding sections when a settings provider exists. */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(
      ONBOARDING_SETTINGS_NAMESPACE,
      OnboardingSettingsSchema,
    )
    settingsCtx.settings.register(
      FIRST_LIGHT_SETTINGS_NAMESPACE,
      FirstLightSettingsSchema,
    )
  })
}
