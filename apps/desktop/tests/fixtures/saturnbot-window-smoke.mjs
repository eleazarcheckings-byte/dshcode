/** Exercise the shipped desktop launcher, visualization control, and native minimize lifecycle in a private profile. */
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, dialog, shell } from 'electron'

const root = process.env.DSHCODE_SATURNBOT_SMOKE_ROOT
const main = process.env.DSHCODE_SATURNBOT_SMOKE_MAIN
if (!root || !main || !isAbsolute(root) || !isAbsolute(main)) {
  throw new Error('SaturnBot smoke requires absolute private root and desktop main paths.')
}
const harness = join(root, 'harness')
assert.equal(resolve(process.env.DSH_HOME ?? ''), harness, 'The smoke must use its private Harness home.')
assert.ok(resolve(process.env.DSH_AGENTS_HOME ?? '').startsWith(root + sep), 'Agent storage must stay inside the smoke root.')
const workspace = join(root, 'workspace')
for (const directory of [join(root, 'electron'), join(harness, 'saturnbot'), workspace]) mkdirSync(directory, { recursive: true })
app.setPath('home', root)
app.setPath('userData', join(root, 'electron'))
app.commandLine.appendSwitch('lang', 'en-US')
// The compositor needs no provider: a disabled schedule and inert fixture route allow typing only.
writeFileSync(join(harness, 'saturnbot', 'config.yaml'), JSON.stringify({
  version: 1, enabled: false, workspace, goal: 'Native window lifecycle smoke; never execute a task.',
  provider: 'saturnbot-window-smoke-unused', model: 'unused', allowedTools: [],
}))
writeFileSync(join(harness, 'settings.yaml'), JSON.stringify({
  'ui-first-light': { complete: '2026-09-14.1' }, 'ui-onboarding': { welcomeNoticeVersion: '2026-08-13.1' },
}))

let finished = false
let mainWindow
let popup
let popupCount = 0
let popupLoads = 0
let nativeMinimizes = 0
let popupSkipTaskbar = false
let visualizationPaused = false
let visualizationResumed = false
let hostJournalUnchanged = false
const steps = []
const startedAt = Date.now()
const deadline = setTimeout(() => finish(false, 'Native SaturnBot smoke exceeded 85 seconds.'), 85_000)

/** Persist bounded evidence before using the product's normal asynchronous shutdown. */
function finish(ok, detail) {
  if (finished) return
  finished = true
  clearTimeout(deadline)
  writeFileSync(join(root, 'result.json'), JSON.stringify({
    ok, detail, platform: process.platform, electron: process.versions.electron, version: app.getVersion(),
    elapsedMs: Date.now() - startedAt, popupCount, popupLoads, nativeMinimizes, popupSkipTaskbar,
    visualizationPaused, visualizationResumed, hostJournalUnchanged, steps,
  }, null, 2) + '\n')
  app.quit()
}

/** Wait for a native or renderer condition without suppressing an exception or timing out silently. */
async function until(description, predicate, timeoutMs = 15_000) {
  const end = Date.now() + timeoutMs
  while (!finished && Date.now() < end) {
    if (await predicate()) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(`Timed out: ${description}`)
}

/** Capture actual state and a rendered image for independent inspection. */
async function record(name, window) {
  const state = {
    name, windowId: window.id, webContentsId: window.webContents.id,
    visible: window.isVisible(), minimized: window.isMinimized(), focused: window.isFocused(),
  }
  steps.push(state)
  if (state.visible) writeFileSync(join(root, `${name}.png`), (await window.webContents.capturePage()).toPNG())
}

/** Click a visible native-renderer control through Electron mouse input, retaining its user gesture. */
async function clickButton(window, label) {
  const position = await window.webContents.executeJavaScript(`(() => {
    const button = [...document.querySelectorAll('button')].find(item => item.getAttribute('aria-label') === ${JSON.stringify(label)});
    if (!button || button.disabled || button.closest('[inert]')) return null;
    const box = button.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) return null;
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    if (!button.contains(document.elementFromPoint(x, y))) return null;
    return { x: Math.round(x), y: Math.round(y) };
  })()`)
  assert.ok(position, `The actual ${label} control must be visible and unobstructed.`)
  window.webContents.sendInputEvent({ type: 'mouseMove', ...position })
  window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...position })
  window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...position })
}

/** Verify the real desktop owns one draft-preserving popup across two native minimizations. */
async function run() {
  await until('main launcher and desktop preload', () => mainWindow.webContents.executeJavaScript(`
    typeof window.dshDesktop?.restoreSaturnBot === 'function' &&
    document.querySelector('button[aria-label="Open SaturnBot in a separate window"]') !== null
  `))
  assert.equal(await mainWindow.webContents.executeJavaScript('window.dshDesktop.restoreSaturnBot()'), false)
  mainWindow.show()
  mainWindow.focus()
  await until('main window focused', () => mainWindow.isFocused())
  await clickButton(mainWindow, 'Open SaturnBot in a separate window')
  await until('one native SaturnBot popup', () => popup !== undefined)
  await until('enabled live SaturnBot composer', () => popup.webContents.executeJavaScript(`
    (() => { const field = document.querySelector('[data-saturnbot-dashboard] textarea:not([disabled])');
      return field !== null && field.closest('[inert]') === null && !document.querySelector('[data-dsh-boot]'); })()
  `))
  assert.equal(popupCount, 1)
  assert.equal(await popup.webContents.executeJavaScript('window.dshDesktop.restoreSaturnBot()'), false,
    'The popup renderer must not invoke the main-window-only restore capability.')
  // Electron exposes no isSkipTaskbar getter; these are the actual merged creation options.
  assert.equal(popupSkipTaskbar, true, 'The popup must be created with skipTaskbar enabled.')
  const id = popup.id
  const contentsId = popup.webContents.id
  const draft = 'Keep this unfinished native SaturnBot request.'
  await until('launcher focuses the new popup', () => popup.isFocused())
  await record('popup-ready', popup)
  writeFileSync(join(root, 'focus-diagnostic.json'), JSON.stringify(await popup.webContents.executeJavaScript(`(() => {
    const field = document.querySelector('[data-saturnbot-dashboard] textarea');
    return { hasFocus: document.hasFocus(), active: document.activeElement?.outerHTML.slice(0, 200),
      inert: field?.closest('[inert]')?.id, disabled: field?.disabled,
      dialogs: [...document.querySelectorAll('[role="dialog"]')].map(item => item.textContent?.slice(0, 400)),
      boot: document.querySelector('[data-dsh-boot]') !== null };
  })()`), null, 2))
  await popup.webContents.executeJavaScript(`document.querySelector('[data-saturnbot-dashboard] textarea').focus()`)
  await until('composer has native text input focus', () => popup.webContents.executeJavaScript(`
    document.activeElement === document.querySelector('[data-saturnbot-dashboard] textarea') && document.hasFocus()
  `))
  await popup.webContents.insertText(draft)
  await until('React composer contains the unsent draft', () => popup.webContents.executeJavaScript(`
    document.querySelector('[data-saturnbot-dashboard] textarea')?.value === ${JSON.stringify(draft)}
  `))
  const originalJournal = readFileSync(join(harness, 'saturnbot', 'events.jsonl'), 'utf8')
  if (await popup.webContents.executeJavaScript(`document.querySelector('button[aria-label="Show execution context"]') !== null`)) {
    await clickButton(popup, 'Show execution context')
  }
  await until('live pause visualization action', () => popup.webContents.executeJavaScript(`
    document.querySelector('button[aria-label="Pause visualization"]') !== null
  `))
  await clickButton(popup, 'Pause visualization')
  await until('pause changes the available action to resume', () => popup.webContents.executeJavaScript(`
    document.querySelector('button[aria-label="Resume visualization"]') !== null &&
    document.querySelector('button[aria-label="Pause visualization"]') === null
  `))
  visualizationPaused = true
  await record('popup-visualization-paused', popup)
  const originalLoads = popupLoads
  await record('popup-before-minimize', popup)

  for (const cycle of [1, 2]) {
    popup.minimize()
    await until(`native minimize ${cycle} hides popup and focuses main`, () =>
      nativeMinimizes === cycle && !popup.isVisible() && mainWindow.isVisible() && mainWindow.isFocused(),
    )
    await record(`popup-hidden-${cycle}`, popup)
    await record(`main-after-minimize-${cycle}`, mainWindow)
    await clickButton(mainWindow, 'Open SaturnBot in a separate window')
    await until(`launcher restores popup ${cycle}`, () => popup.isVisible() && !popup.isMinimized() && popup.isFocused())
    assert.equal(popup.id, id, 'Restoration must reuse the BrowserWindow.')
    assert.equal(popup.webContents.id, contentsId, 'Restoration must reuse the renderer.')
    assert.equal(popupCount, 1, 'Restoration must not create a duplicate window.')
    assert.equal(BrowserWindow.getAllWindows().filter(window => {
      try { return new URL(window.webContents.getURL()).searchParams.get('saturnbot') === '1' } catch { return false }
    }).length, 1)
    assert.equal(await popup.webContents.executeJavaScript(`
      document.querySelector('[data-saturnbot-dashboard] textarea')?.value
    `), draft, 'The real composer must retain its unsent draft.')
    assert.equal(popupLoads, originalLoads, 'Restoring must not reload the dashboard.')
    assert.equal(await popup.webContents.executeJavaScript(`
      document.querySelector('button[aria-label="Resume visualization"]') !== null
    `), true, 'Restoration must retain the paused visualization preference.')
    await record(`popup-restored-${cycle}`, popup)
  }
  await clickButton(popup, 'Resume visualization')
  await until('resume changes the available action back to pause', () => popup.webContents.executeJavaScript(`
    document.querySelector('button[aria-label="Pause visualization"]') !== null &&
    document.querySelector('button[aria-label="Resume visualization"]') === null
  `))
  visualizationResumed = true
  await record('popup-visualization-resumed', popup)
  const finalJournal = readFileSync(join(harness, 'saturnbot', 'events.jsonl'), 'utf8')
  assert.equal(finalJournal, originalJournal, 'Visualization and window controls must not mutate Host state.')
  hostJournalUnchanged = true
  const events = finalJournal.split('\n').filter(Boolean).map(line => JSON.parse(line))
  assert.ok(events.every(event => event.type === 'configured'), 'Typing, visualization controls, and restoring must not send messages or start agent work.')
  finish(true, 'Pause and Resume changed only visualization state. Two native minimize → hidden → main focus → launcher restore cycles preserved the same popup, renderer, paused preference, and unsent draft; the Host journal remained unchanged.')
}

dialog.showErrorBox = (title, content) => finish(false, `${title}: ${content}`)
dialog.showMessageBox = async () => { finish(false, 'Unexpected native dialog.'); return { response: 0, checkboxChecked: false } }
shell.openExternal = async () => { finish(false, 'Unexpected external browser launch.') }
process.on('uncaughtException', error => finish(false, error.stack ?? String(error)))
process.on('unhandledRejection', error => finish(false, error instanceof Error ? error.stack ?? error.message : String(error)))
app.on('browser-window-created', (_event, window) => {
  window.webContents.on('did-fail-load', (_event, code, description) => finish(false, `Renderer load failed: ${code} ${description}`))
  window.webContents.on('render-process-gone', (_event, details) => { if (!finished) finish(false, `Renderer exited: ${details.reason}`) })
  if (mainWindow !== undefined) return
  mainWindow = window
  window.webContents.on('did-create-window', (child, details) => {
    if (new URL(details.url).searchParams.get('saturnbot') !== '1') return
    popup = child
    popupCount++
    popupSkipTaskbar = details.options.skipTaskbar === true
    child.on('minimize', () => { nativeMinimizes++ })
    child.webContents.on('did-finish-load', () => { popupLoads++ })
  })
  window.webContents.once('did-finish-load', () => {
    void run().catch(error => finish(false, error.stack ?? String(error)))
  })
})
await import(pathToFileURL(main).href).catch(error => finish(false, error.stack ?? String(error)))
