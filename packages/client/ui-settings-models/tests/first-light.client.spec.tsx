/**
 * First Light keeps verified model connections separate from deferred model
 * setup. Only a durable seal completes the sequence and transfers to Models.
 */

// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SettingsSchemaService } from '@deepseek-ai/dsh-client-ui-settings/src/client/schema.ts'
import { SettingsDescribeMirror } from '@deepseek-ai/dsh-client-ui-settings/src/client/settings-mirror.ts'
import { SettingsScopeController } from '@deepseek-ai/dsh-client-ui-settings/src/client/settings-scope.ts'
import { FirstLight } from '../src/client/FirstLight.tsx'
import type { FirstLightProps, WorkspacePickOutcome, WorkspaceRegistrationOutcome } from '../src/client/FirstLight.tsx'
import { decodeFirstLightSection, FirstLightStore } from '../src/client/first-light-store.ts'
import type { ModelsSettingsState, ModelsSettingsStore } from '../src/client/store.ts'
import type { ModelDiscoveryOutcome, ModelsOperations } from '../src/client/operations.ts'
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

/** A fresh install with the official provider mounted and no credential. */
function freshModels(): ModelsSettingsState {
  const state = readyModels()
  const value = { apiKeyEnv: 'DEEPSEEK_API_KEY' }
  return {
    ...state,
    rows: state.rows.map(row => ({
      ...row, apiKeyEnv: value.apiKeyEnv, credential: { configured: false, writable: true },
    })),
    namespaces: new Map([['llm-deepseek', {
      ns: 'llm-deepseek',
      schema: JSON.parse(JSON.stringify(Schema.object({
        apiKeyEnv: Schema.string().role('credential-ref'),
      }).toJSON())) as JsonValue,
      value, base: value, user: {}, applies: 'live', secrets: [], revision: 0,
    }]]),
  }
}

type AttentionSnapshot = Parameters<Parameters<FirstLightProps['useSessionPendingInteraction']>[0]>[0]
const noAttention: AttentionSnapshot = new Map()
const useSessionPendingInteraction: FirstLightProps['useSessionPendingInteraction'] = selector => selector(noAttention)

/** Build one First Light over a process-local scope (memory mode: no wire). */
function harness(options: {
  verifyBrain?: () => Promise<DesignBrainOutcome>
  pickWorkspace?: () => Promise<WorkspacePickOutcome>
  registerWorkspace?: (path: string) => Promise<WorkspaceRegistrationOutcome>
  locale?: 'en' | 'zh'
  initialModels?: ModelsSettingsState
  discoverModels?: ModelsOperations['discoverModels']
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
  const modelsStore = createSnapshotStore<ModelsSettingsState>(options.initialModels ?? readyModels())
  const modelsController = {
    store: modelsStore,
    load: vi.fn(() => Promise.resolve()),
  } as unknown as ModelsSettingsStore
  const operations = {
    discoverModels: vi.fn(options.discoverModels ?? (() => Promise.resolve({
      kind: 'found' as const,
      models: [{ id: 'deepseek-flash' }],
    }))),
    describeCredential: vi.fn(() => Promise.resolve({ configured: false, writable: true })),
    storeCredential: vi.fn(() => Promise.resolve(undefined)),
    writeSettings: vi.fn(),
  }
  const complete = vi.fn()
  const unusedHook = (() => { throw new Error('unused standard hook') }) as never
  const pickWorkspace = vi.fn<() => Promise<WorkspacePickOutcome>>(
    options.pickWorkspace ?? (() => Promise.resolve({ kind: 'picked', path: 'C:\\built' })),
  )
  const registerWorkspace = vi.fn<(path: string) => Promise<WorkspaceRegistrationOutcome>>(
    options.registerWorkspace ?? (() => Promise.resolve({ kind: 'registered' })),
  )
  const props: FirstLightProps = {
    stepId: 'first-light',
    complete,
    openSection: vi.fn(),
    useSessions: unusedHook,
    useSessionPendingInteraction,
    useWorkspaces: unusedHook,
    controller,
    modelsController,
    operations: operations as unknown as ModelsOperations,
    schema: settingsSchema,
    useFirstLight: bindSnapshotSelector(controller.store),
    useModels: bindSnapshotSelector(modelsStore),
    verifyDesignBrain: options.verifyBrain ?? (() => Promise.resolve({ kind: 'verified', tools: ['intake'] })),
    declineDesignBrain: async () => true,
    pickWorkspace,
    registerWorkspace,
    writeAgentMemory: () => Promise.resolve({ kind: 'stored' }),
    t: key => (options.locale === 'zh' ? zh[key] : en[key]),
  }
  return {
    ...render(<FirstLight {...props} />), props, controller, complete, pickWorkspace,
    registerWorkspace, operations, modelsStore,
  }
}

/** The locale dictionary shape both `en` and `zh` satisfy. */
type Copy = { readonly [Key in keyof typeof en]: string }

/** The single primary "Continue" of the current step. */
function continueButton(t: Copy = en): HTMLButtonElement {
  return screen.getByRole<HTMLButtonElement>('button', { name: t.firstLightContinue })
}

async function advanceToModel(t: Copy = en): Promise<void> {
  await screen.findByRole('dialog', { name: t.firstLightWelcomeTitle })
  fireEvent.click(continueButton(t))
  fireEvent.change(screen.getByLabelText(t.firstLightName), { target: { value: 'Izzy' } })
  fireEvent.change(screen.getByLabelText(t.firstLightBuilding), { target: { value: 'brands' } })
  fireEvent.click(continueButton(t))
  await screen.findByRole('dialog', { name: t.onboardingTitle })
}

async function advanceToBrain(t: Copy = en): Promise<void> {
  await advanceToModel(t)
  await screen.findByText(t.firstLightModelVerified)
  fireEvent.click(continueButton(t))
  await screen.findByRole('dialog', { name: t.firstLightBrainTitle })
}

/** Complete the remaining choices without optional connections or a workspace. */
async function advanceFromBrainToReceipt(t: Copy = en): Promise<void> {
  await screen.findByRole('dialog', { name: t.firstLightBrainTitle })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: t.firstLightNotNow })) })
  fireEvent.click(continueButton(t))
  await screen.findByRole('dialog', { name: t.firstLightWorkspaceTitle })
  fireEvent.click(screen.getByRole('button', { name: t.firstLightNotNow }))
  fireEvent.click(continueButton(t))
  fireEvent.click(continueButton(t))
  fireEvent.click(continueButton(t))
  await screen.findByRole('dialog', { name: t.firstLightReceiptTitle })
}

async function advanceToWorkspace(t: Copy = en): Promise<void> {
  await advanceToBrain(t)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: t.firstLightNotNow })) })
  fireEvent.click(continueButton(t))
  await screen.findByRole('dialog', { name: t.firstLightWorkspaceTitle })
}

describe('FirstLight', () => {
  it.each(['en', 'zh'] as const)('opens Models after a fresh %s setup without claiming authentication', async (locale) => {
    const t = locale === 'en' ? en : zh
    const initialModels = freshModels()
    const h = harness({ locale, initialModels })
    await advanceToModel(t)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: t.onboardingSave }).disabled).toBe(true)
    expect(continueButton(t).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: t.onboardingOtherProvider }))
    await advanceFromBrainToReceipt(t)
    expect(screen.getByText(t.firstLightModelDeferred)).toBeTruthy()
    const receipt = {
      title: screen.getByRole('heading', { name: t.firstLightReceiptTitle }).textContent,
      model: screen.getByText(t.firstLightModelDeferred).textContent,
      action: screen.getByRole('button', { name: t.firstLightOpenModels }).textContent,
    }
    expect(screen.queryByText(t.firstLightModelVerified)).toBeNull()
    expect(h.props.openSection).not.toHaveBeenCalled()
    expect(h.operations.discoverModels).not.toHaveBeenCalled()
    expect(h.operations.storeCredential).not.toHaveBeenCalled()
    expect(h.operations.writeSettings).not.toHaveBeenCalled()
    expect(h.modelsStore.getSnapshot()).toEqual(initialModels)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: t.firstLightOpenModels })) })
    await waitFor(() => { expect(h.props.openSection).toHaveBeenCalledWith('models') })
    expect(h.complete).toHaveBeenCalledOnce()
    expect(vi.mocked(h.complete).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(h.props.openSection).mock.invocationCallOrder[0]!)
    expect(h.controller.store.getSnapshot()).toMatchObject({
      complete: true, profile: { name: 'Izzy', building: 'brands' }, voice: { tone: 'direct' },
    })
    if (locale === 'en') {
      expect(receipt).toMatchInlineSnapshot(`
          {
            "action": "Finish and open Models",
            "model": "Model setup deferred. Choose and verify your provider in Models.",
            "title": "Review your setup",
          }
        `)
    }
    h.unmount()
    vi.mocked(h.props.openSection).mockClear()
    render(<FirstLight {...h.props} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(h.props.openSection).not.toHaveBeenCalled()
  })

  it('retains the existing DeepSeek key-save and verification path', async () => {
    const h = harness({ initialModels: freshModels() })
    await advanceToModel()
    expect(h.operations.discoverModels).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText(en.keyInput), { target: { value: 'test-only-key' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.onboardingSave })) })
    expect(h.operations.storeCredential).toHaveBeenCalledWith('DEEPSEEK_API_KEY', 'test-only-key')
    expect(h.operations.discoverModels).toHaveBeenCalledWith('llm-deepseek', { provider: 'deepseek-official' })
    await screen.findByText(en.firstLightModelVerified)
    fireEvent.click(continueButton())
    await advanceFromBrainToReceipt()
    expect(screen.getByText(en.firstLightModelVerified)).toBeTruthy()
    expect(screen.queryByText(en.firstLightModelDeferred)).toBeNull()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.firstLightStart })) })
    expect(h.complete).toHaveBeenCalledOnce()
    expect(h.props.openSection).not.toHaveBeenCalled()
  })

  it('offers another provider after refused discovery and keeps unsaved setup open for retry', async () => {
    const h = harness({ discoverModels: async () => ({ kind: 'refused', message: 'Provider refused this key' }) })
    await advanceToModel()
    expect((await screen.findByRole('alert')).textContent).toBe('Provider refused this key')
    expect(continueButton().disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: en.onboardingOtherProvider }))
    await advanceFromBrainToReceipt()
    const seal = vi.spyOn(h.controller, 'seal').mockResolvedValueOnce(false)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.firstLightOpenModels })) })
    expect(await screen.findByText(en.firstLightSealFailed)).toBeTruthy()
    expect(h.complete).not.toHaveBeenCalled()
    expect(h.props.openSection).not.toHaveBeenCalled()
    expect(h.controller.store.getSnapshot().complete).toBe(false)
    seal.mockRestore()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.firstLightOpenModels })) })
    expect(h.props.openSection).toHaveBeenCalledWith('models')
  })

  it('allows provider choice during discovery and keeps a late result out of the deferred receipt', async () => {
    let answer!: (outcome: ModelDiscoveryOutcome) => void
    const pending = new Promise<ModelDiscoveryOutcome>((resolve) => { answer = resolve })
    const h = harness({ discoverModels: () => pending })
    await advanceToModel()
    expect(screen.getByText(en.firstLightChecking)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.onboardingOtherProvider }))
    await act(async () => { answer({ kind: 'found', models: [{ id: 'deepseek-flash' }] }) })
    await advanceFromBrainToReceipt()
    expect(screen.getByText(en.firstLightModelDeferred)).toBeTruthy()
    expect(screen.queryByText(en.firstLightModelVerified)).toBeNull()
    expect(h.props.openSection).not.toHaveBeenCalled()
  })

  it('does not treat another configured provider as DeepSeek authentication', async () => {
    const base = freshModels()
    const initialModels: ModelsSettingsState = {
      ...base,
      rows: [...base.rows, {
        ...base.rows[0]!,
        entry: { provider: 'existing-gateway', displayName: 'Gateway', settingsNs: 'llm-pi-ai',
          settingsPath: ['profiles', 'existing-gateway'], active: true },
        apiKeyEnv: 'GATEWAY_API_KEY', credential: { configured: true, writable: false },
      }],
    }
    const h = harness({ initialModels })
    await advanceToModel()
    expect(h.operations.discoverModels).not.toHaveBeenCalled()
    expect(screen.getByLabelText(en.keyInput)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.onboardingOtherProvider }))
    await advanceFromBrainToReceipt()
    expect(screen.getByText(en.firstLightModelDeferred)).toBeTruthy()
    expect(h.modelsStore.getSnapshot()).toEqual(initialModels)
  })

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
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.firstLightNotNow })) })
    expect(screen.getByText(en.firstLightBrainDeclined)).toBeTruthy()
    expect(continueButton().disabled).toBe(false)
  })

  it('verifies the Design brain through the Host connection and shows its tools', async () => {
    harness({ verifyBrain: () => Promise.resolve({ kind: 'verified', tools: ['intake', 'compose'] }) })
    await advanceToBrain()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.designBrainConnect })) })
    expect(screen.getByText(`${en.firstLightBrainVerified} (intake, compose)`)).toBeTruthy()
    expect(continueButton().disabled).toBe(false)
  })

  it('reports an unreachable Design brain instead of unlocking Continue', async () => {
    harness({
      verifyBrain: () => Promise.resolve({ kind: 'unreachable', message: 'the endpoint answered 503' }),
    })
    await advanceToBrain()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.designBrainConnect })) })
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(`${en.firstLightBrainFailed}: the endpoint answered 503`)
    expect(continueButton().disabled).toBe(true)
  })

  it('opens the folder chooser on the Workspace step and applies the picked folder', async () => {
    const h = harness({ pickWorkspace: () => Promise.resolve({ kind: 'picked', path: 'C:\\Projects\\izzy' }) })
    await advanceToWorkspace()
    expect(continueButton().disabled).toBe(true)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en.firstLightChooseFolder }))
    })

    expect(h.pickWorkspace).toHaveBeenCalledTimes(1)
    expect(h.registerWorkspace).toHaveBeenCalledWith('C:\\Projects\\izzy')
    expect(screen.getByText('C:\\Projects\\izzy')).toBeTruthy()
    expect(screen.getByText(en.firstLightWorkspaceRegistered)).toBeTruthy()
    expect(continueButton().disabled).toBe(false)
  })

  it('surfaces a chooser that cannot open instead of a dead click', async () => {
    const h = harness({
      pickWorkspace: () => Promise.resolve({ kind: 'failed', message: en.firstLightWorkspacePickerFailed }),
    })
    await advanceToWorkspace()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en.firstLightChooseFolder }))
    })

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(en.firstLightWorkspacePickerFailed)
    expect(continueButton().disabled).toBe(true)
    // The button stays usable: the click always lands on a visible result.
    expect(screen.getByRole('button', { name: en.firstLightChooseFolder })).toBeTruthy()
    expect(h.registerWorkspace).not.toHaveBeenCalled()
  })

  it('reports a thrown picker (host unreachable) rather than swallowing it', async () => {
    harness({ pickWorkspace: () => Promise.reject(new Error('the carrier dropped')) })
    await advanceToWorkspace()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en.firstLightChooseFolder }))
    })

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(en.firstLightWorkspacePickerFailed)
    expect(continueButton().disabled).toBe(true)
  })

  it('treats a cancelled chooser as no choice, never as an error', async () => {
    const h = harness({ pickWorkspace: () => Promise.resolve({ kind: 'declined' }) })
    await advanceToWorkspace()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en.firstLightChooseFolder }))
    })

    expect(h.pickWorkspace).toHaveBeenCalledTimes(1)
    expect(h.registerWorkspace).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(continueButton().disabled).toBe(true)
  })

  it('names a refused folder and keeps the retry available', async () => {
    const h = harness({
      pickWorkspace: () => Promise.resolve({ kind: 'picked', path: 'C:\\locked' }),
      registerWorkspace: () => Promise.resolve({
        kind: 'failed', message: `${en.firstLightWorkspaceFailed} that folder is not readable.`,
      }),
    })
    await advanceToWorkspace()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en.firstLightChooseFolder }))
    })

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(`${en.firstLightWorkspaceFailed} that folder is not readable.`)
    expect(continueButton().disabled).toBe(true)

    // Retry re-registers the same folder without reopening the chooser.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en.firstLightWorkspaceRetry }))
    })
    expect(h.registerWorkspace).toHaveBeenCalledTimes(2)
  })

  it('renders the picker failure in the active locale', async () => {
    harness({
      locale: 'zh',
      pickWorkspace: () => Promise.resolve({ kind: 'failed', message: zh.firstLightWorkspacePickerFailed }),
    })
    await advanceToWorkspace(zh)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: zh.firstLightChooseFolder }))
    })

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(zh.firstLightWorkspacePickerFailed)
  })

  it('walks every step and seals only on Start, with the receipt naming declines', async () => {
    const h = harness()
    await advanceToBrain()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.firstLightNotNow })) })
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
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.firstLightNotNow })) })
    fireEvent.click(continueButton())
    // Decline the workspace too: an unpicked folder keeps its Continue disabled.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.firstLightNotNow })) })
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
