/**
 * Mobile breakpoint arithmetic and the layout store's drawer state (SPEC §8
 * M2). The solver stays breakpoint-free — AppFrame reads these predicates and
 * decides the shape — so both halves are provable as plain functions.
 */
import { describe, expect, it } from 'vitest'
import {
  DRAWER_MAX_WIDTH, drawerWidth, isMobileViewport, MOBILE_MAX, SIDEBAR_DEFAULT,
} from '@deepseek-ai/dsh-client-ui-layout/src/client/columns.ts'
import { createLayoutStore } from '@deepseek-ai/dsh-client-ui-layout/src/client/stores.ts'

describe('mobile breakpoint', () => {
  it('pins the SPEC breakpoint at 768px inclusive', () => {
    expect(MOBILE_MAX).toBe(768)
    expect(isMobileViewport(MOBILE_MAX)).toBe(true)
    expect(isMobileViewport(MOBILE_MAX + 1)).toBe(false)
    expect(isMobileViewport(390)).toBe(true)
  })

  it('treats an unmeasured column as not mobile', () => {
    // A zero width is the pre-layout reading, not a phone.
    expect(isMobileViewport(0)).toBe(false)
  })

  it('sizes the drawer at 84% of the viewport under a fixed cap', () => {
    expect(drawerWidth(390)).toBe(328)
    expect(drawerWidth(768)).toBe(DRAWER_MAX_WIDTH)
    expect(DRAWER_MAX_WIDTH).toBe(360)
  })
})

describe('layout store: mobile drawer', () => {
  it('starts closed and not mobile', () => {
    const store = createLayoutStore().create()
    expect(store.getSnapshot().mobile).toBe(false)
    expect(store.getSnapshot().drawer).toBe(false)
  })

  it('toggleSidebar drives the drawer while mobile, and the width otherwise', () => {
    const store = createLayoutStore().create()
    store.actions.toggleSidebar()
    expect(store.getSnapshot().sidebar).toBe(0)
    expect(store.getSnapshot().drawer).toBe(false)

    store.actions.setMobile(true)
    store.actions.toggleSidebar()
    expect(store.getSnapshot().drawer).toBe(true)
    // The width preference is untouched by a drawer gesture.
    expect(store.getSnapshot().sidebar).toBe(0)
    store.actions.toggleSidebar()
    expect(store.getSnapshot().drawer).toBe(false)
  })

  it('setDrawer writes the open state directly', () => {
    const store = createLayoutStore().create()
    store.actions.setMobile(true)
    store.actions.setDrawer(true)
    expect(store.getSnapshot().drawer).toBe(true)
    store.actions.setDrawer(false)
    expect(store.getSnapshot().drawer).toBe(false)
  })

  it('leaving the mobile band closes the drawer', () => {
    const store = createLayoutStore().create()
    store.actions.setMobile(true)
    store.actions.setDrawer(true)
    store.actions.setMobile(false)
    expect(store.getSnapshot().mobile).toBe(false)
    expect(store.getSnapshot().drawer).toBe(false)
  })

  it('re-asserting the same band leaves the drawer alone', () => {
    const store = createLayoutStore().create()
    store.actions.setMobile(true)
    store.actions.setDrawer(true)
    store.actions.setMobile(true)
    expect(store.getSnapshot().drawer).toBe(true)
  })

  it('keeps the wide width preference across a mobile round trip', () => {
    const store = createLayoutStore().create()
    store.actions.setMobile(true)
    store.actions.setDrawer(true)
    store.actions.setMobile(false)
    expect(store.getSnapshot().sidebar).toBe(SIDEBAR_DEFAULT)
  })
})
