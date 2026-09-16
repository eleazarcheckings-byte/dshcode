/**
 * Identity session for the Saturn AI desktop, stored under `$DSH_HOME/account`.
 * A connected record must carry the izzy.la `sub`. Missing or malformed files
 * are disconnected — never a fabricated user.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

/** Directory under the harness home that holds the product session. */
export const ACCOUNT_DIRECTORY = 'account'

/** Session file name. */
export const SESSION_FILE = 'session.json'

/** Owner-only bits for the session file (subject to umask). */
const SESSION_FILE_MODE = 0o600

/** Owner-only bits for `$DSH_HOME/account` when this writer creates it. */
const ACCOUNT_DIR_MODE = 0o700

/** Disconnected product session. */
export interface DisconnectedAccount {
  readonly version: 1
  readonly connected: false
  readonly reason: AccountDisconnectReason
}

/** Why the product session is empty. */
export type AccountDisconnectReason =
  | 'not-connected'
  | 'oauth-unavailable'
  | 'oauth-incomplete'
  | 'malformed'

/** Connected product session keyed by the izzy.la subject. */
export interface ConnectedAccount {
  readonly version: 1
  readonly connected: true
  readonly sub: string
  readonly connectedAt: string
  readonly email?: string
  readonly name?: string
}

/** Durable product identity. */
export type AccountSession = DisconnectedAccount | ConnectedAccount

const DISCONNECTED: DisconnectedAccount = {
  version: 1,
  connected: false,
  reason: 'not-connected',
}

/**
 * Path of the product session file under a harness home.
 * @param home - `$DSH_HOME` (tests pass a temp directory; never invent `~/.dsh`).
 * @returns absolute session path.
 */
export function accountSessionPath(home: string): string {
  return join(home, ACCOUNT_DIRECTORY, SESSION_FILE)
}

/**
 * Parse a session document. A `connected: true` record without `sub` collapses
 * to disconnected so the UI cannot show a fake logged-in user.
 * @param value - JSON value.
 * @returns the durable session.
 */
export function parseAccountSession(value: unknown): AccountSession {
  if (!isRecord(value) || value.version !== 1) {
    return { version: 1, connected: false, reason: 'malformed' }
  }
  if (value.connected !== true) {
    const reason = value.reason
    return {
      version: 1,
      connected: false,
      reason: isDisconnectReason(reason) ? reason : 'not-connected',
    }
  }
  if (typeof value.sub !== 'string' || value.sub.length === 0) {
    return { version: 1, connected: false, reason: 'malformed' }
  }
  if (typeof value.connectedAt !== 'string' || value.connectedAt.length === 0) {
    return { version: 1, connected: false, reason: 'malformed' }
  }
  const email = typeof value.email === 'string' && value.email.length > 0 ? value.email : undefined
  const name = typeof value.name === 'string' && value.name.length > 0 ? value.name : undefined
  return {
    version: 1,
    connected: true,
    sub: value.sub,
    connectedAt: value.connectedAt,
    ...email === undefined ? {} : { email },
    ...name === undefined ? {} : { name },
  }
}

/**
 * Read the product session. A missing file is not-connected.
 * @param home - harness home directory.
 * @returns the durable session.
 */
export async function readAccountSession(home: string): Promise<AccountSession> {
  try {
    const text = await readFile(accountSessionPath(home), 'utf8')
    return parseAccountSession(JSON.parse(text) as unknown)
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') return DISCONNECTED
    return { version: 1, connected: false, reason: 'malformed' }
  }
}

/**
 * Atomically replace the product session.
 * @param home - harness home directory.
 * @param session - next durable session.
 */
export async function writeAccountSession(home: string, session: AccountSession): Promise<void> {
  await writeFileAtomic(
    accountSessionPath(home),
    `${JSON.stringify(session)}\n`,
    { mode: SESSION_FILE_MODE, dirMode: ACCOUNT_DIR_MODE },
  )
}

function isDisconnectReason(value: unknown): value is AccountDisconnectReason {
  return value === 'not-connected'
    || value === 'oauth-unavailable'
    || value === 'oauth-incomplete'
    || value === 'malformed'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
