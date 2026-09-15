// Saturn AI companion — background events poll (SPEC.md §8 M3 DELIVER item;
// Mars r1 finding #2). Runs inside @capacitor/background-runner's isolated
// JS engine on an OS-scheduled tick (Android WorkManager / iOS
// BGTaskScheduler, both handled by the plugin's native side) — no DOM, no
// module imports, only the limited Web APIs + Capacitor* globals it
// documents (fetch with method/headers/body only, CapacitorKV, and
// CapacitorNotifications). It cannot import ../src/lib/*, so its session
// storage and event-mapping logic are hand-mirrored here.
//
// Keep the constants and mapEventToNotification() below in sync with:
//   - src/lib/backgroundSync.ts   (BACKGROUND_SYNC_* constants, KV key names)
//   - src/lib/eventsMapper.ts     (mapEventToNotification's title rules)
//   - src/lib/remoteApi.ts        (parseSseOrJsonEvents' SSE/JSON parsing)
// A mismatch here only affects the *backgrounded* notification; the
// foregrounded EventSource path in src/main.ts is unaffected.

const KV_HOST_URL_KEY = 'saturn.bg.hostUrl';
const KV_DEVICE_TOKEN_KEY = 'saturn.bg.deviceToken';
const KV_LAST_EVENT_ID_KEY = 'saturn.bg.lastEventId';

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

// capacitor.config.ts's plugins.BackgroundRunner.event names this — the OS
// invokes it on its own schedule while the app is backgrounded.
addEventListener('checkRemoteEvents', (resolve, reject) => {
  (async () => {
    try {
      const hostUrl = CapacitorKV.get(KV_HOST_URL_KEY).value;
      const deviceToken = CapacitorKV.get(KV_DEVICE_TOKEN_KEY).value;
      if (!hostUrl || !deviceToken) {
        // Never paired, or paired-then-forgotten — nothing to poll.
        resolve();
        return;
      }

      const response = await fetch(hostUrl + '/saturn/remote/events?since=poll', {
        method: 'GET',
        headers: { authorization: 'Bearer ' + deviceToken, accept: 'application/json' },
      });
      if (!response.ok) {
        // A rejected/expired token surfaces to the user next time they open
        // the app (tokenStore + the offline screen already handle that) —
        // a background tick just stays quiet rather than erroring loudly.
        resolve();
        return;
      }

      const text = await response.text();
      const events = parseEvents(text);
      const lastSeenRaw = CapacitorKV.get(KV_LAST_EVENT_ID_KEY).value;
      const lastSeen = lastSeenRaw || '';
      let newestId = lastSeen;

      for (const event of events) {
        const id = String(event.id);
        if (lastSeen && id <= lastSeen) continue;
        const descriptor = mapEventToNotification(event);
        CapacitorNotifications.schedule([
          { id: numericNotificationId(id), title: descriptor.title, body: descriptor.body },
        ]);
        if (id > newestId) newestId = id;
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

/** Mirrors src/lib/remoteApi.ts's parseSseOrJsonEvents: a JSON array (poll-friendly host) or raw `data: {...}` SSE lines. */
function parseEvents(payload) {
  const trimmed = (payload || '').trim();
  if (trimmed.length === 0) return [];
  if (trimmed.charAt(0) === '[') {
    try {
      return JSON.parse(trimmed);
    } catch (err) {
      return [];
    }
  }
  const events = [];
  const lines = trimmed.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.indexOf('data:') !== 0) continue;
    try {
      events.push(JSON.parse(line.slice(5).trim()));
    } catch (err) {
      // skip a malformed line rather than drop the whole poll
    }
  }
  return events;
}

/** Mirrors src/lib/eventsMapper.ts's mapEventToNotification title rules ("Approval needed" / "Verdict PASS|REVISE|REJECT" / "SaturnBot needs you"). */
function mapEventToNotification(event) {
  const title = event && event.title;
  const body = event && event.body;
  const type = event && event.type;
  if (type === 'approval') {
    return { title: 'Approval needed', body: body || title || 'A run needs your approval' };
  }
  if (type === 'verdict') {
    const source = title || body || '';
    const match = /PASS|REVISE|REJECT/i.exec(source);
    return { title: match ? 'Verdict ' + match[0].toUpperCase() : 'Verdict ready', body: body || title || '' };
  }
  if (type === 'saturnbot') {
    return { title: 'SaturnBot needs you', body: body || title || '' };
  }
  return { title: title || 'Saturn AI', body: body || '' };
}

/** Local-notification ids are a 32-bit int on Android; hash the (string) event id down to one deterministically. */
function numericNotificationId(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 2147483647;
}
