/**
 * Packaged output-design guidance shared by base-backed Saturn AI profiles.
 * @module @saturnai/dsh-skill-premium-output
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { BUNDLED_SKILL_RANK, type SkillCandidate, type SkillProvider } from '@deepseek-ai/dsh-skill'
import { PREMIUM_OUTPUT_POLICY } from './policy.ts'

/** Cordis plugin name. */
export const name = 'skill-premium-output'
/** Registries required for effect-owned guidance and skill contributions. */
export const inject = ['skills', 'systemPrompt']

/** Deployment overrides for packaged output guidance. */
export interface Config {
  /** Mount the policy and bundled guides; default true. */
  enabled?: boolean
  /** Replace the default policy; user and project task requirements still take precedence. */
  policy?: string
}

/** Validate deployment settings before plugin activation. */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  policy: z.string().min(1).default(PREMIUM_OUTPUT_POLICY),
})

const PROVIDER_NAME = 'premium-output'
const GUIDES = [
  {
    name: 'premium-web-experience',
    description: 'Build or refine a website, application, landing page, dashboard, or interactive artifact with a coherent visual direction, useful interactions, responsive layouts, and browser verification.',
  },
  {
    name: 'purposeful-motion',
    description: 'Create or refine canvas, SVG, CSS, or WebGL animation, ambient visuals, transitions, and interactive effects with purposeful motion, accessible fallbacks, and measured rendering costs.',
  },
  {
    name: 'premium-deliverables',
    description: 'Create polished documents, reports, presentations, spreadsheets, and other finished artifacts with an audience-specific structure, accurate content, rendered inspection, and honest verification.',
  },
] as const

const CANDIDATES: readonly SkillCandidate[] = GUIDES.map(guide => ({
  ...guide,
  invocation: { modelInvocable: true, userInvocable: true },
  provider: PROVIDER_NAME,
  source: 'bundled',
  resourceBase: {
    kind: 'directory',
    path: fileURLToPath(new URL(`../skills/${guide.name}/`, import.meta.url)),
  },
  rank: BUNDLED_SKILL_RANK,
  locator: new URL(`../skills/${guide.name}/SKILL.md`, import.meta.url),
}))

const provider: SkillProvider = {
  name: PROVIDER_NAME,
  list: () => Promise.resolve(CANDIDATES),
  async get(candidate, options) {
    const { rank: _rank, locator, ...summary } = candidate
    // Locators are created by this provider and passed back by the registry.
    const content = await readFile(locator as URL, { encoding: 'utf8', signal: options.signal })
    return { ...summary, content }
  },
}

/**
 * Register the base policy and task-specific guides; complete personas remain authoritative.
 * @param ctx - host or preset context supplying the existing registries.
 * @param config - validated deployment overrides.
 */
export function apply(ctx: Context, config: Config = {}): void {
  if (!(config.enabled ?? true)) return
  const policy = config.policy ?? PREMIUM_OUTPUT_POLICY
  ctx.skills.registerProvider(() => provider)
  ctx.systemPrompt.section({
    name: 'saturn:output-quality',
    order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA') + 100,
    text: ({ agent }) => {
      const skillAvailable = agent !== undefined && ctx.get('tools')?.get('skill', agent) !== undefined
      return skillAvailable
        ? `${policy}\n\nFor matching work, load the relevant available skill before implementation: premium-web-experience for websites and interfaces, purposeful-motion for animation, and premium-deliverables for other finished artifacts. Follow the loaded skill and the user's requirements. If a skill is unavailable, continue with the tools and guidance actually available.`
        : policy
    },
  })
}
