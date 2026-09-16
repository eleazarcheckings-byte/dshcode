import { App } from '@capacitor/app'
import { SplashScreen } from '@capacitor/splash-screen'
import { BackgroundRunner } from '@capacitor/background-runner'
import { CapacitorPreferencesStorage } from './lib/capacitorStorage.js'
import { TokenStore, type DeviceSession } from './lib/tokenStore.js'
import { unlockWithBiometrics } from './lib/lock.js'
import { checkHostReachable, pairWithHost, RemoteEventsClient } from './lib/remoteApi.js'
import { syncBackgroundSession } from './lib/backgroundSync.js'
import { mapEventToNotification } from './lib/eventsMapper.js'
import type { RemoteEvent } from './lib/eventsMapper.js'
import { ensureNotificationPermission, fireNotification, onNotificationTapped } from './lib/notify.js'
import { NotificationLog } from './notificationLog.js'
import { ringMarkSvg } from './lib/ring.js'
import { queryPairingElements, wirePairingScreen } from './screens/pairing.js'
import { renderNotificationList } from './screens/notifications.js'
import type { PairingPayload } from './lib/pairing.js'

type ScreenName = 'pairing' | 'lock' | 'offline' | 'notifications' | 'connecting'

const storage = new CapacitorPreferencesStorage()
const tokenStore = new TokenStore(storage)
const notificationLog = new NotificationLog(storage)

let eventsClient: RemoteEventsClient | undefined

function showScreen(name: ScreenName): void {
  for (const section of document.querySelectorAll<HTMLElement>('.screen')) {
    section.hidden = section.dataset.screen !== name
  }
}

function paintRings(): void {
  for (const el of document.querySelectorAll<HTMLElement>('[data-ring]')) {
    const small = el.classList.contains('ring--sm')
    el.innerHTML = ringMarkSvg({ size: small ? 28 : 48, animated: !el.classList.contains('ring--spin') })
  }
}

async function refreshNotificationScreen(): Promise<void> {
  const list = document.querySelector<HTMLElement>('[data-notification-list]')
  const empty = document.querySelector<HTMLElement>('[data-notification-empty]')
  if (!list || !empty) return
  renderNotificationList(list, empty, await notificationLog.all())
}

function deepLinkTo(deepLink: string): void {
  // The notification list and the loaded web UI both understand
  // `saturn://session/<id>`; when we're already inside the paired host's
  // own UI, a same-origin postMessage lets it route without a reload.
  window.postMessage({ type: 'saturn-deep-link', deepLink }, '*')
}

async function handleRemoteEvent(event: RemoteEvent): Promise<void> {
  const descriptor = mapEventToNotification(event)
  await notificationLog.record(descriptor)
  await fireNotification(descriptor)
  await refreshNotificationScreen()
}

function startEventsClient(session: DeviceSession): void {
  eventsClient?.stop()
  eventsClient = new RemoteEventsClient(
    session.hostUrl,
    event => void handleRemoteEvent(event),
    (err) => { console.warn('[saturn] events stream error', err) },
  )
  eventsClient.start()
}

async function enterPairedState(session: DeviceSession): Promise<void> {
  await ensureNotificationPermission()
  startEventsClient(session)
  await refreshNotificationScreen()
  showScreen('notifications')
}

async function completePairing(payload: PairingPayload): Promise<void> {
  const device = {
    name: (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? 'device',
    platform: guessPlatform(),
  }
  const response = await pairWithHost(payload, device)
  const session: DeviceSession = {
    deviceToken: response.deviceToken,
    sessionCookieName: response.sessionCookieName,
    hostUrl: payload.url,
    hostName: payload.name,
    fingerprint: payload.fingerprint,
    pairedAt: new Date().toISOString(),
  }
  await tokenStore.save(session)
  await syncBackgroundSession(BackgroundRunner, session)
  await enterPairedState(session)
}

function guessPlatform(): 'ios' | 'android' {
  const ua = navigator.userAgent.toLowerCase()
  return ua.includes('iphone') || ua.includes('ipad') ? 'ios' : 'android'
}

function wireOfflineScreen(session: DeviceSession): void {
  const hostNameEl = document.querySelector<HTMLElement>('[data-host-name]')
  if (hostNameEl) hostNameEl.textContent = session.hostName

  document.querySelector('[data-action="retry"]')?.addEventListener('click', () => {
    void bootstrap()
  })
  document.querySelector('[data-action="unpair"]')?.addEventListener('click', () => {
    void (async () => {
      await tokenStore.clear()
      await syncBackgroundSession(BackgroundRunner, undefined)
      eventsClient?.stop()
      showScreen('pairing')
    })()
  })
}

function wireLockScreen(session: DeviceSession): void {
  document.querySelector('[data-action="unlock"]')?.addEventListener('click', () => {
    void (async () => {
      if (await unlockWithBiometrics()) {
        await enterPairedState(session)
      }
    })()
  })
}

function wireOpenWebview(session: DeviceSession): void {
  document.querySelector('[data-action="open-webview"]')?.addEventListener('click', () => {
    // The pair request above used credentials:'include', so the host's
    // Set-Cookie for sessionCookieName is already in this WebView's cookie
    // jar for its origin; navigating here carries that session forward.
    // See capacitor.config.ts for why allowNavigation is '*'.
    window.location.href = session.hostUrl
  })
}

async function bootstrap(): Promise<void> {
  paintRings()
  const session = await tokenStore.load()

  if (!session) {
    const elements = queryPairingElements(document.querySelector('[data-screen="pairing"]') as HTMLElement)
    wirePairingScreen(elements, { onPayload: completePairing })
    showScreen('pairing')
    return
  }

  // Rehydrates the background runner's isolated KV store on every boot (a
  // reinstall or an OS-level app-data clear wipes it independently of
  // tokenStore's own @capacitor/preferences-backed storage).
  await syncBackgroundSession(BackgroundRunner, session)

  showScreen('connecting')
  const reachable = await checkHostReachable(session.hostUrl, session.deviceToken)
  if (!reachable) {
    wireOfflineScreen(session)
    showScreen('offline')
    return
  }

  wireLockScreen(session)
  wireOpenWebview(session)

  const unlocked = await unlockWithBiometrics('Unlock Saturn AI')
  if (!unlocked) {
    showScreen('lock')
    return
  }
  await enterPairedState(session)
}

// `extra` is absent for any notification that wasn't scheduled with one --
// the background runner's own notifications before this fix round did
// exactly that and threw here on tap (Mars r2 R2-F3 on M3-apps-mobile-r2.md).
onNotificationTapped((extra) => {
  if (extra?.deepLink) deepLinkTo(extra.deepLink)
})

void App.addListener('appStateChange', ({ isActive }) => {
  if (!isActive) {
    eventsClient?.stop()
    return
  }
  void (async () => {
    const session = await tokenStore.load()
    if (!session) return
    const stillLocked = document.querySelector<HTMLElement>('[data-screen="lock"]')?.hidden === false
    if (stillLocked) {
      if (await unlockWithBiometrics('Unlock Saturn AI')) {
        await enterPairedState(session)
      }
      return
    }
    startEventsClient(session)
  })()
})

window.addEventListener('DOMContentLoaded', () => {
  void bootstrap().finally(() => {
    void SplashScreen.hide()
  })
})
