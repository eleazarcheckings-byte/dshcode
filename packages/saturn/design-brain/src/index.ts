/** Optional, durable SaturnAI MCP connection owned by the Host. */
import { Service, type Context, type Fiber } from '@deepseek-ai/cordis'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import Schema from '@deepseek-ai/schemastery'
import * as mcpClient from '@deepseek-ai/dsh-mcp-client'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type { DesignBrainStatus } from './types.ts'
import { DEFAULT_THUMBNAIL_BASE_URL, registerStudyReferencesTool } from './study-references.ts'

export type { DesignBrainStatus } from './types.ts'
export {
  DEFAULT_THUMBNAIL_BASE_URL,
  MAX_SLUGS,
  MAX_THUMBNAIL_BYTES,
  SLUG_PATTERN,
  assertValidSlugs,
  fetchOneThumbnail,
  registerStudyReferencesTool,
  sniffThumbnailMediaType,
  studyReferencesSummary,
} from './study-references.ts'
export type { FetchedThumbnail, MissedThumbnail, StudyReferencesArgs, StudyReferencesValue, ThumbnailMediaType } from './study-references.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { designBrain: DesignBrainService }
}

/** Deployment-owned endpoint and bounded connection costs; clients cannot override them. */
export interface Config {
  /** Streamable HTTP MCP endpoint, without URL credentials or query parameters. */
  endpoint: string
  /** Deadline for the initial handshake and tool registration, in milliseconds. */
  connectTimeoutMs: number
  /** Deadline for each subsequent model tool call, in milliseconds. */
  toolCallTimeoutMs: number
  /** Optional deployment headers, redacted from settings and status responses. */
  headers: Record<string, string>
  /** Base URL (trailing slash) `design_study_references` fetches `<slug>.jpg` thumbnails from. */
  thumbnailBaseUrl: string
}

const PREFIX = 'mcp__saturnai__'
const REQUIRED_TOOLS = [`${PREFIX}compose`, `${PREFIX}review`]
const PREFERENCE = 'saturn-design-brain'

/** Own a single opt-in MCP fiber while preserving independently configured profile rows. */
export default class DesignBrainService extends TypertRemoteService {
  static inject = ['settings', 'tools', 'systemPrompt', 'loader']
  static Config: Schema<Config> = Schema.object({
    endpoint: Schema.string().default('https://saturnai.tools/api/mcp'),
    connectTimeoutMs: Schema.number().step(1).min(100).max(60_000).default(15_000),
    toolCallTimeoutMs: Schema.number().step(1).min(100).max(600_000).default(120_000),
    headers: Schema.dict(String).role('secret').default({}),
    thumbnailBaseUrl: Schema.string().default(DEFAULT_THUMBNAIL_BASE_URL),
  })

  private readonly preference: SettingsScope<{ enabled: boolean }>
  private child: Fiber | undefined
  private tail: Promise<void> = Promise.resolve()
  private stopped = false
  private connecting = false
  private issue: DesignBrainStatus['issue'] = 'none'

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'designBrain')
    const url = new URL(config.endpoint)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error('Design brain endpoint must use HTTP(S) without credentials, query parameters, or fragments.')
    }
    this.preference = ctx.settings.register(PREFERENCE, Schema.object({ enabled: Schema.boolean().default(false) }), { applies: 'restart' })
    ctx.systemPrompt.section({
      name: 'saturn:design-brain', order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA') + 110,
      text: ({ scope }) => {
        if (!mcpClient.isServerConnected(ctx, 'saturnai') || !ctx.tools.schemas(scope).some(tool => tool.name.startsWith(PREFIX))) return ''
        return 'SaturnAI design and brand tools are available through the mcp__saturnai__ namespace. For relevant design work, use the available tools according to their schemas and the user’s brief. Reuse supplied context for focused edits; ask only for decisions that materially affect the result. After compose/search/pick returns reference slugs, call design_study_references to fetch their thumbnails as real images and study them with eyes — named structural moves, never mood adjectives — before writing a direction. Review evaluates the evidence you supply; it does not look at pixels itself, so read your own built screenshots with read_image before calling it, and report tool failures honestly. If a tool becomes unavailable, continue with the bundled premium-output guidance and the tools still available.'
      },
    })
    registerStudyReferencesTool(ctx, { thumbnailBaseUrl: config.thumbnailBaseUrl })
    ctx.effect(() => async () => {
      this.stopped = true
      await this.child?.dispose()
      await this.tail
      this.child = undefined
    }, 'design-brain: connection lifecycle')
  }

  /** Restore an explicit saved opt-in; a fresh profile makes no external request. */
  async [Service.init](): Promise<void> {
    if (this.preference.get().enabled) await this.enqueue(() => this.ensureConnected(false))
  }

  private profileEntry() {
    return [...this.ctx.loader.entries()].find((entry) => {
      const config = entry.options.config as { serverName?: unknown } | undefined
      const mcp = entry.options.name === '@deepseek-ai/dsh-mcp-client' || entry.fiber?.runtime?.callback === mcpClient.apply
      return scopeOf(entry.ctx) === scopeOf(this.ctx) && mcp && config?.serverName === 'saturnai'
    })
  }

  /**
   * Read actual Host registration state without opening a connection or invoking a tool.
   * @returns Current model tool names and who owns the connection.
   */
  @Remote('status')
  status(): DesignBrainStatus {
    if (this.stopped) throw new Error('Design brain connector is closed.')
    const profile = this.profileEntry()
    const tools = this.ctx.tools.schemas().map(tool => tool.name).filter(name => name.startsWith(PREFIX)).sort()
    const enabled = profile === undefined ? this.preference.get().enabled : !profile.disabled
    const ready = mcpClient.isServerConnected(this.ctx, 'saturnai') && REQUIRED_TOOLS.every(name => tools.includes(name))
    let endpoint: string | null = this.config.endpoint
    if (profile !== undefined) {
      const config = profile.options.config as { url?: unknown } | undefined
      try {
        const url = new URL(typeof config?.url === 'string' ? config.url : '')
        endpoint = `${url.origin}${url.pathname}`
      } catch { endpoint = null }
    }
    return {
      state: ready ? 'connected' : this.connecting ? 'connecting' : enabled || profile !== undefined ? 'unavailable' : 'disabled',
      enabled, source: profile === undefined ? 'managed' : 'profile', endpoint, tools,
      issue: ready ? 'none' : tools.length > 0 && !REQUIRED_TOOLS.every(name => tools.includes(name)) ? 'incomplete-tools' : profile !== undefined ? profile.disabled ? 'profile-disabled' : 'profile-unavailable' : this.issue,
    }
  }

  /**
   * Persist opt-in and await real MCP tool registration, or inspect the existing profile connection.
   * @returns Connected only when tools are registered; failures remain explicit and retryable.
   */
  @Remote('connect')
  connect(): Promise<DesignBrainStatus> {
    return this.enqueue(async () => {
      if (this.profileEntry() !== undefined) return this.status()
      await this.preference.update({ enabled: true })
      return this.ensureConnected(true)
    })
  }

  /**
   * Persist opt-out, close the managed connection, and remove its tools.
   * @returns Disabled state after connection disposal completes.
   * @throws RemoteError when an independent profile row owns the connection.
   */
  @Remote('disconnect')
  disconnect(): Promise<DesignBrainStatus> {
    return this.enqueue(async () => {
      if (this.profileEntry() !== undefined) throw new RemoteError('gateway/bad-request', 'This connection is managed by your profile. Disable its SaturnAI MCP row there.', {})
      await this.preference.update({ enabled: false })
      await this.child?.dispose()
      this.child = undefined
      this.issue = 'none'
      return this.status()
    })
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.tail.then(() => {
      if (this.stopped) throw new Error('Design brain connector is closed.')
      return operation()
    })
    this.tail = task.then(() => {}, () => {})
    return task
  }

  private async ensureConnected(retry: boolean): Promise<DesignBrainStatus> {
    if (this.profileEntry() !== undefined || this.status().state === 'connected') return this.status()
    if (this.child !== undefined && !retry) return this.status()
    await this.child?.dispose()
    this.child = undefined
    if (this.stopped) return this.status()
    this.connecting = true
    this.issue = 'none'
    const child = this.ctx.plugin(mcpClient, {
      serverName: 'saturnai', transport: 'streamable-http', url: this.config.endpoint,
      headers: this.config.headers, connectTimeoutMs: this.config.connectTimeoutMs,
      toolCallTimeoutMs: this.config.toolCallTimeoutMs, failOnStartupError: true,
    })
    this.child = child
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const deadline = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => { this.issue = 'timeout'; reject(new Error('Design brain connection timed out.')) }, this.config.connectTimeoutMs)
      })
      await Promise.race([Promise.resolve(child), deadline])
      if (this.status().tools.length === 0) this.issue = 'connection-failed'
    } catch (error) {
      this.issue = error instanceof Error && error.message === 'Design brain connection timed out.' ? 'timeout' : 'connection-failed'
      await child.dispose()
      if (this.child === child) this.child = undefined
    } finally {
      clearTimeout(timer)
      this.connecting = false
    }
    return this.status()
  }
}
