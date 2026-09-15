import type { PairingDevice, PairingPayload } from './pairing.js';
import { buildPairRequestBody } from './pairing.js';
import type { RemoteEvent } from './eventsMapper.js';

export class RemoteApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'RemoteApiError';
  }
}

export interface PairResponse {
  deviceToken: string;
  sessionCookieName: string;
}

/** `POST <url>/saturn/remote/pair` — exchanges the QR's one-time token for a long-lived device token. */
export async function pairWithHost(payload: PairingPayload, device: PairingDevice): Promise<PairResponse> {
  const body = buildPairRequestBody(payload, device);
  let response: Response;
  try {
    response = await fetch(`${payload.url}/saturn/remote/pair`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (cause) {
    throw new RemoteApiError('could not reach the host — is it on the same network?');
  }
  if (response.status === 401) {
    throw new RemoteApiError('pairing token was rejected (expired or already used)', 401);
  }
  if (!response.ok) {
    throw new RemoteApiError(`pairing failed with status ${response.status}`, response.status);
  }
  const json = (await response.json()) as Partial<PairResponse>;
  if (!json.deviceToken || !json.sessionCookieName) {
    throw new RemoteApiError('host returned a malformed pairing response');
  }
  return { deviceToken: json.deviceToken, sessionCookieName: json.sessionCookieName };
}

/** `DELETE <url>/saturn/remote/devices/<id>` — revokes this device's pairing. */
export async function revokeDevice(hostUrl: string, deviceToken: string, deviceId: string): Promise<void> {
  const response = await fetch(`${hostUrl}/saturn/remote/devices/${encodeURIComponent(deviceId)}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${deviceToken}` },
  });
  if (!response.ok && response.status !== 404) {
    throw new RemoteApiError(`revoke failed with status ${response.status}`, response.status);
  }
}

export type RemoteEventListener = (event: RemoteEvent) => void;

/**
 * Foreground event delivery for `GET <url>/saturn/remote/events`.
 *
 * `EventSource` cannot set an `Authorization` header, so this relies on the
 * session cookie the host sets during `pairWithHost` (`credentials: 'include'`
 * on that request) rather than the bearer token used for one-shot API calls.
 * `pollOnce` is the background-safe fallback used while the app is not
 * foregrounded (see README "Known Limitations" — neither OS keeps an
 * EventSource connection alive in the background without a push service).
 */
export class RemoteEventsClient {
  private source: EventSource | undefined;

  constructor(
    private readonly hostUrl: string,
    private readonly deviceToken: string,
    private readonly onEvent: RemoteEventListener,
    private readonly onError?: (err: unknown) => void,
  ) {}

  start(): void {
    if (this.source) return;
    this.source = new EventSource(`${this.hostUrl}/saturn/remote/events`, { withCredentials: true });
    this.source.onmessage = (message) => {
      try {
        this.onEvent(JSON.parse(message.data) as RemoteEvent);
      } catch (cause) {
        this.onError?.(cause);
      }
    };
    this.source.onerror = (err) => this.onError?.(err);
  }

  stop(): void {
    this.source?.close();
    this.source = undefined;
  }

  /** One bearer-authenticated GET, used for a background poll tick instead of a held-open stream. */
  async pollOnce(): Promise<RemoteEvent[]> {
    const response = await fetch(`${this.hostUrl}/saturn/remote/events?since=poll`, {
      headers: { authorization: `Bearer ${this.deviceToken}`, accept: 'application/json' },
    });
    if (!response.ok) {
      throw new RemoteApiError(`events poll failed with status ${response.status}`, response.status);
    }
    const text = await response.text();
    return parseSseOrJsonEvents(text);
  }
}

/** Accepts either a JSON array (a poll-friendly host) or raw `data: {...}` SSE lines (the same stream, read once). */
export function parseSseOrJsonEvents(payload: string): RemoteEvent[] {
  const trimmed = payload.trim();
  if (trimmed.length === 0) return [];
  if (trimmed.startsWith('[')) {
    return JSON.parse(trimmed) as RemoteEvent[];
  }
  const events: RemoteEvent[] = [];
  for (const line of trimmed.split('\n')) {
    const dataLine = line.trim();
    if (!dataLine.startsWith('data:')) continue;
    try {
      events.push(JSON.parse(dataLine.slice(5).trim()) as RemoteEvent);
    } catch {
      // skip a malformed line rather than drop the whole poll
    }
  }
  return events;
}

/** `GET <url>/` with the device token — used by the offline screen's "check again" and the pairing health check. */
export async function checkHostReachable(hostUrl: string, deviceToken: string): Promise<boolean> {
  try {
    const response = await fetch(hostUrl, {
      headers: { authorization: `Bearer ${deviceToken}` },
      credentials: 'include',
    });
    return response.ok;
  } catch {
    return false;
  }
}
