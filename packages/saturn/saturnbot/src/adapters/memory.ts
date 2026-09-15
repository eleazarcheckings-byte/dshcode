/** Durable local memory, support tickets, and deduplicated signed-webhook receipts. */
import { lstat, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import type { BotTool } from '../contracts.ts'
import type { BotJson } from '../types.ts'
import type { BotToolOptions } from '../tools.ts'
import { boundedRows, json, MAX_ADAPTER_BYTES, redact, tool } from './shared.ts'

const memoryRecord = z.object({ key: z.string(), value: z.string(), updatedAt: z.string() })
const ticketRecord = z.object({ id: z.string(), subject: z.string(), body: z.string(), status: z.enum(['open', 'pending', 'closed']), updatedAt: z.string() })
const webhookRecord = z.object({
  deliveryId: z.string(), source: z.string(),
  payload: z.string().transform((value): BotJson => json(JSON.parse(value))), receivedAt: z.string(),
})

/** A durable memory entry returned by the read-only dashboard query. */
export type BotMemoryEntry = z.infer<typeof memoryRecord>
/** A validated support ticket retained locally. */
export type BotSupportTicket = z.infer<typeof ticketRecord>
/** A webhook receipt admitted by the Host signature verifier. */
export type BotWebhookReceipt = z.infer<typeof webhookRecord>

/** A delivery ID already identifies different authenticated webhook content. */
export class WebhookConflictError extends Error {
  constructor() { super('Webhook delivery identity was reused with different content.'); this.name = 'WebhookConflictError' }
}

/** Opens SQLite lazily for each bounded operation; no connection outlives its method. */
export class BotDataStore {
  private readonly directory: string
  constructor(dataDirectory: string) { this.directory = resolve(dataDirectory) }

  private async withDatabase<T>(operation: (database: DatabaseSync) => T): Promise<T> {
    await mkdir(this.directory, { recursive: true })
    const path = join(this.directory, 'knowledge.sqlite')
    try {
      if ((await lstat(path)).isSymbolicLink()) throw new Error('Knowledge database cannot be a symlink.')
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const { DatabaseSync: SQLite } = await import('node:sqlite')
    const database = new SQLite(path, { timeout: 5000 })
    try {
      database.exec(`
        CREATE TABLE IF NOT EXISTS memory (key TEXT PRIMARY KEY, value TEXT NOT NULL, updatedAt TEXT NOT NULL) STRICT;
        CREATE TABLE IF NOT EXISTS tickets (id TEXT PRIMARY KEY, subject TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('open','pending','closed')), updatedAt TEXT NOT NULL) STRICT;
        CREATE TABLE IF NOT EXISTS webhooks (deliveryId TEXT PRIMARY KEY, source TEXT NOT NULL, payload TEXT NOT NULL, receivedAt TEXT NOT NULL) STRICT;
      `)
      return operation(database)
    } finally { database.close() }
  }

  /** Search bounded memory values using parameterized SQL.
   * @param query - Literal substring, not SQL.
   * @param limit - Maximum entries, between one and one hundred.
   * @returns matching entries, newest first.
   */
  async searchMemory(query = '', limit = 20): Promise<BotMemoryEntry[]> {
    const input = z.object({ query: z.string().max(2000), limit: z.number().int().min(1).max(100) }).parse({ query, limit })
    return await this.withDatabase(db => z.array(memoryRecord).parse(db.prepare('SELECT key,value,updatedAt FROM memory WHERE instr(key, ?) > 0 OR instr(value, ?) > 0 ORDER BY updatedAt DESC,key LIMIT ?').all(input.query, input.query, input.limit)))
  }

  /** Upsert a bounded memory value.
   * @param key - Stable entry identity.
   * @param value - Text the agent deliberately chose to retain.
   * @returns persisted entry.
   */
  async writeMemory(key: string, value: string): Promise<BotMemoryEntry> {
    const entry = memoryRecord.parse({
      key: z.string().min(1).max(200).parse(key), value: z.string().max(16_384).parse(value), updatedAt: new Date().toISOString(),
    })
    await this.withDatabase(db => db.prepare('INSERT INTO memory (key,value,updatedAt) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedAt=excluded.updatedAt').run(entry.key, entry.value, entry.updatedAt))
    return entry
  }

  /** List current support tickets with an optional status filter.
   * @param status - A supported ticket status or all.
   * @param limit - Maximum returned rows.
   * @returns validated tickets, newest first.
   */
  async listTickets(status: 'open' | 'pending' | 'closed' | 'all' = 'open', limit = 20): Promise<BotSupportTicket[]> {
    z.enum(['open', 'pending', 'closed', 'all']).parse(status)
    z.number().int().min(1).max(100).parse(limit)
    return await this.withDatabase(db => z.array(ticketRecord).parse(db.prepare("SELECT id,subject,body,status,updatedAt FROM tickets WHERE ? = 'all' OR status = ? ORDER BY updatedAt DESC,id LIMIT ?").all(status, status, limit)))
  }

  /** Persist one deliberate support-ticket update.
   * @param value - Ticket identity, content, and explicit status.
   * @returns persisted ticket with its update timestamp.
   */
  async upsertTicket(value: Omit<BotSupportTicket, 'updatedAt'>): Promise<BotSupportTicket> {
    const entry = ticketRecord.parse({ ...value, updatedAt: new Date().toISOString() })
    z.string().min(1).max(200).parse(entry.id)
    z.string().min(1).max(300).parse(entry.subject)
    z.string().max(16_384).parse(entry.body)
    await this.withDatabase(db => db.prepare('INSERT INTO tickets (id,subject,body,status,updatedAt) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET subject=excluded.subject,body=excluded.body,status=excluded.status,updatedAt=excluded.updatedAt').run(entry.id, entry.subject, entry.body, entry.status, entry.updatedAt))
    return entry
  }

  /** Persist an authenticated webhook exactly once; changed duplicate payloads are rejected.
   * @param deliveryId - Provider delivery identity checked by the ingress route.
   * @param source - Configured provider/source name.
   * @param payload - Parsed JSON from the exact signed request body.
   * @returns whether a new durable receipt was inserted.
   */
  async ingestWebhook(deliveryId: string, source: string, payload: BotJson): Promise<{ inserted: boolean }> {
    z.string().min(1).max(200).parse(deliveryId)
    z.string().min(1).max(200).parse(source)
    const body = JSON.stringify(json(payload))
    if (Buffer.byteLength(body) > MAX_ADAPTER_BYTES) throw new Error('Webhook payload exceeds the permitted size.')
    return await this.withDatabase((db) => {
      db.exec('BEGIN IMMEDIATE')
      try {
        const existing = db.prepare('SELECT source,payload FROM webhooks WHERE deliveryId = ?').get(deliveryId)
        if (existing !== undefined) {
          if (existing.source !== source || existing.payload !== body) throw new WebhookConflictError()
          db.exec('COMMIT')
          return { inserted: false }
        }
        db.prepare('INSERT INTO webhooks (deliveryId,source,payload,receivedAt) VALUES (?,?,?,?)').run(deliveryId, source, body, new Date().toISOString())
        db.exec('COMMIT')
        return { inserted: true }
      } catch (error) { db.exec('ROLLBACK'); throw error }
    })
  }

  /** Read recent authenticated webhook receipts.
   * @param limit - Maximum receipts, between one and one hundred.
   * @returns newest receipts with parsed JSON payloads.
   */
  async listWebhooks(limit = 20): Promise<BotWebhookReceipt[]> {
    z.number().int().min(1).max(100).parse(limit)
    return await this.withDatabase(db => z.array(webhookRecord).parse(db.prepare('SELECT deliveryId,source,payload,receivedAt FROM webhooks ORDER BY receivedAt DESC,deliveryId LIMIT ?').all(limit)))
  }
}

/** Build local memory and operations tools over the shared durable data store.
 * @param options - Host data directory and redaction environment.
 * @returns validated definitions including read-only evaluation inputs.
 */
export function createMemoryTools(options: BotToolOptions): BotTool[] {
  const store = new BotDataStore(options.dataDirectory)
  const roles = ['orchestrator', 'developer', 'growth', 'operations', 'finance'] as const
  return [
    tool({ name: 'memory.search', description: 'Search long-term local memory by literal text.', roles, effect: 'read', retry: 'safe', evaluationInput: { query: '', limit: 20 } }, { query: z.string().max(2000).default(''), limit: z.number().int().min(1).max(100).default(20) }, async ({ query, limit }, context) => {
      const entries = await store.searchMemory(query, limit)
      return { summary: `Found ${entries.length} memory entries.`, data: boundedRows(entries.map(entry => ({ ...entry, value: redact(entry.value, options, context) }))) }
    }),
    tool({ name: 'memory.write', description: 'Retain an explicit long-term local memory entry.', roles, effect: 'memory', retry: 'idempotent' }, { key: z.string().min(1).max(200), value: z.string().max(16_384) }, async ({ key, value }, context) => ({ summary: `Saved memory entry ${key}.`, data: json(await store.writeMemory(key, redact(value, options, context))) })),
    tool({ name: 'tickets.list', description: 'List local support tickets by status.', roles: ['orchestrator', 'operations'], effect: 'read', retry: 'safe', evaluationInput: { status: 'open', limit: 20 } }, { status: z.enum(['open', 'pending', 'closed', 'all']).default('open'), limit: z.number().int().min(1).max(100).default(20) }, async ({ status, limit }, context) => {
      const tickets = await store.listTickets(status, limit)
      return { summary: `Found ${tickets.length} support tickets.`, data: boundedRows(tickets.map(ticket => ({ ...ticket, body: redact(ticket.body, options, context) }))) }
    }),
    tool({ name: 'tickets.upsert', description: 'Create or update a local support ticket.', roles: ['operations'], effect: 'memory', retry: 'idempotent' }, { id: z.string().min(1).max(200), subject: z.string().min(1).max(300), body: z.string().max(16_384), status: z.enum(['open', 'pending', 'closed']) }, async (input, context) => ({ summary: `Saved support ticket ${input.id}.`, data: json(await store.upsertTicket({ ...input, body: redact(input.body, options, context) })) })),
    tool({ name: 'webhook.inbox', description: 'Read recent authenticated, deduplicated webhook deliveries.', roles: ['orchestrator', 'operations'], effect: 'read', retry: 'safe', evaluationInput: { limit: 20 } }, { limit: z.number().int().min(1).max(100).default(20) }, async ({ limit }, context) => {
      const receipts = await store.listWebhooks(limit)
      return { summary: `Read ${receipts.length} authenticated webhook receipts.`, data: boundedRows(receipts.map(receipt => ({ ...receipt, payload: redact(JSON.stringify(receipt.payload), options, context) }))) }
    }),
  ]
}
