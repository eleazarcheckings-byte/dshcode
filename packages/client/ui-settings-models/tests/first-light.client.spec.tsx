/**
 * First Light step flow: the sequence is a hard gate, so this suite walks it
 * end to end and pins the two things that make the gate real — a required
 * verifier cannot be walked past, and the seal is the only path to completion
 * (a sealed remount never re-opens the modal).
 */

// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SettingsSchemaService } from '@deepseek-ai/dsh-client-ui-settings/src/client/schema.ts'
import { SettingsDescribeMirror } from '@deepseek-ai/dsh-client-ui-settings/src/client/settings-mirror.ts'
import { SettingsScopeController } from '@deepseek-ai/dsh-client-ui-settings/src/client/settings-scope.ts'
import { FirstLight } from '../src/client/FirstLight.tsx'
import type { FirstLightProps } from '../src/client/FirstLight.tsx'
import { decodeFirstLightSection, FirstLightStore } from '../src/client/first-light-store.ts'
import type { ModelsSettingsState, ModelsSettingsStore } from '../src/client/store.ts'
import type { ModelsOperations } from '../src/client/operations.ts'
import type { DesignBrainOutcome } from '../src/client/design-brain.ts'
import { FIRST_LIGHT_SETTINGS_NAMESPACE } from '../src/onboarding-copy.ts'
import { en, zh } from '../src/client/locales.ts'
import { settingsSchema } from './settings-schema.client.ts'

afterEach(() => {
  cleanup()
  document.getElementById('root')?.remove()
})

const schemaService = new SettingsSchemaService(new Context())

/** A workspace row that already makes the Model step's gate green. */
function readyModels(): ModelsSettingsState {
  return {
    status: 'ready',
    error: null,
    credentialError: null,
    writable: true,
    rows: [{
      entry: {
        provider: 'deepseek-official',
        displayName: 'DeepSeek',
        settingsNs: 'llm-deepseek',
        settingsPath: [],
        active: true,
      },
      apiKeyEnv: undefined,
    }],
    namespaces: new Map(),
  } as unknown as ModelsSettingsState
}

type AttentionSnapshot = Parameters<Parameters<FirstLightProps['useSessionPendingInteraction']>[0]>[0]
const noAttention: AttentionSnapshot = new Map()
const useSessionPendingInteraction: FirstLightProps['useSessionPendingInteraction'] = selector => selector(noAttention)

/** Build one First Light over a process-local scope (memory mode: no wire). */
function harness(options: {
  verifyBrain?: () => Promise<DesignBrainOutcome>
  pickWorkspace?: () => Promise<string | null>
  locale?: 'en' | 'zh'
} = {}) {
  const appRoot = document.createElement('div')
  appRoot.id = 'root'
  document.body.append(appRoot)

  const ctx = { remote: { settings: { describe: vi.fn(), mutate: vi.fn() } } } as never
  const mirror = new SettingsDescribeMirror(ctx, 'memory')
  const scope = new SettingsScopeController(
    ctx,
    { namespace: FIRST_LIGHT_SETTINGS_NAMESPACE, decode: decodeFirstLightSection },
    mirror,
    'memory',
    schemaService,
  )
  const controller = new FirstLightStore(scope)
  const modelsStore = createSnapshotStore<ModelsSettingsState>(readyModels())
  const modelsController = {
    store: modelsStore,
    load: vi.fn(() => Promise.resolve()),
  } as unknown as ModelsSettingsStore
  const operations = {
    discoverModels: vi.fn(() => Promise.resolve({
      kind: 'found' as const,
      models: [{ id: 'deepseek-flash' }],
    })),
  } as unknown as ModelsOperations
  const complete = vi.fn()
  const unusedHook = (() => { throw new Error('unused standard hook') }) as never
  const props: FirstLightProps = {
    stepId: 'first-light',
    complete,
    openSection: vi.fn(),
    useSessions: unusedHook,
    useSessionPendingInteraction,
    useWorkspaces: unusedHook,
    controller,
    modelsController,
    operations,
    schema: settingsSchema,
    useFirstLight: bindSnapshotSelector(controller.store),
    useModels: bindSnapshotSelector(modelsStore),
    verifyDesignBrain: options.verifyBrain ?? (() => Promise.resolve({ kind: 'verified', tools: ['intake'] })),
    pickWorkspace: options.pickWorkspace ?? (() => Promise.resolve('C:\\built')),
    registerWorkspace: () => Promise.resolve({ kind: 'registered' }),
    writeAgentMemory: () => Promise.resolve({ kind: 'stored' }),
    t: key => (options.locale === 'zh' ? zh[key] : en[key]),
  }
  return { ...render(<FirstLight {...props} />), props, controller, complete }
}

/** The single primary "Continue" of the current step. */
function continueButton(): HTMLButtonElement {
  return screen.getByRole<HTMLButtonElement>('button', { name: en.firstLightContinue })
}

async function advanceToBrain(): Promise<void> {
  await screen.findByRole('dialog', { name: en.firstLightWelcomeTitle })
  fireEvent.click(continueButton())
  fireEvent.change(screen.getByLabelText(en.firstLightName), { target: { value: 'Izzy' } })
  fireEvent.change(screen.getByLabelText(en.firstLightBuilding), { target: { value: 'brands' } })
  fireEvent.click(continueButton())
  // The Model step reports its own live check with `firstLightModelVerified`;
  // `firstLightModelReady` belongs to the receipt's Model row, one step later.
  await screen.findByText(en.firstLightModelVerified)
  fireEvent.click(continueButton())
  await screen.findByRole('dialog', { name: en.firstLightBrainTitle })
}

describe('FirstLight', () => {
  it('opens on the welcome step and gates the profile behind real input', async () => {
    harness()
    await screen.findByRole('dialog', { name: en.firstLightWelcomeTitle })
    fireEvent.click(continueButton())
    const next = continueButton()
    expect(next.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(en.firstLightName), { target: { value: 'Izzy' } })
    expect(next.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(en.firstLightBuilding), { target: { value: 'brands' } })
    expect(next.disabled).toBe(false)
  })

  it('cannot leave the Design brain step without verifying or declining', async () => {
    harness()
    await advanceToBrain()
    expect(continueButton().disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: en.firstLightNotNow }))
    expect(screen.getByText(en.firstLightBrainDeclined)).toBeTruthy()
    expect(continueButton().disabled).toBe(false)
  })

  it('verifies the Design brain through the real probe and shows its tools', async () => {
    harness({ verifyBrain: () => Promise.resolve({ kind: 'verified', tools: ['intake', 'compose'] }) })
    await advanceToBrain()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.firstLightVerify })) })
    expect(screen.getByText(`${en.firstLightBrainVerified} (intake, compose)`)).toBeTruthy()
    expect(continueButton().disabled).toBe(false)
  })

  it('reports an unreachable Design brain instead of unlocking Continue', async () => {
    harness({
      verifyBrain: () => Promise.resolve({ kind: 'unreachable', message: 'the endpoint answered 503' }),
    })
    await advanceToBrain()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.firstLightVerify })) })
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(`${en.firstLightBrainFailed}: the endpoint answered 503`)
    expect(continueButton().disabled).toBe(true)
  })

  it('walks every step and seals only on Start, with the receipt naming declines', async () => {
    const h = harness()
    await advanceToBrain()
    fireEvent.click(screen.getByRole('button', { name: en.firstLightNotNow }))
    fireEvent.click(continueButton())

    // Workspace: the picker's answer is shown before Continue unlocks.
    await screen.findByRole('dialog', { name: en.firstLightWorkspaceTitle })
    expect(continueButton().disabled).toBe(true)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en.firstLightChooseFolder }))
    })
    expect(await screen.findByText('C:\\built')).toBeTruthy()
    fireEvent.click(continueButton())

    // Connections: continuing without declining reports "Later", which differs
    // from the Design brain's "Skipped". Connections then Voice, then the receipt.
    fireEvent.click(continueButton())
    fireEvent.click(continueButton())
    await screen.findByRole('dialog', { name: en.firstLightReceiptTitle })
    expect(screen.getByText(en.firstLightDeclined)).toBeTruthy()
    expect(screen.getByText(en.firstLightLater)).toBeTruthy()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en.firstLightStart }))
    })
    await waitFor(() => { expect(h.complete).toHaveBeenCalledTimes(1) })
    expect(h.controller.store.getSnapshot()).toMatchObject({
      complete: true,
      profile: { name: 'Izzy', building: 'brands', language: 'en' },
      voice: { tone: 'direct' },
    })
  })

  it('does not re-open on a sealed remount (a blank hero cannot replay setup)', async () => {
    const h = harness()
    await advanceToBrain()
    fireEvent.click(screen.getByRole('button', { name: en.firstLightNotNow }))
    fireEvent.click(continueButton())
    // Decline the workspace too: an unpicked folder keeps its Continue disabled.
    fireEvent.click(screen.getByRole('button', { name: en.firstLightNotNow }))
    fireEvent.click(continueButton())
    fireEvent.click(continueButton())
    fireEvent.click(continueButton())
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en.firstLightStart }))
    })
    await waitFor(() => { expect(h.complete).toHaveBeenCalledTimes(1) })

    h.unmount()
    h.complete.mockClear()
    render(<FirstLight {...h.props} />)
    await waitFor(() => { expect(h.complete).toHaveBeenCalledTimes(1) })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
