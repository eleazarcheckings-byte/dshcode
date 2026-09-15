import type { LoggedNotification } from '../notificationLog.js'

function verdictKind(title: string): 'pass' | 'revise' | 'reject' | undefined {
  if (title.includes('PASS')) return 'pass'
  if (title.includes('REVISE')) return 'revise'
  if (title.includes('REJECT')) return 'reject'
  return undefined
}

function relativeTime(iso: string): string {
  const deltaMs = Date.now() - Date.parse(iso)
  const minutes = Math.round(deltaMs / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export function renderNotificationList(
  list: HTMLElement,
  emptyState: HTMLElement,
  entries: LoggedNotification[],
): void {
  list.innerHTML = ''
  emptyState.hidden = entries.length > 0

  for (const entry of entries) {
    const item = document.createElement('li')
    item.className = 'verdict-card'
    const kind = verdictKind(entry.title)
    if (kind) item.dataset.kind = kind
    item.dataset.deepLink = entry.extra.deepLink

    const title = document.createElement('p')
    title.className = 'verdict-card__title'
    title.textContent = entry.title

    const body = document.createElement('p')
    body.className = 'verdict-card__body'
    body.textContent = entry.body

    const meta = document.createElement('p')
    meta.className = 'verdict-card__meta'
    meta.textContent = `${entry.extra.type} · ${relativeTime(entry.receivedAt)}`

    item.append(title, body, meta)
    list.appendChild(item)
  }
}
