// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { IntegrationConnectForms, safeParseIntegrations } from '../src/client/ConnectForms.tsx'
import { en } from '../src/client/locales.ts'
import { integrationCatalog } from './fixtures.client.ts'

const t = makeTranslate(en)
afterEach(() => { cleanup() })

describe('safeParseIntegrations', () => {
  it('parses a well-formed integrations object into the fixed record', () => {
    expect(safeParseIntegrations('{"github":{"resource":"izzy/saturn-ai","credentialEnv":"SATURN_GITHUB_TOKEN"}}')).toEqual({ github: { resource: 'izzy/saturn-ai', credentialEnv: 'SATURN_GITHUB_TOKEN' } })
  })

  it('degrades to empty on malformed or non-object JSON rather than throwing', () => {
    expect(safeParseIntegrations('not json')).toEqual({})
    expect(safeParseIntegrations('[]')).toEqual({})
    expect(safeParseIntegrations('null')).toEqual({})
  })

  it('drops an unrecognized field instead of admitting an arbitrary key', () => {
    expect(safeParseIntegrations('{"mail":{"token":"secret","resource":"kept"}}')).toEqual({ mail: { resource: 'kept' } })
  })
})

describe('IntegrationConnectForms', () => {
  it('shows the empty state when the runtime publishes no catalog', () => {
    render(<IntegrationConnectForms catalog={[]} values={{}} onChange={vi.fn()} t={t} />)
    expect(screen.getByText(en['connect.empty'])).toBeTruthy()
  })

  it('renders one generated form per catalog entry with its docs link', () => {
    render(<IntegrationConnectForms catalog={integrationCatalog} values={{}} onChange={vi.fn()} t={t} />)
    expect(screen.getByRole('heading', { name: 'GitHub' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Stripe' })).toBeTruthy()
    const github = screen.getByRole('heading', { name: 'GitHub' }).closest('section')!
    expect(within(github).getByRole('link', { name: en['connect.docs'] })).toHaveProperty('href', 'https://docs.github.com/rest')
  })

  it('never renders an editable input for a secret field, only its required env var name', () => {
    render(<IntegrationConnectForms catalog={integrationCatalog} values={{}} onChange={vi.fn()} t={t} />)
    const github = screen.getByRole('heading', { name: 'GitHub' }).closest('section')!
    expect(within(github).queryByRole('textbox', { name: /token/i })).toBeNull()
    expect(within(github).getByText('SATURN_GITHUB_TOKEN')).toBeTruthy()
  })

  it('edits a non-secret field and reports the updated record without disturbing other entries', () => {
    const onChange = vi.fn()
    render(<IntegrationConnectForms catalog={integrationCatalog} values={{ stripe: { credentialEnv: 'SATURN_STRIPE_KEY' } }} onChange={onChange} t={t} />)
    fireEvent.change(screen.getByRole('textbox', { name: /Repository/ }), { target: { value: 'izzy/saturn-ai' } })
    expect(onChange).toHaveBeenCalledWith({ stripe: { credentialEnv: 'SATURN_STRIPE_KEY' }, github: { resource: 'izzy/saturn-ai' } })
  })
})
