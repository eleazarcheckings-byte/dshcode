// @vitest-environment jsdom
/**
 * The column's drawer anchor (SPEC §8 M2). At phone width ui-layout carries
 * this column as an off-canvas drawer and the global mobile sheet has to
 * reach the column itself — to fill the panel and to raise its controls to a
 * 44px tap target. CSS-module class names are hashed and private, so the
 * column publishes one durable attribute instead, and this spec is the
 * contract the sheet is written against.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { SidebarRootComponentProps } from '../src/client/contract/slots.ts'
import { SidebarRoot } from '../src/client/SidebarRoot.tsx'
import { en } from '../src/client/locales.ts'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'

afterEach(cleanup)

const t: SidebarRootComponentProps['t'] = key =>
  (en as Record<string, string>)[key] ?? (commonEn as Record<string, string>)[key] ?? key

const neverHook = (() => { throw new Error('shell must not read global hooks') }) as never
type AttentionSnapshot = Parameters<Parameters<SidebarRootComponentProps['useSessionPendingInteraction']>[0]>[0]
const useSessionPendingInteraction: SidebarRootComponentProps['useSessionPendingInteraction'] =
  selector => selector(new Map() as AttentionSnapshot)

/** Mount the shell with the drawer's owner props (always wide, never the rail). */
function mountSidebar(width = 328) {
  return render(
    <SidebarRoot
      collapsed={false} width={width}
      useSessions={neverHook} useSessionPendingInteraction={useSessionPendingInteraction} useWorkspaces={neverHook}
      startSession={() => {}} toggleSidebar={() => {}} t={t}
      renderSlot={(() => null) as SidebarRootComponentProps['renderSlot']}
    />,
  )
}

describe('SidebarRoot drawer anchor', () => {
  it('publishes a durable root attribute for the mobile sheet', () => {
    const { container } = mountSidebar()
    expect(container.querySelector('[data-sidebar-root]')).toBe(container.firstElementChild)
  })

  it('still takes its width from the owner, so the sheet overrides exactly one property', () => {
    const { container } = mountSidebar(328)
    expect((container.firstElementChild as HTMLElement).style.width).toBe('328px')
  })
})
