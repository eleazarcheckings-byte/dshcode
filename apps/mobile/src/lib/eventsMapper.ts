/**
 * Maps a `GET <url>/saturn/remote/events` SSE payload (SPEC §8 pairing
 * contract) to a local-notification descriptor. Keeps the host's own
 * verdict-card language ("Verdict PASS", "Approval needed", "SaturnBot
 * needs you") so the phone reads the same object as the desktop.
 */

export type RemoteEventType = 'approval' | 'verdict' | 'fleet' | 'saturnbot';

export interface RemoteEvent {
  type: RemoteEventType;
  title: string;
  body: string;
  sessionId?: string;
  id: string;
  at: string;
}

export interface LocalNotificationDescriptor {
  id: number;
  title: string;
  body: string;
  extra: {
    deepLink: string;
    eventId: string;
    type: RemoteEventType;
  };
}

type Verdict = 'PASS' | 'REVISE' | 'REJECT';

const VERDICT_TITLE: Record<Verdict, string> = {
  PASS: 'Verdict PASS',
  REVISE: 'Verdict REVISE',
  REJECT: 'Verdict REJECT',
};

const VERDICT_PATTERN = /\b(PASS|REVISE|REJECT)\b/;

const DEFAULT_TITLE: Partial<Record<RemoteEventType, string>> = {
  approval: 'Approval needed',
  saturnbot: 'SaturnBot needs you',
};

function detectVerdict(text: string): Verdict | undefined {
  const match = VERDICT_PATTERN.exec(text);
  return match ? (match[1] as Verdict) : undefined;
}

/** Stable, non-negative 31-bit hash so re-delivered events reuse (and replace) the same OS notification id. */
function hashToNotificationId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return hash % 2147483647;
}

export function deepLinkFor(event: Pick<RemoteEvent, 'sessionId' | 'type' | 'id'>): string {
  if (event.sessionId) {
    return `saturn://session/${encodeURIComponent(event.sessionId)}`;
  }
  return `saturn://event/${encodeURIComponent(event.id)}`;
}

export function mapEventToNotification(event: RemoteEvent): LocalNotificationDescriptor {
  let title = event.title;

  if (event.type === 'verdict') {
    const verdict = detectVerdict(event.body) ?? detectVerdict(event.title);
    if (verdict) title = VERDICT_TITLE[verdict];
  }

  if (!title) {
    title = DEFAULT_TITLE[event.type] ?? event.type;
  }

  return {
    id: hashToNotificationId(event.id),
    title,
    body: event.body,
    extra: {
      deepLink: deepLinkFor(event),
      eventId: event.id,
      type: event.type,
    },
  };
}
