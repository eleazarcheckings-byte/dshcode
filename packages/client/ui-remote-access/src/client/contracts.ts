/**
 * The browser's copy of the remote-access wire shapes, and the one place the
 * generated Remote's result envelope is unwrapped. Declared locally rather
 * than imported from the Host package so the Settings card compiles and tests
 * without the generated artifacts present.
 */

/** How the phone reaches the host. */
export type RemoteMode = 'lan' | 'tunnel'

/** Lifecycle of the remote listener. */
export type RemoteState = 'off' | 'starting' | 'on' | 'failed'

/** Why the listener is not serving, when it is not. */
export type RemoteIssue =
  | 'none' | 'no-lan-address' | 'tunnel-missing' | 'tunnel-failed' | 'listen-failed'

/** One paired device, as the card lists it. */
export interface RemoteDeviceView {
  id: string
  name: string
  platform: string
  pairedAt: string
  lastSeenAt: string | null
}

/** One journalled state change. */
export interface RemoteJournalView {
  at: string
  action: string
  detail?: string
}

/** The QR payload, verbatim as the phone parses it. */
export interface RemotePairingPayload {
  v: 1
  name: string
  url: string
  token: string
  fingerprint?: string
  expires: string
}

/** Everything the card renders. */
export interface RemoteStatusView {
  state: RemoteState
  mode: RemoteMode
  url: string | null
  fingerprint: string | null
  devices: RemoteDeviceView[]
  tunnelAvailable: boolean
  issue: RemoteIssue
  journal: RemoteJournalView[]
}

/** The generated Remote's result envelope. */
export interface RemoteEnvelope<T> {
  /** Whether the transport call succeeded. */
  readonly ok: boolean
  /** The domain value, present whether or not the call succeeded. */
  readonly value: T
}

/** A Host answer: the domain value, or the generated Remote's envelope around it. */
export type Answered<T> = T | RemoteEnvelope<T>

/** The Host operations the card calls. */
export interface RemoteAccessFace {
  status: () => Promise<RemoteStatusView>
  enable: (mode: RemoteMode) => Promise<RemoteStatusView>
  disable: () => Promise<RemoteStatusView>
  pairingCode: () => Promise<RemotePairingPayload>
  revoke: (deviceId: string) => Promise<RemoteStatusView>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Normalize one Host answer. The generated Remote reports transport success
 * separately from the value (`{ ok, value }`); a face supplied directly hands
 * the value back on its own. One unwrap at the boundary keeps every caller
 * above it speaking in domain values.
 * @param answer - the value or envelope the injected face resolved with.
 * @returns the domain value.
 * @throws when the transport reported failure.
 */
export function unwrap<T>(answer: Answered<T>): T {
  if (!isEnvelope(answer)) return answer
  if (!answer.ok) throw new Error('remote-access: the host request failed')
  return answer.value
}

/** Whether one answer is the generated Remote's envelope rather than a bare value. */
function isEnvelope<T>(answer: Answered<T>): answer is RemoteEnvelope<T> {
  return isRecord(answer) && typeof answer.ok === 'boolean' && 'value' in answer
}
