import { mkdtemp, readFile, rm, writeFile, appendFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { SaturnBotStore } from '../src/store.ts'
import { parseBotConfig } from '../src/config.ts'
import type { BotEventData, BotId } from '../src/types.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function setup() { const root = await mkdtemp(join(tmpdir(), 'saturnbot-store-')); roots.push(root); return { root, store: new SaturnBotStore(root) } }

describe('append-only journal and writer lease', () => {
  it('protects cached journal facts from returned state and caller mutations', async () => {
    const { store } = await setup()
    const release = await store.acquireLease()
    const data: BotEventData = { type: 'configured', config: parseBotConfig({ goal: 'Original goal' }) }
    const pending = store.append(data)
    data.config.goal = 'Mutation during append'
    await pending
    const state = await store.snapshot()
    state.config.goal = 'Mutation after snapshot'
    const page = await store.events()
    if (page.events[0]!.type === 'configured') page.events[0]!.config.goal = 'Mutation after event read'
    expect((await store.snapshot()).config.goal).toBe('Original goal')
    expect((await new SaturnBotStore(store.root).snapshot()).config.goal).toBe('Original goal')
    await release()
  })

  it('refreshes cached projections after a different store writes and keeps contiguous sequences', async () => {
    const { root, store } = await setup()
    const release = await store.acquireLease()
    await Promise.all(Array.from({ length: 15 }, (_, index) => store.append({ type: 'configured', config: parseBotConfig({ goal: `Goal ${index}` }) })))
    await release()
    expect((await store.snapshot()).config.goal).toBe('Goal 14')
    const peer = new SaturnBotStore(root)
    const releasePeer = await peer.acquireLease()
    await peer.append({ type: 'configured', config: parseBotConfig({ goal: 'Peer goal' }) }); await releasePeer()
    expect((await store.snapshot()).config.goal).toBe('Peer goal')
    const page = await store.events(10, 3)
    expect(page.events.map(event => event.seq)).toEqual([11, 12, 13])
    expect(page.hasMore).toBe(true)
  })

  it('ignores and truncates only a crash-partial final record, rejecting damaged complete records', async () => {
    const { root, store } = await setup()
    const release = await store.acquireLease()
    await store.append({ type: 'configured', config: parseBotConfig({ goal: 'Durable' }) }); await release()
    await appendFile(store.journalPath, '{"version":')
    expect((await new SaturnBotStore(root).snapshot()).config.goal).toBe('Durable')
    const recover = await store.acquireLease()
    await store.append({ type: 'configured', config: parseBotConfig({ goal: 'Recovered' }) }); await recover()
    expect((await store.snapshot()).cursor).toBe(2)
    await appendFile(store.journalPath, '{bad record}\n')
    await expect(new SaturnBotStore(root).snapshot()).rejects.toThrow()
  })

  it('excludes a live owner, recovers a provably exited child, and refuses an unreadable owner', async () => {
    const { root, store } = await setup()
    const release = await store.acquireLease()
    await expect(new SaturnBotStore(root).acquireLease()).rejects.toThrow('already running')
    await release()
    const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' })
    expect(child.status).toBe(0)
    await writeFile(join(root, 'execution.lock'), `${child.stdout}:dead-owner`)
    const recovered = await store.acquireLease(); await recovered()
    await writeFile(join(root, 'execution.lock'), 'unreadable')
    await expect(store.acquireLease()).rejects.toThrow('unreadable')
  })

  it('awaits owner-local borrowed work before releasing and refuses writes without ownership', async () => {
    const { store } = await setup()
    await expect(store.append({ type: 'configured', config: parseBotConfig({}) })).rejects.toThrow('lease')
    const release = await store.acquireLease()
    let finish!: () => void
    const gate = new Promise<void>((resolve) => { finish = resolve })
    const borrowed = store.withHeldLease(async () => { await gate; await store.writeConfiguration(parseBotConfig({ goal: 'Paused safely' })) })
    const releasing = release()
    await expect(store.withHeldLease(async () => {})).rejects.toThrow('already running')
    finish(); await borrowed; await releasing
    expect((await store.snapshot()).config.goal).toBe('Paused safely')
    const next = await store.acquireLease(); await next()
  })

  it('aggregates all daily reports beyond the dashboard preview and retains the latest report revision', async () => {
    const { store } = await setup()
    const release = await store.acquireLease()
    for (let index = 0; index < 102; index++) await store.append({ type: 'report', report: { id: `report-${index}` as BotId, cycleId: `cycle-${index}` as BotId, date: '2026-09-14', title: 'Cycle', markdown: `Cycle ${index}`, channel: 'inbox' } })
    await store.append({ type: 'report', report: { id: 'report-0' as BotId, cycleId: 'cycle-0' as BotId, date: '2026-09-14', title: 'Cycle', markdown: 'Updated after approval', channel: 'inbox' } })
    expect((await store.snapshot()).reports).toHaveLength(100)
    const daily = await store.dailyReports('2026-09-14')
    expect(daily).toHaveLength(102)
    expect(daily[0]?.markdown).toBe('Updated after approval')
    await release()
  })

  it('fails explicitly at a configured journal cap without truncating committed records', async () => {
    const { root } = await setup()
    const store = new SaturnBotStore(root, { maxJournalBytes: 2000 })
    const release = await store.acquireLease()
    await store.append({ type: 'configured', config: parseBotConfig({}) })
    const before = await readFile(store.journalPath, 'utf8')
    await expect(store.append({ type: 'configured', config: parseBotConfig({ goal: 'x'.repeat(1500) }) })).rejects.toThrow('size limit')
    expect(await readFile(store.journalPath, 'utf8')).toBe(before)
    await release()
  })
})
