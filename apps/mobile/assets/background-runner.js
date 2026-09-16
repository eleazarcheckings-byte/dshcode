// GENERATED FILE -- do not hand-edit.
//
// Produced by scripts/backgroundRunnerBuild.mjs (run via
// `npm run build:background-runner`) from:
//   - src/lib/backgroundEventsCore.js   (pure helpers -- SSE frame parsing,
//     numeric id ordering, event -> notification mapping -- also imported
//     directly by tests/backgroundEventsCore.test.ts)
//   - scripts/background-runner.entry.js (the OS-tick wiring: addEventListener,
//     CapacitorKV, CapacitorNotifications, fetch)
//
// @capacitor/background-runner's isolated JS engine has no module loader
// (see its README's "JavaScript API" section), so this file inlines the
// pure helpers as plain function declarations rather than importing them --
// that engine cannot execute an `import`/`export` statement at all. Edit
// one of the two sources above and re-run the generator; hand-editing this
// file fails tests/backgroundRunnerGenerated.test.ts, which compares it
// against a fresh render on every `npm test`.

/**
 * Pure helpers behind the background-events poll (SPEC.md §8 M3 DELIVER
 * item; Mars r2 findings R2-F2/R2-F3/R2-F4 on M3-apps-mobile-r2.md; Mars r3
 * finding R3-F1 on M3-apps-mobile-r3.md).
 *
 * Shared, at build time, between:
 *   - assets/background-runner.entry.js's OS-tick wiring, inlined by
 *     scripts/backgroundRunnerBuild.mjs into the actual runner file the
 *     plugin loads, assets/background-runner.js. That inlining -- not a
 *     runtime import -- is required because @capacitor/background-runner's
 *     isolated JS engine has no module loader at all (its README's
 *     "JavaScript API" section lists only console/TextDecoder/TextEncoder/
 *     timers/crypto/fetch plus the Capacitor* globals -- no `import`).
 *   - this file's own tests (tests/backgroundEventsCore.test.ts), which
 *     import it directly, and the drift guard
 *     (tests/backgroundRunnerGenerated.test.ts) that fails if the generated
 *     file and this module (plus background-runner.entry.js) ever disagree.
 *
 * Mirrors, deliberately, rather than reimplements differently:
 *   - src/lib/eventsMapper.ts's mapEventToNotification / deepLinkFor
 *     (title rules, and the `extra` shape a tapped notification deep-links
 *     from -- see main.ts's onNotificationTapped)
 * A mismatch here only affects the *backgrounded* notification path; the
 * foregrounded EventSource path (src/main.ts) imports eventsMapper.ts
 * directly and is unaffected.
 *
 * Mars r3 R3-F1: the tick previously read the host's held-open
 * `GET /saturn/remote/events` SSE stream with `response.body.getReader()`.
 * @capacitor/background-runner's own shipped Swift source
 * (node_modules/@capacitor/background-runner/ios/Sources/RunnerEngine/
 * JSResponse.swift) proves that isolate's `Response` has no `body` at all --
 * only `ok`/`status`/`url`/`text()`/`json()` -- and JSFetch.swift resolves
 * the fetch promise itself only once the whole body has buffered
 * (URLSession's completion handler), so a fetch against a stream the host
 * never closes on its own never resolves. The tick now consumes the bounded
 * replay contract (SPEC.md §8: `GET .../events/replay?after=&limit=`,
 * `{ events, newest, truncated, gap? }`) with a single `response.json()`
 * per page instead -- no `body`/`ReadableStream` access anywhere in this
 * path, on either platform.
 */

/**
 * `GET .../events/replay`'s JSON body -> the events it carries. Tolerant of
 * a malformed or absent `events` array -- a background tick never trusts a
 * host response enough to throw on it -- so a bad payload just yields no
 * notifications this tick rather than crashing the poll.
 * @param {unknown} payload
 * @returns {Array<Record<string, unknown>>}
 */
function parseReplayEvents(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
  const events = /** @type {{ events?: unknown }} */ (payload).events;
  return Array.isArray(events) ? events : [];
}

/**
 * Whether the replay response's `after` cursor was older than the host's
 * ring buffer retains, i.e. some events between the last poll and this one
 * were dropped and this page starts from the oldest retained event instead
 * (SPEC.md §8 replay contract). Nothing else in this tick reacts to a gap
 * specially -- the page is still processed and the cursor still advances --
 * this only makes the condition observable and testable.
 * @param {unknown} payload
 * @returns {boolean}
 */
function hasReplayGap(payload) {
  return Boolean(payload && typeof payload === 'object' && /** @type {{ gap?: unknown }} */ (payload).gap);
}

/**
 * Whether more than `limit` events were available, i.e. this tick should
 * fetch another page (with `after` advanced to this page's `newest`) rather
 * than stopping after one.
 * @param {unknown} payload
 * @returns {boolean}
 */
function isReplayTruncated(payload) {
  return Boolean(payload && typeof payload === 'object' && /** @type {{ truncated?: unknown }} */ (payload).truncated);
}

/**
 * The `after` cursor to persist once a replay page has been processed: the
 * host-reported `newest` id when it parses as numerically at or ahead of
 * `observedNewest` (the highest id this page actually scheduled a
 * notification for, or the prior cursor if the page was empty), else
 * `observedNewest` -- so a missing or malformed `newest` field, or one that
 * (incorrectly) reports behind what this page just delivered, can never
 * regress the persisted cursor.
 * @param {unknown} reportedNewest - the replay response's `newest` field, verbatim.
 * @param {string} observedNewest
 * @returns {string}
 */
function resolveReplayCursor(reportedNewest, observedNewest) {
  const reported = reportedNewest === undefined || reportedNewest === null ? '' : String(reportedNewest);
  if (!reported) return observedNewest;
  if (!observedNewest) return reported;
  return compareEventIds(reported, observedNewest) >= 0 ? reported : observedNewest;
}

/**
 * Host ids are `String(sequence)` from a plain increasing counter
 * (packages/saturn/remote-access/src/events.ts's EventBus). Compare
 * numerically so `"10"` sorts after `"9"` (Mars r2 R2-F2: a lexicographic
 * `"10" <= "9"` compare silently dropped every event from 10 through 89);
 * fall back to a string compare only when either id fails to parse as a
 * finite number, so a malformed id never silently wins or loses a
 * comparison it shouldn't.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function compareEventIds(a, b) {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na === nb ? 0 : na < nb ? -1 : 1;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * Whether `candidateId` is strictly newer than `lastSeenId`. An empty or
 * absent `lastSeenId` means nothing has been seen yet, so everything counts
 * as newer.
 * @param {string} candidateId
 * @param {string | undefined} lastSeenId
 * @returns {boolean}
 */
function isNewerEventId(candidateId, lastSeenId) {
  if (!lastSeenId) return true;
  return compareEventIds(candidateId, lastSeenId) > 0;
}

/**
 * Stable, non-negative 31-bit hash -- mirrors src/lib/eventsMapper.ts's
 * hashToNotificationId so a re-delivered event reuses (and replaces) the
 * same OS notification id whether it was mapped in the foreground or here.
 * @param {string} id
 * @returns {number}
 */
function hashToNotificationId(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return hash % 2147483647;
}

function detectVerdict(text) {
  const match = /\b(PASS|REVISE|REJECT)\b/.exec(text || '');
  return match ? match[1] : undefined;
}

/**
 * Mirrors src/lib/eventsMapper.ts's deepLinkFor exactly -- the value a
 * tapped notification's `extra.deepLink` must carry for main.ts's
 * `onNotificationTapped` handler to route it.
 * @param {{ sessionId?: string, id?: string }} event
 * @returns {string}
 */
function deepLinkForBackgroundEvent(event) {
  const sessionId = event && event.sessionId;
  const id = event && event.id;
  if (sessionId) return 'saturn://session/' + encodeURIComponent(sessionId);
  return 'saturn://event/' + encodeURIComponent(id);
}

/**
 * Mirrors src/lib/eventsMapper.ts's mapEventToNotification: the same title
 * rules, and the same `extra` shape (`deepLink`/`eventId`/`type`) so a
 * background-fired notification deep-links exactly like a foreground one
 * (Mars r2 R2-F3 -- the runner previously scheduled `{ id, title, body }`
 * with no `extra` at all, so main.ts:174's tap handler threw).
 * @param {{ id: string, type: string, title?: string, body?: string, sessionId?: string }} event
 * @returns {{ id: number, title: string, body: string, extra: { deepLink: string, eventId: string, type: string } }}
 */
function mapBackgroundEvent(event) {
  const type = event && event.type;
  const id = String(event && event.id);
  const body = (event && event.body) || '';
  let title = event && event.title;

  if (type === 'verdict') {
    const verdict = detectVerdict(body) || detectVerdict(title);
    if (verdict) title = 'Verdict ' + verdict;
  }
  if (!title) {
    title = type === 'approval' ? 'Approval needed' : type === 'saturnbot' ? 'SaturnBot needs you' : type || 'Saturn AI';
  }

  return {
    id: hashToNotificationId(id),
    title,
    body,
    extra: { deepLink: deepLinkForBackgroundEvent(event), eventId: id, type },
  };
}

// Wiring for @capacitor/background-runner's isolated JS engine (OS-scheduled
// tick -- Android WorkManager / iOS BGTaskScheduler). Not runnable standalone
// and not itself the runner file the plugin loads: scripts/backgroundRunnerBuild.mjs
// inlines src/lib/backgroundEventsCore.js's pure helpers above this wiring
// into the actual generated file, assets/background-runner.js. Edit THIS
// file (or the core module) and run `npm run build:background-runner` --
// never hand-edit the generated file, which tests/backgroundRunnerGenerated.test.ts
// checks against a fresh render.
//
// SPEC.md §8 M3 DELIVER item; Mars r1 finding #2 (background poll -> local
// notifications), Mars r2 (M3-apps-mobile-r2.md) R2-F2..R2-F4, and Mars r3
// (M3-apps-mobile-r3.md) R3-F1:
//   - R2-F2: event ids were compared as strings, silently dropping every id
//     from 10 through 89 once `lastSeen` passed "9".
//   - R2-F3: scheduled notifications carried no `extra`, so a tap on one
//     threw in main.ts's onNotificationTapped handler.
//   - R3-F1 (this round): the previous fix for R2-F1 replaced a
//     query-string poll with a `Last-Event-ID`-driven read of the host's
//     held-open `GET /saturn/remote/events` SSE stream via
//     `response.body.getReader()`. That is unreachable on iOS:
//     @capacitor/background-runner's own shipped Swift source
//     (node_modules/@capacitor/background-runner/ios/Sources/RunnerEngine/
//     JSResponse.swift) exposes only `ok`/`status`/`url`/`text()`/`json()`
//     on its isolate's `Response` -- no `body`, no `ReadableStream` -- and
//     JSFetch.swift resolves the fetch promise itself only once the whole
//     response body has buffered inside URLSession's completion handler. A
//     fetch against a stream the host never closes on its own therefore
//     never resolves at all: the identical hang R2-F1 flagged, just
//     relocated from `response.text()` to the `fetch()` call itself. This
//     tick now consumes the bounded replay contract (SPEC.md §8:
//     `GET .../events/replay?after=&limit=100` -> `{ events, newest,
//     truncated, gap? }`) with a single `response.json()` per page --
//     nothing in this path touches `response.body` on either platform.

const KV_HOST_URL_KEY = 'saturn.bg.hostUrl';
const KV_DEVICE_TOKEN_KEY = 'saturn.bg.deviceToken';
const KV_LAST_EVENT_ID_KEY = 'saturn.bg.lastEventId';

// SPEC.md §8 replay contract: "limit=<1..200, default 100>". One page
// covers the common case (well under a device's typical event volume
// between two 15-minute ticks); `MAX_REPLAY_PAGES` bounds how many more the
// tick will fetch in a row when the response comes back `truncated: true`,
// so a pathological backlog can't turn one OS-scheduled tick into an
// unbounded loop.
const REPLAY_PAGE_LIMIT = 100;
const MAX_REPLAY_PAGES = 5;

// src/lib/backgroundSync.ts's syncBackgroundSession() dispatches this after
// pairing, after a revoke/forget-host (with empty details, clearing below),
// and once at app boot.
addEventListener('storeSession', (resolve, reject, args) => {
  try {
    const hostUrl = args && args.hostUrl;
    const deviceToken = args && args.deviceToken;
    if (hostUrl && deviceToken) {
      CapacitorKV.set(KV_HOST_URL_KEY, hostUrl);
      CapacitorKV.set(KV_DEVICE_TOKEN_KEY, deviceToken);
    } else {
      CapacitorKV.remove(KV_HOST_URL_KEY);
      CapacitorKV.remove(KV_DEVICE_TOKEN_KEY);
      CapacitorKV.remove(KV_LAST_EVENT_ID_KEY);
    }
    resolve();
  } catch (err) {
    reject(err);
  }
});

// capacitor.config.ts's plugins.BackgroundRunner.event names this -- the OS
// invokes it on its own schedule while the app is backgrounded.
addEventListener('checkRemoteEvents', (resolve, reject) => {
  (async () => {
    try {
      const hostUrl = CapacitorKV.get(KV_HOST_URL_KEY).value;
      const deviceToken = CapacitorKV.get(KV_DEVICE_TOKEN_KEY).value;
      if (!hostUrl || !deviceToken) {
        // Never paired, or paired-then-forgotten -- nothing to poll.
        resolve();
        return;
      }

      const lastSeenRaw = CapacitorKV.get(KV_LAST_EVENT_ID_KEY).value || '';
      const headers = { authorization: 'Bearer ' + deviceToken, accept: 'application/json' };

      let after = lastSeenRaw || '0';
      let cursor = lastSeenRaw;
      let page = 0;

      while (page < MAX_REPLAY_PAGES) {
        page += 1;
        const url =
          hostUrl + '/saturn/remote/events/replay?after=' + encodeURIComponent(after) + '&limit=' + REPLAY_PAGE_LIMIT;
        const response = await fetch(url, { method: 'GET', headers });
        if (!response.ok) {
          // A rejected/expired token surfaces to the user next time they
          // open the app (tokenStore + the offline screen already handle
          // that) -- a background tick just stays quiet and tries again
          // next time.
          break;
        }

        const payload = await response.json();
        const events = parseReplayEvents(payload);
        let observedNewest = cursor;

        for (const event of events) {
          const id = String(event.id);
          if (!isNewerEventId(id, lastSeenRaw)) continue;
          const descriptor = mapBackgroundEvent(event);
          CapacitorNotifications.schedule([
            { id: descriptor.id, title: descriptor.title, body: descriptor.body, extra: descriptor.extra },
          ]);
          if (compareEventIds(id, observedNewest) > 0) observedNewest = id;
        }

        cursor = resolveReplayCursor(payload && payload.newest, observedNewest);
        if (!isReplayTruncated(payload)) break;
        // gap: true just means this page started at the ring's oldest
        // retained event instead of `after` -- still processed above like
        // any other page; the cursor still advances to what the host
        // reports as newest.
        after = cursor || after;
      }

      if (cursor && cursor !== lastSeenRaw) {
        CapacitorKV.set(KV_LAST_EVENT_ID_KEY, cursor);
      }
      resolve();
    } catch (err) {
      reject(err);
    }
  })();
});
