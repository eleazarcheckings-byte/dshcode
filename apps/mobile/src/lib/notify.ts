import { LocalNotifications } from '@capacitor/local-notifications';
import type { LocalNotificationDescriptor } from './eventsMapper.js';

export async function ensureNotificationPermission(): Promise<boolean> {
  const current = await LocalNotifications.checkPermissions();
  if (current.display === 'granted') return true;
  const requested = await LocalNotifications.requestPermissions();
  return requested.display === 'granted';
}

/** Fires a mapped remote event as a local notification (SPEC §8: "Approval needed · Verdict PASS · SaturnBot needs you"). */
export async function fireNotification(descriptor: LocalNotificationDescriptor): Promise<void> {
  await LocalNotifications.schedule({
    notifications: [
      {
        id: descriptor.id,
        title: descriptor.title,
        body: descriptor.body,
        smallIcon: 'ic_stat_saturn_ring',
        extra: descriptor.extra,
      },
    ],
  });
}

// `extra` is honestly optional here: the Capacitor plugin types it as `any`,
// and a notification fired without one (a stray OS/system notification, or
// one scheduled by an older build) really does deliver `undefined` — see
// main.ts's onNotificationTapped call, which must guard against exactly this
// (Mars r2 R2-F3 on M3-apps-mobile-r2.md).
export type NotificationTapListener = (extra: LocalNotificationDescriptor['extra'] | undefined) => void;

/** Wires a tap on a delivered notification to the deep-link handler in main.ts. */
export function onNotificationTapped(listener: NotificationTapListener): void {
  void LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
    listener(action.notification.extra as LocalNotificationDescriptor['extra'] | undefined);
  });
}
