/** Desktop-shell lifecycle and navigation policies independent of Electron globals. */

// Type-only: erased at build, so this module still runs without an Electron
// global (the sandboxed preload inlines it) while the application-menu roles
// stay the exact union Electron accepts.
import type { BrowserWindow, MenuItemConstructorOptions } from 'electron'

/** Result of classifying a renderer navigation target. */
export type NavigationDisposition = 'application' | 'external' | 'blocked'

/** Loopback address the desktop-owned HTTP carrier must bind. */
const DESKTOP_WEB_HOST = '127.0.0.1'

/** Port value that delegates collision-free allocation to the operating system. */
const DESKTOP_WEB_PORT = 0

/**
 * Supply the main-module argument that packaged Electron launches omit.
 * Cordis HMR uses this argument to classify the launch module even when the
 * Web profile keeps module reload disabled and uses only config watching.
 * @param argv - mutable process argument vector.
 * @param mainModulePath - absolute path of the Electron main module.
 */
export function ensureMainModuleArgument(argv: string[], mainModulePath: string): void {
  if (argv[1] === undefined) argv[1] = mainModulePath
}

/**
 * Build the immutable Web-profile arguments for a desktop launch.
 * @returns Arguments that bind only to loopback, request an ephemeral port, and suppress the external browser.
 */
export function desktopWebArguments(): readonly string[] {
  return ['--host', DESKTOP_WEB_HOST, '--port', String(DESKTOP_WEB_PORT), '--no-open']
}

/**
 * Convert the activated WebServer address into the renderer URL while enforcing desktop isolation.
 * @param host - host reported by the activated WebServer service.
 * @param port - actual listening port reported after the operating system binds the socket.
 * @returns The local application URL.
 * @throws when the service did not bind the required loopback host or still reports an invalid port.
 */
export function desktopApplicationUrl(host: string, port: number): string {
  if (host !== DESKTOP_WEB_HOST) {
    throw new Error(`desktop web service bound unexpected host ${JSON.stringify(host)}`)
  }
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`desktop web service reported invalid port ${String(port)}`)
  }
  return `http://${DESKTOP_WEB_HOST}:${String(port)}/`
}

/** The shutdown operation owned by the booted Harness tree. */
export interface DesktopShutdown {
  /** Dispose the tree and settle after all owned resources are quiescent. */
  shutdown(code: number): Promise<void>
}

/** One coalescing desktop quit request. */
export interface QuitCoordinator {
  /** Whether a quit request already owns application teardown. */
  readonly requested: boolean
  /** Start or join teardown, then invoke the native exit callback. */
  request(code: number): Promise<void>
}

/**
 * Classify a requested renderer destination against the local application origin.
 * @param rawUrl - absolute destination supplied by Electron.
 * @param applicationOrigin - exact loopback origin owned by this process.
 * @returns Whether the renderer may navigate, the system browser may open it, or it is rejected.
 */
export function navigationDisposition(
  rawUrl: string,
  applicationOrigin: string,
): NavigationDisposition {
  let destination: URL
  try {
    destination = new URL(rawUrl)
  } catch {
    return 'blocked'
  }
  if (destination.origin === applicationOrigin) return 'application'
  if (destination.protocol === 'https:') return 'external'
  return 'blocked'
}

/**
 * Accept only the dedicated same-origin SaturnBot window route.
 * @param rawUrl - Absolute popup destination supplied by Electron.
 * @param applicationOrigin - Exact origin of this desktop's authenticated server.
 * @returns Whether a separate application window may load this destination.
 */
export function isSaturnBotWindowUrl(rawUrl: string, applicationOrigin: string): boolean {
  let destination: URL
  try { destination = new URL(rawUrl) } catch { return false }
  return destination.origin === applicationOrigin && destination.pathname === '/'
    && destination.username === '' && destination.password === '' && destination.hash === ''
    && destination.searchParams.size === 1 && destination.searchParams.get('saturnbot') === '1'
}

/**
 * Restore the existing SaturnBot window without navigating or replacing its renderer.
 * @param window - The desktop-owned popup, when it has been opened.
 * @returns Whether an existing popup was shown and focused.
 */
export function restoreSaturnBotWindow(
  window: Pick<BrowserWindow, 'isDestroyed' | 'isMinimized' | 'restore' | 'show' | 'focus'> | undefined,
): boolean {
  if (window === undefined || window.isDestroyed()) return false
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
  return true
}

/**
 * Coordinate native quit requests around the Harness disposer.
 * @param shutdown - controller for the booted Harness tree.
 * @param exit - native process exit callback, called only after disposal settles.
 * @returns A controller that coalesces repeated quit requests.
 */
export function createQuitCoordinator(
  shutdown: DesktopShutdown,
  exit: (code: number) => void,
): QuitCoordinator {
  let pending: Promise<void> | undefined
  return {
    get requested() {
      return pending !== undefined
    },
    request(code) {
      pending ??= shutdown.shutdown(code).then(() => { exit(code) })
      return pending
    },
  }
}

/**
 * One tray menu item template: the Electron `MenuItemConstructorOptions`
 * subset the tray uses, with a zero-argument click callback so tests can
 * invoke it without Electron menu arguments.
 */
export interface TrayMenuTemplateItem {
  label?: string
  type?: 'separator'
  click?: () => void
}

/**
 * The tray actions the main process wires to the window, About, and quit
 * flows. `productName` is supplied by the main process rather than written
 * here so this module holds no product-identity literal; every user-visible
 * label that names the product is composed from it.
 */
export interface TrayActions {
  /** The application product name the tray labels are composed from. */
  productName: string
  /** Show and focus the main window, recreating it when it does not exist. */
  show: () => void
  /** Show the About surface for the running build. */
  about: () => void
  /** Request a real application exit through the Harness shutdown controller. */
  quit: () => void
}

/** Whether a main-window close request hides to the tray or really closes. */
export type CloseDisposition = 'hide' | 'close'

/**
 * Decide a window close request under the tray policy: hide unless a real
 * quit already owns teardown.
 * @param quitArmed - whether a quit request is in flight or already completed.
 * @returns the close disposition the main window must follow.
 */
export function windowCloseDisposition(quitArmed: boolean): CloseDisposition {
  return quitArmed ? 'close' : 'hide'
}

/**
 * Build the tray context-menu template: the window action, the About
 * surface, and the exit. macOS also renders the application menu built by
 * `buildApplicationMenu`, so the tray stays the two-action surface there and
 * the About item is the shared entry point on every platform.
 * @param actions - the product name and the show, about, and quit callbacks.
 * @returns the menu template for `Menu.buildFromTemplate`.
 */
export function buildTrayMenu(actions: TrayActions): TrayMenuTemplateItem[] {
  return [
    { label: `Show ${actions.productName}`, click: actions.show },
    { type: 'separator' },
    { label: `About ${actions.productName}\u2026`, click: actions.about },
    { type: 'separator' },
    { label: `Quit ${actions.productName}`, click: actions.quit },
  ]
}

/**
 * Resolve the tray icon file for a platform: the colored app logo everywhere.
 * macOS loads it as a 1x/2x representation pair (`tray16.png`/`tray.png`);
 * Windows and Linux use the 32 px file directly.
 * @param platform - the running platform.
 * @returns the icon filename under the packaged `assets/` directory.
 */
export function trayIconFile(platform: NodeJS.Platform): string {
  return platform === 'darwin' ? 'tray16.png' : 'tray.png'
}

/** Launch argument marking a custom (hidden) window frame on Windows. */
export const DESKTOP_FRAME_ARG = '--dsh-frame=custom'

/** Launch-argument prefix carrying the URL-encoded product name. */
const DESKTOP_PRODUCT_ARG_PREFIX = '--dsh-product-name='

/** Launch-argument prefix carrying the packaged application version. */
const DESKTOP_VERSION_ARG_PREFIX = '--dsh-app-version='

/** IPC channel the renderer menu button invokes to pop the window menu. */
export const DESKTOP_SHOW_MENU_CHANNEL = 'desktop:show-menu'

/** IPC channel through which the main harness restores its retained SaturnBot window. */
export const DESKTOP_RESTORE_SATURNBOT_CHANNEL = 'desktop:restore-saturnbot'

/** IPC channel the renderer invokes to restart the application in place. */
export const DESKTOP_RESTART_CHANNEL = 'desktop:restart'

/** IPC channel the renderer invokes to surface one native OS notification. */
export const DESKTOP_NOTIFICATION_CHANNEL = 'desktop:notification'

/** IPC channel the main process pushes a clicked notification's request id back to the renderer. */
export const DESKTOP_NOTIFICATION_CLICK_CHANNEL = 'desktop:notification-click'

/** IPC channel the renderer invokes to read the izzy.la product session. */
export const DESKTOP_ACCOUNT_STATUS_CHANNEL = 'desktop:account-status'

/** IPC channel the renderer invokes to start Sign in with izzy.la. */
export const DESKTOP_ACCOUNT_SIGN_IN_CHANNEL = 'desktop:account-sign-in'

/** IPC channel the renderer invokes to drop the product session. */
export const DESKTOP_ACCOUNT_SIGN_OUT_CHANNEL = 'desktop:account-sign-out'

/** IPC channel the renderer invokes to check the GitHub update feed. */
export const DESKTOP_CHECK_UPDATES_CHANNEL = 'desktop:check-updates'

/** IPC channel the renderer invokes to open an allowlisted GitHub release. */
export const DESKTOP_OPEN_RELEASE_CHANNEL = 'desktop:open-release'

/** What the renderer learns about the desktop window frame. */
export interface DesktopBridgePayload {
  /** 'custom' when the window renders its own title-bar row (Windows). */
  readonly frame: 'custom' | 'native'
  /** The application product name shown in the title-bar row. */
  readonly productName: string
  /** The packaged application version ('' when the launch carries no version argument). */
  readonly appVersion: string
}

/**
 * Build the preload launch arguments carrying the product name and the
 * application version (URL-encoded because the renderer receives them
 * verbatim). Passed on every platform; the custom-frame argument is
 * platform-owned and the caller appends it separately (Windows only).
 * @param productName - the application product name.
 * @param appVersion - the packaged application version.
 * @returns the `additionalArguments` shared by every platform.
 */
export function desktopLaunchArguments(productName: string, appVersion: string): string[] {
  return [
    `${DESKTOP_PRODUCT_ARG_PREFIX}${encodeURIComponent(productName)}`,
    `${DESKTOP_VERSION_ARG_PREFIX}${encodeURIComponent(appVersion)}`,
  ]
}

/**
 * Parse the preload bridge payload from the renderer process arguments.
 * @param argv - the renderer `process.argv` (includes `additionalArguments`).
 * @returns the bridge payload; an absent product name or version yields an empty string.
 */
export function desktopBridgePayload(argv: readonly string[], _platform: NodeJS.Platform): DesktopBridgePayload {
  const productArg = argv.find(arg => arg.startsWith(DESKTOP_PRODUCT_ARG_PREFIX))
  const versionArg = argv.find(arg => arg.startsWith(DESKTOP_VERSION_ARG_PREFIX))
  return {
    frame: argv.includes(DESKTOP_FRAME_ARG) ? 'custom' : 'native',
    productName: productArg === undefined ? '' : decodeURIComponent(productArg.slice(DESKTOP_PRODUCT_ARG_PREFIX.length)),
    appVersion: versionArg === undefined ? '' : decodeURIComponent(versionArg.slice(DESKTOP_VERSION_ARG_PREFIX.length)),
  }
}

/**
 * Verify an IPC sender against the application origin before honoring it.
 * @param senderUrl - the sender frame URL (`event.senderFrame.url`), absent
 * when the frame is gone.
 * @param applicationOrigin - the exact application origin.
 * @returns whether the sender is a page of the application.
 */
export function desktopIpcSenderIsApplication(senderUrl: string | undefined, applicationOrigin: string): boolean {
  if (senderUrl === undefined) return false
  try {
    return new URL(senderUrl).origin === applicationOrigin
  } catch {
    return false
  }
}

/** The actions the title-bar window menu wires. */
export interface WindowMenuActions {
  /** The application product name the menu labels are composed from. */
  productName: string
  /** Show the About surface for the running build. */
  about: () => void
  /** Hide the main window to the tray. */
  hide: () => void
  /** Restart the whole application in place (applies profile/patch changes). */
  restart: () => void
  /** Request a real application exit through the Harness shutdown controller. */
  quit: () => void
  /** User-initiated check against the GitHub update feed. Never silent. */
  checkUpdates: () => void
}

/**
 * Build the window menu template popped by the title-bar menu button. The
 * rows group identity first, then the user-initiated update check, then the
 * two application-lifecycle actions the shell owns (restart to apply profile
 * and patch changes, hide to the tray), then the exit; no accelerator is
 * declared because Electron registers a popup menu's accelerators only from
 * an application menu, and a displayed binding that does not fire is worse
 * than none.
 * @param actions - the product name and the about, update, restart, hide, and quit callbacks.
 * @returns the menu template for `Menu.buildFromTemplate`.
 */
export function buildWindowMenu(actions: WindowMenuActions): TrayMenuTemplateItem[] {
  return [
    { label: `About ${actions.productName}\u2026`, click: actions.about },
    { type: 'separator' },
    { label: 'Check for Updates\u2026', click: actions.checkUpdates },
    { label: `Restart ${actions.productName}`, click: actions.restart },
    { label: 'Hide to Tray', click: actions.hide },
    { type: 'separator' },
    { label: `Quit ${actions.productName}`, click: actions.quit },
  ]
}

/**
 * One application-menu item template: the Electron
 * `MenuItemConstructorOptions` subset the macOS menu bar uses, with a
 * zero-argument click callback and a recursive `submenu` so both the template
 * and the tests stay free of Electron menu arguments.
 */
export interface ApplicationMenuTemplateItem {
  label?: string
  // NonNullable: an indexed access on Electron's optional `role` admits an
  // explicit undefined, which this repo's exactOptionalPropertyTypes rejects.
  role?: NonNullable<MenuItemConstructorOptions['role']>
  type?: 'separator'
  click?: () => void
  submenu?: ApplicationMenuTemplateItem[]
}

/** The application-menu actions the macOS menu bar wires. */
export interface ApplicationMenuActions {
  /** The application product name naming the leading menu. */
  productName: string
  /** Show the About surface for the running build. */
  about: () => void
}

/**
 * Build the macOS application-menu template. Every row is an Electron role
 * rather than a label, so the standard bindings (Cmd+Z/C/X/V/A, Cmd+Q, Cmd+W,
 * Cmd+M, Cmd+R, the zoom pair, full screen) come from Electron exactly as the
 * stock menu supplied them, and no product copy is written here. Only the
 * About row is a custom item, because it must open the shell's own About
 * surface instead of the native panel. The stock Help menu is dropped: its
 * single row links to the Electron project, which is upstream shell branding
 * rather than this product's.
 * @param actions - the product name and the About callback.
 * @returns the menu template for `Menu.setApplicationMenu`.
 */
export function buildApplicationMenu(actions: ApplicationMenuActions): ApplicationMenuTemplateItem[] {
  return [
    {
      label: actions.productName,
      submenu: [
        { label: `About ${actions.productName}\u2026`, click: actions.about },
        { type: 'separator' },
        { role: 'services', submenu: [] },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
  ]
}
