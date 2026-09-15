/** Signed ingress is exercised over actual HTTP and durable SQLite, without external accounts. */
import { createServer, request as httpRequest } from 'node:http'
import { createHmac } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BotDataStore } from '../src/adapters/memory.ts'
import { parseBotConfig } from '../src/config.ts'
import { createBotWebhookHandler, verifyBotWebhook } from '../src/webhook.ts'

const secret = 'fixture-signing-secret'
const timestamp = '1800000000'
const now = Number(timestamp) * 1000
const signed = (body: string, deliveryId = 'delivery-1', source = 'support') => ({
  'content-type': 'application/json', 'x-saturnbot-delivery': deliveryId, 'x-saturnbot-source': source,
  'x-saturnbot-timestamp': timestamp,
  'x-saturnbot-signature': createHmac('sha256', secret)
    .update(`${JSON.stringify([timestamp, deliveryId, source])}\n`).update(body).digest('hex'),
})
const disposers: (() => Promise<void>)[] = []
afterEach(async () => { for (const dispose of disposers.splice(0).reverse()) await dispose() })

describe('SaturnBot signed delivery', () => {
  it('binds the raw body, timestamp, source, and delivery id', () => {
    const body = Buffer.from('{"ticket":42}')
    const signature = signed(body.toString())['x-saturnbot-signature']
    const values = { timestamp, deliveryId: 'delivery-1', source: 'support', signature, body, secret, now, toleranceSeconds: 300 }
    expect(verifyBotWebhook(values)).toBe(true)
    expect(verifyBotWebhook({ ...values, body: Buffer.from('{"ticket":43}') })).toBe(false)
    expect(verifyBotWebhook({ ...values, now: now + 301_000 })).toBe(false)
    expect(verifyBotWebhook({ ...values, deliveryId: 'delivery-2' })).toBe(false)
    expect(verifyBotWebhook({ ...values, source: 'finance' })).toBe(false)
    expect(verifyBotWebhook({ ...values, signature: 'bad' })).toBe(false)
    const dottedSignature = signed(body.toString(), 'a.b', 'c')['x-saturnbot-signature']
    expect(verifyBotWebhook({ ...values, deliveryId: 'a.b', source: 'c', signature: dottedSignature })).toBe(true)
    expect(verifyBotWebhook({ ...values, deliveryId: 'a', source: 'b.c', signature: dottedSignature })).toBe(false)
  })

  it('deduplicates valid HTTP deliveries and refuses changed replays, unsigned requests, and oversized payloads', async () => {
    const root = await mkdtemp(join(tmpdir(), 'saturnbot-webhook-'))
    disposers.push(async () => { await rm(root, { recursive: true, force: true }) })
    const data = new BotDataStore(root)
    const handler = createBotWebhookHandler({
      data, config: async () => parseBotConfig({ integrations: { webhook: { credentialEnv: 'BOT_TEST_SIGNING_KEY' } } }),
      environment: { BOT_TEST_SIGNING_KEY: secret }, now: () => now, maxBytes: 128, toleranceSeconds: 300,
    })
    const server = createServer((request, response) => { void handler(request, response) })
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
    disposers.push(async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => { if (error === undefined) resolve(); else reject(error) })
      })
    })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('Missing test address')
    const url = `http://127.0.0.1:${address.port}/saturnbot/webhook`
    const body = JSON.stringify({ ticket: 42, subject: 'Account access' })
    const send = (content: string, headers = signed(content)) => fetch(url, { method: 'POST', headers, body: content })
    expect(await (await send(body)).json()).toEqual({ accepted: true, duplicate: false, deliveryId: 'delivery-1' })
    expect(await (await send(body)).json()).toEqual({ accepted: true, duplicate: true, deliveryId: 'delivery-1' })
    expect(await data.listWebhooks()).toHaveLength(1)
    expect((await send('{"ticket":43}')).status).toBe(409)
    expect((await send(body, { ...signed(body), 'x-saturnbot-signature': '0'.repeat(64) })).status).toBe(401)
    expect((await send(JSON.stringify({ content: 'x'.repeat(200) }))).status).toBe(413)
    expect((await fetch(url)).status).toBe(405)
    expect((await send(body, { ...signed(body), 'content-type': 'text/plain' })).status).toBe(415)
    const oversized = JSON.stringify({ content: 'x'.repeat(300) })
    const chunkedStatus = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(url, { method: 'POST', headers: { ...signed(oversized), 'transfer-encoding': 'chunked' } }, (response) => {
        response.resume(); response.on('end', () => { resolve(response.statusCode) })
      })
      request.on('error', reject)
      request.write(oversized.slice(0, 150))
      request.end(oversized.slice(150))
    })
    expect(chunkedStatus).toBe(413)
  })
})
