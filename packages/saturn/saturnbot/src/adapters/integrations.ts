/** Configured GitHub, Graph, Stripe, Telegram, Shopify, deploy-hook, and explicit provider-webhook integrations. */
import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { BotMediaService, BotTool, BotToolContext } from '../contracts.ts'
import type { BotConfig } from '../types.ts'
import type { BotToolOptions } from '../tools.ts'
import { git, verifyStage } from './local.ts'
import { ActionRequiredError, boundedRows, deployHook, integration, json, redactedJson, request, tool } from './shared.ts'

const endpoints: Record<string, string> = {
  github: 'https://api.github.com', email: 'https://graph.microsoft.com/v1.0', stripe: 'https://api.stripe.com/v1',
  telegram: 'https://api.telegram.org',
}
/** Integrations whose deploy-hook URL is itself the secret; no credential is required. */
const CREDENTIAL_OPTIONAL = new Set(['vercel', 'cloudflare-pages'])
const link = z.url().max(8192).refine((value) => { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password }, 'HTTPS URL without embedded credentials required')
const requestId = z.string().min(1).max(200)
const revision = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u)
const currency = z.string().regex(/^[a-z]{3}$/u)
const repositoryResource = /^[A-Za-z0-9][A-Za-z0-9_-]*\/(?!\.{1,2}$)[A-Za-z0-9_.-]+$/u
/** Exact store domain shape; a mistyped or hostile value would otherwise send the Admin API token to that host. */
const shopifyResource = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/u
/** Currently supported Shopify Admin API version (Shopify supports each release for ~12 months); revisit before 2027-07. */
const SHOPIFY_API_VERSION = '2026-07'
function isHttpsWithoutCredentials(value: string | undefined): boolean {
  if (value === undefined) return false
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.hash } catch { return false }
}
const providerResult = z.object({ id: requestId, status: z.enum(['accepted', 'running', 'completed']), url: link.optional() })
const prResult = z.object({
  number: z.number().int().positive(), html_url: link, head: z.object({ sha: revision }),
  body: z.string().max(65_536).nullable().optional(),
})
const mailboxMessage = z.object({
  id: z.string().max(1024), subject: z.string().max(1024).optional(), bodyPreview: z.string().max(8192).optional(),
  receivedDateTime: z.string().max(100).optional(),
  from: z.object({ emailAddress: z.object({ address: z.string().max(320).optional(), name: z.string().max(500).optional() }) }).optional(),
})
/** Commerce fields only; no customer personal information is retained in model-visible order data. */
const shopifyLineItem = z.object({
  title: z.string().max(500), quantity: z.number().int(), sku: z.string().max(200).nullable().optional(),
})
const shopifyOrder = z.object({
  id: z.number().int(), name: z.string().max(100),
  financial_status: z.string().max(50).nullable().optional(), fulfillment_status: z.string().max(50).nullable().optional(),
  total_price: z.string().max(50).optional(), currency: z.string().max(10).optional(), created_at: z.string().max(100).optional(),
  line_items: z.array(shopifyLineItem).max(100).optional(),
})
const shopifyVariant = z.object({
  id: z.number().int(), sku: z.string().max(200).nullable().optional(),
  price: z.string().max(50).optional(), inventory_quantity: z.number().int().optional(),
})
const shopifyProduct = z.object({
  id: z.number().int(), title: z.string().max(500), status: z.string().max(50).optional(),
  variants: z.array(shopifyVariant).max(200).optional(),
})
const shopifyLevel = z.object({ inventory_item_id: z.number().int(), location_id: z.number().int(), available: z.number().int() })

/** A credential-presence report, not a claim that an external service authenticated successfully. */
export interface BotConnectionStatus { name: string; status: 'configured' | 'unconfigured'; message: string }

/** Inspect configuration and environment references without making a network call.
 * @param config - Validated SaturnBot configuration.
 * @param environment - Host environment snapshot; values are never returned.
 * @returns an honest configured/unconfigured status for every supported integration.
 */
export function describeBotConnections(config: BotConfig, environment: Readonly<NodeJS.ProcessEnv> = process.env): BotConnectionStatus[] {
  return ['github', 'email', 'stripe', 'cloud', 'social', 'creative', 'webhook', 'telegram', 'shopify', 'vercel', 'cloudflare-pages'].map((name) => {
    const entry = config.integrations[name]
    const credentialOptional = CREDENTIAL_OPTIONAL.has(name)
    let message = 'Configuration is present. Authentication has not been tested.'
    if (entry === undefined) message = 'Integration is not configured.'
    else if (!credentialOptional && (!entry.credentialEnv || !environment[entry.credentialEnv])) message = 'Configured credential environment variable is missing.'
    else if (credentialOptional && entry.credentialEnv !== undefined && !environment[entry.credentialEnv]) message = 'Configured credential environment variable is missing.'
    else if (CREDENTIAL_OPTIONAL.has(name) && (entry.endpointEnv === undefined || !environment[entry.endpointEnv])) message = 'Set the environment variable configured for the deploy hook URL.'
    else if (CREDENTIAL_OPTIONAL.has(name) && entry.endpointEnv !== undefined && !isHttpsWithoutCredentials(environment[entry.endpointEnv])) message = 'The deploy hook URL environment variable does not hold a valid HTTPS URL without embedded credentials.'
    else if (!CREDENTIAL_OPTIONAL.has(name) && !endpoints[name] && name !== 'webhook' && !entry.endpoint) message = 'An HTTPS provider endpoint is required.'
    else if ((name === 'github' || name === 'email' || name === 'shopify') && !entry.resource) message = 'Configure the repository, mailbox, or store resource.'
    else if (name === 'github' && (entry.resource === undefined || !repositoryResource.test(entry.resource))) message = 'Configure a GitHub repository as owner/repository.'
    else if (name === 'shopify' && (entry.resource === undefined || !shopifyResource.test(entry.resource))) message = 'Configure a Shopify store domain as your-store.myshopify.com.'
    else if (entry.endpoint) {
      try {
        const url = new URL(entry.endpoint)
        if (url.protocol !== 'https:' || url.username || url.password || (!credentialOptional && url.search) || url.hash) message = 'An HTTPS endpoint without embedded credentials is required.'
      } catch { message = 'Provider endpoint is invalid.' }
    }
    return { name, status: message.startsWith('Configuration is present') ? 'configured' as const : 'unconfigured' as const, message }
  })
}

function headers(token: string): Record<string, string> { return { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' } }
function branch(context: BotToolContext): string { return `saturnbot/${createHash('sha256').update(`${context.cycleId}:${context.branchId}`).digest('hex').slice(0, 24)}` }
function github(options: BotToolOptions, config: BotConfig) {
  const connected = integration(options, config, 'github', endpoints.github)
  if (!connected.resource || !repositoryResource.test(connected.resource)) throw new ActionRequiredError('Configure a GitHub repository as owner/repository.')
  return { ...connected, resource: connected.resource, headers: { ...headers(connected.token), Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10' } }
}
function email(options: BotToolOptions, config: BotConfig) {
  const connected = integration(options, config, 'email', endpoints.email)
  if (!connected.resource) throw new ActionRequiredError('Configure the Microsoft Graph mailbox user ID or email address.')
  return { ...connected, mailbox: `${connected.endpoint}/users/${encodeURIComponent(connected.resource)}` }
}
/** Shopify uses `X-Shopify-Access-Token`, not a bearer token, and derives its endpoint from the store domain. */
function shopifyHeaders(token: string): Record<string, string> { return { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' } }
function shopify(options: BotToolOptions, config: BotConfig): { endpoint: string; token: string; resource: string } {
  const entry = config.integrations['shopify']
  if (entry === undefined) throw new ActionRequiredError('Connect shopify in SaturnBot settings.')
  if (!entry.resource || !shopifyResource.test(entry.resource)) throw new ActionRequiredError('Configure the Shopify store domain as your-store.myshopify.com.')
  const connected = integration(options, config, 'shopify', `https://${entry.resource}/admin/api/${SHOPIFY_API_VERSION}`)
  return { ...connected, resource: entry.resource }
}

/** Build adapters for actual configured services; unavailable connections fail explicitly.
 * @param options - Fetch, environment, process, and durable-directory capabilities.
 * @returns effect-labelled definitions for central engine admission.
 */
export function createIntegrationTools(options: BotToolOptions): BotTool[] {
  const emailFields = { to: z.array(z.email()).min(1).max(20), subject: z.string().min(1).max(300), body: z.string().min(1).max(16_384) }
  const emailBody = (input: { to: string[]; subject: string; body: string }) => ({ subject: input.subject, body: { contentType: 'Text', content: input.body }, toRecipients: input.to.map(address => ({ emailAddress: { address } })) })
  return [
    tool({ name: 'github.create_pr', description: 'Publish the exact validated task revision and create a draft pull request after central approval.', roles: ['developer'], effect: 'pr', retry: 'never' }, { title: z.string().min(1).max(250), body: z.string().max(16_384), base: z.string().min(1).max(200).optional() }, async (input, context) => {
      const stage = context.stage
      if (stage === null) throw new ActionRequiredError('Create an isolated workspace stage first.')
      const root = await verifyStage(options, context)
      const connected = github(options, context.config)
      const repositoryUrl = `${connected.endpoint}/repos/${connected.resource}`
      const repository = await request(options, context, repositoryUrl, { headers: connected.headers }, z.object({
        default_branch: z.string().min(1),
      }))
      const base = input.base ?? repository.default_branch
      const head = branch(context)
      const marker = `<!-- SaturnBot ${context.idempotencyKey} -->`
      const existing = await request(options, context, `${repositoryUrl}/pulls?${new URLSearchParams({ state: 'open', head: `${connected.resource.split('/')[0]}:${head}`, base })}`, { headers: connected.headers }, z.array(prResult))
      const prior = existing.find(pull => pull.body?.includes(marker) && pull.head.sha === stage.revision)
      if (prior !== undefined) return { summary: 'The exact task pull request already exists.', data: redactedJson({ number: prior.number, url: prior.html_url, revision: prior.head.sha }, options, context) }
      const api = new URL(connected.endpoint)
      const origin = api.hostname === 'api.github.com' ? 'https://github.com' : api.origin
      await verifyStage(options, context)
      await git(options, context, root, ['push', '--', `${origin}/${connected.resource}.git`, `${stage.revision}:refs/heads/${head}`], {
        GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: `http.${origin}/.extraheader`, GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from(`x-access-token:${connected.token}`).toString('base64')}`,
      })
      await verifyStage(options, context)
      const pull = await request(options, context, `${repositoryUrl}/pulls`, { method: 'POST', headers: connected.headers, body: JSON.stringify({ title: input.title, body: `${input.body}\n\n${marker}`, head, base, draft: true }) }, prResult)
      if (pull.head.sha !== stage.revision) throw new Error('GitHub pull request does not reference the approved task revision.')
      return { summary: `Created draft pull request #${pull.number}.`, data: redactedJson({ number: pull.number, url: pull.html_url, revision: pull.head.sha }, options, context) }
    }),
    tool({ name: 'email.inbox', description: 'Read bounded Microsoft Graph mailbox previews.', roles: ['orchestrator', 'operations', 'growth'], effect: 'read', retry: 'safe', evaluationInput: { limit: 10 } }, { limit: z.number().int().min(1).max(50).default(10) }, async ({ limit }, context) => {
      const connected = email(options, context.config)
      const query = new URLSearchParams({ '$top': String(limit), '$select': 'id,subject,bodyPreview,receivedDateTime,from', '$orderby': 'receivedDateTime desc' })
      const response = await request(options, context, `${connected.mailbox}/mailFolders/inbox/messages?${query}`, { headers: headers(connected.token) }, z.object({ value: z.array(mailboxMessage).max(limit), '@odata.nextLink': z.string().optional() }))
      return { summary: `Read ${response.value.length} email previews.`, data: json({ ...boundedRows(response.value.map(message => redactedJson(message, options, context))), hasMore: response['@odata.nextLink'] !== undefined }) }
    }),
    tool({ name: 'email.draft', description: 'Create an unsent Microsoft Graph draft after central role policy admission.', roles: ['operations', 'growth'], effect: 'draft', retry: 'never' }, emailFields, async (input, context) => {
      const connected = email(options, context.config)
      const draft = await request(options, context, `${connected.mailbox}/messages`, { method: 'POST', headers: headers(connected.token), body: JSON.stringify(emailBody(input)) }, z.object({ id: z.string().min(1).max(1024), isDraft: z.literal(true), webLink: link.optional() }))
      return { summary: 'Created an unsent email draft.', data: redactedJson(draft, options, context) }
    }),
    tool({ name: 'email.send', description: 'Submit the exact approved recipients and message to Microsoft Graph; acceptance does not confirm delivery.', roles: ['operations', 'growth'], effect: 'email', retry: 'never' }, emailFields, async (input, context) => {
      const connected = email(options, context.config)
      await request(options, context, `${connected.mailbox}/sendMail`, { method: 'POST', headers: headers(connected.token), body: JSON.stringify({ message: emailBody(input), saveToSentItems: true }) }, z.null(), 202)
      return { summary: 'Microsoft Graph accepted the email submission; delivery is not confirmed.', data: { accepted: true, deliveryConfirmed: false, recipientCount: input.to.length } }
    }),
    tool({ name: 'stripe.metrics', description: 'Read Stripe balances and a bounded balance-transaction page, preserving each currency and minor unit.', roles: ['orchestrator', 'finance'], effect: 'read', retry: 'safe', evaluationInput: { limit: 100 } }, { limit: z.number().int().min(1).max(100).default(100), since: z.number().int().nonnegative().optional() }, async ({ limit, since }, context) => {
      const connected = integration(options, context.config, 'stripe', endpoints.stripe)
      const money = z.object({ amount: z.number().int(), currency })
      const balances = await request(options, context, `${connected.endpoint}/balance`, { headers: headers(connected.token) }, z.object({ available: z.array(money).max(200), pending: z.array(money).max(200) }))
      const query = new URLSearchParams({ limit: String(limit), ...since === undefined ? {} : { 'created[gte]': String(since) } })
      const page = await request(options, context, `${connected.endpoint}/balance_transactions?${query}`, { headers: headers(connected.token) }, z.object({ has_more: z.boolean(), data: z.array(z.object({ id: z.string().max(200), amount: z.number().int(), currency, fee: z.number().int(), net: z.number().int(), type: z.string().max(100), created: z.number().int() })).max(limit) }))
      const totals: Record<string, {
        revenueGrossMinor: number
        refundsMinor: number
        feesMinor: number
        payoutsMinor: number
        otherOutflowMinor: number
        netMovementMinor: number
      }> = {}
      for (const transaction of page.data) {
        const row = totals[transaction.currency] ??= {
          revenueGrossMinor: 0, refundsMinor: 0, feesMinor: 0, payoutsMinor: 0, otherOutflowMinor: 0, netMovementMinor: 0,
        }
        if (['charge', 'payment'].includes(transaction.type)) row.revenueGrossMinor += Math.max(0, transaction.amount)
        else if (['refund', 'payment_refund'].includes(transaction.type)) row.refundsMinor += Math.max(0, -transaction.amount)
        else if (transaction.type === 'payout') row.payoutsMinor += Math.max(0, -transaction.amount)
        else row.otherOutflowMinor += Math.max(0, -transaction.amount)
        row.feesMinor += transaction.fee
        row.netMovementMinor += transaction.net
        if (Object.values(row).some(value => !Number.isSafeInteger(value))) throw new Error('Stripe aggregation exceeded safe integer precision.')
      }
      return { summary: `Read balances and ${page.data.length} transactions; totals cover this page only.`, data: json({ balances, totalsByCurrency: totals, transactionCount: page.data.length, hasMore: page.has_more, units: 'minor', scope: 'returned transaction page' }) }
    }),
    tool({ name: 'cloud.deploy', description: 'Submit an approved, validated, GitHub-published revision to a first-class Vercel/Cloudflare Pages deploy hook, or the configured generic deployment webhook.', roles: ['developer'], effect: 'deploy', retry: 'never' }, { environment: z.string().min(1).max(100), target: z.enum(['vercel', 'cloudflare-pages', 'webhook']).default('webhook') }, async (input, context) => {
      const stage = context.stage
      if (stage === null) throw new ActionRequiredError('Create an isolated workspace stage first.')
      await verifyStage(options, context)
      const repository = github(options, context.config)
      const remote = await request(options, context, `${repository.endpoint}/repos/${repository.resource}/git/commits/${encodeURIComponent(stage.revision)}`, { headers: repository.headers }, z.object({ sha: revision }))
      if (remote.sha !== stage.revision) throw new Error('The exact approved revision is not published to GitHub.')
      await verifyStage(options, context)
      if (input.target === 'webhook') {
        const connected = integration(options, context.config, 'cloud')
        const result = await request(options, context, connected.endpoint, { method: 'POST', headers: { ...headers(connected.token), 'Idempotency-Key': context.idempotencyKey }, body: JSON.stringify({ resource: connected.resource, repository: repository.resource, revision: stage.revision, environment: input.environment, requestId: context.idempotencyKey }) }, providerResult)
        return { summary: `Deployment provider reports ${result.status}.`, data: redactedJson(result, options, context) }
      }
      const hook = deployHook(options, context.config, input.target)
      const raw = await request(options, context, hook.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': context.idempotencyKey, ...hook.token === undefined ? {} : headers(hook.token) },
        body: JSON.stringify({ ref: stage.revision, environment: input.environment, requestId: context.idempotencyKey }),
      }, z.unknown())
      return { summary: `${input.target} deploy hook accepted revision ${stage.revision.slice(0, 12)}.`, data: redactedJson({ target: input.target, revision: stage.revision, response: json(raw ?? {}) }, options, context) }
    }),
    tool({ name: 'social.publish', description: 'Publish exact approved text through the configured social-provider endpoint.', roles: ['growth'], effect: 'social', retry: 'never' }, { channel: z.string().min(1).max(100), text: z.string().min(1).max(10_000) }, async (input, context) => {
      const connected = integration(options, context.config, 'social')
      const result = await request(options, context, connected.endpoint, { method: 'POST', headers: { ...headers(connected.token), 'Idempotency-Key': context.idempotencyKey }, body: JSON.stringify({ ...input, resource: connected.resource, requestId: context.idempotencyKey }) }, providerResult)
      return { summary: `Social provider reports ${result.status}.`, data: redactedJson(result, options, context) }
    }),
    tool({ name: 'creative.generate', description: 'Request a creative asset from the connected media provider when present, otherwise the configured generic generation webhook; return its actual status and asset links.', roles: ['growth'], effect: 'social', retry: 'never' }, { kind: z.enum(['image', 'video', 'audio']), prompt: z.string().min(1).max(8000) }, async (input, context) => {
      const media = options.services?.get('media') as BotMediaService | undefined
      if (media !== undefined) {
        const job = await media.generate({ kind: input.kind, prompt: input.prompt, workspace: context.config.workspace })
        return { summary: `Media provider reports ${job.status}.`, data: redactedJson({ id: job.id, status: job.status, assets: job.assets, cost: job.cost }, options, context) }
      }
      const connected = integration(options, context.config, 'creative')
      const result = await request(options, context, connected.endpoint, { method: 'POST', headers: { ...headers(connected.token), 'Idempotency-Key': context.idempotencyKey }, body: JSON.stringify({ ...input, resource: connected.resource, requestId: context.idempotencyKey }) }, providerResult.extend({ assets: z.array(z.object({ url: link, mimeType: z.string().min(1).max(128) })).max(20).default([]) }))
      const assets = boundedRows(result.assets.map(asset => redactedJson(asset, options, context)))
      return { summary: `Creative provider reports ${result.status}.`, data: redactedJson({ ...result, assets: assets.items, omittedAssets: assets.omitted }, options, context) }
    }),
    tool({ name: 'telegram.send', description: 'Send an approved message through the configured Telegram bot to its default or an explicit chat.', roles: ['growth', 'operations'], effect: 'social', retry: 'never' }, { chatId: z.string().min(1).max(64).optional(), text: z.string().min(1).max(4096) }, async (input, context) => {
      const connected = integration(options, context.config, 'telegram', endpoints.telegram)
      const chatId = input.chatId ?? connected.resource
      if (chatId === undefined) throw new ActionRequiredError('Configure a default Telegram chat id or supply one.')
      const result = await request(options, context, `${connected.endpoint}/bot${connected.token}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text: input.text }),
      }, z.object({ ok: z.literal(true), result: z.object({ message_id: z.number().int() }) }))
      return { summary: `Sent Telegram message ${result.result.message_id}.`, data: { messageId: result.result.message_id, chatId } }
    }),
    tool({ name: 'shopify.orders_list', description: 'Read a bounded page of Shopify orders without customer personal information.', roles: ['orchestrator', 'operations', 'finance'], effect: 'read', retry: 'safe', evaluationInput: { limit: 20, status: 'open' } }, { limit: z.number().int().min(1).max(100).default(20), status: z.enum(['open', 'closed', 'cancelled', 'any']).default('open') }, async ({ limit, status }, context) => {
      const connected = shopify(options, context.config)
      const query = new URLSearchParams({ limit: String(limit), status })
      const response = await request(options, context, `${connected.endpoint}/orders.json?${query}`, { headers: shopifyHeaders(connected.token) }, z.object({ orders: z.array(shopifyOrder).max(limit) }))
      const rows = boundedRows(response.orders.map(order => redactedJson(order, options, context)))
      return { summary: `Read ${rows.items.length} Shopify orders.`, data: json({ ...rows }) }
    }),
    tool({ name: 'shopify.products_list', description: 'Read a bounded page of Shopify products and their variant inventory.', roles: ['orchestrator', 'operations'], effect: 'read', retry: 'safe' }, { limit: z.number().int().min(1).max(100).default(20) }, async ({ limit }, context) => {
      const connected = shopify(options, context.config)
      const query = new URLSearchParams({ limit: String(limit) })
      const response = await request(options, context, `${connected.endpoint}/products.json?${query}`, { headers: shopifyHeaders(connected.token) }, z.object({ products: z.array(shopifyProduct).max(limit) }))
      const rows = boundedRows(response.products.map(product => redactedJson(product, options, context)))
      return { summary: `Read ${rows.items.length} Shopify products.`, data: json({ ...rows }) }
    }),
    tool({ name: 'shopify.inventory_update', description: 'Set the available inventory quantity for one inventory item at one location after central approval.', roles: ['operations'], effect: 'social', retry: 'never' }, { inventoryItemId: z.number().int().positive(), locationId: z.number().int().positive(), available: z.number().int().min(0).max(1_000_000) }, async (input, context) => {
      const connected = shopify(options, context.config)
      const result = await request(options, context, `${connected.endpoint}/inventory_levels/set.json`, {
        method: 'POST', headers: shopifyHeaders(connected.token),
        body: JSON.stringify({ inventory_item_id: input.inventoryItemId, location_id: input.locationId, available: input.available }),
      }, z.object({ inventory_level: shopifyLevel }))
      const message = `Set Shopify inventory item ${input.inventoryItemId} to ${result.inventory_level.available} at location ${input.locationId}.`
      return { summary: message, data: redactedJson(result.inventory_level, options, context) }
    }),
  ]
}

/** One `reportChannel` delivery; settlement invokes it directly, outside model-facing role/approval admission. */
export type BotReportDelivery = (config: BotConfig, report: { title: string; markdown: string }) => Promise<void>

/** Build the non-inbox report-channel deliveries this runtime supports.
 * @param options - Fetch and environment dependencies shared with the adapters above.
 * @returns a channel-name-keyed map consumed by the engine's cycle settlement.
 */
export function createReportDeliveries(options: BotToolOptions): Record<string, BotReportDelivery> {
  return {
    telegram: async (config, report) => {
      const connected = integration(options, config, 'telegram', endpoints.telegram)
      const chatId = connected.resource
      if (chatId === undefined) throw new ActionRequiredError('Configure a default Telegram chat id for report delivery.')
      const text = `${report.title}\n\n${report.markdown}`.slice(0, 4096)
      const signal = AbortSignal.timeout(15_000)
      const response = await (options.fetch ?? globalThis.fetch)(`${connected.endpoint}/bot${connected.token}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, redirect: 'error', signal,
        body: JSON.stringify({ chat_id: chatId, text }),
      })
      if (!response.ok) { await response.body?.cancel(); throw new Error(`Telegram report delivery returned HTTP ${response.status}.`) }
      await response.body?.cancel()
    },
  }
}
