/**
 * REAL composition: the vendored Loader boots the same rows the desktop app
 * boots — credentials, the loopback web server, the browser-session
 * connection, the static front end — plus remote access. Every assertion is
 * made over the wire against the LAN listener, pinning the certificate the
 * pairing payload published, because that is the only vantage point the phone
 * ever has.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import LocalCredentials from '@deepseek-ai/dsh-credentials-local'
import HttpServer from '@deepseek-ai/dsh-host-webserver'
import * as FrontendStatic from '@deepseek-ai/dsh-host-frontend-static'
import SettingsFile from '@deepseek-ai/dsh-settings-file'
import { afterEach, expect, it } from 'vitest'
import RemoteAccess from '../src/index.ts'
import type { RemotePairingPayload } from '../src/types.ts'
import { frameData, pinnedRequest, pinnedStream } from './tls-client.ts'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })

async function harness() {
  const home = await mkdtemp(join(tmpdir(), 'saturn-remote-'))
  cleanup.push(async () => { await rm(home, { recursive: true, force: true }) })
  const dist = join(home, 'dist')
  await mkdir(dist)
  const distIndex = join(dist, 'index.html')
  await writeFile(distIndex, '<head></head><body>saturn shell</body>')

  const ctx = new Context()
  ctx.baseUrl = `${pathToFileURL(home).href}/`
  const loader = ctx.plugin(Loader)
  await loader
  cleanup.push(async () => { await loader.dispose() })
  Object.assign(ctx.loader.builtins, {
    include: Include,
    credentials: LocalCredentials,
    webserver: HttpServer,
    connection: Connection,
    frontend: FrontendStatic,
    settings: SettingsFile,
    remote: RemoteAccess,
  })
  const path = join(home, 'cordis.yml')
  const yaml = (value: string): string => JSON.stringify(value)
  await writeFile(path, [
    '- id: credentials',
    "  name: 'cordis:credentials'",
    '  config:',
    `    path: ${yaml(join(home, '.credentials.yaml'))}`,
    '    watch: false',
    '- id: settings',
    "  name: 'cordis:settings'",
    '  config:',
    `    path: ${yaml(join(home, 'settings.yaml'))}`,
    '    watch: false',
    '- id: webserver',
    "  name: 'cordis:webserver'",
    '  config:',
    "    host: '127.0.0.1'",
    '    port: 0',
    '- id: connection',
    "  name: 'cordis:connection'",
    '- id: frontend',
    "  name: 'cordis:frontend'",
    '  config:',
    `    distIndex: ${yaml(distIndex)}`,
    '- id: remote',
    "  name: 'cordis:remote'",
    '  config:',
    `    dshHome: ${yaml(home)}`,
    "    bindHost: '127.0.0.1'",
    '    port: 0',
    "    hostName: 'saturn-test'",
    '',
  ].join('\n'))
  await ctx.loader.root.update([{ id: 'composition', name: 'cordis:include', config: { path: pathToFileURL(path).href } }])
  await ctx.loader.await()
  const mounted = ctx.loader.resolve('composition').fiber
  if (mounted === undefined) throw new Error('remote-access composition did not mount')
  cleanup.push(async () => { await mounted.dispose() })
  return { ctx, home }
}

function localUrl(payload: RemotePairingPayload): string {
  const url = new URL(payload.url)
  url.hostname = '127.0.0.1'
  return url.origin
}

it('pairs a device over the LAN listener, proxies the app to it, streams approvals, and revokes it', { timeout: 60_000 }, async () => {
  const h = await harness()
  const service = h.ctx.remoteAccess

  // Off by default: nothing listens beyond loopback until a person says so.
  expect(service.status()).toMatchObject({ state: 'off', mode: 'lan', url: null, devices: [] })

  const enabled = await service.enable('lan')
  expect(enabled).toMatchObject({ state: 'on', mode: 'lan' })
  expect(enabled.fingerprint).toMatch(/^[0-9a-f]{64}$/u)
  expect(enabled.url).toMatch(/^https:\/\//u)

  const payload = await service.pairingCode()
  expect(payload).toMatchObject({ v: 1, name: 'saturn-test', url: enabled.url, fingerprint: enabled.fingerprint })
  expect(payload.token).toMatch(/^[A-Za-z0-9_-]{43}$/u)
  const ttl = Date.parse(payload.expires) - Date.now()
  expect(ttl).toBeGreaterThan(8 * 60_000)
  expect(ttl).toBeLessThanOrEqual(10 * 60_000)

  const origin = localUrl(payload)
  const fingerprint = payload.fingerprint!

  // Unpaired traffic never reaches the loopback app.
  expect((await pinnedRequest({ url: `${origin}/`, fingerprint })).status).toBe(401)
  expect((await pinnedRequest({
    url: `${origin}/`,
    fingerprint,
    headers: { authorization: 'Bearer not-a-device-token' },
  })).status).toBe(401)

  const paired = await pinnedRequest({
    url: `${origin}/saturn/remote/pair`,
    fingerprint,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: payload.token, device: { name: 'izzy iPhone', platform: 'ios' } }),
  })
  expect(paired.status).toBe(200)
  const grant = JSON.parse(paired.body) as { deviceToken: string; sessionCookieName: string }
  expect(grant.deviceToken).toMatch(/^[A-Za-z0-9_-]{43}$/u)
  expect(grant.sessionCookieName).toMatch(/^[A-Za-z0-9_-]+$/u)
  expect(String(paired.headers['set-cookie'])).toContain(grant.sessionCookieName)

  // The pairing token is single use.
  expect((await pinnedRequest({
    url: `${origin}/saturn/remote/pair`,
    fingerprint,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: payload.token, device: { name: 'second', platform: 'android' } }),
  })).status).toBe(401)

  const bearer = { authorization: `Bearer ${grant.deviceToken}` }

  // The whole app, through the proxy, on the device token alone.
  const index = await pinnedRequest({ url: `${origin}/`, fingerprint, headers: bearer })
  expect(index.status).toBe(200)
  expect(index.body).toContain('saturn shell')
  expect(String(index.headers['set-cookie'])).toContain(grant.sessionCookieName)
  // The desktop's own session cookie is never handed to a remote device.
  expect(String(index.headers['set-cookie'])).not.toContain('dsh-auth-')

  // The session cookie alone carries later subresource loads, as a WebView needs.
  const asset = await pinnedRequest({
    url: `${origin}/`,
    fingerprint,
    headers: { cookie: `${grant.sessionCookieName}=${grant.deviceToken}` },
  })
  expect(asset.status).toBe(200)
  expect(asset.body).toContain('saturn shell')

  // A cross-site initiator is refused at the edge, before the loopback server.
  expect((await pinnedRequest({
    url: `${origin}/api/anything`,
    fingerprint,
    headers: { ...bearer, origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
  })).status).toBe(403)

  const stream = await pinnedStream({ url: `${origin}/saturn/remote/events`, fingerprint, headers: bearer })
  cleanup.push(async () => { stream.close() })
  expect(stream.status).toBe(200)
  expect(stream.headers['content-type']).toContain('text/event-stream')

  const outcome = await h.ctx.waterfall(
    'approval/request',
    { agent: { id: 'agent-1' }, toolName: 'bash', reason: 'writes outside the workspace' } as never,
    () => Promise.resolve('unavailable' as never),
  )
  // Remote access observes the question; it never answers it.
  expect(outcome).toBe('unavailable')

  const event = frameData(await stream.next()) as { type: string; title: string; body: string; id: string; at: string }
  expect(event.type).toBe('approval')
  expect(event.title).toContain('bash')
  expect(event.body).toContain('writes outside the workspace')
  expect(Date.parse(event.at)).not.toBeNaN()

  // A second question gives the replay window a backlog it can be too small for.
  await h.ctx.waterfall(
    'approval/request',
    { agent: { id: 'agent-2' }, toolName: 'write', reason: 'edits a file the plan did not name' } as never,
    () => Promise.resolve('unavailable' as never),
  )
  const second = frameData(await stream.next()) as { id: string; title: string }
  expect(second.id).toBe('2')

  // Replay carries exactly what the stream carried, for a phone that was asleep.
  const replayed = await pinnedRequest({ url: `${origin}/saturn/remote/events/replay?after=0`, fingerprint, headers: bearer })
  expect(replayed.status).toBe(200)
  expect(String(replayed.headers['content-type'])).toContain('application/json')
  expect(replayed.headers['content-length']).toBe(String(Buffer.byteLength(replayed.body)))
  expect(String(replayed.headers['content-type'])).not.toContain('event-stream')
  const caught = JSON.parse(replayed.body) as {
    events: { id: string; type: string; title: string; body: string; at: string }[]
    newest: string
    truncated: boolean
    gap?: boolean
  }
  expect(caught.events.map(entry => entry.id)).toEqual(['1', '2'])
  expect(caught.events[0]).toEqual(event)
  expect(caught.events[1]?.title).toBe(second.title)
  expect(caught).toMatchObject({ newest: '2', truncated: false })
  expect(caught.gap).toBeUndefined()

  // Caught up: the cursor comes straight back and nothing is re-delivered.
  const emptied = await pinnedRequest({ url: `${origin}/saturn/remote/events/replay?after=2`, fingerprint, headers: bearer })
  expect(emptied.status).toBe(200)
  expect(JSON.parse(emptied.body)).toMatchObject({ events: [], newest: '2', truncated: false })

  // A window smaller than the backlog says so instead of dropping the rest silently.
  const windowed = await pinnedRequest({ url: `${origin}/saturn/remote/events/replay?after=0&limit=1`, fingerprint, headers: bearer })
  expect(windowed.status).toBe(200)
  const page = JSON.parse(windowed.body) as { events: { id: string }[]; newest: string; truncated: boolean }
  expect(page.events.map(entry => entry.id)).toEqual(['1'])
  expect(page).toMatchObject({ newest: '2', truncated: true })

  // A window the device cannot have meant is refused rather than guessed at.
  for (const query of ['after=soon', 'after=-1', 'after=', 'limit=0', 'limit=201', 'limit=1.5', 'limit=all']) {
    const refused = await pinnedRequest({ url: `${origin}/saturn/remote/events/replay?${query}`, fingerprint, headers: bearer })
    expect({ query, status: refused.status }).toEqual({ query, status: 400 })
  }

  // Replay stands behind the same door as the stream it replays.
  expect((await pinnedRequest({ url: `${origin}/saturn/remote/events/replay?after=0`, fingerprint })).status).toBe(401)
  expect((await pinnedRequest({
    url: `${origin}/saturn/remote/events/replay`,
    fingerprint,
    headers: { authorization: 'Bearer not-a-device-token' },
  })).status).toBe(401)

  const listed = await pinnedRequest({ url: `${origin}/saturn/remote/devices`, fingerprint, headers: bearer })
  expect(listed.status).toBe(200)
  const devices = JSON.parse(listed.body) as { devices: { id: string; name: string }[] }
  expect(devices.devices).toHaveLength(1)
  expect(devices.devices[0]?.name).toBe('izzy iPhone')
  expect(listed.body).not.toContain(grant.deviceToken)

  expect(service.status().devices[0]).toMatchObject({ name: 'izzy iPhone', platform: 'ios' })
  expect(service.status().journal.map(entry => entry.action)).toContain('paired')
  expect(JSON.stringify(service.status())).not.toContain(grant.deviceToken)

  const revoked = await pinnedRequest({
    url: `${origin}/saturn/remote/devices/${devices.devices[0]!.id}`,
    fingerprint,
    method: 'DELETE',
    headers: bearer,
  })
  expect(revoked.status).toBe(204)
  expect((await pinnedRequest({ url: `${origin}/`, fingerprint, headers: bearer })).status).toBe(401)

  const off = await service.disable()
  expect(off).toMatchObject({ state: 'off', url: null, fingerprint: null })
  await expect(pinnedRequest({ url: `${origin}/`, fingerprint })).rejects.toThrow()
})

it('refuses tunnel mode when no cloudflared is installed, without reaching for one', { timeout: 60_000 }, async () => {
  const h = await harness()
  const status = await h.ctx.remoteAccess.enable('tunnel')
  if (status.tunnelAvailable) {
    expect(status.state).toBe('on')
    expect(status.url).toMatch(/^https:\/\//u)
  } else {
    expect(status).toMatchObject({ state: 'failed', issue: 'tunnel-missing', url: null })
    expect(status.journal.map(entry => entry.action)).toContain('tunnel-missing')
  }
  await h.ctx.remoteAccess.disable()
})
