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

export type NotificationTapListener = (extra: LocalNotificationDescriptor['extra']) => void;

/** Wires a tap on a delivered notification to the deep-link handler in main.ts. */
export function onNotificationTapped(listener: NotificationTapListener): void {
  void LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
    listener(action.notification.extra as LocalNotificationDescriptor['extra']);
  });
}
