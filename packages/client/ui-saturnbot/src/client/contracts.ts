/** Plain dashboard values and operations supplied by the SaturnBot Client model. */
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { BotConfig, BotEvent, BotId, BotMemoryRecord, BotRole, BotSnapshot, BotTicketRecord, BotWebhookRecord } from '@saturnai/dsh-saturnbot/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { NS } from './locales.ts'

/**
 * One credential the runtime resolved (or did not) for the current configuration
 * (SPEC "SaturnBot snapshot" contract, C8a -> C8b). Local mirror: C8a has not shipped
 * this field on `BotSnapshot` yet, so it stays optional here and the orchestrator
 * reconciles any drift once the runtime's own type carries it.
 */
export interface SaturnBotFirstRunCredential {
  readonly name: string
  readonly env: string
  readonly present: boolean
}

/**
 * First-run guidance the wizard uses to resume at the right step and to explain
 * what is missing (SPEC §3 C8a item 7). Optional on `BotSnapshot` for the same
 * reason as `SaturnBotFirstRunCredential`.
 */
export interface SaturnBotFirstRun {
  readonly goal: string
  readonly workspace: string
  readonly provider: string
  readonly credentials: readonly SaturnBotFirstRunCredential[]
  /**
   * Path a resolved credential's value should be pasted into (e.g. `<dataDirectory>/.env`).
   * Not named in the SPEC §4 contract; until C8a's snapshot carries it, the connect
   * forms fall back to naming only the environment variable (see `connect.envHint`
   * in locales.ts). Declared as a deviation in the Agent Note.
   */
  readonly envPath?: string
}

/** One BotConfig.integrations field key the runtime's fixed integration record admits. */
export type SaturnBotIntegrationFieldKey = 'endpoint' | 'credentialEnv' | 'resource'

/**
 * One field of a generated connect form (SPEC §3 C8a item 7 / §3 C8b). `key` is a
 * plain `string`, not narrowed to `SaturnBotIntegrationFieldKey`: SPEC §4's C8a
 * contract puts no constraint on `fields[].key`, so a future catalog entry may name a
 * key the runtime's fixed `BotConfig.integrations` record does not yet admit (e.g. a
 * `telegram` entry's `chatId`). `ConnectForms.tsx` renders only the admitted keys as
 * editable and shows every other key as an unsupported, disabled field rather than a
 * live input whose edits `safeParseIntegrations` would silently discard.
 */
export interface SaturnBotIntegrationField {
  readonly key: string
  readonly label: string
  /** Secret fields never carry an editable value; only the required env var name is shown. */
  readonly secret: boolean
  /** Environment variable name to set (meaningful, non-empty, only when `secret`). */
  readonly env: string
}

/** One integration's generated connect form (matches a `BotConfig.integrations` key). */
export interface SaturnBotIntegrationCatalogEntry {
  readonly name: string
  readonly label: string
  readonly fields: readonly SaturnBotIntegrationField[]
  readonly docsUrl: string
}

/**
 * `BotSnapshot` as SPEC §3 C8a item 7 extends it. Both members stay optional: this
 * package is coded against the documented shape ahead of C8a landing it, and older
 * snapshots (or a snapshot from a harness build predating C8a) simply omit them —
 * every reader in this package degrades to the pre-wizard behavior in that case.
 */
export type SaturnBotSnapshot = BotSnapshot & {
  readonly firstRun?: SaturnBotFirstRun
  readonly integrationCatalog?: readonly SaturnBotIntegrationCatalogEntry[]
}

/** Latest server projection and transport presentation state. */
export interface SaturnBotViewState {
  readonly snapshot: SaturnBotSnapshot | null
  readonly events: readonly BotEvent[]
  readonly loading: boolean
  readonly error: string | null
  readonly memory: readonly BotMemoryRecord[]
  readonly tickets: readonly BotTicketRecord[]
  readonly webhooks: readonly BotWebhookRecord[]
  readonly recordsLoading: boolean
}

/** Commands reject with a user-displayable error and publish successful state through the model. */
export interface SaturnBotActions {
  refresh: () => Promise<void>
  configure: (input: Partial<BotConfig>) => Promise<void>
  runNow: () => Promise<void>
  pause: () => Promise<void>
  cancel: () => Promise<void>
  approve: (id: BotId, allowed: boolean) => Promise<void>
  message: (role: BotRole, content: string) => Promise<void>
  loadMoreEvents: () => Promise<void>
  loadRecords: (query: string) => Promise<void>
}

/** Root inject face; the renderer binds the observable into useBot. */
export interface SaturnBotInjected extends SaturnBotActions {
  hooks: { bot: HostObservable<SaturnBotViewState> }
  standalone: boolean
  openWindow(): Promise<boolean>
  /**
   * Open the Host-native directory picker (`ctx.uiWorkspace.pickDirectory()`) for the
   * wizard's workspace step. Resolves `null` on cancellation; rejects when no chooser
   * is available (e.g. a browser-only build) — callers keep the manual path in that case.
   */
  pickDirectory(): Promise<string | null>
}

/** Complete slot-derived entry props. */
export type SaturnBotEntryProps = PropsRuntime<'shell.overlay'> & PropsLocale<typeof NS> & InjectFace<SaturnBotInjected>

/** Pure dashboard props; fixture tests do not require a Remote server. */
export interface DashboardProps extends PropsLocale<typeof NS> {
  state: SaturnBotViewState
  workspaces: readonly WorkspaceView[]
  actions: SaturnBotActions
  /** Threaded to the first-run wizard's workspace step; see `SaturnBotInjected.pickDirectory`. */
  pickDirectory: () => Promise<string | null>
}

/** Stable dashboard navigation destinations. */
export type BotPage = 'overview' | 'agents' | 'runs' | 'approvals' | 'memory' | 'connections' | 'settings'
