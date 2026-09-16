/**
 * Sign in with izzy.la for the Saturn AI desktop. The authorize URL is the
 * live IdP. Completing the code exchange needs a registered OAuth client for
 * this product — SaturnDesign's client is a different RP and is never used.
 */

/** Live izzy.la Accounts issuer (OIDC discovery). */
export const IZZY_LA_ISSUER = 'https://izzy.la/api/auth'

/** Live authorize endpoint for Sign in with izzy.la. */
export const IZZY_LA_AUTHORIZE = 'https://izzy.la/api/auth/oauth2/authorize'

/** Live token endpoint. */
export const IZZY_LA_TOKEN = 'https://izzy.la/api/auth/oauth2/token'

/** Live UserInfo endpoint. */
export const IZZY_LA_USERINFO = 'https://izzy.la/api/auth/oauth2/userinfo'

/** Env var naming this product's OAuth client. Unrelated to SaturnDesign. */
export const SATURN_AI_OAUTH_CLIENT_ID_ENV = 'SATURN_AI_OAUTH_CLIENT_ID'

/** Registered OAuth client for this product, when one exists. */
export interface OAuthClient {
  /** Public client id registered on izzy.la for Saturn AI. */
  readonly clientId: string
}

/**
 * Read this product's OAuth client from the environment. SaturnDesign and
 * other RP client ids are ignored on purpose.
 * @param env - process environment.
 * @returns the client, or undefined when OAuth cannot complete.
 */
export function readOAuthClient(
  env: Record<string, string | undefined> = process.env,
): OAuthClient | undefined {
  const clientId = env[SATURN_AI_OAUTH_CLIENT_ID_ENV]?.trim()
  if (clientId === undefined || clientId.length === 0) return undefined
  if (clientId.startsWith('saturndesign_')) return undefined
  return { clientId }
}

/** Inputs for the izzy.la authorize URL. */
export interface AuthorizeRequest {
  readonly clientId: string
  readonly redirectUri: string
  readonly state: string
  readonly challenge: string
  readonly scope?: string
}

/**
 * Build the live izzy.la authorize URL (OAuth 2.1 + PKCE).
 * @param request - client, redirect, state, and S256 challenge.
 * @returns the HTTPS authorize URL.
 */
export function buildAuthorizeURL(request: AuthorizeRequest): string {
  const url = new URL(IZZY_LA_AUTHORIZE)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', request.clientId)
  url.searchParams.set('redirect_uri', request.redirectUri)
  url.searchParams.set('scope', request.scope ?? 'openid profile email')
  url.searchParams.set('state', request.state)
  url.searchParams.set('code_challenge', request.challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  return url.toString()
}

/**
 * Whether sign-in can even start. Without a Saturn AI client, the IdP has
 * nowhere to return a code for this product.
 * @param env - process environment.
 * @returns `'ready'` or `'oauth-unavailable'`.
 */
export function oauthAvailability(
  env: Record<string, string | undefined> = process.env,
): 'ready' | 'oauth-unavailable' {
  return readOAuthClient(env) === undefined ? 'oauth-unavailable' : 'ready'
}
