/** Strict configuration, model-output, and journal parsers for SaturnBot. */
import { isAbsolute } from 'node:path'
import { parseDocument } from 'yaml'
import { z } from 'zod'
import type { BotConfig, BotEvent, BotId, BotJson } from './types.ts'

/** All supported runtime roles. */
export const BOT_ROLES = ['orchestrator', 'developer', 'growth', 'operations', 'finance'] as const
const id = z.string().min(1).max(200).transform(value => value as BotId)
const text = z.string().max(16_384)
const tools = z.array(z.string().min(1).max(100)).max(100)
const roleConfig = z.object({ enabled: z.boolean().default(true), instructions: z.string().max(8000).default(''), tools: tools.default([]) }).strict()
/** Configuration values contain environment references, never secret literals. */
export const botConfigSchema = z.object({
  version: z.literal(1).default(1), enabled: z.boolean().default(false),
  goal: z.string().max(8000).default(''), workspace: z.string().max(4096).default(''),
  intervalMinutes: z.number().int().min(1).max(1440).default(30),
  provider: z.string().max(100).default('deepseek-official'), model: z.string().max(200).default('deepseek-v4-flash'),
  maxTasks: z.number().int().min(1).max(3).default(3), maxActionsPerTask: z.number().int().min(1).max(20).default(8),
  toolTimeoutMs: z.number().int().min(100).max(600_000).default(120_000),
  modelTimeoutMs: z.number().int().min(100).max(600_000).default(120_000),
  maxInputBytes: z.number().int().min(4096).max(1_048_576).default(131_072),
  maxOutputTokens: z.number().int().min(256).max(32_768).default(4096),
  requirePrApproval: z.boolean().default(true), autoDispatchEmail: z.boolean().default(false),
  requireDeployApproval: z.boolean().default(true), requireWriteApproval: z.boolean().default(true),
  allowedTools: tools.default([]),
  roles: z.object({
    orchestrator: roleConfig.prefault({}), developer: roleConfig.prefault({}), growth: roleConfig.prefault({}),
    operations: roleConfig.prefault({}), finance: roleConfig.prefault({}),
  }).strict().prefault({}),
  validationCommands: z.array(z.array(z.string().min(1).max(4000)).min(1).max(100)).max(20).default([]),
  integrations: z.record(z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/), z.object({
    endpoint: z.url().refine((value) => {
      const url = new URL(value)
      return ['https:', 'http:'].includes(url.protocol) && url.username === '' && url.password === '' && url.search === ''
    }, 'Endpoints cannot contain credentials or query strings').optional(),
    endpointEnv: z.string().regex(/^[A-Z_][A-Z0-9_]*$/).optional(),
    credentialEnv: z.string().regex(/^[A-Z_][A-Z0-9_]*$/).optional(), resource: z.string().max(2000).optional(),
  }).strict()).default({}),
  reportChannel: z.string().max(200).default('inbox'),
}).strict().superRefine((config, ctx) => {
  if (config.workspace !== '' && !isAbsolute(config.workspace)) ctx.addIssue({ code: 'custom', path: ['workspace'], message: 'Workspace must be an absolute path' })
  if (config.enabled && (config.goal.trim() === '' || config.workspace.trim() === '')) ctx.addIssue({ code: 'custom', message: 'Set a goal and workspace before enabling the daemon' })
  // A vercel/cloudflare-pages deploy-hook URL is itself the secret (the platform
  // authenticates the request by the URL alone); it must never be stored as a
  // literal config value, since configuration is durably journaled verbatim.
  for (const name of ['vercel', 'cloudflare-pages']) {
    if (config.integrations[name]?.endpoint !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['integrations', name, 'endpoint'], message: `${name}'s deploy hook URL is itself a secret; configure endpointEnv (an environment variable name) instead of a literal endpoint` })
    }
  }
})

/** Parse configuration at a JSON or wire boundary.
 * @param value Untrusted configuration document.
 * @returns Validated configuration with all defaults resolved.
 */
export function parseBotConfig(value: unknown): BotConfig {
  const config = botConfigSchema.parse(value) as BotConfig
  if (Buffer.byteLength(JSON.stringify(config)) > 128_000) throw new Error('SaturnBot configuration exceeds 128 KB')
  return config
}
/** Read versioned YAML without custom tags or alias expansion.
 * @param source UTF-8 configuration text containing version: 1.
 * @returns Validated configuration with all defaults resolved.
 */
export function parseBotYaml(source: string): BotConfig {
  if (Buffer.byteLength(source) > 128_000) throw new Error('SaturnBot YAML exceeds 128 KB')
  const document = parseDocument(source, { uniqueKeys: true, customTags: [] })
  if (document.errors.length > 0 || document.warnings.length > 0) throw new Error([...document.errors, ...document.warnings].map(error => error.message).join('; '))
  const value: unknown = document.toJS({ maxAliasCount: 0 })
  if (typeof value !== 'object' || value === null || !('version' in value)) throw new Error('SaturnBot YAML requires version: 1')
  return parseBotConfig(value)
}
/** Versioned YAML parser alias for host configuration loading. */
export const parseBotConfigYaml = parseBotYaml

/** JSON model/tool data with a serialized size bound applied by the engine. */
export const botJsonSchema: z.ZodType<BotJson> = z.json()
const input = z.record(z.string(), botJsonSchema)
const stage = z.object({ path: z.string().min(1).max(4096), revision: z.string().min(1).max(200) }).strict()
/** Runtime-generated task identity is omitted from the model's plan. */
export const botPlanSchema = z.object({ summary: text, tasks: z.array(z.object({ role: z.enum(['developer', 'growth', 'operations', 'finance']), title: z.string().min(1).max(300), instruction: z.string().min(1).max(8000) }).strict()).max(3) }).strict()
/** Model action requests cannot override role, approval, retry, or timeout policy. */
export const agentProposalSchema = z.object({
  summary: text, actions: z.array(z.object({ tool: z.string().min(1).max(100), input }).strict()).max(20),
  continue: z.boolean().optional(),
}).strict()
/** Adapter results cannot inject new runtime policy. */
export const botToolResultSchema = z.object({
  summary: text, data: botJsonSchema.optional(), stage: stage.optional(), validatedRevision: z.string().min(1).max(200).optional(),
}).strict()
const task = z.object({ id, role: z.enum(['developer', 'growth', 'operations', 'finance']), title: z.string().min(1).max(300), instruction: z.string().max(8000) }).strict()
const branch = z.object({ id, task, status: z.enum(['planning', 'running', 'awaiting-approval', 'completed', 'failed', 'interrupted']), summary: text, actions: agentProposalSchema.shape.actions, nextAction: z.number().int().min(0), continue: z.boolean(), rounds: z.number().int().min(0).max(21), stage: stage.nullable(), validatedRevision: z.string().nullable(), error: text.nullable() }).strict()
const cycle = z.object({ id, startedAt: z.string(), finishedAt: z.string().nullable(), status: z.enum(['running', 'awaiting-approval', 'completed', 'failed', 'interrupted']), plan: text, branches: z.array(branch).max(3) }).strict()
const approval = z.object({ id, cycleId: id, branchId: id, actionIndex: z.number().int().min(0), tool: z.string(), input, stage: stage.nullable(), status: z.enum(['pending', 'approved', 'rejected', 'consumed', 'interrupted']), createdAt: z.string(), decidedAt: z.string().nullable() }).strict()
const trace = z.object({ cycleId: id, branchId: id.nullable(), kind: z.enum(['plan', 'proposal', 'tool-start', 'tool-result', 'tool-error', 'decision']), tool: z.string().optional(), attempt: z.number().int().optional(), summary: text, data: botJsonSchema.optional() }).strict()
const alert = z.object({ id, cycleId: id.nullable(), branchId: id.nullable(), message: text, createdAt: z.string() }).strict()
const report = z.object({
  id, cycleId: id, date: z.string(), title: z.string(), markdown: z.string().max(64_000), channel: z.string(),
}).strict()
const message = z.object({ id, role: z.enum(BOT_ROLES), sender: z.enum(['user', 'agent', 'system']), content: z.string().min(1).max(16_384), at: z.string(), cycleId: id.nullable() }).strict()
const envelope = { version: z.literal(1), seq: z.number().int().positive(), at: z.string() }
const eventSchema = z.discriminatedUnion('type', [
  z.object({ ...envelope, type: z.literal('configured'), config: botConfigSchema }).strict(),
  z.object({ ...envelope, type: z.literal('cycle'), cycle }).strict(),
  z.object({ ...envelope, type: z.literal('approval'), approval }).strict(),
  z.object({ ...envelope, type: z.literal('trace'), trace }).strict(),
  z.object({ ...envelope, type: z.literal('alert'), alert }).strict(),
  z.object({ ...envelope, type: z.literal('report'), report }).strict(),
  z.object({ ...envelope, type: z.literal('message'), message }).strict(),
])
/** Validate one persisted event before reconstructing execution state.
 * @param value Parsed but untrusted JSONL record.
 * @returns The versioned execution event.
 */
export function parseBotEvent(value: unknown): BotEvent { return eventSchema.parse(value) as BotEvent }
