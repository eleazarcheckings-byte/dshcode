/** Authenticated inbound webhooks persisted for the next SaturnBot state evaluation. */
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { BotConfig } from './types.ts'
import { botJsonSchema } from './config.ts'
import type { BotDataStore } from './adapters/memory.ts'
import { WebhookConflictError } from './adapters/memory.ts'

/** Deployment-owned ingress limits and dependencies. */
export interface BotWebhookOptions {
  config: () => Promise<BotConfig>
  data: BotDataStore
  maxBytes: number
  toleranceSeconds: number
  environment?: Record<string, string | undefined>
  now?: () => number
}

/**
 * Verify a timestamped, delivery-bound signature without revealing the shared secret.
 * @param values - Header identities, raw bytes, shared secret, and replay window.
 * @returns Whether the delivery can be admitted; duplicate detection happens in durable storage.
 */
export function verifyBotWebhook(values: {
  timestamp: string
  deliveryId: string
  source: string
  signature: string
  body: Buffer
  secret: string
  now: number
  toleranceSeconds: number
}): boolean {
  if (!/^\d{10,11}$/.test(values.timestamp) || !/^[A-Za-z0-9._:-]{1,160}$/.test(values.deliveryId)
    || !/^[A-Za-z0-9._:-]{1,64}$/.test(values.source) || !/^[a-fA-F0-9]{64}$/.test(values.signature)) return false
  const timestamp = Number(values.timestamp)
  if (Math.abs(values.now / 1000 - timestamp) > values.toleranceSeconds) return false
  const expected = createHmac('sha256', values.secret)
    .update(`${JSON.stringify([values.timestamp, values.deliveryId, values.source])}\n`).update(values.body).digest()
  return timingSafeEqual(expected, Buffer.from(values.signature, 'hex'))
}

/**
 * Construct the one signed ingress route; it never accepts cookie-only or unsigned delivery.
 * @param options - Configuration reader, SQLite receipt store, and request bounds.
 * @returns A Node HTTP handler for POST /saturnbot/webhook.
 */
export function createBotWebhookHandler(options: BotWebhookOptions): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  const reply = (response: ServerResponse, status: number, value: object): void => {
    response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    response.end(JSON.stringify(value))
  }
  return async (request, response) => {
    if (request.method !== 'POST') { reply(response, 405, { error: 'Use POST' }); return }
    const contentType = request.headers['content-type']?.split(';')[0]?.trim()
    if (contentType !== 'application/json') { reply(response, 415, { error: 'Use application/json' }); return }
    if (Number(request.headers['content-length']) > options.maxBytes) {
      request.resume()
      reply(response, 413, { error: 'Delivery exceeds the configured byte limit' })
      return
    }
    const header = (name: string): string => typeof request.headers[name] === 'string' ? request.headers[name] : ''
    try {
      const config = await options.config()
      const credentialEnv = config.integrations.webhook?.credentialEnv
      const secret = credentialEnv === undefined ? undefined : (options.environment ?? process.env)[credentialEnv]
      if (secret === undefined || secret.trim() === '') { reply(response, 503, { error: 'Webhook integration is not configured' }); return }
      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of request.iterator({ destroyOnReturn: false })) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
        size += bytes.length
        if (size > options.maxBytes) { request.resume(); reply(response, 413, { error: 'Delivery exceeds the configured byte limit' }); return }
        chunks.push(bytes)
      }
      const body = Buffer.concat(chunks)
      const deliveryId = header('x-saturnbot-delivery')
      const source = header('x-saturnbot-source')
      if (!verifyBotWebhook({
        timestamp: header('x-saturnbot-timestamp'), deliveryId, source,
        signature: header('x-saturnbot-signature'), body, secret,
        now: options.now?.() ?? Date.now(), toleranceSeconds: options.toleranceSeconds,
      })) { reply(response, 401, { error: 'Invalid delivery signature or timestamp' }); return }
      let payload: unknown
      try { payload = JSON.parse(body.toString('utf8')) } catch { reply(response, 400, { error: 'Invalid JSON payload' }); return }
      const parsed = botJsonSchema.safeParse(payload)
      if (!parsed.success) { reply(response, 400, { error: 'Payload must be JSON data' }); return }
      const result = await options.data.ingestWebhook(deliveryId, source, parsed.data)
      reply(response, 202, { accepted: true, duplicate: !result.inserted, deliveryId })
    } catch (error) {
      // Provider payloads and database errors may contain customer data; the route never echoes them.
      if (response.writableEnded || response.destroyed) return
      if (error instanceof WebhookConflictError) reply(response, 409, { error: 'Delivery identity was already used with different content' })
      else reply(response, 503, { error: 'Delivery could not be stored; retry with the same identity and payload' })
    }
  }
}
