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
