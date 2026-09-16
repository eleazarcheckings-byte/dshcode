// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { FirstRunWizard, resumeWizardStep } from '../src/client/Wizard.tsx'
import { en } from '../src/client/locales.ts'
import { config, firstRun, wizardSnapshot } from './fixtures.client.ts'

const t = makeTranslate(en)
afterEach(() => { cleanup() })

describe('resumeWizardStep', () => {
  it('resumes at the first incomplete step firstRun reports, in wizard order', () => {
    expect(resumeWizardStep(wizardSnapshot({ firstRun: { ...firstRun, goal: '', workspace: '', provider: '' } }))).toBe('goal')
    expect(resumeWizardStep(wizardSnapshot({ firstRun: { ...firstRun, goal: 'Ship it', workspace: '', provider: '' } }))).toBe('workspace')
    expect(resumeWizardStep(wizardSnapshot({ firstRun: { ...firstRun, goal: 'Ship it', workspace: 'C:/work', provider: '' } }))).toBe('model')
    expect(resumeWizardStep(wizardSnapshot({ firstRun: { ...firstRun, goal: 'Ship it', workspace: 'C:/work', provider: 'local' } }))).toBe('connections')
  })
})

describe('FirstRunWizard', () => {
  it('blocks Continue until the objective is filled, then persists only that field and advances', async () => {
    const save = vi.fn(async () => {})
    const data = wizardSnapshot({ config: { ...config, goal: '', workspace: '', provider: '', model: '' } })
    render(<FirstRunWizard
      snapshot={data}
      workspaces={[]}
      save={save}
      busy={false}
      pickDirectory={vi.fn(async () => null)}
      t={t}
      onExit={vi.fn()}
    />)
    expect(screen.getByRole('heading', { name: en['wizard.step.goal'] })).toBeTruthy()
    const continueButton = screen.getByRole('button', { name: en['wizard.next'] })
    expect(continueButton).toHaveProperty('disabled', true)
    fireEvent.change(screen.getByRole('textbox', { name: /Business goal/ }), { target: { value: 'Ship the release' } })
    expect(continueButton).toHaveProperty('disabled', false)
    fireEvent.click(continueButton)
    await waitFor(() => { expect(save).toHaveBeenCalledWith({ goal: 'Ship the release' }) })
    await waitFor(() => { expect(screen.getByRole('heading', { name: en['wizard.step.workspace'] })).toBeTruthy() })
  })

  it('jumps directly to a step chosen from the step list', () => {
    const data = wizardSnapshot({ config: { ...config, goal: '', workspace: '', provider: '', model: '' } })
    render(<FirstRunWizard
      snapshot={data}
      workspaces={[]}
      save={vi.fn(async () => {})}
      busy={false}
      pickDirectory={vi.fn(async () => null)}
      t={t}
      onExit={vi.fn()}
    />)
    fireEvent.click(screen.getByRole('button', { name: new RegExp(en['wizard.step.connections']) }))
    expect(screen.getByRole('heading', { name: en['wizard.step.connections'] })).toBeTruthy()
  })

  it('generates connect forms from the catalog on the connections step', () => {
    const data = wizardSnapshot({ config: { ...config, goal: 'Ship it', workspace: 'C:/work' } })
    render(<FirstRunWizard
      snapshot={data}
      workspaces={[]}
      save={vi.fn(async () => {})}
      busy={false}
      pickDirectory={vi.fn(async () => null)}
      t={t}
      initialStep="connections"
      onExit={vi.fn()}
    />)
    expect(screen.getByRole('heading', { name: 'GitHub' })).toBeTruthy()
  })

  it('finishes by saving the schedule fields and exiting the wizard', async () => {
    const save = vi.fn(async () => {}), onExit = vi.fn()
    const data = wizardSnapshot({ config: { ...config, goal: 'Ship it', workspace: 'C:/work', provider: 'local', model: 'm' } })
    render(<FirstRunWizard
      snapshot={data}
      workspaces={[]}
      save={save}
      busy={false}
      pickDirectory={vi.fn(async () => null)}
      t={t}
      initialStep="schedule"
      onExit={onExit}
    />)
    fireEvent.click(screen.getByRole('checkbox', { name: new RegExp(en['settings.enabled']) }))
    fireEvent.click(screen.getByRole('button', { name: en['wizard.finish'] }))
    await waitFor(() => { expect(onExit).toHaveBeenCalledOnce() })
    expect(save).toHaveBeenCalledWith({ enabled: true, intervalMinutes: config.intervalMinutes })
  })

  it('skips to advanced configuration without saving anything', () => {
    const save = vi.fn(async () => {}), onExit = vi.fn()
    const data = wizardSnapshot({ config: { ...config, goal: '', workspace: '' } })
    render(<FirstRunWizard
      snapshot={data}
      workspaces={[]}
      save={save}
      busy={false}
      pickDirectory={vi.fn(async () => null)}
      t={t}
      onExit={onExit}
    />)
    fireEvent.click(screen.getByRole('button', { name: en['wizard.skip'] }))
    expect(onExit).toHaveBeenCalledOnce()
    expect(save).not.toHaveBeenCalled()
  })
})
