/** Browser-safe administrative records returned by the SaturnBot Remote service. */
import type { BotJson } from './types.ts'

/** One durable long-term memory fact. */
export interface BotMemoryRecord {
  key: string
  value: string
  updatedAt: string
}
/** A locally tracked support ticket. */
export interface BotTicketRecord {
  id: string
  subject: string
  body: string
  status: 'open' | 'pending' | 'closed'
  updatedAt: string
}
/** A signed webhook delivery retained with an idempotent identity. */
export interface BotWebhookRecord {
  deliveryId: string
  source: string
  payload: BotJson
  receivedAt: string
}
