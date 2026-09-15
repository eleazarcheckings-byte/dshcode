// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { computeSetupGaps, StatusStrip } from '../src/client/StatusStrip.tsx'
import { en } from '../src/client/locales.ts'
import { config, firstRun, snapshot, wizardSnapshot } from './fixtures.client.ts'

const t = makeTranslate(en)
afterEach(() => { cleanup() })

describe('computeSetupGaps', () => {
  it('names every blank required field in a fresh, unconfigured snapshot', () => {
    const data = snapshot({ config: { ...config, workspace: '', goal: '', provider: '', model: '' } })
    const gaps = computeSetupGaps(data, t)
    expect(gaps.map(gap => gap.step)).toEqual(['workspace', 'goal', 'model'])
  })

  it('reports a missing credential the runtime could not resolve, naming it and its env var', () => {
    const data = wizardSnapshot({ firstRun: { ...firstRun, goal: 'Ship the release', workspace: 'C:/work', provider: 'local' } })
    const gaps = computeSetupGaps(data, t)
    expect(gaps).toEqual([{ key: 'credential:SATURN_GITHUB_TOKEN', label: 'GitHub needs SATURN_GITHUB_TOKEN set before it can run', step: 'connections' }])
  })

  it('reports nothing once every required field is set and every credential resolved', () => {
    const data = wizardSnapshot({ firstRun: { ...firstRun, goal: 'Ship the release', workspace: 'C:/work', provider: 'local', credentials: firstRun.credentials.map(credential => ({ ...credential, present: true })) } })
    expect(computeSetupGaps(data, t)).toEqual([])
  })
})

describe('StatusStrip', () => {
  it('states plainly that SaturnBot can run when nothing is missing', () => {
    const data = wizardSnapshot({ firstRun: { ...firstRun, goal: 'Ship it', workspace: 'C:/work', provider: 'local', credentials: [] } })
    render(<StatusStrip snapshot={data} t={t} />)
    expect(screen.getByRole('status').textContent).toContain(en['wizard.ready'])
  })

  it('lists each concrete gap and routes a click to the step that resolves it', () => {
    const data = snapshot({ config: { ...config, workspace: '', goal: '' } })
    const onFix = vi.fn()
    render(<StatusStrip snapshot={data} t={t} onFix={onFix} />)
    expect(screen.getByText(en['wizard.gap.workspace'])).toBeTruthy()
    expect(screen.getByText(en['wizard.gap.goal'])).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en['wizard.gap.workspace'] }))
    expect(onFix).toHaveBeenCalledWith('workspace')
  })
})
