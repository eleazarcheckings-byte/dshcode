/** Browser popup reuse with desktop-owned restoration of a hidden SaturnBot window. */

/** Optional capability supplied by newer desktop preloads; plain browsers omit it. */
interface SaturnBotWindowBridge {
  restoreSaturnBot?: () => Promise<boolean>
}

/**
 * Keep one popup and restore its renderer without losing a draft or selected page.
 * @returns A coalescing launcher that reports popup blocking and rejects transport failures.
 */
export function createSaturnBotWindowLauncher(): () => Promise<boolean> {
  let dashboard: Window | null = null
  let pending: Promise<boolean> | null = null
  const launch = async (): Promise<boolean> => {
    // The renderer shell owns Window.dshDesktop; this consumer reads only its optional capability.
    const bridge = (window as unknown as { dshDesktop?: SaturnBotWindowBridge }).dshDesktop
    if (bridge?.restoreSaturnBot !== undefined && await bridge.restoreSaturnBot()) return true
    if (dashboard !== null && !dashboard.closed) {
      dashboard.focus()
      return true
    }
    const url = new URL('/', window.location.origin)
    url.searchParams.set('saturnbot', '1')
    // Without a desktop bridge, this runs synchronously in the original click gesture.
    dashboard = window.open(url.href, 'saturnbot', 'width=1440,height=920,resizable=yes,scrollbars=yes')
    return dashboard !== null
  }
  return () => {
    pending ??= launch().finally(() => { pending = null })
    return pending
  }
}
