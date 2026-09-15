/**
 * Pure helpers behind the background-events poll (SPEC.md §8 M3 DELIVER
 * item; Mars r2 findings R2-F2/R2-F3/R2-F4 on M3-apps-mobile-r2.md).
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
 *   - src/lib/remoteApi.ts's parseSseOrJsonEvents (frame parsing)
 *   - src/lib/eventsMapper.ts's mapEventToNotification / deepLinkFor
 *     (title rules, and the `extra` shape a tapped notification deep-links
 *     from -- see main.ts's onNotificationTapped)
 * A mismatch here only affects the *backgrounded* notification path; the
 * foregrounded EventSource path (src/main.ts) imports eventsMapper.ts
 * directly and is unaffected.
 */

/**
 * One SSE payload -> the events it carries: `data: {...}` lines (a real
 * frame from packages/saturn/remote-access/src/proxy.ts's stream()), or a
 * bare JSON array for a poll-friendly host. Tolerant of a buffer that ends
 * mid-frame -- a bounded background read stopped mid-stream -- by skipping
 * an unterminated or malformed line rather than throwing.
 * @param {string} payload
 * @returns {Array<Record<string, unknown>>}
 */
export function parseSseFrames(payload) {
  const trimmed = (payload || '').trim();
  if (trimmed.length === 0) return [];
  if (trimmed.charAt(0) === '[') {
    try {
      return JSON.parse(trimmed);
    } catch {
      return [];
    }
  }
  const events = [];
  for (const line of trimmed.split('\n')) {
    const t = line.trim();
    if (t.indexOf('data:') !== 0) continue;
    try {
      events.push(JSON.parse(t.slice(5).trim()));
    } catch {
      // skip a malformed/truncated line rather than drop the whole frame
    }
  }
  return events;
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
