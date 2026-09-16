/**
 * Sandboxed preload bridge: the only Electron surface the renderer sees.
 * Exposes the desktop frame facts (from launch arguments) and the window-menu
 * popup RPC. Sandboxed preloads cannot load ESM, so tsdown bundles this entry
 * as CommonJS (`lib/preload.cjs`); the payload parsing stays in lifecycle.ts
 * where the node test suite covers it without loading Electron.
 */
import { contextBridge, ipcRenderer } from 'electron'
import {
  DESKTOP_ACCOUNT_SIGN_IN_CHANNEL,
  DESKTOP_ACCOUNT_SIGN_OUT_CHANNEL,
  DESKTOP_ACCOUNT_STATUS_CHANNEL,
  DESKTOP_CHECK_UPDATES_CHANNEL,
  DESKTOP_NOTIFICATION_CHANNEL,
  DESKTOP_NOTIFICATION_CLICK_CHANNEL,
  DESKTOP_OPEN_RELEASE_CHANNEL,
  DESKTOP_RESTART_CHANNEL,
  DESKTOP_SHOW_MENU_CHANNEL,
  DESKTOP_RESTORE_SATURNBOT_CHANNEL,
  desktopBridgePayload,
} from './lifecycle.ts'

const payload = desktopBridgePayload(process.argv, process.platform)

contextBridge.exposeInMainWorld('dshDesktop', {
  ...payload,
  showMenu: () => {
    void ipcRenderer.invoke(DESKTOP_SHOW_MENU_CHANNEL)
  },
  restart: () => {
    void ipcRenderer.invoke(DESKTOP_RESTART_CHANNEL)
  },
  restoreSaturnBot: (): Promise<boolean> => ipcRenderer.invoke(DESKTOP_RESTORE_SATURNBOT_CHANNEL),
  // Native notifications: the main process owns the Notification instance,
  // and a click focuses the window and echoes the request id back here so
  // the renderer can open the notification's target session.
  notify: (request: { id: string; title: string; body?: string }) => {
    void ipcRenderer.invoke(DESKTOP_NOTIFICATION_CHANNEL, request)
  },
  onNotificationClick: (listener: (id: string) => void) => {
    const handler = (_event: unknown, id: string): void => { listener(id) }
    ipcRenderer.on(DESKTOP_NOTIFICATION_CLICK_CHANNEL, handler)
    return () => { ipcRenderer.removeListener(DESKTOP_NOTIFICATION_CLICK_CHANNEL, handler) }
  },
  accountStatus: () => ipcRenderer.invoke(DESKTOP_ACCOUNT_STATUS_CHANNEL),
  accountSignIn: () => ipcRenderer.invoke(DESKTOP_ACCOUNT_SIGN_IN_CHANNEL),
  accountSignOut: () => ipcRenderer.invoke(DESKTOP_ACCOUNT_SIGN_OUT_CHANNEL),
  checkForUpdates: () => ipcRenderer.invoke(DESKTOP_CHECK_UPDATES_CHANNEL),
  openRelease: (url: string) => {
    void ipcRenderer.invoke(DESKTOP_OPEN_RELEASE_CHANNEL, url)
  },
})
