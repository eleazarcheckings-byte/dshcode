/**
 * Desktop account actions: read the durable session, refuse a fake login, and
 * start Sign in with izzy.la only when this product has its own OAuth client.
 */

import {
  oauthAvailability,
  readOAuthClient,
  type OAuthClient,
} from './account-oauth.ts'
import {
  readAccountSession,
  writeAccountSession,
  type AccountSession,
} from './account-session.ts'

export type { AccountSession }

/**
 * Current product identity. A missing file is not-connected; without a Saturn
 * AI OAuth client the reason is oauth-unavailable. Never synthesizes a user.
 * @param home - harness home directory.
 * @param env - process environment.
 */
export async function loadAccount(
  home: string,
  env: Record<string, string | undefined> = process.env,
): Promise<AccountSession> {
  const stored = await readAccountSession(home)
  if (stored.connected) return stored
  if (stored.reason === 'malformed') return stored
  if (oauthAvailability(env) === 'oauth-unavailable') {
    return { version: 1, connected: false, reason: 'oauth-unavailable' }
  }
  return stored
}

/**
 * Begin sign-in. Without a registered Saturn AI client this stays disconnected.
 * A registered client still cannot finish the code exchange until izzy.la has
 * a redirect for this install — the session stays oauth-incomplete, not logged in.
 * @param home - harness home directory.
 * @param env - process environment.
 */
export async function startSignIn(
  home: string,
  env: Record<string, string | undefined> = process.env,
): Promise<{ session: AccountSession; client: OAuthClient | undefined }> {
  const client = readOAuthClient(env)
  if (client === undefined) {
    const session: AccountSession = { version: 1, connected: false, reason: 'oauth-unavailable' }
    await writeAccountSession(home, session)
    return { session, client: undefined }
  }
  const session: AccountSession = { version: 1, connected: false, reason: 'oauth-incomplete' }
  await writeAccountSession(home, session)
  return { session, client }
}

/**
 * Drop the product session. izzy.la keeps its own IdP cookie; this is the RP.
 * @param home - harness home directory.
 */
export async function signOutAccount(home: string): Promise<AccountSession> {
  const session: AccountSession = { version: 1, connected: false, reason: 'not-connected' }
  await writeAccountSession(home, session)
  return session
}
