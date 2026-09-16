/**
 * View types for Settings → Account. Declared here so the page compiles without
 * the desktop main process, matching the Remote settings card's local contracts.
 */

/** Why the product session is empty. */
export type AccountDisconnectReason =
  | 'not-connected'
  | 'oauth-unavailable'
  | 'oauth-incomplete'
  | 'malformed'

/** Product identity as the page renders it. */
export type AccountStatus =
  | { readonly version: 1; readonly connected: false; readonly reason: AccountDisconnectReason }
  | {
    readonly version: 1
    readonly connected: true
    readonly sub: string
    readonly connectedAt: string
    readonly email?: string
    readonly name?: string
  }

/** Result of one user-initiated update check. */
export type UpdateCheck =
  | { readonly status: 'current'; readonly current: string; readonly feed: boolean }
  | { readonly status: 'available'; readonly current: string; readonly latest: string; readonly releaseUrl: string }
  | { readonly status: 'available-no-feed'; readonly current: string; readonly latest: string; readonly releaseUrl: string }
  | { readonly status: 'empty'; readonly current: string }
  | { readonly status: 'error'; readonly current: string; readonly message: string }

/** Host operations the page calls (desktop preload, or stubs when absent). */
export interface AccountFace {
  status: () => Promise<AccountStatus>
  signIn: () => Promise<AccountStatus>
  signOut: () => Promise<AccountStatus>
  checkUpdates: () => Promise<UpdateCheck>
  openRelease: (url: string) => void
}

/** Empty product session when the desktop bridge is missing. */
export const DISCONNECTED: AccountStatus = {
  version: 1,
  connected: false,
  reason: 'oauth-unavailable',
}

/** Empty update result when the desktop bridge is missing. */
export const NO_DESKTOP_UPDATES: UpdateCheck = { status: 'empty', current: '' }
