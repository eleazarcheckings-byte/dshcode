/**
 * App-side half of the background event poll (SPEC.md §8 M3 DELIVER item;
 * Mars r1 finding #2: `RemoteEventsClient.pollOnce()` existed with no OS
 * background-execution capability registered, so nothing invoked it; that
 * method has since been deleted outright -- its one-shot `fetch` + `text()`
 * of the SSE-only events route could never resolve, Mars r2 R2-F1's hang --
 * see `tests/remoteApi.test.ts`).
 *
 * `@capacitor/background-runner` (official `@capacitor` scope) runs a
 * separate JS file — `apps/mobile/assets/background-runner.js`, copied
 * verbatim into `www/` by Vite's `publicDir` and from there into each
 * platform's bundle by `npx cap sync` — in an isolated engine with no DOM
 * and no module imports. That engine can't see this app's
 * `@capacitor/preferences`-backed `TokenStore`, so this module's job is to
 * push (or clear) the session into the runner's own `CapacitorKV` store via
 * `dispatchEvent`, which the runner script reads on its OS-scheduled tick
 * to poll `/saturn/remote/events` and fire local notifications on its own.
 *
 * The four exported constants below and the runner script's own constants
 * (`KV_HOST_URL_KEY` etc., `checkRemoteEvents`/`storeSession` event names)
 * must stay in sync by hand — the isolated engine cannot import this file.
 * See `apps/mobile/assets/background-runner.js`'s header comment.
 */

import type { DeviceSession } from './tokenStore.js';

export const BACKGROUND_SYNC_LABEL = 'ai.saturnai.mobile.events-poll';
/** Relative to the built web asset root (`www/`) — matches `assets/background-runner.js` after Vite's publicDir copy. */
export const BACKGROUND_SYNC_SRC = 'background-runner.js';
export const BACKGROUND_SYNC_EVENT = 'checkRemoteEvents';
export const BACKGROUND_SYNC_STORE_EVENT = 'storeSession';
/** Android's Background Runner enforces a 15-minute floor on repeating intervals; iOS treats `interval` as a hint only (BGTaskScheduler decides). */
export const BACKGROUND_SYNC_INTERVAL_MINUTES = 15;

export interface BackgroundRunnerPluginConfig {
  label: string;
  src: string;
  event: string;
  repeat: boolean;
  interval: number;
  autoStart: boolean;
}

/** The exact `plugins.BackgroundRunner` block `capacitor.config.ts` installs — pulled out so it's testable without loading the CLI's config machinery. */
export function buildBackgroundRunnerConfig(): BackgroundRunnerPluginConfig {
  return {
    label: BACKGROUND_SYNC_LABEL,
    src: BACKGROUND_SYNC_SRC,
    event: BACKGROUND_SYNC_EVENT,
    repeat: true,
    interval: BACKGROUND_SYNC_INTERVAL_MINUTES,
    autoStart: true,
  };
}

export interface StoreSessionArgs {
  hostUrl: string;
  deviceToken: string;
}

type SessionLike = Pick<DeviceSession, 'hostUrl' | 'deviceToken'>;

/** The runner's KV store only holds strings, so only these two fields cross the boundary — never the cookie name or fingerprint. */
export function buildStoreSessionArgs(session: SessionLike | undefined): StoreSessionArgs | Record<string, never> {
  if (!session) return {};
  return { hostUrl: session.hostUrl, deviceToken: session.deviceToken };
}

function toDetails(args: StoreSessionArgs | Record<string, never>): Record<string, unknown> {
  return args as Record<string, unknown>;
}

/** Structural subset of `@capacitor/background-runner`'s `BackgroundRunner` plugin object — injected so this is unit-testable without the Capacitor runtime, matching this codebase's `KeyValueStorage`-injection pattern (see `tokenStore.ts`). */
export interface EventDispatcher {
  dispatchEvent(options: { label: string; event: string; details: Record<string, unknown> }): Promise<unknown>;
}

/**
 * Pushes (or clears, when `session` is undefined) the session the
 * background runner needs to poll on its own. Call this after a successful
 * pairing, after a revoke/forget-host, and once at app boot to rehydrate
 * the runner's KV store after a reinstall or OS-level data clear.
 */
export async function syncBackgroundSession(dispatcher: EventDispatcher, session: SessionLike | undefined): Promise<void> {
  await dispatcher.dispatchEvent({
    label: BACKGROUND_SYNC_LABEL,
    event: BACKGROUND_SYNC_STORE_EVENT,
    details: toDetails(buildStoreSessionArgs(session)),
  });
}
