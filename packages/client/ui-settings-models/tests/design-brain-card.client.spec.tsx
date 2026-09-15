// @vitest-environment jsdom
/** The permanent settings card supports connection management after First Light closes. */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import type { DesignBrainStatus } from '@saturnai/dsh-design-brain/client'
import { DesignBrainController } from '../src/client/design-brain.ts'
import { DesignBrainCard } from '../src/client/DesignBrainCard.tsx'
import { en, zh } from '../src/client/locales.ts'

afterEach(cleanup)
const off: DesignBrainStatus = { state: 'disabled', enabled: false, source: 'managed', tools: [], endpoint: 'https://saturnai.tools/api/mcp', issue: 'none' }
function bench(initial: DesignBrainStatus = off, locale = en) {
  let current = initial
  const controller = new DesignBrainController({
    status: async () => ({ ok: true, value: current }),
    connect: async () => ({ ok: true, value: current = { ...current, state: 'connected', enabled: true, tools: ['mcp__saturnai__compose', 'mcp__saturnai__review'] } }),
    disconnect: async () => ({ ok: true, value: current = off }),
  }, key => locale[key])
  const unused = (() => { throw new Error('Unused standing hook') }) as never
  const props: Parameters<typeof DesignBrainCard>[0] = {
    useDesignBrain: bindSnapshotSelector(controller.state), refresh: controller.refresh,
    connect: controller.connect, disconnect: controller.disconnect,
    t: key => locale[key], useSessions: unused, useSessionPendingInteraction: unused, useWorkspaces: unused,
  }
  return { controller, ...render(<DesignBrainCard {...props} />) }
}
it('connects and disconnects from settings with real callback results and accessible status', async () => {
  const h = bench()
  await screen.findByText(en.designBrainOff)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.designBrainConnect })) })
  expect(screen.getByRole('status').textContent).toBe(en.firstLightBrainVerified)
  expect(h.container.innerHTML).toMatchSnapshot()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.designBrainDisconnect })) })
  expect(screen.getByRole('status').textContent).toBe(en.designBrainOff)
})
it('shows localized profile ownership without an ineffective disconnect', async () => {
  const h = bench({ ...off, state: 'unavailable', source: 'profile', issue: 'profile-disabled', endpoint: null }, zh)
  await screen.findByText(zh.designBrainProfile)
  expect(screen.queryByRole('button', { name: zh.designBrainDisconnect })).toBeNull()
  expect(screen.queryByRole('button', { name: zh.designBrainConnect })).toBeNull()
  expect(h.container.innerHTML).toMatchSnapshot()
})
