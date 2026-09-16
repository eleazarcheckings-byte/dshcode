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
export function parseReplayEvents(payload) {
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
export function hasReplayGap(payload) {
  return Boolean(payload && typeof payload === 'object' && /** @type {{ gap?: unknown }} */ (payload).gap);
}

/**
 * Whether more than `limit` events were available, i.e. this tick should
 * fetch another page (with `after` advanced to this page's `newest`) rather
 * than stopping after one.
 * @param {unknown} payload
 * @returns {boolean}
 */
export function isReplayTruncated(payload) {
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
export function resolveReplayCursor(reportedNewest, observedNewest) {
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
export function compareEventIds(a, b) {
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
export function isNewerEventId(candidateId, lastSeenId) {
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
export function hashToNotificationId(id) {
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
export function deepLinkForBackgroundEvent(event) {
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
export function mapBackgroundEvent(event) {
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
