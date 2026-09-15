/** Real local adapter integrations; external network boundaries alone use mock responses. */
import { mkdtemp, mkdir, readFile, rm, symlink, unlink, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseBotConfig } from '../src/config.ts'
import type { BotToolContext } from '../src/contracts.ts'
import type { BotId } from '../src/types.ts'
import { createBotTools, type BotToolOptions } from '../src/tools.ts'
import { git, runProcess, verifyStage } from '../src/adapters/local.ts'
import { BotDataStore, WebhookConflictError } from '../src/adapters/memory.ts'
import { describeBotConnections } from '../src/adapters/integrations.ts'
import { MAX_ADAPTER_BYTES } from '../src/adapters/shared.ts'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); vi.restoreAllMocks() })

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'saturnbot-adapter-'))
  const ctx = new Context()
  const runtime = ctx.plugin(LocalSubprocessRuntime)
  await runtime.await()
  const workspace = join(root, 'repository')
  await mkdir(workspace)
  const options: BotToolOptions = { dataDirectory: join(root, 'state'), subprocess: ctx.subprocess }
  const context: BotToolContext = {
    config: parseBotConfig({ workspace, toolTimeoutMs: 10_000 }),
    cycleId: 'cycle-test' as BotId, branchId: 'branch-test' as BotId, role: 'developer',
    idempotencyKey: 'test-action-1', signal: new AbortController().signal, stage: null,
  }
  cleanups.push(async () => { await runtime.dispose(); await rm(root, { recursive: true, force: true }) })
  const execute = (name: string, input: Record<string, import('../src/types.ts').BotJson> = {}, current = context) => {
    const definition = createBotTools(options).find(tool => tool.name === name)!
    return definition.execute(input, current)
  }
  return { root, workspace, options, context, execute }
}

async function repository() {
  const fixtureValue = await fixture()
  const { options, context, workspace } = fixtureValue
  await git(options, context, workspace, ['init'])
  await writeFile(join(workspace, 'source.txt'), 'original\n')
  await git(options, context, workspace, ['add', 'source.txt'])
  await git(options, context, workspace, ['commit', '-m', 'Initial source'])
  return fixtureValue
}

function parsedBody(body: RequestInit['body']): unknown {
  if (typeof body !== 'string') throw new Error('Expected a serialized JSON request body.')
  return JSON.parse(body)
}

async function failureFrom(action: Promise<unknown>): Promise<Error> {
  try { await action } catch (error) {
    if (error instanceof Error) return error
    throw error
  }
  throw new Error('Expected the adapter invocation to reject.')
}

describe('isolated source and validation tools', () => {
  it('writes and validates an exact isolated revision without changing the original checkout', async () => {
    const f = await repository()
    const stage = (await f.execute('workspace.stage')).stage!
    f.context.stage = stage
    const changed = await f.execute('fs.write', { path: 'source.txt', text: 'task change\n' })
    expect(changed.stage!.revision).not.toBe(stage.revision)
    expect(await readFile(join(f.workspace, 'source.txt'), 'utf8')).toBe('original\n')
    f.context.stage = changed.stage!
    expect((await f.execute('fs.read', { path: 'source.txt' })).data).toMatchObject({ text: 'task change\n' })
    f.context.config.validationCommands = [[process.execPath, '-e', 'process.stdout.write("validated")']]
    expect((await f.execute('shell.validate')).validatedRevision).toBe(changed.stage!.revision)
    expect(await verifyStage(f.options, f.context)).toBe(changed.stage!.path)
    await writeFile(join(changed.stage!.path, 'source.txt'), 'external change')
    await expect(f.execute('shell.validate')).rejects.toThrow('uncommitted')
  }, 20_000)

  it('rejects traversal, credential files, symlink escapes, and writing without a stage', async () => {
    const f = await repository()
    await expect(f.execute('fs.write', { path: 'source.txt', text: 'unsafe' })).rejects.toThrow('isolated')
    await expect(f.execute('fs.read', { path: '../outside.txt' })).rejects.toThrow('inside')
    await expect(f.execute('fs.read', { path: '.env' })).rejects.toThrow('not permitted')
    if (process.platform === 'win32') {
      await expect(f.execute('fs.read', { path: '.env ' })).rejects.toThrow('not permitted')
      await expect(f.execute('fs.read', { path: 'NUL.txt' })).rejects.toThrow('not permitted')
    }
    await expect(f.execute('fs.write', { path: 'large.txt', text: '界'.repeat(MAX_ADAPTER_BYTES / 2) })).rejects.toThrow('UTF-8 byte size')
    const outside = join(f.root, 'outside')
    await mkdir(outside)
    await writeFile(join(outside, 'secret.txt'), 'outside')
    const link = join(f.workspace, 'shortcut')
    await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir')
    try { await expect(f.execute('fs.read', { path: 'shortcut/secret.txt' })).rejects.toThrow('Symlink') }
    finally { await unlink(link) }
    expect(await readFile(join(outside, 'secret.txt'), 'utf8')).toBe('outside')
  }, 20_000)

  it('requires configured validation and never accepts a model-supplied command', async () => {
    const f = await repository()
    f.context.stage = (await f.execute('workspace.stage')).stage!
    await expect(f.execute('shell.validate')).rejects.toMatchObject({ code: 'action-required' })
    await expect(f.execute('shell.validate', { command: 'anything' })).rejects.toThrow()
  }, 20_000)

  it('does not inherit API credentials or the user HOME into validation processes', async () => {
    const f = await fixture()
    f.options.environment = { ...process.env, SPECIAL_TOKEN: 'never-forward', HOME: '/private-user-home' }
    const result = await runProcess(f.options, f.context, f.workspace, [process.execPath, '-e', 'process.stdout.write(JSON.stringify({ token:process.env.SPECIAL_TOKEN, home:process.env.HOME }))'])
    expect(JSON.parse(result.stdout)).toEqual({ home: join(f.options.dataDirectory, 'process-home') })
  })

  it('awaits whole-process-tree cleanup when a validation deadline expires', async () => {
    const f = await fixture()
    f.context.config.toolTimeoutMs = 800
    const started = join(f.workspace, 'started')
    const escaped = join(f.workspace, 'escaped')
    const child = `require('node:fs').writeFileSync(${JSON.stringify(started)},'ready');setTimeout(()=>require('node:fs').writeFileSync(${JSON.stringify(escaped)},'escaped'),1500)`
    const parent = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(child)}],{stdio:'ignore'});setInterval(()=>{},1000)`
    await expect(runProcess(f.options, f.context, f.workspace, [process.execPath, '-e', parent])).rejects.toThrow()
    await access(started)
    await new Promise(resolve => setTimeout(resolve, 1800))
    await expect(access(escaped)).rejects.toMatchObject({ code: 'ENOENT' })
  }, 10_000)
})

describe('durable knowledge and webhook receipts', () => {
  it('keeps memory and support tickets across store instances and treats queries as literal text', async () => {
    const f = await fixture()
    const store = new BotDataStore(f.options.dataDirectory)
    await store.writeMemory('positioning', 'Customer request: privacy first')
    await store.upsertTicket({ id: 'ticket-1', subject: 'Help', body: 'Please help', status: 'open' })
    const reopened = new BotDataStore(f.options.dataDirectory)
    expect(await reopened.searchMemory('privacy')).toEqual([expect.objectContaining({ key: 'positioning' })])
    expect(await reopened.searchMemory("' OR 1=1 --")).toEqual([])
    expect(await reopened.listTickets('open')).toEqual([expect.objectContaining({ id: 'ticket-1' })])
    await reopened.upsertTicket({ id: 'ticket-1', subject: 'Help', body: 'Resolved', status: 'closed' })
    expect(await store.listTickets('open')).toEqual([])
  })

  it('deduplicates deliveries durably and rejects an identity reused for changed content', async () => {
    const f = await fixture()
    const store = new BotDataStore(f.options.dataDirectory)
    expect(await store.ingestWebhook('delivery-1', 'github', { action: 'opened' })).toEqual({ inserted: true })
    expect(await new BotDataStore(f.options.dataDirectory).ingestWebhook('delivery-1', 'github', { action: 'opened' })).toEqual({ inserted: false })
    await expect(store.ingestWebhook('delivery-1', 'github', { action: 'closed' })).rejects.toBeInstanceOf(WebhookConflictError)
    expect(await store.listWebhooks()).toEqual([expect.objectContaining({ deliveryId: 'delivery-1', payload: { action: 'opened' } })])
  })
})

describe('external provider adapters', () => {
  it('reports missing connections as action required and never claims network authentication from config', async () => {
    const f = await fixture()
    const fetch = vi.fn<typeof globalThis.fetch>()
    f.options.fetch = fetch
    await expect(f.execute('email.inbox')).rejects.toMatchObject({ code: 'action-required' })
    expect(fetch).not.toHaveBeenCalled()
    f.context.config.integrations.email = { credentialEnv: 'MAIL_TOKEN', resource: 'operator@example.com' }
    const status = describeBotConnections(f.context.config, { MAIL_TOKEN: 'available' }).find(item => item.name === 'email')
    expect(status?.status).toBe('configured')
    expect(status?.message).toContain('not been tested')
  })

  it('uses Graph mailbox resources and reports send acceptance rather than delivery', async () => {
    const f = await fixture()
    f.context.config.integrations.email = { credentialEnv: 'MAIL_TOKEN', resource: 'operator@example.com' }
    f.options.environment = { MAIL_TOKEN: 'sensitive-mail-token' }
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(null, { status: 202 }))
    f.options.fetch = fetch
    const result = await f.execute('email.send', { to: ['customer@example.com'], subject: 'Update', body: 'Ready for review.' })
    expect(result.data).toEqual({ accepted: true, deliveryConfirmed: false, recipientCount: 1 })
    expect(fetch.mock.calls[0]![0]).toBe('https://graph.microsoft.com/v1.0/users/operator%40example.com/sendMail')
    expect(parsedBody(fetch.mock.calls[0]![1]!.body)).toMatchObject({ message: { subject: 'Update', body: { content: 'Ready for review.' } } })
    fetch.mockResolvedValueOnce(new Response('null', { status: 200 }))
    await expect(f.execute('email.send', { to: ['customer@example.com'], subject: 'Update', body: 'Body' })).rejects.toThrow('HTTP 202')
  })

  it('redacts mailbox previews and rejects malformed provider responses', async () => {
    const f = await fixture()
    f.context.config.integrations.email = { credentialEnv: 'MAIL_TOKEN', resource: 'mailbox' }
    f.options.environment = { MAIL_TOKEN: 'secret-mail-token' }
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(Response.json({ value: [{ id: '1', bodyPreview: 'Do not log secret-mail-token' }] })).mockResolvedValueOnce(Response.json({ unexpected: true }))
    f.options.fetch = fetch
    const output = JSON.stringify((await f.execute('email.inbox')).data)
    expect(output).toContain('[redacted]')
    expect(output).not.toContain('secret-mail-token')
    await expect(f.execute('email.inbox')).rejects.toThrow()
  })

  it('keeps currencies separate, excludes payouts from revenue, and marks incomplete transaction pages', async () => {
    const f = await fixture()
    f.context.config.integrations.stripe = { credentialEnv: 'STRIPE_TOKEN' }
    f.options.environment = { STRIPE_TOKEN: 'stripe-test-secret' }
    f.options.fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ available: [{ amount: 1000, currency: 'usd' }], pending: [] }))
      .mockResolvedValueOnce(Response.json({ has_more: true, data: [
        { id: 'a', amount: 2000, currency: 'usd', fee: 100, net: 1900, type: 'charge', created: 1 },
        { id: 'b', amount: -1000, currency: 'usd', fee: 0, net: -1000, type: 'payout', created: 2 },
        { id: 'c', amount: 500, currency: 'jpy', fee: 20, net: 480, type: 'charge', created: 3 },
      ] }))
    expect((await f.execute('stripe.metrics')).data).toMatchObject({
      units: 'minor', hasMore: true,
      totalsByCurrency: {
        usd: { revenueGrossMinor: 2000, payoutsMinor: 1000, netMovementMinor: 900 }, jpy: { revenueGrossMinor: 500, netMovementMinor: 480 },
      },
    })
  })

  it('rejects unsafe provider URLs before fetch and never retains transport or parser secret excerpts', async () => {
    const f = await fixture()
    f.context.config.integrations.social = { endpoint: 'https://provider.example/publish', credentialEnv: 'SOCIAL_TOKEN' }
    f.options.environment = { SOCIAL_TOKEN: 'secret-social-value' }
    const fetch = vi.fn<typeof globalThis.fetch>()
    f.options.fetch = fetch
    for (const endpoint of ['not a URL secret-social-value', 'https://user:secret-social-value@provider.example', 'http://provider.example', 'https://provider.example?key=secret-social-value']) {
      f.context.config.integrations.social.endpoint = endpoint
      const error = await failureFrom(f.execute('social.publish', { channel: 'news', text: 'Update' }))
      expect(error).toMatchObject({ code: 'action-required' })
      expect(String(error)).not.toContain('secret-social-value')
    }
    expect(fetch).not.toHaveBeenCalled()
    f.context.config.integrations.social.endpoint = 'https://provider.example/publish'
    fetch.mockRejectedValueOnce(new Error('fetch failed at https://secret-social-value@host'))
      .mockResolvedValueOnce(new Response('secret-social-value is not JSON'))
      .mockResolvedValueOnce(Response.json({ id: 'safe', status: 'secret-social-value' }))
    for (let attempt = 0; attempt < 3; attempt++) {
      const error = await failureFrom(f.execute('social.publish', { channel: 'news', text: 'Update' }))
      expect(error).toBeInstanceOf(Error)
      expect(String(error)).not.toContain('secret-social-value')
    }
  })

  it('cancels oversized remote bodies before parsing and keeps ordinary provider acceptance explicit', async () => {
    const f = await fixture()
    f.context.config.integrations.social = { endpoint: 'https://provider.example/publish', credentialEnv: 'SOCIAL_TOKEN' }
    f.options.environment = { SOCIAL_TOKEN: 'provider-secret' }
    const cancel = vi.fn()
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(MAX_ADAPTER_BYTES + 1)) }, cancel })
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(new Response(stream)).mockResolvedValueOnce(Response.json({ id: 'request-1', status: 'accepted', url: 'https://provider.example/jobs/1' }, { status: 202 }))
    f.options.fetch = fetch
    await expect(f.execute('social.publish', { channel: 'news', text: 'Update' })).rejects.toThrow('permitted size')
    expect(cancel).toHaveBeenCalledOnce()
    expect((await f.execute('social.publish', { channel: 'news', text: 'Update' })).data).toMatchObject({ id: 'request-1', status: 'accepted' })
    expect(fetch.mock.calls[1]![1]).toMatchObject({ redirect: 'error', headers: { 'Idempotency-Key': f.context.idempotencyKey } })
  })

  it('redacts all mailbox fields and rejects credential-bearing creative links', async () => {
    const f = await fixture()
    f.context.config.integrations.email = { credentialEnv: 'MAIL_TOKEN', resource: 'mailbox' }
    f.context.config.integrations.creative = { endpoint: 'https://creative.example/generate', credentialEnv: 'MAIL_TOKEN' }
    f.options.environment = { MAIL_TOKEN: 'private-mail-value' }
    f.options.fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ value: [{ id: 'message-1', subject: 'private-mail-value', from: { emailAddress: { name: 'private-mail-value' } } }] }))
      .mockResolvedValueOnce(Response.json({ id: 'image-1', status: 'completed', assets: [{ url: 'https://user:private-mail-value@creative.example/image.png', mimeType: 'image/png' }] }))
    const data = JSON.stringify((await f.execute('email.inbox')).data)
    expect(data).not.toContain('private-mail-value')
    expect(data).toContain('[redacted]')
    await expect(f.execute('creative.generate', { kind: 'image', prompt: 'A clear product illustration' })).rejects.toThrow('invalid JSON')
  })

  it('returns an existing exact-revision PR without another push or creation request', async () => {
    const f = await repository()
    f.context.stage = (await f.execute('workspace.stage')).stage!
    f.context.config.integrations.github = { credentialEnv: 'GH_TOKEN', resource: 'owner/repository' }
    f.options.environment = { ...process.env, GH_TOKEN: 'test-github-credential' }
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(Response.json({ default_branch: 'main' }))
      .mockResolvedValueOnce(Response.json([{ number: 21, html_url: 'https://github.com/owner/repository/pull/21', head: { sha: f.context.stage.revision }, body: `<!-- SaturnBot ${f.context.idempotencyKey} -->` }]))
    f.options.fetch = fetch
    expect((await f.execute('github.create_pr', { title: 'Change', body: 'Details' })).data).toMatchObject({ number: 21, revision: f.context.stage.revision })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls.every(([, init]) => init?.method === undefined)).toBe(true)
    expect(await readFile(join(f.workspace, 'source.txt'), 'utf8')).toBe('original\n')
  }, 20_000)

  it('deploys only the exact remote revision and rechecks local changes before provider dispatch', async () => {
    const f = await repository()
    f.context.stage = (await f.execute('workspace.stage')).stage!
    f.context.config.integrations.github = { credentialEnv: 'GH_TOKEN', resource: 'owner/repository' }
    f.context.config.integrations.cloud = { endpoint: 'https://deploy.example/start', credentialEnv: 'CLOUD_TOKEN', resource: 'project-1' }
    f.options.environment = { ...process.env, GH_TOKEN: 'github-test-token', CLOUD_TOKEN: 'cloud-test-token' }
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(Response.json({ sha: f.context.stage.revision }))
      .mockResolvedValueOnce(Response.json({ id: 'deploy-1', status: 'running' }))
    f.options.fetch = fetch
    expect((await f.execute('cloud.deploy', { environment: 'preview' })).data).toEqual({ id: 'deploy-1', status: 'running' })
    expect(parsedBody(fetch.mock.calls[1]![1]!.body)).toMatchObject({ repository: 'owner/repository', revision: f.context.stage.revision, environment: 'preview', resource: 'project-1' })
    fetch.mockImplementationOnce(async () => {
      await writeFile(join(f.context.stage!.path, 'source.txt'), 'unreviewed')
      return Response.json({ sha: f.context.stage!.revision })
    })
    await expect(f.execute('cloud.deploy', { environment: 'production' })).rejects.toThrow('uncommitted')
    expect(fetch).toHaveBeenCalledTimes(3)
  }, 20_000)

  it('keeps mutation role/effect/retry ceilings on trusted definitions', async () => {
    const f = await fixture()
    const tools = createBotTools(f.options)
    expect(tools.find(tool => tool.name === 'github.create_pr')).toMatchObject({ roles: ['developer'], effect: 'pr', retry: 'never' })
    expect(tools.find(tool => tool.name === 'email.send')).toMatchObject({ roles: ['operations', 'growth'], effect: 'email', retry: 'never' })
    expect(tools.find(tool => tool.name === 'social.publish')).toMatchObject({ roles: ['growth'], effect: 'social', retry: 'never' })
    expect(tools.find(tool => tool.name === 'fs.write')).toMatchObject({ effect: 'stage', retry: 'never' })
    expect(tools.filter(tool => tool.evaluationInput !== undefined).every(tool => tool.effect === 'read' && tool.roles.includes('orchestrator'))).toBe(true)
  })
})

describe('telegram adapter', () => {
  it('sends a message via the bot-token URL, defaulting to the configured chat id', async () => {
    const f = await fixture()
    f.context.config.integrations.telegram = { credentialEnv: 'TG_TOKEN', resource: '123456' }
    f.options.environment = { TG_TOKEN: 'secret-bot-token' }
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ ok: true, result: { message_id: 42 } }))
    f.options.fetch = fetch
    const result = await f.execute('telegram.send', { text: 'Digest ready' })
    expect(result.data).toEqual({ messageId: 42, chatId: '123456' })
    expect(fetch.mock.calls[0]![0]).toBe('https://api.telegram.org/botsecret-bot-token/sendMessage')
    expect(parsedBody(fetch.mock.calls[0]![1]!.body)).toEqual({ chat_id: '123456', text: 'Digest ready' })
    await f.execute('telegram.send', { text: 'Another', chatId: '999' })
    expect(parsedBody(fetch.mock.calls[1]![1]!.body)).toMatchObject({ chat_id: '999' })
  })

  it('requires a configured or supplied chat id and never leaks the token in a rejection', async () => {
    const f = await fixture()
    f.context.config.integrations.telegram = { credentialEnv: 'TG_TOKEN' }
    f.options.environment = { TG_TOKEN: 'secret-bot-token' }
    const error = await failureFrom(f.execute('telegram.send', { text: 'Hi' }))
    expect(error).toMatchObject({ code: 'action-required' })
    expect(String(error)).not.toContain('secret-bot-token')
  })
})

describe('shopify adapter', () => {
  it('reads bounded orders and products from the configured store domain', async () => {
    const f = await fixture()
    f.context.config.integrations.shopify = { credentialEnv: 'SHOPIFY_TOKEN', resource: 'test-shop.myshopify.com' }
    f.options.environment = { SHOPIFY_TOKEN: 'shpat-secret-value' }
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ orders: [{ id: 1, name: '#1001', financial_status: 'paid', fulfillment_status: null, total_price: '19.99', currency: 'USD', created_at: '2026-09-01T00:00:00Z', line_items: [{ title: 'Widget', quantity: 2, sku: 'WID-1' }] }] }))
      .mockResolvedValueOnce(Response.json({ products: [{ id: 2, title: 'Widget', status: 'active', variants: [{ id: 3, sku: 'WID-1', price: '9.99', inventory_quantity: 40 }] }] }))
    f.options.fetch = fetch
    const orders = await f.execute('shopify.orders_list', {})
    expect(orders.data).toMatchObject({ items: [expect.objectContaining({ name: '#1001' })] })
    expect(fetch.mock.calls[0]![0]).toBe('https://test-shop.myshopify.com/admin/api/2025-01/orders.json?limit=20&status=open')
    expect(fetch.mock.calls[0]![1]).toMatchObject({ headers: { 'X-Shopify-Access-Token': 'shpat-secret-value' } })
    const products = await f.execute('shopify.products_list', {})
    expect(products.data).toMatchObject({ items: [expect.objectContaining({ title: 'Widget' })] })
  })

  it('sets inventory only through the admitted tool and reports the provider-confirmed quantity', async () => {
    const f = await fixture()
    f.context.config.integrations.shopify = { credentialEnv: 'SHOPIFY_TOKEN', resource: 'test-shop.myshopify.com' }
    f.options.environment = { SHOPIFY_TOKEN: 'shpat-secret-value' }
    const level = { inventory_item_id: 111, location_id: 222, available: 5 }
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ inventory_level: level }))
    f.options.fetch = fetch
    const result = await f.execute('shopify.inventory_update', { inventoryItemId: 111, locationId: 222, available: 5 })
    expect(result.data).toEqual({ inventory_item_id: 111, location_id: 222, available: 5 })
    expect(parsedBody(fetch.mock.calls[0]![1]!.body)).toEqual({ inventory_item_id: 111, location_id: 222, available: 5 })
  })

  it('requires the store domain resource before dispatching any request', async () => {
    const f = await fixture()
    f.context.config.integrations.shopify = { credentialEnv: 'SHOPIFY_TOKEN' }
    f.options.environment = { SHOPIFY_TOKEN: 'shpat-secret-value' }
    const fetch = vi.fn<typeof globalThis.fetch>()
    f.options.fetch = fetch
    await expect(f.execute('shopify.orders_list', {})).rejects.toMatchObject({ code: 'action-required' })
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('cloud.deploy first-class targets', () => {
  it('deploys through a configured Vercel deploy hook without requiring a credential', async () => {
    const f = await repository()
    f.context.stage = (await f.execute('workspace.stage')).stage!
    f.context.config.integrations.github = { credentialEnv: 'GH_TOKEN', resource: 'owner/repository' }
    f.context.config.integrations.vercel = { endpoint: 'https://api.vercel.com/v1/integrations/deploy/prj_x/hook_y' }
    f.options.environment = { ...process.env, GH_TOKEN: 'github-test-token' }
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ sha: f.context.stage.revision }))
      .mockResolvedValueOnce(Response.json({ job: { id: 'job-1', state: 'PENDING' } }))
    f.options.fetch = fetch
    const result = await f.execute('cloud.deploy', { environment: 'production', target: 'vercel' })
    expect(result.data).toMatchObject({ target: 'vercel', revision: f.context.stage.revision, response: { job: { id: 'job-1' } } })
    expect(fetch.mock.calls[1]![0]).toBe('https://api.vercel.com/v1/integrations/deploy/prj_x/hook_y')
    expect((fetch.mock.calls[1]![1]!.headers as Record<string, string>)['Authorization']).toBeUndefined()
  }, 20_000)

  it('deploys through a configured Cloudflare Pages deploy hook and rejects a hook URL carrying embedded credentials', async () => {
    const f = await repository()
    f.context.stage = (await f.execute('workspace.stage')).stage!
    f.context.config.integrations.github = { credentialEnv: 'GH_TOKEN', resource: 'owner/repository' }
    f.context.config.integrations['cloudflare-pages'] = { endpoint: 'https://api.cloudflare.com/client/v4/pages/webhooks/deploy_hooks/hook-id' }
    f.options.environment = { ...process.env, GH_TOKEN: 'github-test-token' }
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ sha: f.context.stage.revision }))
      .mockResolvedValueOnce(Response.json({ success: true, result: { id: 'deployment-1' } }))
    f.options.fetch = fetch
    const result = await f.execute('cloud.deploy', { environment: 'production', target: 'cloudflare-pages' })
    expect(result.data).toMatchObject({ target: 'cloudflare-pages', response: { success: true } })
    f.context.config.integrations['cloudflare-pages'] = { endpoint: 'https://user:pass@api.cloudflare.com/hook' }
    await expect(f.execute('cloud.deploy', { environment: 'production', target: 'cloudflare-pages' })).rejects.toMatchObject({ code: 'action-required' })
  }, 20_000)
})

describe('creative.generate media routing', () => {
  it('routes to a connected media service instead of the generic webhook contract when one is present', async () => {
    const f = await fixture()
    const job = { id: 'job-1', status: 'done', assets: [{ path: '/abs/out.png', mimeType: 'image/png' }], cost: { estimatedUsd: 0.02, provider: 'gemini', model: 'gemini-image' } }
    const generate = vi.fn().mockResolvedValue(job)
    f.options.services = { get: (name: string) => name === 'media' ? { generate, status: vi.fn() } : undefined }
    const result = await f.execute('creative.generate', { kind: 'image', prompt: 'A clean product photo' })
    expect(result.data).toMatchObject({ id: 'job-1', status: 'done' })
    expect(generate).toHaveBeenCalledWith({ kind: 'image', prompt: 'A clean product photo', workspace: f.context.config.workspace })
  })

  it('falls back to the generic webhook contract when no media service is connected', async () => {
    const f = await fixture()
    f.context.config.integrations.creative = { endpoint: 'https://creative.example/generate', credentialEnv: 'CREATIVE_TOKEN' }
    f.options.environment = { CREATIVE_TOKEN: 'creative-secret' }
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ id: 'req-1', status: 'accepted', assets: [] }))
    f.options.fetch = fetch
    const result = await f.execute('creative.generate', { kind: 'video', prompt: 'A short clip' })
    expect(result.data).toMatchObject({ id: 'req-1', status: 'accepted' })
    expect(fetch).toHaveBeenCalledOnce()
  })
})
