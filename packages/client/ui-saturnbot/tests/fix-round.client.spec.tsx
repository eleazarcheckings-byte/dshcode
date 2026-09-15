// @vitest-environment jsdom
// Mars review r1 fix round (REVISE -> fix): host-native workspace picker, a dead
// input for a catalog field key the runtime does not admit, and a malformed
// Advanced JSON draft silently destroying itself on the first generated-field
// edit. New behaviors get new test files rather than editing the RED specs
// from the original round.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { FirstRunWizard } from '../src/client/Wizard.tsx'
import { IntegrationConnectForms, parseIntegrationsResult } from '../src/client/ConnectForms.tsx'
import { Configuration } from '../src/client/Configuration.tsx'
import { en } from '../src/client/locales.ts'
import { config, integrationCatalog, wizardSnapshot } from './fixtures.client.ts'

const t = makeTranslate(en)
afterEach(() => { cleanup() })

describe('FirstRunWizard workspace picker', () => {
  it('sets the workspace from the Host-native directory picker and saves the picked path', async () => {
    const save = vi.fn(async () => {})
    const pickDirectory = vi.fn(async () => 'C:/repos/picked')
    const data = wizardSnapshot({ config: { ...config, goal: 'Ship it', workspace: '' } })
    render(<FirstRunWizard snapshot={data} workspaces={[]} save={save} busy={false} pickDirectory={pickDirectory} t={t} initialStep="workspace" onExit={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: en['settings.workspaceBrowseLabel'] }))
    expect(pickDirectory).toHaveBeenCalledOnce()
    await waitFor(() => { expect(screen.getByRole('textbox', { name: new RegExp(en['settings.workspacePath']) })).toHaveProperty('value', 'C:/repos/picked') })
    fireEvent.click(screen.getByRole('button', { name: en['wizard.next'] }))
    await waitFor(() => { expect(save).toHaveBeenCalledWith({ workspace: 'C:/repos/picked' }) })
  })

  it('cancelling the picker (null) leaves the existing manual path untouched', async () => {
    const pickDirectory = vi.fn(async () => null)
    const data = wizardSnapshot({ config: { ...config, goal: 'Ship it', workspace: 'C:/existing' } })
    render(<FirstRunWizard snapshot={data} workspaces={[]} save={vi.fn(async () => {})} busy={false} pickDirectory={pickDirectory} t={t} initialStep="workspace" onExit={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: en['settings.workspaceBrowseLabel'] }))
    await waitFor(() => { expect(pickDirectory).toHaveBeenCalledOnce() })
    expect(screen.getByRole('textbox', { name: new RegExp(en['settings.workspacePath']) })).toHaveProperty('value', 'C:/existing')
  })

  it('a rejected picker (no native chooser available) keeps the manual path and never throws', async () => {
    const pickDirectory = vi.fn().mockRejectedValue(new Error('no chooser'))
    const data = wizardSnapshot({ config: { ...config, goal: 'Ship it', workspace: 'C:/existing' } })
    render(<FirstRunWizard snapshot={data} workspaces={[]} save={vi.fn(async () => {})} busy={false} pickDirectory={pickDirectory} t={t} initialStep="workspace" onExit={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: en['settings.workspaceBrowseLabel'] }))
    await waitFor(() => { expect(pickDirectory).toHaveBeenCalledOnce() })
    expect(screen.getByRole('textbox', { name: new RegExp(en['settings.workspacePath']) })).toHaveProperty('value', 'C:/existing')
  })
})

describe('parseIntegrationsResult', () => {
  it('reports ok:false for genuinely unparseable text instead of degrading to an empty record', () => {
    expect(parseIntegrationsResult('{"github":').ok).toBe(false)
    expect(parseIntegrationsResult('[]').ok).toBe(false)
    expect(parseIntegrationsResult('null').ok).toBe(false)
  })

  it('reports ok:true for a well-formed object, even one that drops an unrecognized field', () => {
    const result = parseIntegrationsResult('{"mail":{"token":"secret","resource":"kept"}}')
    expect(result).toEqual({ ok: true, value: { mail: { resource: 'kept' } } })
  })
})

describe('IntegrationConnectForms — unsupported catalog field key', () => {
  const catalogWithUnsupportedField = [
    ...integrationCatalog,
    { name: 'telegram', label: 'Telegram', docsUrl: '', fields: [
      { key: 'chatId', label: 'Chat id', secret: false, env: '' },
    ] },
  ]

  it('renders no editable input for a field key the runtime does not round-trip, only an explanatory note', () => {
    render(<IntegrationConnectForms catalog={catalogWithUnsupportedField} values={{}} onChange={vi.fn()} t={t} />)
    const telegram = screen.getByRole('heading', { name: 'Telegram' }).closest('section')!
    expect(telegram.querySelector('input')).toBeNull()
    expect(telegram.textContent).toContain(en['connect.fieldUnsupported'])
  })

  it('still edits a supported field on the same entry as an ordinary input', () => {
    const onChange = vi.fn()
    render(<IntegrationConnectForms catalog={catalogWithUnsupportedField} values={{}} onChange={onChange} t={t} />)
    fireEvent.change(screen.getByRole('textbox', { name: /Repository/ }), { target: { value: 'izzy/saturn-ai' } })
    expect(onChange).toHaveBeenCalledWith({ github: { resource: 'izzy/saturn-ai' } })
  })

  it('disables every generated input while the Advanced JSON draft cannot be parsed', () => {
    render(<IntegrationConnectForms catalog={integrationCatalog} values={{}} onChange={vi.fn()} disabled t={t} />)
    expect(screen.getByRole('textbox', { name: /Repository/ })).toHaveProperty('disabled', true)
  })
})

describe('Configuration — malformed Advanced JSON never destroys the draft', () => {
  it('blocks the generated forms and shows a fix-first notice instead of collapsing the draft to {}', () => {
    const snapshot = wizardSnapshot({ config: { ...config, integrations: { github: { resource: 'izzy/saturn-ai' } } } })
    render(<Configuration snapshot={snapshot} workspaces={[]} save={vi.fn(async () => {})} busy={false} t={t} />)
    fireEvent.click(screen.getByText(en['connect.advancedJson']))
    const textarea = screen.getByRole('textbox', { name: new RegExp(en['settings.integrations']) })
    fireEvent.change(textarea, { target: { value: '{"github": not valid' } })
    expect(screen.getByRole('alert').textContent).toBe(en['connect.fixJsonFirst'])
    expect(screen.getByRole('textbox', { name: /Repository/ })).toHaveProperty('disabled', true)
    // The user's malformed keystrokes are preserved verbatim, not collapsed to "{}".
    expect(textarea).toHaveProperty('value', '{"github": not valid')
  })

  it('re-enables the generated forms once the draft parses again', () => {
    const snapshot = wizardSnapshot({ config: { ...config, integrations: {} } })
    render(<Configuration snapshot={snapshot} workspaces={[]} save={vi.fn(async () => {})} busy={false} t={t} />)
    fireEvent.click(screen.getByText(en['connect.advancedJson']))
    const textarea = screen.getByRole('textbox', { name: new RegExp(en['settings.integrations']) })
    fireEvent.change(textarea, { target: { value: 'not json at all' } })
    expect(screen.getByRole('alert').textContent).toBe(en['connect.fixJsonFirst'])
    fireEvent.change(textarea, { target: { value: '{"github":{"resource":"izzy/saturn-ai"}}' } })
    expect(screen.queryByText(en['connect.fixJsonFirst'])).toBeNull()
    expect(screen.getByRole('textbox', { name: /Repository/ })).toHaveProperty('disabled', false)
  })
})
