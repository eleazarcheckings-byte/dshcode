/** Observe the real packaged entry reaching its rendered workspace surface. */

import { app, dialog, shell } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.env.DSHCODE_STARTUP_SMOKE_ROOT
const main = process.env.DSHCODE_STARTUP_SMOKE_MAIN
if (!root || !main) throw new Error('packaged startup smoke requires its isolated root and original entry')
const userData = join(root, 'electron')
mkdirSync(userData, { recursive: true })
app.setPath('home', root)
app.setPath('userData', userData)
let finished = false
const timer = setTimeout(() => finish(false, 'desktop did not render within 60 seconds'), 60_000)

function finish(ok, detail) {
  if (finished) return
  finished = true
  clearTimeout(timer)
  writeFileSync(join(root, 'result.json'), `${JSON.stringify({ ok, detail })}\n`)
  if (ok) app.quit()
  else app.exit(1)
}

// Failed startup must report to CI instead of waiting for a modal dialog.
dialog.showErrorBox = (title, content) => finish(false, `${title}: ${content}`)
shell.openExternal = async () => finish(false, 'desktop startup attempted to open an external browser')
dialog.showMessageBox = async (...args) => {
  finish(false, JSON.stringify(args))
  return { response: 0, checkboxChecked: false }
}
process.on('uncaughtException', error => finish(false, error.stack ?? String(error)))
process.on('unhandledRejection', error => finish(false, String(error)))
app.on('browser-window-created', (_event, window) => {
  window.webContents.on('did-fail-load', (_event, code, description) => finish(false, `${code}: ${description}`))
  window.webContents.once('did-finish-load', async () => {
    try {
      const url = new URL(window.webContents.getURL())
      if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') throw new Error(`unexpected application URL ${url.origin}`)
      await window.webContents.executeJavaScript(`new Promise(resolve => {
        const ready = () => document.querySelector('[class*="frame"]') !== null;
        if (ready()) return resolve(true);
        const observer = new MutationObserver(() => {
          if (ready()) { observer.disconnect(); resolve(true); }
        });
        observer.observe(document, { childList: true, subtree: true });
      })`)
      finish(true, { version: app.getVersion(), origin: url.origin })
    } catch (error) {
      finish(false, error.stack ?? String(error))
    }
  })
})

await import(new URL(main, import.meta.url).href).catch(error => finish(false, error.stack ?? String(error)))
