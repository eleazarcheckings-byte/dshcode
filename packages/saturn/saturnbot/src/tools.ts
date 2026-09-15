/** Trusted built-in tools; the engine owns role, approval, validation, and retry admission. */
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type { BotTool } from './contracts.ts'
import { createLocalTools } from './adapters/local.ts'
import { createMemoryTools } from './adapters/memory.ts'
import { createIntegrationTools } from './adapters/integrations.ts'

/**
 * Minimal duck-typed service lookup, satisfied by a cordis `Context` without
 * importing it here: `creative.generate` calls `services.get('media')` to
 * find a connected media provider (the C7 `tool-media` contract) before
 * falling back to the generic webhook contract. Absent when no host context
 * is available (for example, in isolated adapter tests).
 */
export interface BotServiceLookup { get(name: string): unknown }

/** Host capabilities shared by the built-in adapters; external calls are injectable for tests. */
export interface BotToolOptions {
  dataDirectory: string
  subprocess: SubprocessRuntime
  fetch?: typeof globalThis.fetch
  environment?: Readonly<NodeJS.ProcessEnv>
  services?: BotServiceLookup
}

/** Build independent definitions without registering effects or reading credentials at startup.
 * @param options - Host-managed data directory, process service, and external-call dependencies.
 * @returns tools whose declared effects and role ceilings are enforced by the central engine.
 */
export function createBotTools(options: BotToolOptions): BotTool[] {
  return [...createLocalTools(options), ...createMemoryTools(options), ...createIntegrationTools(options)]
}
