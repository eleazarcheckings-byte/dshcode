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
 * Reconnecting, and replaying what was missed via `Last-Event-ID`, is
 * `EventSource`'s own behaviour.
 *
 * Foreground only. Neither OS keeps an `EventSource` alive once the app is
 * backgrounded; that path is `backgroundSync.ts` plus the generated
 * `assets/background-runner.js` (README "Background event delivery"), not
 * a method here. This client deliberately has no one-shot poll: the host's
 * events route is SSE-only and never closes on its own
 * (`packages/saturn/remote-access/src/proxy.ts`'s `stream()`), and the
 * router drops query strings before dispatch, so a `fetch` + `text()`
 * "poll" of it never resolves -- the hang Mars r2 (R2-F1) found in the
 * runner, and the trap a former `pollOnce()` here carried until it was
 * removed. `tests/remoteApi.test.ts` pins that.
 */
export class RemoteEventsClient {
  private source: EventSource | undefined;

  constructor(
    private readonly hostUrl: string,
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
