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
