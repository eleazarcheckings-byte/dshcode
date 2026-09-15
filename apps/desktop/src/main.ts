/** Electron main process for the no-CLI Saturn AI desktop application. */

import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, session, shell, Tray } from 'electron'
import type { NativeImage } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PROFILE_PATCH_FILENAME, resolveProfileDir } from '@deepseek-ai/dsh-app-boot'
import { loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import {
  pruneBootFailures,
  readPluginState,
  readSafeMode,
  setPluginRowEnabled,
  setSafeMode,
} from '@deepseek-ai/dsh-host-plugin-installer'
import { runProfile } from '@deepseek-ai/dsh/profile-boot'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-client-connection'
import {
  buildApplicationMenu,
  buildTrayMenu,
  buildWindowMenu,
  createQuitCoordinator,
  desktopApplicationUrl,
  desktopIpcSenderIsApplication,
  desktopLaunchArguments,
  desktopWebArguments,
  DESKTOP_FRAME_ARG,
  DESKTOP_RESTART_CHANNEL,
  DESKTOP_NOTIFICATION_CHANNEL,
  DESKTOP_NOTIFICATION_CLICK_CHANNEL,
  DESKTOP_SHOW_MENU_CHANNEL,
  DESKTOP_RESTORE_SATURNBOT_CHANNEL,
  ensureMainModuleArgument,
  navigationDisposition,
  isSaturnBotWindowUrl,
  restoreSaturnBotWindow,
  trayIconFile,
  windowCloseDisposition,
  type QuitCoordinator,
} from './lifecycle.ts'
import { aboutSurface } from './about.ts'
import { readBootMarker, writeBootMarker } from './boot-marker.ts'
import { installCrashMonitor, type CrashMonitor } from './crash-monitor.ts'
import {
  clearResolvedFailures,
  CONSECUTIVE_FAILURE_THRESHOLD,
  DESKTOP_BOOT_TIMEOUT_MS,
  failureMessage,
  recordBootFailures,
  recordLateRejection,
  recoveryDecision,
  withBootTimeout,
} from './recovery.ts'

const PRODUCT_NAME = 'Saturn AI'
const APP_ID = 'tools.saturnai.desktop'
/**
 * Window chrome colors match the Saturn AI monochrome palette:
 * `void` (the app background) and `ink` (the window-control symbols).
 * The renderer's skin resolves the same two values, so the title-bar overlay
 * and the OS-drawn window frame sit on one continuous surface with no seam.
 */
const CHROME_VOID = '#0a0a0a'
const CHROME_INK = '#efefef'
/** Absolute directory of the bundled main module (Contents/Resources/app/lib). */
const mainDir = fileURLToPath(new URL('.', import.meta.url))
let mainWindow: BrowserWindow | undefined
let saturnBotWindow: BrowserWindow | undefined
let applicationUrl: string | undefined
let quitCoordinator: QuitCoordinator | undefined
let nativeExitAllowed = false
let quitArmed = false
let tray: Tray | undefined
/**
 * The crash monitor for this launch. Installed as soon as the Harness home is
 * known and before the Harness tree is built, so a death during startup still
 * leaves a tombstone the next launch can read.
 */
let crashMonitor: CrashMonitor | undefined

function reportExternalOpenFailure(error: unknown): void {
  console.error(`${PRODUCT_NAME}: failed to open external link`, error)
}

function openExternal(rawUrl: string): void {
  void shell.openExternal(rawUrl).catch(reportExternalOpenFailure)
}

function installRendererPolicy(window: BrowserWindow, origin: string, allowSaturnBot = true): void {
  window.webContents.on('will-navigate', (event, rawUrl) => {
    const disposition = navigationDisposition(rawUrl, origin)
    if (disposition === 'application') return
    event.preventDefault()
    if (disposition === 'external') openExternal(rawUrl)
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (allowSaturnBot && isSaturnBotWindowUrl(url, origin)) {
      if (restoreSaturnBotWindow(saturnBotWindow)) return { action: 'deny' }
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          title: 'SaturnBot', width: 1380, height: 900, minWidth: 760, minHeight: 600,
          backgroundColor: CHROME_VOID, autoHideMenuBar: true, skipTaskbar: true,
          webPreferences: {
            contextIsolation: true, nodeIntegration: false, sandbox: true,
            webSecurity: true, allowRunningInsecureContent: false, webviewTag: false,
            navigateOnDragDrop: false, preload: join(mainDir, 'preload.cjs'),
            additionalArguments: desktopLaunchArguments('SaturnBot', app.getVersion()),
          },
        },
      }
    }
    if (navigationDisposition(url, origin) === 'external') openExternal(url)
    return { action: 'deny' }
  })
  if (allowSaturnBot) {
    window.webContents.on('did-create-window', (child, details) => {
      if (!isSaturnBotWindowUrl(details.url, origin)) { child.close(); return }
      saturnBotWindow = child
      installRendererPolicy(child, origin, false)
      crashMonitor?.attachWindow(child)
      child.on('minimize', () => {
        if (quitArmed || nativeExitAllowed) return
        child.hide()
        showMainWindow()
      })
      child.on('page-title-updated', (event) => { event.preventDefault(); child.setTitle('SaturnBot') })
      child.on('closed', () => { if (saturnBotWindow === child) saturnBotWindow = undefined })
    })
  }
}

/**
 * Show and focus the main window, recreating it when it no longer exists.
 * Used by the tray, the second-instance lock, and macOS dock activation: a
 * hidden window restores, a closed one relaunches against the still-running
 * application URL.
 */
function showMainWindow(): void {
  if (mainWindow !== undefined) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
    return
  }
  if (applicationUrl === undefined) return
  void createMainWindow(applicationUrl).catch((error: unknown) => {
    dialog.showErrorBox(`${PRODUCT_NAME} could not open`, error instanceof Error ? error.message : String(error))
    requestQuit(1)
  })
}

/**
 * Load the ring glyph shown as the About surface's icon. A missing or
 * unreadable asset yields undefined so the dialog opens without an icon
 * rather than failing.
 * @returns the About icon, or undefined when the asset is unavailable.
 */
function aboutIcon(): NativeImage | undefined {
  const image = nativeImage.createFromPath(join(mainDir, '..', 'assets', 'about.png'))
  return image.isEmpty() ? undefined : image
}

/**
 * Show the About surface: the product name, the packaged version, the runtime
 * stack the build shipped with, the Saturn ring glyph as its icon, and the MIT
 * attribution line. A native message box rather than a BrowserWindow because
 * the shell owns no local renderer document — its only page is the Harness web
 * UI served over loopback — so a window would need a second page, its own
 * navigation policy, and a lifecycle to close it, while the dialog is one call
 * on the same `dialog` surface the recovery paths already use.
 */
function showAbout(): void {
  const icon = aboutIcon()
  const surface = aboutSurface(PRODUCT_NAME, app.getVersion(), {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  })
  void dialog.showMessageBox({
    type: 'info',
    title: `About ${PRODUCT_NAME}`,
    message: surface.message,
    detail: surface.detail,
    buttons: ['Close'],
    defaultId: 0,
    noLink: true,
    ...(icon === undefined ? {} : { icon }),
  })
}

/**
 * Install the application menu. Windows and Linux remove it: the native menu
 * bar would render as a full-width row below the custom title bar, and the
 * tray, the title-bar menu button, and the embedded web UI own application
 * commands there. macOS keeps a menu bar and cannot work without one — its
 * Edit roles are what bind Cmd+C/V/X/A — so it receives the branded
 * application menu, which replaces the stock File/Edit/View/Help/Window bar
 * and its upstream Help link while preserving every role binding.
 */
function installMenus(): void {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
    return
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildApplicationMenu({
    productName: PRODUCT_NAME,
    about: showAbout,
  })))
}

/**
 * Install the system tray: the colored app logo on every platform, with the
 * primary click showing the main window and the secondary click popping the
 * context menu. Creation is guarded because some Linux desktops provide no
 * tray host; the window close-to-tray policy then degrades to a real close.
 * The macOS image carries explicit 1x/2x representations so the logo renders
 * crisply on Retina displays.
 */
function installTray(): void {
  if (tray !== undefined) return
  try {
    const assetsDir = join(mainDir, '..', 'assets')
    const image = process.platform === 'darwin'
      ? (() => {
        const logo = nativeImage.createEmpty()
        logo.addRepresentation({ scaleFactor: 1, buffer: readFileSync(join(assetsDir, 'tray16.png')) })
        logo.addRepresentation({ scaleFactor: 2, buffer: readFileSync(join(assetsDir, 'tray.png')) })
        return logo
      })()
      : nativeImage.createFromPath(join(assetsDir, trayIconFile(process.platform)))
    const trayIcon = new Tray(image)
    trayIcon.setToolTip(PRODUCT_NAME)
    const menu = Menu.buildFromTemplate(buildTrayMenu({
      productName: PRODUCT_NAME,
      show: showMainWindow,
      about: showAbout,
      quit: () => {
        quitArmed = true
        requestQuit(0)
      },
    }))
    if (process.platform === 'darwin') {
      // On macOS a set context menu swallows the left-click event, so the
      // primary click shows the window and the secondary click pops the menu.
      trayIcon.on('click', showMainWindow)
      trayIcon.on('right-click', () => { trayIcon.popUpContextMenu(menu) })
    } else {
      trayIcon.setContextMenu(menu)
      trayIcon.on('click', showMainWindow)
    }
    tray = trayIcon
  } catch (error) {
    console.error(`${PRODUCT_NAME}: system tray unavailable`, error)
  }
}

async function createMainWindow(rawUrl: string): Promise<void> {
  const origin = new URL(rawUrl).origin
  // Windows runs a custom single-row title bar: the renderer draws the
  // product name and menu button in a drag region, while titleBarOverlay
  // keeps native minimize/maximize/close buttons on the same row. The
  // preload bridge (CJS; sandboxed preloads cannot load ESM) carries the
  // product name and application version on every platform (the UI shows the
  // version); only Windows additionally receives the custom-frame argument —
  // a native-frame platform must never see `--dsh-frame=custom`, or the
  // renderer would draw the Windows chrome over the system title bar.
  const customFrame = process.platform === 'win32'
  const window = new BrowserWindow({
    title: PRODUCT_NAME,
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: CHROME_VOID,
    ...(customFrame
      ? {
        titleBarStyle: 'hidden' as const,
        titleBarOverlay: {
          // The shell's darkest rung and its ink: the overlay strip must be
          // the same value the renderer paints beneath it, or the seam shows.
          color: CHROME_VOID,
          symbolColor: CHROME_INK,
          height: 38,
        },
      }
      : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      navigateOnDragDrop: false,
      preload: join(mainDir, 'preload.cjs'),
      additionalArguments: customFrame
        ? [DESKTOP_FRAME_ARG, ...desktopLaunchArguments(PRODUCT_NAME, app.getVersion())]
        : desktopLaunchArguments(PRODUCT_NAME, app.getVersion()),
    },
  })
  mainWindow = window
  installRendererPolicy(window, origin)
  crashMonitor?.attachWindow(window)
  window.on('page-title-updated', (event) => {
    event.preventDefault()
    window.setTitle(PRODUCT_NAME)
  })
  // Closing the window hides to the tray unless a real quit owns teardown;
  // without a tray host (some Linux desktops) the close really closes.
  window.on('close', (event) => {
    if (tray !== undefined && windowCloseDisposition(quitArmed) === 'hide') {
      event.preventDefault()
      window.hide()
    }
  })
  window.once('ready-to-show', () => { window.show() })
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = undefined
  })
  await window.loadURL(rawUrl)
}

function finishNativeExit(code: number): void {
  // The single exit funnel for every graceful quit. Stamping the run clean
  // here is what keeps a normal close from being reported as a crash next
  // launch; it is synchronous and cannot fail the exit.
  crashMonitor?.markClean(code)
  nativeExitAllowed = true
  app.exit(code)
}

function requestQuit(code: number): void {
  // A quit is in flight: teardown noise (a renderer torn down mid-shutdown)
  // must not be filed as a crash.
  crashMonitor?.noteQuitStarted()
  const coordinator = quitCoordinator
  if (coordinator === undefined) {
    finishNativeExit(code)
    return
  }
  void coordinator.request(code).catch((error: unknown) => {
    console.error(`${PRODUCT_NAME}: shutdown failed`, error)
    finishNativeExit(1)
  })
}

/**
 * Record a late unhandled rejection. The fail-loud guard reports every late
 * rejection here, both the startup-window ones (the tree is suspect, so the
 * default hard exit still follows) and the post-readiness ones (the session
 * keeps running). The failure is attributed to an installed plugin when its
 * name appears in the rejection; next launch the plugin list shows the badge,
 * and a startup that dies before `ok` still triggers the recovery dialog
 * through the boot marker.
 */
function reportLateRejection(error: unknown): void {
  const home = resolveDshHome()
  // A pre-readiness rejection is fatal through the fail-loud guard, so it is
  // also a death worth a reviewable report. After readiness the guard keeps
  // the session alive and the monitor declines, leaving the existing
  // boot-failures.json late-rejection record as the soft-failure signal.
  crashMonitor?.reportRejection(error)
  try {
    void recordLateRejection(home, error, readPluginState(home).plugins).catch((writeError: unknown) => {
      console.error(`${PRODUCT_NAME}: failed to record late rejection`, writeError)
    })
  } catch (recordError) {
    console.error(`${PRODUCT_NAME}: failed to record late rejection`, recordError)
  }
}

/**
 * Handle a failed desktop boot: record the attributable failures, then show
 * the recovery dialog offering to disable the blamed plugins and restart,
 * to start in safe mode (skip the user patch layers), or to exit. Every path
 * terminates the process — the caller must not continue startup after this.
 */
async function handleStartupFailure(
  error: unknown,
  context: {
    home: string
    profilePatchPath: string
    lastOkAt: string | undefined
    bootAttempts: number
    safeMode: boolean
  },
): Promise<void> {
  const { home, profilePatchPath, lastOkAt, bootAttempts, safeMode } = context
  const decision = recoveryDecision({ error, installed: readPluginState(home).plugins, lastOkAt })
  // Record the death before the dialog and before the exit: this is the one
  // failure the user is about to be told about, and the report is what makes
  // the next occurrence diagnosable without archaeology. The write is
  // synchronous and defensive, so it cannot delay the dialog perceptibly.
  crashMonitor?.reportBootFailure({
    message: decision.message,
    stack: decision.stack,
    hang: decision.hang,
    pluginIds: decision.pluginIds,
    safeMode,
  })

  // Safe mode failing still means a broken bundle layer or overlay, not a
  // user plugin; retry or exit, without disabling anything.
  if (safeMode) {
    const { response } = await dialog.showMessageBox({
      type: 'error',
      title: `${PRODUCT_NAME} failed to start`,
      message: 'Could not start even in safe mode',
      detail: `${decision.message}\n\nSafe mode already skipped user plugin configuration; the problem is likely in the bundled components or the installation itself. Retry, or exit and check the installation.`,
      buttons: ['Restart App', 'Quit'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    })
    if (response === 0) {
      app.relaunch()
      requestQuit(0)
      return
    }
    requestQuit(1)
    return
  }

  const attributable = decision.kind === 'attributable'
  if (attributable) await recordBootFailures(home, decision)
  const crashLoopHint = bootAttempts >= CONSECUTIVE_FAILURE_THRESHOLD
    ? '\n\nSeveral consecutive launches failed; try safe mode.'
    : ''
  const detail = attributable
    ? `The following plugins failed to load: ${decision.pluginIds.join(', ')}\n\n${decision.message}${crashLoopHint}`
    : `Could not determine which plugin caused the startup failure.${crashLoopHint}\n\n${decision.message}`
  const safeModeIndex = attributable ? 1 : 0
  const buttons = attributable ? ['Continue (disable plugins and restart)', 'Start in Safe Mode', 'Quit'] : ['Start in Safe Mode', 'Quit']
  const { response } = await dialog.showMessageBox({
    type: 'error',
    title: `${PRODUCT_NAME} failed to start`,
    message: 'Plugin startup failure',
    detail,
    buttons,
    defaultId: crashLoopHint !== '' ? safeModeIndex : 0,
    cancelId: buttons.length - 1,
    noLink: true,
  })
  if (attributable && response === 0) {
    for (const pluginId of decision.pluginIds) {
      try {
        await setPluginRowEnabled(profilePatchPath, pluginId, false)
      } catch (disableError) {
        console.error(`${PRODUCT_NAME}: failed to disable ${pluginId}`, disableError)
      }
    }
    app.relaunch()
    requestQuit(0)
    return
  }
  if (response === safeModeIndex) {
    await setSafeMode(home, true)
    app.relaunch()
    requestQuit(0)
    return
  }
  requestQuit(1)
}

async function startDesktop(): Promise<void> {
  app.setName(PRODUCT_NAME)
  app.setAppUserModelId(APP_ID)
  ensureMainModuleArgument(process.argv, fileURLToPath(import.meta.url))
  process.chdir(app.getPath('home'))

  // Windows and Linux would otherwise render the default File/Edit/View
  // menu bar as a full-width row below the title bar; the tray context menu
  // and the embedded Web UI own application commands. macOS keeps its system
  // menu bar (app menu, standard edit roles, Cmd+Q).
  installMenus()
  installTray()

  // Deny every renderer permission except the sanitized clipboard write the
  // Web UI's copy buttons need: `navigator.clipboard.writeText` rejects when
  // `clipboard-sanitized-write` is refused, which would make every copy
  // control a silent no-op. Everything else (notifications, media, location)
  // stays denied.
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    return permission === 'clipboard-sanitized-write'
  })
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'clipboard-sanitized-write')
  })

  const home = resolveDshHome()
  const profilePatchPath = join(resolveProfileDir('web', home), PROFILE_PATCH_FILENAME)
  // Boot lifecycle marker: a previous `started` without a following `ok`
  // means the last launch died during startup, and the attempt counter
  // drives the safe-mode default of the recovery dialog. Diagnostics must
  // never block startup, so every marker failure degrades to first-run.
  const previousMarker = readBootMarker(home)
  const marker = await writeBootMarker(home, 'started').catch((error: unknown) => {
    console.error(`${PRODUCT_NAME}: failed to write boot marker`, error)
    return undefined
  })
  await pruneBootFailures(home).catch((error: unknown) => {
    console.error(`${PRODUCT_NAME}: failed to sweep boot failures`, error)
  })
  const safeMode = readSafeMode(home)

  // Crash reporting is installed here, before the Harness tree is built: the
  // run tombstone must be on disk while the shell is still starting, or a
  // death during startup would leave no witness. The previous marker state is
  // passed through because that marker is the only record of a launch that
  // died before the tombstone existed. The reporter is diagnostics, so a
  // failure to install it must never keep the shell from starting.
  try {
    crashMonitor = installCrashMonitor({
      home,
      productName: PRODUCT_NAME,
      appVersion: app.getVersion(),
      appPath: app.getAppPath(),
      mainModulePath: fileURLToPath(import.meta.url),
      isPackaged: app.isPackaged,
      runtime: {
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node,
      },
      ...previousMarker?.state === undefined ? {} : { bootMarkerState: previousMarker.state },
      ...marker?.bootAttempts === undefined ? {} : { bootAttempts: marker.bootAttempts },
    })
  } catch (crashMonitorError) {
    console.error(`${PRODUCT_NAME}: crash monitor unavailable`, crashMonitorError)
  }

  let running: Awaited<ReturnType<typeof runProfile>>
  try {
    running = await withBootTimeout(runProfile({
      environment: loadLayeredEnv('dsh'),
      profile: 'web',
      patchFiles: [],
      args: desktopWebArguments(),
      watchUserPatches: false,
      skipUserPatches: safeMode,
      failLoud: reportLateRejection,
    }), DESKTOP_BOOT_TIMEOUT_MS)
  } catch (error) {
    await handleStartupFailure(error, {
      home,
      profilePatchPath,
      lastOkAt: previousMarker?.state === 'ok' ? previousMarker.at : undefined,
      bootAttempts: marker?.bootAttempts ?? 1,
      safeMode,
    })
    return
  }
  await writeBootMarker(home, 'ok').catch((error: unknown) => {
    console.error(`${PRODUCT_NAME}: failed to write boot marker`, error)
  })
  // The tree is up: from here on a death is an in-session crash rather than a
  // failed startup, and the heartbeat keeps the tombstone's last-alive time
  // honest for the next launch's report.
  crashMonitor?.markReady()
  await clearResolvedFailures(home, profilePatchPath).catch((error: unknown) => {
    console.error(`${PRODUCT_NAME}: failed to clear resolved boot failures`, error)
  })
  quitCoordinator = createQuitCoordinator(running.shutdown, finishNativeExit)
  applicationUrl = running.ctx.connection.authenticatedUrl(
    desktopApplicationUrl(running.ctx.webServer.host, running.ctx.webServer.port),
  )
  // The title-bar menu button pops a native window menu; only a page of the
  // application origin may invoke it.
  ipcMain.handle(DESKTOP_SHOW_MENU_CHANNEL, (event) => {
    if (mainWindow === undefined || applicationUrl === undefined) return
    if (!desktopIpcSenderIsApplication(event.senderFrame?.url, new URL(applicationUrl).origin)) return
    Menu.buildFromTemplate(buildWindowMenu({
      productName: PRODUCT_NAME,
      about: showAbout,
      hide: () => { mainWindow?.hide() },
      restart: () => {
        quitArmed = true
        app.relaunch()
        requestQuit(0)
      },
      quit: () => {
        quitArmed = true
        requestQuit(0)
      },
    })).popup({ window: mainWindow })
  })
  ipcMain.handle(DESKTOP_RESTORE_SATURNBOT_CHANNEL, (event) => {
    if (mainWindow === undefined || applicationUrl === undefined) return false
    if (event.sender !== mainWindow.webContents) return false
    if (!desktopIpcSenderIsApplication(event.senderFrame?.url, new URL(applicationUrl).origin)) return false
    return restoreSaturnBotWindow(saturnBotWindow)
  })
  // The plugin-management surface restarts the whole application in place so
  // profile and patch changes take effect (packaged Electron cannot hot-apply
  // host plugins). relaunch() is queued before the Harness shutdown so the
  // process restarts regardless of how teardown settles.
  ipcMain.handle(DESKTOP_RESTART_CHANNEL, (event) => {
    if (applicationUrl === undefined) return
    if (!desktopIpcSenderIsApplication(event.senderFrame?.url, new URL(applicationUrl).origin)) return
    quitArmed = true
    app.relaunch()
    requestQuit(0)
  })
  // Native OS notifications: the renderer's notification sink detects this
  // bridge and routes every notification through the main process. A click
  // shows the window (close-to-tray may have hidden it) and echoes the
  // request id back so the renderer opens the notification's target session.
  ipcMain.handle(DESKTOP_NOTIFICATION_CHANNEL, (event, request: { id: string; title: string; body?: string }) => {
    if (applicationUrl === undefined) return
    if (!desktopIpcSenderIsApplication(event.senderFrame?.url, new URL(applicationUrl).origin)) return
    if (!Notification.isSupported()) return
    const notification = new Notification({
      title: request.title,
      ...(request.body === undefined ? {} : { body: request.body }),
    })
    notification.on('click', () => {
      showMainWindow()
      if (mainWindow !== undefined && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(DESKTOP_NOTIFICATION_CLICK_CHANNEL, request.id)
      }
    })
    notification.show()
  })
  await createMainWindow(applicationUrl)
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    // A second launch restores a tray-hidden window (or recreates a closed
    // one) instead of starting another Harness tree.
    showMainWindow()
  })
  app.on('before-quit', (event) => {
    if (nativeExitAllowed) return
    event.preventDefault()
    quitArmed = true
    requestQuit(0)
  })
  app.on('window-all-closed', () => {
    // The close-to-tray policy hides the window, so this only fires while a
    // real quit closes the window; the quit path already owns teardown.
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('activate', () => {
    // The close-to-tray policy leaves the window existing but hidden, and
    // unlike an application-level hide macOS does not restore it on dock
    // activation. showMainWindow() restores a hidden window or recreates a
    // closed one against the still-running profile.
    showMainWindow()
  })

  void app.whenReady().then(startDesktop).catch((error: unknown) => {
    // A failure outside the Harness boot sequence (menu, tray, window
    // creation, the application URL) still ends the process. Record it rather
    // than leaving only a box on screen and no evidence on disk.
    try {
      const { message, stack } = failureMessage(error)
      crashMonitor?.reportBootFailure({
        message,
        stack,
        hang: false,
        pluginIds: [],
        safeMode: readSafeMode(resolveDshHome()),
        notes: ['The failure surfaced outside the Harness boot sequence.'],
      })
    } catch (recordError) {
      console.error(`${PRODUCT_NAME}: failed to record startup failure`, recordError)
    }
    dialog.showErrorBox(`${PRODUCT_NAME} could not start`, error instanceof Error ? error.message : String(error))
    requestQuit(1)
  })
}
