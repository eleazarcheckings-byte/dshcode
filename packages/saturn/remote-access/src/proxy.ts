/**
 * The remote edge. One listener outside loopback, one job: decide whether the
 * request in front of it belongs to a paired device, and if it does, hand it to
 * the loopback web server wearing the same browser session the desktop window
 * wears. The authentication the harness already has is reused, never forked —
 * the edge holds exactly one upstream session cookie, obtained through
 * Connection's own launch-token exchange, and the device never sees it.
 *
 * What the edge adds on its own account is the device token, the four
 * `/saturn/remote/*` routes, and the two browser fences (Host and Origin) that
 * a rewritten Host header would otherwise blunt: the incoming Origin is
 * checked against the address the device actually dialled BEFORE it is
 * dropped, so a rewrite never launders a cross-site request into a same-origin
 * one.
 */

import { createServer as createHttpServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import type { AddressInfo } from 'node:net'
import type { Duplex } from 'node:stream'
import { PairingError, type DeviceLedger } from './devices.ts'
import type { EventBus } from './events.ts'
import type { RemoteJournal } from './journal.ts'
import type { RemoteDeviceRecord } from './types.ts'

/** Hop-by-hop headers plus the ones the edge owns; never forwarded upstream. */
const STRIPPED_REQUEST_HEADERS = new Set([
  'authorization', 'connection', 'cookie', 'host', 'keep-alive', 'origin',
  'proxy-authorization', 'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade',
])
const STRIPPED_RESPONSE_HEADERS = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'set-cookie', 'trailer', 'transfer-encoding', 'upgrade',
])

const REMOTE_PREFIX = '/saturn/remote'
const MAX_PAIR_BODY_BYTES = 4096
const HEARTBEAT_MS = 25_000
const DEVICE_TOKEN_MAX_AGE_SECONDS = 400 * 24 * 60 * 60

/** Everything the edge needs from the host it fronts. */
export interface ProxyOptions {
  /** Interface to bind, `0.0.0.0` for LAN mode and `127.0.0.1` behind a tunnel. */
  bindHost: string
  /** Port to bind; 0 asks the operating system. */
  port: number
  /** TLS material for LAN mode; absent behind a tunnel, which terminates its own. */
  tls?: { key: string; cert: string }
  /** The loopback web server's port. */
  loopbackPort: number
  /** The paired-device ledger. */
  ledger: DeviceLedger
  /** The notification bus behind the events route. */
  bus: EventBus
  /** The state-change journal. */
  journal: RemoteJournal
  /** Cookie name the device stores after pairing. */
  sessionCookieName: string
  /** Obtain the upstream browser session cookie; `force` re-runs the exchange. */
  session: (force: boolean) => Promise<string>
  /** Clock, injectable for tests. */
  now: () => number
  /** Diagnostics; never receives a token. */
  logger: { warn: (error: unknown) => void }
  /** Whether the device cookie may be sent without the Secure attribute (tunnel mode terminates TLS upstream). */
  secureCookies: boolean
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

/** Read one cookie by exact name without implementing general Cookie parsing. */
function cookieValue(header: string | undefined, name: string): string | undefined {
  if (header === undefined) return undefined
  for (const segment of header.split(';')) {
    const at = segment.indexOf('=')
    if (at === -1 || segment.slice(0, at).trim() !== name) continue
    return segment.slice(at + 1).trim()
  }
  return undefined
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': String(Buffer.byteLength(payload)),
  })
  res.end(payload)
}

function text(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
  res.end(body)
}

async function readBody(req: IncomingMessage, limit: number): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).byteLength
    if (size > limit) throw new Error('remote-access: request body is too large')
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The browser fences, applied before the Host header is rewritten. An explicit
 * cross-site marker is refused outright; an Origin must name the authority the
 * device dialled. Absent markers pass — a native request carries neither.
 */
function browserFencePasses(req: IncomingMessage): boolean {
  if (firstHeader(req.headers['sec-fetch-site']) === 'cross-site') return false
  const origin = firstHeader(req.headers.origin)
  if (origin === undefined) return true
  const host = firstHeader(req.headers.host)
  if (host === undefined) return false
  try {
    return new URL(origin).host === new URL(`https://${host}`).host
  } catch {
    return false
  }
}

/** The listener outside loopback and everything it is allowed to do. */
export class RemoteProxy {
  private readonly server: Server
  private readonly streams = new Set<{ close: () => void }>()
  private listenedPort = 0

  private constructor(private readonly options: ProxyOptions) {
    const handle = (req: IncomingMessage, res: ServerResponse): void => {
      void this.dispatch(req, res).catch((error: unknown) => {
        this.options.logger.warn(error)
        if (res.headersSent) res.destroy()
        else text(res, 400, 'bad request\n')
      })
    }
    this.server = options.tls === undefined
      ? createHttpServer(handle)
      : createHttpsServer({ key: options.tls.key, cert: options.tls.cert }, handle)
    this.server.on('upgrade', (req, socket, head) => { this.upgrade(req, socket, head) })
  }

  /**
   * Bind the edge.
   * @param options - the host it fronts and the state it reads.
   * @returns the running edge.
   */
  static async start(options: ProxyOptions): Promise<RemoteProxy> {
    const proxy = new RemoteProxy(options)
    await new Promise<void>((resolve, reject) => {
      proxy.server.once('error', reject)
      proxy.server.listen(options.port, options.bindHost, () => {
        proxy.server.off('error', reject)
        proxy.server.on('error', (error) => { options.logger.warn(error) })
        proxy.listenedPort = (proxy.server.address() as AddressInfo).port
        resolve()
      })
    })
    return proxy
  }

  /** The bound port (the assigned one when the config asked for zero). */
  get port(): number {
    return this.listenedPort
  }

  /** Close every device stream and the listener itself. */
  async stop(): Promise<void> {
    for (const stream of [...this.streams]) stream.close()
    this.streams.clear()
    this.options.bus.clear()
    await new Promise<void>((resolve) => {
      this.server.close(() => { resolve() })
      this.server.closeAllConnections()
    })
  }

  /** Resolve the presented credential to a paired device, if any. */
  private device(req: IncomingMessage): { record: RemoteDeviceRecord; token: string; fromBearer: boolean } | undefined {
    const authorization = firstHeader(req.headers.authorization) ?? ''
    const bearer = authorization.toLowerCase().startsWith('bearer ')
      ? authorization.slice('bearer '.length).trim()
      : undefined
    const token = bearer ?? cookieValue(firstHeader(req.headers.cookie), this.options.sessionCookieName) ?? ''
    const record = this.options.ledger.authenticate(token, this.options.now())
    return record === undefined ? undefined : { record, token, fromBearer: bearer !== undefined }
  }

  /** The cookie a paired device stores so its WebView's subresource loads authenticate. */
  private deviceCookie(token: string): string {
    return [
      `${this.options.sessionCookieName}=${token}`,
      `Max-Age=${String(DEVICE_TOKEN_MAX_AGE_SECONDS)}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Strict',
      ...this.options.secureCookies ? ['Secure'] : [],
    ].join('; ')
  }

  private async dispatch(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!browserFencePasses(req)) {
      text(res, 403, 'forbidden\n')
      return
    }
    const path = new URL(req.url ?? '/', 'http://saturn.invalid').pathname
    if (path === `${REMOTE_PREFIX}/pair`) {
      await this.pair(req, res)
      return
    }
    if (path.startsWith(`${REMOTE_PREFIX}/`) || path === REMOTE_PREFIX) {
      const device = this.device(req)
      if (device === undefined) {
        text(res, 401, 'pair this device first\n')
        return
      }
      if (path === `${REMOTE_PREFIX}/events` && req.method === 'GET') {
        this.stream(req, res)
        return
      }
      if (path === `${REMOTE_PREFIX}/devices` && req.method === 'GET') {
        json(res, 200, { devices: this.options.ledger.list() })
        return
      }
      if (path.startsWith(`${REMOTE_PREFIX}/devices/`) && req.method === 'DELETE') {
        const id = decodeURIComponent(path.slice(`${REMOTE_PREFIX}/devices/`.length))
        const removed = await this.options.ledger.revoke(id)
        if (removed) this.options.journal.record('revoked', id === device.record.id ? 'this device' : 'device', this.options.now())
        res.writeHead(removed ? 204 : 404, { 'cache-control': 'no-store' })
        res.end()
        return
      }
      text(res, 404, 'no such remote route\n')
      return
    }
    const device = this.device(req)
    if (device === undefined) {
      text(res, 401, 'pair this device first\n')
      return
    }
    // A WebView cannot attach an Authorization header to the subresource loads
    // the document then makes, so a request that arrived on the bearer token
    // leaves with the same credential planted as an HttpOnly cookie.
    await this.forward(req, res, device.fromBearer ? this.deviceCookie(device.token) : undefined)
  }

  /** Spend a pairing token and enrol the device that presented it. */
  private async pair(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST') {
      text(res, 405, 'pair with POST\n')
      return
    }
    let body: unknown
    try {
      body = JSON.parse(await readBody(req, MAX_PAIR_BODY_BYTES))
    } catch {
      json(res, 400, { error: 'send a JSON body carrying the pairing token' })
      return
    }
    const token = isRecord(body) && typeof body.token === 'string' ? body.token : undefined
    const device = isRecord(body) && isRecord(body.device) ? body.device : undefined
    const name = typeof device?.name === 'string' && device.name !== '' ? device.name : 'Saturn device'
    const platform = typeof device?.platform === 'string' ? device.platform : 'unknown'
    if (token === undefined) {
      json(res, 400, { error: 'send a JSON body carrying the pairing token' })
      return
    }
    try {
      const paired = await this.options.ledger.redeemPairingToken(token, { name, platform }, this.options.now())
      this.options.journal.record('paired', `${paired.record.name} (${paired.record.platform})`, this.options.now())
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'set-cookie': this.deviceCookie(paired.deviceToken),
      })
      res.end(JSON.stringify({
        deviceToken: paired.deviceToken,
        sessionCookieName: this.options.sessionCookieName,
        device: paired.record,
      }))
    } catch (error) {
      if (!(error instanceof PairingError)) throw error
      this.options.journal.record('pairing-refused', error.message, this.options.now())
      json(res, 401, { error: error.message })
    }
  }

  /** Hold one Server-Sent Events stream open for a paired device. */
  private stream(req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      'connection': 'keep-alive',
      // Proxies that buffer would defeat the point of a notification stream.
      'x-accel-buffering': 'no',
    })
    // Flush the head without inventing a frame: the first thing a device reads
    // must be a real notification, not a greeting it has to learn to skip.
    res.flushHeaders()
    res.socket?.setNoDelay(true)
    res.socket?.setTimeout(0)
    const detach = this.options.bus.attach(
      { write: (frame) => { res.write(frame) } },
      firstHeader(req.headers['last-event-id']),
    )
    const heartbeat = setInterval(() => { res.write(': keep-alive\n\n') }, HEARTBEAT_MS)
    heartbeat.unref()
    const entry = { close: () => { res.end() } }
    this.streams.add(entry)
    const release = (): void => {
      clearInterval(heartbeat)
      detach()
      this.streams.delete(entry)
    }
    res.on('close', release)
    req.on('close', release)
  }

  /** Request headers for the loopback hop: the device's, minus what the edge owns. */
  private upstreamHeaders(req: IncomingMessage, cookie: string): Record<string, string | string[]> {
    const headers: Record<string, string | string[]> = {}
    for (const [name, value] of Object.entries(req.headers)) {
      if (value === undefined || STRIPPED_REQUEST_HEADERS.has(name)) continue
      headers[name] = value
    }
    headers.host = `127.0.0.1:${String(this.options.loopbackPort)}`
    headers.cookie = cookie
    return headers
  }

  /** Pass one authenticated request to the loopback web server and stream the answer back. */
  private async forward(req: IncomingMessage, res: ServerResponse, plantCookie?: string): Promise<void> {
    const cookie = await this.options.session(false)
    const upstream = httpRequest({
      host: '127.0.0.1',
      port: this.options.loopbackPort,
      method: req.method,
      path: req.url ?? '/',
      headers: this.upstreamHeaders(req, cookie),
    }, (answer) => {
      if (answer.statusCode === 401) {
        // The edge's own session lapsed — a fact about the host, not about the
        // device. Say so plainly and re-run the exchange for the next request.
        answer.resume()
        void this.options.session(true).catch((error: unknown) => { this.options.logger.warn(error) })
        text(res, 503, 'the host session is being renewed; retry\n')
        return
      }
      const headers: Record<string, string | string[]> = {}
      for (const [name, value] of Object.entries(answer.headers)) {
        if (value === undefined || STRIPPED_RESPONSE_HEADERS.has(name)) continue
        headers[name] = value
      }
      if (plantCookie !== undefined) headers['set-cookie'] = plantCookie
      res.writeHead(answer.statusCode ?? 502, headers)
      answer.pipe(res)
    })
    upstream.on('error', (error) => {
      this.options.logger.warn(error)
      if (res.headersSent) res.destroy()
      else text(res, 502, 'the harness is not answering\n')
    })
    req.pipe(upstream)
  }

  /** Proxy a protocol upgrade (the streaming RPC socket) for a paired device. */
  private upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const fail = (): void => { socket.destroy() }
    socket.on('error', fail)
    if (!browserFencePasses(req) || this.device(req) === undefined) {
      socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n')
      return
    }
    void this.options.session(false).then((cookie) => {
      const headers = this.upstreamHeaders(req, cookie)
      headers.connection = 'Upgrade'
      const upgradeHeader = firstHeader(req.headers.upgrade)
      if (upgradeHeader !== undefined) headers.upgrade = upgradeHeader
      const upstream = httpRequest({
        host: '127.0.0.1',
        port: this.options.loopbackPort,
        method: req.method,
        path: req.url ?? '/',
        headers,
      })
      upstream.on('upgrade', (answer, upstreamSocket, upstreamHead) => {
        const lines = Object.entries(answer.headers)
          .flatMap(([name, value]) => (Array.isArray(value) ? value : [value ?? '']).map(entry => `${name}: ${entry}`))
        socket.write(`HTTP/1.1 101 ${answer.statusMessage ?? 'Switching Protocols'}\r\n${lines.join('\r\n')}\r\n\r\n`)
        if (upstreamHead.byteLength > 0) socket.write(upstreamHead)
        if (head.byteLength > 0) upstreamSocket.write(head)
        upstreamSocket.pipe(socket)
        socket.pipe(upstreamSocket)
        upstreamSocket.on('error', fail)
      })
      upstream.on('response', () => { socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n') })
      upstream.on('error', (error) => { this.options.logger.warn(error); fail() })
      upstream.end()
    }, (error: unknown) => { this.options.logger.warn(error); fail() })
  }
}
