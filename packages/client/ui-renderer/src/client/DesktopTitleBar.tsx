/**
 * Desktop application chrome: the single-row title bar rendered only inside
 * the Saturn AI desktop shell on Windows (custom frame). Shows the product
 * brand — the Saturn mark plus the product name — and a menu button in a
 * draggable strip; the native window controls from `titleBarOverlay` occupy
 * the same row. In every other environment — plain browsers, native-frame
 * platforms — the bridge is absent or reports a native frame and the
 * children render unwrapped, so the shared shell output is unchanged. Pure
 * presentation: no subscriptions, no services.
 */
import type { ReactNode } from 'react'
import { SaturnLogo } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './DesktopTitleBar.module.css'
import { shellText } from './shell-locale.ts'

/** Minimal face of the desktop preload bridge (defined in apps/desktop). */
export interface DesktopBridge {
  /** 'custom' when the window renders its own title-bar row (Windows). */
  readonly frame: 'custom' | 'native'
  /** The application product name shown in the title-bar row. */
  readonly productName: string
  /** The packaged application version ('' when the launch carries no version argument). */
  readonly appVersion: string
  /** Pop the native window menu (hide to tray / restart / quit). */
  showMenu: () => void
  /** Restart the whole application in place (applies profile and patch changes). */
  restart: () => void
}

declare global {
  interface Window {
    /** Present only inside the desktop shell's preload. */
    dshDesktop?: DesktopBridge
  }
}

/**
 * The desktop title-bar chrome. On a custom frame it renders the draggable
 * bar above the application frame; elsewhere the application frame renders
 * unchanged.
 * @param props.children - the assembled application frame.
 * @param props.context - title of the selected session, shown as a muted
 *   trailing segment after the brand; undefined hides the segment.
 */
export function DesktopTitleBar(props: { children?: ReactNode; context?: string }) {
  const bridge = window.dshDesktop
  if (bridge === undefined || bridge.frame !== 'custom') return <>{props.children}</>
  return (
    <div className={css.shell}>
      <div className={css.titlebar}>
        <div className={css.inner}>
          <div className={css.left}>
            <span className={css.brand}>
              <SaturnLogo size={16} />
              {bridge.productName}
            </span>
            {props.context === undefined ? null : (
              <span className={css.context}>{`— ${props.context}`}</span>
            )}
          </div>
          <button
            type="button"
            className={css.menu}
            aria-label={shellText('menuLabel', { product: bridge.productName })}
            title={shellText('menuLabel', { product: bridge.productName })}
            onClick={() => { bridge.showMenu() }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>
      <div className={css.body}>{props.children}</div>
    </div>
  )
}
