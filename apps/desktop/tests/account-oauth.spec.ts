import { describe, expect, it } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildAuthorizeURL,
  IZZY_LA_AUTHORIZE,
  IZZY_LA_ISSUER,
  oauthAvailability,
  readOAuthClient,
  SATURN_AI_OAUTH_CLIENT_ID_ENV,
} from '../src/account-oauth.ts'
import { loadAccount, signOutAccount, startSignIn } from '../src/account.ts'
import { accountSessionPath, writeAccountSession } from '../src/account-session.ts'

describe('izzy.la OAuth client', () => {
  it('uses the live izzy.la authorize URL', () => {
    expect(IZZY_LA_AUTHORIZE).toBe('https://izzy.la/api/auth/oauth2/authorize')
    expect(IZZY_LA_ISSUER).toBe('https://izzy.la/api/auth')
    expect(buildAuthorizeURL({
      clientId: 'saturnai_desktop_test',
      redirectUri: 'http://127.0.0.1:9/oauth/callback',
      state: 'st',
      challenge: 'ch',
    })).toBe(
      'https://izzy.la/api/auth/oauth2/authorize?response_type=code&client_id=saturnai_desktop_test&redirect_uri=http%3A%2F%2F127.0.0.1%3A9%2Foauth%2Fcallback&scope=openid+profile+email&state=st&code_challenge=ch&code_challenge_method=S256',
    )
    expect(buildAuthorizeURL({
      clientId: 'saturnai_desktop_test',
      redirectUri: 'http://127.0.0.1:9/oauth/callback',
      state: 'st',
      challenge: 'ch',
      scope: 'openid',
    })).toContain('scope=openid&')
  })

  it('is unavailable without a Saturn AI client and ignores SaturnDesign ids', () => {
    expect(readOAuthClient({})).toBeUndefined()
    expect(oauthAvailability({})).toBe('oauth-unavailable')
    expect(readOAuthClient({ [SATURN_AI_OAUTH_CLIENT_ID_ENV]: '  ' })).toBeUndefined()
    expect(readOAuthClient({ [SATURN_AI_OAUTH_CLIENT_ID_ENV]: 'saturndesign_abc' })).toBeUndefined()
    expect(readOAuthClient({ SATURNDESIGN_OAUTH_CLIENT_ID: 'saturndesign_abc' })).toBeUndefined()
    expect(readOAuthClient({ [SATURN_AI_OAUTH_CLIENT_ID_ENV]: 'saturnai_desktop_1' }))
      .toEqual({ clientId: 'saturnai_desktop_1' })
    expect(oauthAvailability({ [SATURN_AI_OAUTH_CLIENT_ID_ENV]: 'saturnai_desktop_1' })).toBe('ready')
  })

  it('keeps Settings in the empty not-connected state when OAuth cannot complete', async () => {
    const home = await mkdtemp(join(tmpdir(), 'saturn-oauth-'))
    await expect(loadAccount(home, {})).resolves.toEqual({
      version: 1,
      connected: false,
      reason: 'oauth-unavailable',
    })
    await expect(startSignIn(home, {})).resolves.toMatchObject({
      client: undefined,
      session: { connected: false, reason: 'oauth-unavailable' },
    })
    await expect(startSignIn(home, { [SATURN_AI_OAUTH_CLIENT_ID_ENV]: 'saturnai_desktop_1' }))
      .resolves.toMatchObject({
        client: { clientId: 'saturnai_desktop_1' },
        session: { connected: false, reason: 'oauth-incomplete' },
      })
    await expect(signOutAccount(home)).resolves.toEqual({
      version: 1,
      connected: false,
      reason: 'not-connected',
    })
    await writeAccountSession(home, {
      version: 1,
      connected: true,
      sub: 'user_1',
      connectedAt: '2026-09-15T00:00:00.000Z',
    })
    await expect(loadAccount(home, {})).resolves.toMatchObject({ connected: true, sub: 'user_1' })
  })

  it('keeps a malformed stored session empty instead of inventing a user', async () => {
    const { mkdir, writeFile } = await import('node:fs/promises')
    const home = await mkdtemp(join(tmpdir(), 'saturn-oauth-bad-'))
    await mkdir(join(home, 'account'), { recursive: true })
    await writeFile(accountSessionPath(home), '{not json', 'utf8')
    await expect(loadAccount(home, {})).resolves.toEqual({
      version: 1,
      connected: false,
      reason: 'malformed',
    })
  })
})
