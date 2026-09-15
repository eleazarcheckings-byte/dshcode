import type { KeyValueStorage } from './lib/tokenStore.js'
import type { LocalNotificationDescriptor } from './lib/eventsMapper.js'

export interface LoggedNotification extends LocalNotificationDescriptor {
  receivedAt: string
}

const LOG_KEY = 'saturn.remote.notificationLog'
const MAX_ENTRIES = 100

/** Append-only local history behind the in-app "notifications list" screen (SPEC §8 M3). */
export class NotificationLog {
  constructor(private readonly storage: KeyValueStorage) {}

  async all(): Promise<LoggedNotification[]> {
    const raw = await this.storage.get(LOG_KEY)
    if (!raw) return []
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? (parsed as LoggedNotification[]) : []
    } catch {
      return []
    }
  }

  async record(descriptor: LocalNotificationDescriptor): Promise<LoggedNotification[]> {
    const entries = await this.all()
    entries.unshift({ ...descriptor, receivedAt: new Date().toISOString() })
    const trimmed = entries.slice(0, MAX_ENTRIES)
    await this.storage.set(LOG_KEY, JSON.stringify(trimmed))
    return trimmed
  }

  async clear(): Promise<void> {
    await this.storage.remove(LOG_KEY)
  }
}
