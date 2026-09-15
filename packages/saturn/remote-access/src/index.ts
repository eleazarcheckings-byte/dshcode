/**
 * Remote access: the harness, reachable from the phone in the person's pocket,
 * without moving one byte of it off their machine. The host keeps running on
 * loopback exactly as it does today; this package adds one listener beside it
 * that a paired device — and only a paired device — may speak to, and relays
 * what the device is actually there for: approvals, verdicts, the fleet.
 *
 * Off by default. Turning it on is a decision with a receipt: every state
 * change is journalled, the pairing code expires in ten minutes and is spent
 * once, and any paired device can be revoked from Settings or from another
 * device. Tunnel mode uses a cloudflared the person installed themselves; the
 * harness never downloads a binary.
 *
 * @module @saturnai/dsh-remote-access
 */

import { hostname } from 'node:os'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Service, type Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-user-approval/types'
import { generateSelfSignedCertificate, type IssuedCertificate } from './certificate.ts'
import { DeviceLedger } from './devices.ts'
import { EventBus, type RemoteEventInput } from './events.ts'
import { RemoteJournal } from './journal.ts'
import { lanAddresses } from './network.ts'
import { RemoteProxy } from './proxy.ts'
import { findInstalledCloudflared, startTunnel, type TunnelHandle } from './tunnel.ts'
import type {
  RemoteIssue,
  RemoteMode,
  RemotePairingPayload,
  RemoteState,
  RemoteStatus,
} from './types.ts'

export type {
  RemoteDeviceRecord,
  RemoteEvent,
  RemoteEventType,
  RemoteIssue,
  RemoteJournalEntry,
  RemoteMode,
  RemotePairingPayload,
  RemoteState,
  RemoteStatus,
} from './types.ts'
export { generateSelfSignedCertificate, encodeObjectIdentifier } from './certificate.ts'
export { DeviceLedger, PairingError } from './devices.ts'
export { EventBus, serializeEvent } from './events.ts'
export type { RemoteEventInput } from './events.ts'
export { RemoteJournal } from './journal.ts'
export { lanAddresses } from './network.ts'
export { RemoteProxy } from './proxy.ts'
export { findCloudflared, findInstalledCloudflared, harvestTunnelUrl, startTunnel, tunnelArguments } from './tunnel.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    remoteAccess: RemoteAccessService
  }
}

/** Deployment-owned bounds; a person chooses the mode, not these. */
export interface Config {
  /** Explicit harness home; omitted follows `DSH_HOME`, then `~/.dsh`. */
  dshHome?: string
  /** Interface the LAN listener binds. */
  bindHost: '0.0.0.0' | '127.0.0.1'
  /** Port for the LAN listener; zero asks the operating system. */
  port: number
  /** Display name shown on the phone before it commits to pairing. */
  hostName: string
  /** Pairing-token lifetime in milliseconds. */
  pairingTtlMs: number
  /** Lifetime of the generated certificate, in days. */
  certificateValidityDays: number
  /** How long to wait for cloudflared to publish an address. */
  tunnelTimeoutMs: number
}

const PREFERENCE = 'saturn-remote-access'
const STATE_DIRECTORY = 'remote'
const CERTIFICATE_FILE = 'listener.json'
const SESSION_COOKIE = 'saturn-remote-session'
const CERTIFICATE_RENEW_DAYS = 14
const DAY_MILLISECONDS = 24 * 60 * 60 * 1000

interface StoredCertificate {
  version: 1
  privateKeyPem: string
  certificatePem: string
  fingerprintSha256: string
  ipAddresses: string[]
  dnsNames: string[]
  notAfter: string
}

interface Listener {
  proxy: RemoteProxy
  tunnel?: TunnelHandle
  url: string
  fingerprint: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Read one of the two stores initialized by {@link Service.init}.
 * @param store - the ledger or the journal.
 * @returns the store.
 */
function ready<T>(store: T | undefined): T {
  /* v8 ignore next -- every caller runs after Service.init has assigned both stores. */
  if (store === undefined) throw new Error('remote-access: the listener state is not open yet')
  return store
}

/**
 * The remote-access owner: one optional listener, one device ledger, one
 * notification bus, and the journal that records what changed.
 */
export default class RemoteAccessService extends TypertRemoteService {
  static inject = ['webServer', 'connection', 'settings']
  static Config: Schema<Config> = Schema.object({
    dshHome: Schema.string(),
    bindHost: Schema.union([Schema.const('0.0.0.0'), Schema.const('127.0.0.1')]).default('0.0.0.0'),
    port: Schema.natural().max(65535).default(0),
    hostName: Schema.string().default(''),
    pairingTtlMs: Schema.number().step(1).min(60_000).max(3_600_000).default(600_000),
    certificateValidityDays: Schema.number().step(1).min(1).max(825).default(397),
    tunnelTimeoutMs: Schema.number().step(1).min(1000).max(120_000).default(30_000),
  })

  private readonly directory: string
  private readonly preference: SettingsScope<{ enabled: boolean; mode: RemoteMode }>
  private readonly bus = new EventBus()
  private ledger: DeviceLedger | undefined
  private journal: RemoteJournal | undefined
  private listener: Listener | undefined
  private certificate: IssuedCertificate | undefined
  private session: string | undefined
  private sessionPending: Promise<string> | undefined
  private state: RemoteState = 'off'
  private issue: RemoteIssue = 'none'
  private tail: Promise<void> = Promise.resolve()
  private stopped = false

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'remoteAccess')
    this.directory = join(resolveDshHome(config.dshHome), STATE_DIRECTORY)
    this.preference = ctx.settings.register(PREFERENCE, Schema.object({
      enabled: Schema.boolean().default(false),
      mode: Schema.union([Schema.const('lan'), Schema.const('tunnel')]).default('lan'),
    }), { applies: 'live' })

    // Observe the approval question; never answer it. The waterfall hands the
    // decision straight on, so remote access can be switched on mid-session
    // without changing what the harness asks or who answers.
    ctx.on('approval/request', async (request, next) => {
      this.bus.publish({
        type: 'approval',
        title: `Approval needed · ${request.toolName}`,
        body: request.reason ?? 'The agent is waiting for a decision before it runs this tool.',
      }, Date.now())
      return await next()
    })

    ctx.effect(() => async () => {
      this.stopped = true
      await this.enqueue(async () => { await this.stopListener() })
      await this.ledger?.checkpoint()
      await this.journal?.drain()
    }, 'remote-access: listener lifecycle')
  }

  /** Restore an explicit saved opt-in; a fresh profile opens no listener. */
  async [Service.init](): Promise<void> {
    this.ledger = await DeviceLedger.open(this.directory)
    this.journal = await RemoteJournal.open(this.directory)
    const saved = this.preference.get()
    if (saved.enabled) await this.enqueue(() => this.startListener(saved.mode))
  }

  /**
   * The listener's current state, its address, and the devices that may reach it.
   * @returns the full status the Settings card renders.
   */
  @Remote('status')
  status(): RemoteStatus {
    const saved = this.preference.get()
    return {
      state: this.state,
      mode: saved.mode,
      url: this.listener?.url ?? null,
      fingerprint: this.listener?.fingerprint ?? null,
      devices: this.ledger?.list() ?? [],
      tunnelAvailable: findInstalledCloudflared() !== undefined,
      issue: this.issue,
      journal: this.journal?.entries() ?? [],
    }
  }

  /**
   * Open the listener in one mode and remember the choice.
   * @param mode - `lan` for a pinned certificate on the local network, `tunnel` for cloudflared.
   * @returns the status after the attempt; a failure is reported, not thrown.
   */
  @Remote('enable')
  async enable(mode: RemoteMode): Promise<RemoteStatus> {
    await this.preference.update({ enabled: true, mode })
    return await this.enqueue(async () => {
      await this.stopListener()
      await this.startListener(mode)
      return this.status()
    })
  }

  /**
   * Close the listener; paired devices stay paired and reconnect when it reopens.
   * @returns the status after the listener is down.
   */
  @Remote('disable')
  async disable(): Promise<RemoteStatus> {
    await this.preference.update({ enabled: false })
    return await this.enqueue(async () => {
      await this.stopListener()
      ready(this.journal).record('disabled', undefined, Date.now())
      return this.status()
    })
  }

  /**
   * Mint a fresh pairing code for the QR. Any code issued earlier stops working.
   * @returns the payload the phone scans.
   * @throws {RemoteError} when the listener is not open.
   */
  @Remote('pairingCode')
  async pairingCode(): Promise<RemotePairingPayload> {
    const listener = this.listener
    if (listener === undefined || this.state !== 'on') {
      throw new RemoteError('gateway/bad-request', 'Turn remote access on before pairing a device.', {})
    }
    const now = Date.now()
    await Promise.resolve()
    const ledger = ready(this.ledger)
    ledger.clearPairingTokens()
    const token = ledger.issuePairingToken(now, this.config.pairingTtlMs)
    ready(this.journal).record('pairing-issued', undefined, now)
    return {
      v: 1,
      name: this.displayName(),
      url: listener.url,
      token,
      ...listener.fingerprint === null ? {} : { fingerprint: listener.fingerprint },
      expires: new Date(now + this.config.pairingTtlMs).toISOString(),
    }
  }

  /**
   * Revoke one paired device; its token stops working at once.
   * @param deviceId - the ledger row id from {@link status}.
   * @returns the status with the device gone.
   */
  @Remote('revokeDevice')
  async revokeDevice(deviceId: string): Promise<RemoteStatus> {
    if (await ready(this.ledger).revoke(deviceId)) ready(this.journal).record('revoked', 'device', Date.now())
    return this.status()
  }

  /**
   * Publish one notification to every attached device. Other Saturn packages
   * reach this duck-typed (`ctx.get('remoteAccess')?.publish(...)`), so a
   * composition without remote access costs them nothing.
   * @param event - the frame's type and copy.
   */
  publish(event: RemoteEventInput): void {
    this.bus.publish(event, Date.now())
  }

  /** The name shown on the phone before it commits to pairing. */
  private displayName(): string {
    return this.config.hostName !== '' ? this.config.hostName : hostname()
  }

  /** Serialize lifecycle transitions so two clicks cannot open two listeners. */
  private async enqueue<T>(work: () => Promise<T>): Promise<T> {
    const pending = this.tail.then(work)
    this.tail = pending.then(() => {}, () => {})
    return await pending
  }

  /**
   * The upstream browser session. Connection owns browser authentication, so
   * the edge borrows it through the same launch-token exchange the desktop
   * window performs — there is no second credential and no forked auth path.
   */
  private async browserSession(force: boolean): Promise<string> {
    if (!force && this.session !== undefined) return this.session
    if (force) this.session = undefined
    this.sessionPending ??= (async () => {
      const origin = `http://127.0.0.1:${String(this.ctx.webServer.port)}`
      const response = await fetch(this.ctx.connection.authenticatedUrl(origin), { redirect: 'manual' })
      const header = typeof response.headers.getSetCookie === 'function'
        ? response.headers.getSetCookie()[0]
        : response.headers.get('set-cookie') ?? undefined
      const pair = header?.split(';', 1)[0]
      if (pair === undefined || !pair.includes('=')) {
        throw new Error('remote-access: the loopback server issued no browser session')
      }
      this.session = pair
      return pair
    })().finally(() => { this.sessionPending = undefined })
    return await this.sessionPending
  }

  /** Reuse the stored certificate while it still covers every address and is not near expiry. */
  private async ensureCertificate(ipAddresses: string[], dnsNames: string[]): Promise<IssuedCertificate> {
    const covers = (candidate: IssuedCertificate): boolean =>
      ipAddresses.every(address => candidate.ipAddresses.includes(address))
      && dnsNames.every(name => candidate.dnsNames.includes(name))
    if (this.certificate !== undefined && covers(this.certificate)) return this.certificate
    const file = join(this.directory, CERTIFICATE_FILE)
    try {
      const stored: unknown = JSON.parse(await readFile(file, 'utf8'))
      if (isRecord(stored) && stored.version === 1
        && typeof stored.privateKeyPem === 'string' && typeof stored.certificatePem === 'string'
        && typeof stored.fingerprintSha256 === 'string' && typeof stored.notAfter === 'string'
        && Array.isArray(stored.ipAddresses) && Array.isArray(stored.dnsNames)
        && Date.parse(stored.notAfter) - Date.now() > CERTIFICATE_RENEW_DAYS * DAY_MILLISECONDS) {
        const candidate: IssuedCertificate = {
          privateKeyPem: stored.privateKeyPem,
          certificatePem: stored.certificatePem,
          fingerprintSha256: stored.fingerprintSha256,
          ipAddresses: stored.ipAddresses.filter((entry): entry is string => typeof entry === 'string'),
          dnsNames: stored.dnsNames.filter((entry): entry is string => typeof entry === 'string'),
        }
        if (covers(candidate)) {
          this.certificate = candidate
          return candidate
        }
      }
    } catch {
      // No usable certificate on disk; mint one below. A device paired against
      // a previous certificate re-pairs, which is the honest outcome of the
      // host's identity having changed.
    }
    const issued = generateSelfSignedCertificate({
      commonName: this.displayName(),
      ipAddresses,
      dnsNames,
      validityDays: this.config.certificateValidityDays,
      now: new Date(),
    })
    const stored: StoredCertificate = {
      version: 1,
      privateKeyPem: issued.privateKeyPem,
      certificatePem: issued.certificatePem,
      fingerprintSha256: issued.fingerprintSha256,
      ipAddresses: [...issued.ipAddresses],
      dnsNames: [...issued.dnsNames],
      notAfter: new Date(Date.now() + this.config.certificateValidityDays * DAY_MILLISECONDS).toISOString(),
    }
    await writeFile(join(this.directory, CERTIFICATE_FILE), `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 })
    ready(this.journal).record('certificate-issued', issued.fingerprintSha256.slice(0, 12), Date.now())
    this.certificate = issued
    return issued
  }

  private proxyOptions(): Omit<Parameters<typeof RemoteProxy.start>[0], 'bindHost' | 'port' | 'tls' | 'secureCookies'> {
    return {
      loopbackPort: this.ctx.webServer.port,
      ledger: ready(this.ledger),
      bus: this.bus,
      journal: ready(this.journal),
      sessionCookieName: SESSION_COOKIE,
      session: force => this.browserSession(force),
      now: () => Date.now(),
      logger: { warn: (error) => { this.ctx.logger.warn(error instanceof Error ? error : new Error(String(error))) } },
    }
  }

  /** Record a failed open, keeping the first, more specific reason when there is one. */
  private markFailed(fallback: RemoteIssue): void {
    this.state = 'failed'
    const current: RemoteIssue = this.issue
    if (current === 'none') this.issue = fallback
  }

  private async startListener(mode: RemoteMode): Promise<void> {
    if (this.stopped) return
    this.state = 'starting'
    this.issue = 'none'
    try {
      // Establish the upstream session before anything is reachable: a listener
      // that cannot reach the app is worse than one that never opened.
      await this.browserSession(true)
      if (mode === 'tunnel') await this.startTunnelListener()
      else await this.startLanListener()
    } catch (error) {
      this.ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
      await this.stopListener()
      this.markFailed('listen-failed')
      ready(this.journal).record('listen-failed', undefined, Date.now())
    }
  }

  private async startLanListener(): Promise<void> {
    const addresses = lanAddresses()
    if (addresses.length === 0) this.issue = 'no-lan-address'
    const ipAddresses = [...new Set([...addresses.map(entry => entry.address), '127.0.0.1'])]
    const certificate = await this.ensureCertificate(ipAddresses, ['localhost'])
    const proxy = await RemoteProxy.start({
      ...this.proxyOptions(),
      bindHost: this.config.bindHost,
      port: this.config.port,
      tls: { key: certificate.privateKeyPem, cert: certificate.certificatePem },
      secureCookies: true,
    })
    const advertise = addresses[0]?.address ?? '127.0.0.1'
    this.listener = {
      proxy,
      url: `https://${advertise}:${String(proxy.port)}`,
      fingerprint: certificate.fingerprintSha256,
    }
    this.state = 'on'
    ready(this.journal).record('enabled', 'lan', Date.now())
  }

  private async startTunnelListener(): Promise<void> {
    const binary = findInstalledCloudflared()
    if (binary === undefined) {
      this.state = 'failed'
      this.issue = 'tunnel-missing'
      ready(this.journal).record('tunnel-missing', undefined, Date.now())
      return
    }
    // The tunnel terminates TLS itself, so the edge behind it speaks plain
    // HTTP on loopback — and binds loopback only, so the tunnel is the one way in.
    const proxy = await RemoteProxy.start({
      ...this.proxyOptions(),
      bindHost: '127.0.0.1',
      port: 0,
      secureCookies: true,
    })
    const tunnel = await startTunnel({
      binary,
      port: proxy.port,
      timeoutMs: this.config.tunnelTimeoutMs,
    })
    if (tunnel === undefined) {
      await proxy.stop()
      this.state = 'failed'
      this.issue = 'tunnel-failed'
      ready(this.journal).record('tunnel-failed', undefined, Date.now())
      return
    }
    this.listener = { proxy, tunnel, url: tunnel.url, fingerprint: null }
    this.state = 'on'
    ready(this.journal).record('enabled', 'tunnel', Date.now())
  }

  private async stopListener(): Promise<void> {
    const listener = this.listener
    this.listener = undefined
    this.state = 'off'
    this.ledger?.clearPairingTokens()
    if (listener === undefined) return
    await listener.tunnel?.stop()
    await listener.proxy.stop()
    ready(this.journal).record('listener-closed', undefined, Date.now())
  }
}
