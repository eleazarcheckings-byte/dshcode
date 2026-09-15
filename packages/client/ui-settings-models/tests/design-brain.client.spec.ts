/** Host-backed connection state must come from real registered tools, never browser fetch success. */
import { expect, it, vi } from 'vitest'
import type { DesignBrainStatus } from '@saturnai/dsh-design-brain/client'
import { DesignBrainController, type DesignBrainRemote } from '../src/client/design-brain.ts'
import { en } from '../src/client/locales.ts'

const off: DesignBrainStatus = { state: 'disabled', enabled: false, source: 'managed', tools: [], endpoint: 'https://saturnai.tools/api/mcp', issue: 'none' }
const ready: DesignBrainStatus = { ...off, state: 'connected', enabled: true, tools: ['mcp__saturnai__compose', 'mcp__saturnai__review'] }
function bench() {
  const remote = {
    status: vi.fn<DesignBrainRemote['status']>(async () => ({ ok: true, value: off })),
    connect: vi.fn<DesignBrainRemote['connect']>(async () => ({ ok: true, value: ready })),
    disconnect: vi.fn<DesignBrainRemote['disconnect']>(async () => ({ ok: true, value: off })),
  }
  const controller = new DesignBrainController(remote, key => en[key])
  return { controller, remote }
}
it('connects through the Host, projects returned tools, and removes stale success after a failed refresh', async () => {
  const { controller, remote } = bench()
  expect(await controller.verify()).toEqual({ kind: 'verified', tools: ready.tools })
  expect(remote.connect).toHaveBeenCalledOnce()
  remote.status.mockRejectedValueOnce(new Error('connection reset'))
  await controller.refresh()
  expect(controller.state.getSnapshot()).toEqual({ snapshot: null, busy: false, error: true })
})
it('keeps missing core tools and profile-owned disabled rows explicit', async () => {
  const { controller, remote } = bench()
  remote.connect.mockResolvedValueOnce({ ok: true, value: { ...off, state: 'unavailable', issue: 'incomplete-tools', tools: ['mcp__saturnai__compose'] } })
  expect(await controller.verify()).toEqual({ kind: 'unreachable', message: en.designBrainPartial })
  remote.connect.mockResolvedValueOnce({ ok: true, value: { ...off, state: 'unavailable', source: 'profile', issue: 'profile-disabled' } })
  expect(await controller.verify()).toEqual({ kind: 'unreachable', message: en.designBrainProfile })
})
it('serializes a connect behind an in-flight status read without losing the user command', async () => {
  const { controller, remote } = bench()
  const read = Promise.withResolvers<Awaited<ReturnType<DesignBrainRemote['status']>>>()
  remote.status.mockReturnValueOnce(read.promise)
  const refreshing = controller.refresh()
  const connecting = controller.verify()
  await Promise.resolve()
  expect(remote.connect).not.toHaveBeenCalled()
  read.resolve({ ok: true, value: off })
  await refreshing
  expect(await connecting).toEqual({ kind: 'verified', tools: ready.tools })
})
it('declining persists opt-out but leaves independent profile rows untouched', async () => {
  const { controller, remote } = bench()
  expect(await controller.decline()).toBe(true)
  expect(remote.disconnect).toHaveBeenCalledOnce()
  remote.status.mockResolvedValueOnce({ ok: true, value: { ...ready, source: 'profile' } })
  expect(await controller.decline()).toBe(true)
  expect(remote.disconnect).toHaveBeenCalledOnce()
  remote.status.mockRejectedValueOnce(new Error('offline'))
  expect(await controller.decline()).toBe(false)
})
it('does not publish or launch queued work after its owner is disposed', async () => {
  const { controller, remote } = bench()
  controller.dispose()
  await controller.connect()
  expect(remote.connect).not.toHaveBeenCalled()
  expect(controller.state.getSnapshot().snapshot).toBeNull()
})

it('does not publish a late Host reply after disposal', async () => {
  const { controller, remote } = bench()
  const response: PromiseWithResolvers<Awaited<ReturnType<DesignBrainRemote['connect']>>> = Promise.withResolvers()
  remote.connect.mockReturnValueOnce(response.promise)
  const connecting = controller.connect()
  await Promise.resolve()
  const last = controller.state.getSnapshot()
  controller.dispose()
  response.resolve({ ok: true, value: ready })
  await connecting
  expect(controller.state.getSnapshot()).toBe(last)
})
