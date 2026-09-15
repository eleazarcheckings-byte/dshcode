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
function parseSseFrames(payload) {
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
// notifications) and Mars r2 (M3-apps-mobile-r2.md) R2-F1..R2-F3:
//   - R2-F1: `fetch(.../events?since=poll').then(r => r.text())` never
//     resolved, because the host's route is SSE-only and never closes on its
//     own (packages/saturn/remote-access/src/proxy.ts's stream() -- the
//     query string is stripped by the router and always lands there) --
//     the tick hung until the OS killed it, with no notification ever
//     scheduled.
//   - R2-F2: event ids were compared as strings, silently dropping every id
//     from 10 through 89 once `lastSeen` passed "9".
//   - R2-F3: scheduled notifications carried no `extra`, so a tap on one
//     threw in main.ts's onNotificationTapped handler.

const KV_HOST_URL_KEY = 'saturn.bg.hostUrl';
const KV_DEVICE_TOKEN_KEY = 'saturn.bg.deviceToken';
const KV_LAST_EVENT_ID_KEY = 'saturn.bg.lastEventId';

// Bounds one tick's read of the host's held-open SSE stream. Comfortably
// inside iOS's ~30s per-task budget (see @capacitor/background-runner's
// README, "Limitations of Background Tasks" -> iOS), with headroom for the
// fetch call itself and CapacitorKV/CapacitorNotifications round-trips.
const READ_DEADLINE_MS = 8000;

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

      const lastSeenRaw = CapacitorKV.get(KV_LAST_EVENT_ID_KEY).value;
      const lastSeen = lastSeenRaw || '';
      let newestId = lastSeen;

      // Last-Event-ID (not the `?since=poll` query, which the router ignores
      // entirely -- proxy.ts strips the query before routing) asks the bus to
      // replay only what this device missed (events.ts's EventBus.attach()).
      const headers = { authorization: 'Bearer ' + deviceToken, accept: 'text/event-stream' };
      if (lastSeen) headers['last-event-id'] = lastSeen;

      const response = await fetch(hostUrl + '/saturn/remote/events', { method: 'GET', headers });
      if (!response.ok || !response.body || typeof response.body.getReader !== 'function') {
        // A rejected/expired token surfaces to the user next time they open
        // the app (tokenStore + the offline screen already handle that) -- a
        // background tick just stays quiet. No streaming reader (an older
        // plugin build, or a response with no body) is treated the same way
        // rather than falling back to response.text(), which never resolves
        // against a stream this host never closes on its own.
        resolve();
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let timedOut = false;
      const deadline = setTimeout(() => {
        timedOut = true;
        // Closes the connection from our side so the host's req/res 'close'
        // handlers free the stream immediately rather than waiting on it.
        reader.cancel().catch(() => {});
      }, READ_DEADLINE_MS);

      try {
        while (!timedOut) {
          let chunk;
          try {
            chunk = await reader.read();
          } catch (err) {
            if (timedOut) break; // the deadline's own cancel() rejected this read -- expected
            throw err;
          }
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          const frames = buffer.split('\n\n');
          buffer = frames.pop() || '';
          for (const frameText of frames) {
            for (const event of parseSseFrames(frameText + '\n\n')) {
              const id = String(event.id);
              if (!isNewerEventId(id, lastSeen)) continue;
              const descriptor = mapBackgroundEvent(event);
              CapacitorNotifications.schedule([
                { id: descriptor.id, title: descriptor.title, body: descriptor.body, extra: descriptor.extra },
              ]);
              if (compareEventIds(id, newestId) > 0) newestId = id;
            }
          }
        }
      } finally {
        clearTimeout(deadline);
      }

      if (newestId && newestId !== lastSeen) {
        CapacitorKV.set(KV_LAST_EVENT_ID_KEY, newestId);
      }
      resolve();
    } catch (err) {
      reject(err);
    }
  })();
});
