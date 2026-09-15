/** Plain dashboard values and operations supplied by the SaturnBot Client model. */
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { BotConfig, BotEvent, BotId, BotMemoryRecord, BotRole, BotSnapshot, BotTicketRecord, BotWebhookRecord } from '@saturnai/dsh-saturnbot/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { NS } from './locales.ts'

/** Latest server projection and transport presentation state. */
export interface SaturnBotViewState {
  readonly snapshot: BotSnapshot | null
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
}

/** Complete slot-derived entry props. */
export type SaturnBotEntryProps = PropsRuntime<'shell.overlay'> & PropsLocale<typeof NS> & InjectFace<SaturnBotInjected>

/** Pure dashboard props; fixture tests do not require a Remote server. */
export interface DashboardProps extends PropsLocale<typeof NS> {
  state: SaturnBotViewState
  workspaces: readonly WorkspaceView[]
  actions: SaturnBotActions
}

/** Stable dashboard navigation destinations. */
export type BotPage = 'overview' | 'agents' | 'runs' | 'approvals' | 'memory' | 'connections' | 'settings'
