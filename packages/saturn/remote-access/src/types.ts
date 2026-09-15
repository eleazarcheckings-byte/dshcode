/**
 * Wire-safe remote-access vocabulary, free of node and cordis imports so the
 * browser half can consume the same shapes the Host publishes.
 * @module @saturnai/dsh-remote-access/types
 */

/** How the phone reaches this host: over the local network, or through a tunnel. */
export type RemoteMode = 'lan' | 'tunnel'

/** Lifecycle of the remote listener. */
export type RemoteState = 'off' | 'starting' | 'on' | 'failed'

/** Why the listener is not serving, when it is not. */
export type RemoteIssue =
  | 'none'
  /** No non-loopback IPv4 interface was found; the published address is loopback only. */
  | 'no-lan-address'
  /** Tunnel mode was asked for and no cloudflared is installed. */
  | 'tunnel-missing'
  /** cloudflared started but published no address. */
  | 'tunnel-failed'
  /** The listener could not bind. */
  | 'listen-failed'

/** One paired phone or tablet, without anything that could impersonate it. */
export interface RemoteDeviceRecord {
  /** Opaque ledger id, used by the revoke route. */
  id: string
  /** The device's self-reported name. */
  name: string
  /** The device's self-reported platform (`ios`, `android`, …). */
  platform: string
  /** ISO time the device paired. */
  pairedAt: string
  /** ISO time of the last authenticated request, or null when it has not returned. */
  lastSeenAt: string | null
}

/** The QR payload, verbatim as the phone parses it. */
export interface RemotePairingPayload {
  /** Payload version; 1 is the only shape in the field. */
  v: 1
  /** The host's display name, shown on the phone before it commits. */
  name: string
  /** The origin the phone will talk to. */
  url: string
  /** Single-use pairing token, base64url, valid for ten minutes. */
  token: string
  /** Lowercase hex SHA-256 of the listener's certificate; LAN mode only. */
  fingerprint?: string
  /** ISO expiry of the pairing token. */
  expires: string
}

/** One journalled state change; never carries a token or a certificate key. */
export interface RemoteJournalEntry {
  /** ISO time the change was recorded. */
  at: string
  /** What changed: `enabled`, `disabled`, `paired`, `revoked`, `pairing-issued`, … */
  action: string
  /** Short, non-secret context — a mode, a device name, an error class. */
  detail?: string
}

/** What a remote device is notified about. */
export type RemoteEventType = 'approval' | 'verdict' | 'fleet' | 'saturnbot'

/** One frame of the Server-Sent Events stream. */
export interface RemoteEvent {
  /** Which surface the frame came from. */
  type: RemoteEventType
  /** One line, already localized by its publisher. */
  title: string
  /** The detail line under the title. */
  body: string
  /** The session the frame deep-links to, when it has one. */
  sessionId?: string
  /** Monotonic frame id, also used as the SSE `id:` field. */
  id: string
  /** ISO time the frame was published. */
  at: string
}

/** Everything the Settings card and the phone need to know about the listener. */
export interface RemoteStatus {
  /** Lifecycle of the listener. */
  state: RemoteState
  /** The mode that is configured (whether or not it is running). */
  mode: RemoteMode
  /** The origin devices should be pointed at, or null while off. */
  url: string | null
  /** The certificate SHA-256 the phone pins, or null outside LAN mode. */
  fingerprint: string | null
  /** Paired devices, newest last. */
  devices: RemoteDeviceRecord[]
  /** Whether a cloudflared binary was found on PATH. */
  tunnelAvailable: boolean
  /** Why the listener is not serving, when it is not. */
  issue: RemoteIssue
  /** The most recent state changes, oldest first. */
  journal: RemoteJournalEntry[]
}
