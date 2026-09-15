/** Trusted built-in tools; the engine owns role, approval, validation, and retry admission. */
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type { BotTool } from './contracts.ts'
import { createLocalTools } from './adapters/local.ts'
import { createMemoryTools } from './adapters/memory.ts'
import { createIntegrationTools } from './adapters/integrations.ts'

/** Host capabilities shared by the built-in adapters; external calls are injectable for tests. */
export interface BotToolOptions {
  dataDirectory: string
  subprocess: SubprocessRuntime
  fetch?: typeof globalThis.fetch
  environment?: Readonly<NodeJS.ProcessEnv>
}

/** Build independent definitions without registering effects or reading credentials at startup.
 * @param options - Host-managed data directory, process service, and external-call dependencies.
 * @returns tools whose declared effects and role ceilings are enforced by the central engine.
 */
export function createBotTools(options: BotToolOptions): BotTool[] {
  return [...createLocalTools(options), ...createMemoryTools(options), ...createIntegrationTools(options)]
}
