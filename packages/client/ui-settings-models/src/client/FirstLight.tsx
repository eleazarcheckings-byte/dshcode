/**
 * First Light: the setup sequence a new install walks once, before any chat.
 * It is a single `settings.onboarding` registration at the earliest order, so
 * it rides the existing gate instead of forking a second overlay system; the
 * versioned testing notice and the DeepSeek prompt stay registered behind it
 * and resume their old roles once setup is sealed.
 *
 * DeepSeek can be verified here, or model configuration can be deferred to
 * Models after the remaining setup steps. Deferral never verifies a provider.
 * Optional connections may be declined explicitly. The seal is written last
 * and read back, so a run that did not persist can never complete.
 */

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FirstLightState, FirstLightStore } from './first-light-store.ts'
import type { DesignBrainOutcome } from './design-brain.ts'
import type { ModelsSettingsState, ModelsSettingsStore } from './store.ts'
import { onboardingReadiness } from './store.ts'
import type { ModelsOperations } from './operations.ts'
import type { SettingsSchemaOperations } from './schema-operations.ts'
import { ProviderEditor } from './ProviderEditor.tsx'
import type { en } from './locales.ts'
import { OnboardingModal } from './OnboardingModal.tsx'
import css from './FirstLight.module.css'

/** The ordered steps of the sequence. */
type Step = 'welcome' | 'you' | 'model' | 'brain' | 'workspace' | 'connectors' | 'voice' | 'receipt'

/** The next step, or undefined at the end. */
function nextStep(step: Step): Step | undefined {
  switch (step) {
    case 'welcome': return 'you'
    case 'you': return 'model'
    case 'model': return 'brain'
    case 'brain': return 'workspace'
    case 'workspace': return 'connectors'
    case 'connectors': return 'voice'
    case 'voice': return 'receipt'
    case 'receipt': return undefined
  }
}

/** How the Model step's live check ended. */
type VerifyStatus = 'idle' | 'checking' | 'verified' | 'failed'

/** How the Workspace step's default registration ended. */
type WorkspaceStatus = 'idle' | 'registering' | 'registered' | 'failed'

/** Whether the picked folder really became the session default. */
export type WorkspaceRegistrationOutcome =
  /** The Host registered it as the session default. */
  | { readonly kind: 'registered' }
  /** The Host refused or the attempt failed; the message is plain language. */
  | { readonly kind: 'failed'; readonly message: string }

/** How the folder chooser answered. A failure is a named outcome, never a swallowed rejection. */
export type WorkspacePickOutcome =
  /** The chooser returned a folder. */
  | { readonly kind: 'picked'; readonly path: string }
  /** The user closed the chooser without choosing; not an error. */
  | { readonly kind: 'declined' }
  /** The chooser could not be opened at all; the message is plain language. */
  | { readonly kind: 'failed'; readonly message: string }

/** Outcome of mirroring the profile into user-global agent memory. */
export type AgentMemoryOutcome =
  /** The Host wrote the profile into the user-global memory file. */
  | { readonly kind: 'stored' }
  /** The write failed; the message is plain language and safe to show. */
  | { readonly kind: 'failed'; readonly message: string }

/** The identity and voice facts the memory mirror renders. */
export interface AgentMemoryFacts {
  readonly name: string
  readonly building: string
  readonly language: string
  readonly tone: string
  readonly consultDesignBrain: boolean
}

/** Registration-side dependencies of {@link FirstLight}. */
export interface FirstLightInjected {
  hooks: {
    /** Durable or process-local setup state. */
    firstLight: SnapshotStore<FirstLightState>
    /** Shared Models-page join state, for the Model step's key editor. */
    models: SnapshotStore<ModelsSettingsState>
  }
  /** Setup persistence controller. */
  controller: FirstLightStore
  /** Shared Models-page join controller (the Model step's key editor writes through it). */
  modelsController: ModelsSettingsStore
  /** The Host operations the reused Models credential editor writes through. */
  operations: ModelsOperations
  /** Settings schema and immutable path callbacks. */
  schema: SettingsSchemaOperations
  /** Persist opt-in and verify that the Host registered the required tools. */
  verifyDesignBrain: () => Promise<DesignBrainOutcome>
  /** Skip optional guidance and remove any setup-owned saved opt-in. Profile rows remain independent. */
  declineDesignBrain: () => Promise<boolean>
  /**
   * Open the native folder picker and report the one outcome: the chosen path,
   * the user's cancel, or a named failure. A picker that cannot open is
   * reported through the same union instead of rejecting, so the click always
   * lands on something the user can see.
   */
  pickWorkspace: () => Promise<WorkspacePickOutcome>
  /**
   * Make the chosen folder the session default through the Host workspace
   * registry. Never local-only: the step's promise is that the next chat opens
   * here, so a folder that was not registered is not a usable answer.
   */
  registerWorkspace: (path: string) => Promise<WorkspaceRegistrationOutcome>
  /**
   * Persist the profile and voice preferences as user-global agent memory
   * through the Host. Settings alone are read by configuration surfaces, not
   * by the model, so this is the hop that makes the answers actually known.
   */
  writeAgentMemory: (facts: AgentMemoryFacts) => Promise<AgentMemoryOutcome>
  /** Setup copy. */
  t: (key: keyof typeof en) => string
}

/** Coordinator owner props plus this step's injected face. */
export type FirstLightProps = PropsRuntime<'settings.onboarding'> & InjectFace<FirstLightInjected>

/* v8 ignore next 3 -- closed-union default only defends future source widening */
function assertNever(_value: never): never {
  throw new Error('unexpected DeepSeek onboarding state')
}

/** The language choices offered by the You step. */
const LANGUAGES = ['en', 'zh'] as const
/** The tone choices offered by the Voice step. */
const TONES = ['direct', 'warm', 'detailed'] as const

/**
 * Render the First Light sequence, or nothing once it is sealed or while the
 * durable state has not answered.
 * @param props - settings-shell owner state and setup dependencies.
 * @returns the setup modal, an error modal, or null while the step decides.
 */
export function FirstLight(props: FirstLightProps): ReactNode {
  const {
    complete, openSection, controller, useFirstLight, useModels, modelsController, operations, schema,
    verifyDesignBrain, declineDesignBrain, pickWorkspace, registerWorkspace, writeAgentMemory, t,
  } = props
  const state = useFirstLight(snapshot => snapshot)
  const models = useModels(snapshot => snapshot)

  const [step, setStep] = useState<Step>('welcome')
  const [name, setName] = useState('')
  const [building, setBuilding] = useState('')
  const [language, setLanguage] = useState<string>('en')
  const [modelStatus, setModelStatus] = useState<VerifyStatus>('idle')
  const [modelDeferred, setModelDeferred] = useState(false)
  const [modelError, setModelError] = useState<string | null>(null)
  const [brainStatus, setBrainStatus] = useState<VerifyStatus>('idle')
  const [brainError, setBrainError] = useState<string | null>(null)
  const [brainTools, setBrainTools] = useState<readonly string[]>([])
  const [brainDeclined, setBrainDeclined] = useState(false)
  const [workspacePath, setWorkspacePath] = useState<string | null>(null)
  const [workspaceStatus, setWorkspaceStatus] = useState<WorkspaceStatus>('idle')
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)
  const [workspaceDeclined, setWorkspaceDeclined] = useState(false)
  const [connectorsDeclined, setConnectorsDeclined] = useState(false)
  const [tone, setTone] = useState<string>('direct')
  const [sealing, setSealing] = useState(false)
  const [sealError, setSealError] = useState<string | null>(null)
  const finished = useRef(false)

  const advance = (): void => {
    const next = nextStep(step)
    if (next !== undefined) setStep(next)
  }

  const row = models.rows.find(candidate =>
    candidate.entry.provider === 'deepseek-official'
    && candidate.entry.settingsNs === 'llm-deepseek'
    && candidate.entry.settingsPath.length === 0)
  // Another provider's credential cannot authorize an automatic DeepSeek probe.
  const readiness = onboardingReadiness({ ...models, rows: row === undefined ? [] : [row] })
  const namespace = models.namespaces.get('llm-deepseek')
  /** The DeepSeek route exists and is live, so its gate is the live probe below. */
  const deepSeekLane = row !== undefined && row.entry.active
  /**
   * Whether the step may answer itself. A route that authenticates outside the
   * credential store still owes the probe a real request, so only the keyless
   * credential-missing route waits for the editor; every other live route
   * probes on entry. Advancing on local metadata would reopen the exact hole
   * this gate exists to close.
   */
  const autoVerifyModel = deepSeekLane && readiness.kind !== 'credential-missing'

  /** The Model step's live check: ask the Host to interrogate the provider for real. */
  const verifyModel = async (): Promise<void> => {
    setModelStatus('checking')
    setModelError(null)
    const outcome = await operations.discoverModels('llm-deepseek', { provider: 'deepseek-official' })
    if (outcome.kind === 'found' && outcome.models.length > 0) {
      setModelStatus('verified')
      return
    }
    setModelStatus('failed')
    setModelError(outcome.kind === 'refused' ? outcome.message : t('firstLightModelEmpty'))
  }

  const finish = (): void => {
    if (finished.current) return
    finished.current = true
    complete()
    if (modelDeferred) openSection('models')
  }

  useEffect(() => {
    if (state.status === 'idle') void controller.load()
  }, [controller, state.status])

  useEffect(() => {
    if (state.status === 'idle') return
    if (models.status === 'idle') void modelsController.load()
  }, [modelsController, models.status, state.status])

  // The durable seal is the only completion path: a sealed scope finishes the
  // step at boot, so setup never replays for a returning user.
  useEffect(() => {
    if (state.complete) finish()
  }, [state.complete])

  // Entering the Model step answers itself when the route is already live: the
  // gate is a real request, not a click the user has to remember.
  useEffect(() => {
    if (step !== 'model' || !autoVerifyModel || modelStatus !== 'idle') return
    void verifyModel()
  }, [step, autoVerifyModel, modelStatus, verifyModel])

  if (state.status === 'idle' || state.status === 'loading' || state.complete) return null

  if (state.status === 'error') {
    return (
      <OnboardingModal title={t('firstLightTitle')}>
        <p className={css.error} role="alert">{t('firstLightUnavailable')}</p>
        <div className={css.actions}>
          <Button variant="primary" onClick={() => { void controller.load() }}>{t('retry')}</Button>
        </div>
      </OnboardingModal>
    )
  }

  const verifyBrain = async (): Promise<void> => {
    setBrainDeclined(false)
    setBrainStatus('checking')
    setBrainError(null)
    const outcome = await verifyDesignBrain()
    if (outcome.kind === 'verified') {
      setBrainStatus('verified')
      setBrainTools(outcome.tools)
      return
    }
    setBrainStatus('failed')
    setBrainError(outcome.message)
  }

  /** Register one chosen folder as the session default, reporting refusal honestly. */
  const registerChosen = async (path: string): Promise<void> => {
    setWorkspaceStatus('registering')
    setWorkspaceError(null)
    const outcome = await registerWorkspace(path)
    if (outcome.kind === 'registered') {
      setWorkspaceStatus('registered')
      return
    }
    // Not silently trapped: the failure is named, retry stays available, and
    // declining is still a deliberate, recorded choice rather than a dead end.
    setWorkspaceStatus('failed')
    setWorkspaceError(outcome.message)
  }

  /** Pick a folder, then make it the default. A declined picker is not an error. */
  const chooseWorkspace = async (): Promise<void> => {
    setWorkspaceError(null)
    let outcome: WorkspacePickOutcome
    try {
      outcome = await pickWorkspace()
    } catch {
      // A throwing picker is one that could not open at all: report it rather
      // than letting the click land nowhere, and keep the folder choosable.
      outcome = { kind: 'failed', message: t('firstLightWorkspacePickerFailed') }
    }
    if (outcome.kind === 'declined') return
    if (outcome.kind === 'failed') {
      setWorkspaceStatus('failed')
      setWorkspaceError(outcome.message)
      return
    }
    setWorkspacePath(outcome.path)
    setWorkspaceDeclined(false)
    await registerChosen(outcome.path)
  }

  /** Retry the folder already picked, without reopening the picker. */
  const retryWorkspace = async (): Promise<void> => {
    if (workspacePath === null) return
    await registerChosen(workspacePath)
  }

  /**
   * Write the profile, the voice, the memory mirror, and finally the seal. The
   * memory write is part of the gate, not a courtesy: the step's promise is
   * that the agent knows who the user is, and a settings row alone is not read
   * by the model. Its failure is named and recoverable — the user retries here
   * with every answer still on screen.
   */
  const startChatting = async (): Promise<void> => {
    setSealing(true)
    setSealError(null)
    const profileSaved = await controller.saveProfile({ name, building, language })
    const voiceSaved = await controller.saveVoice({ tone })
    let memoryError: string | null = null
    if (profileSaved && voiceSaved) {
      const memory = await writeAgentMemory({
        name, building, language, tone, consultDesignBrain: brainStatus === 'verified' && !brainDeclined,
      })
      if (memory.kind === 'failed') memoryError = memory.message
    }
    const sealed = profileSaved && voiceSaved && memoryError === null
      ? await controller.seal()
      : false
    setSealing(false)
    if (!sealed) setSealError(memoryError ?? t('firstLightSealFailed'))
  }

  const title = (() => {
    switch (step) {
      case 'welcome': return t('firstLightWelcomeTitle')
      case 'you': return t('firstLightYouTitle')
      case 'model': return t('onboardingTitle')
      case 'brain': return t('firstLightBrainTitle')
      case 'workspace': return t('firstLightWorkspaceTitle')
      case 'connectors': return t('firstLightConnectorsTitle')
      case 'voice': return t('firstLightVoiceTitle')
      case 'receipt': return t('firstLightReceiptTitle')
    }
  })()

  const body = (): ReactNode => {
    switch (step) {
      case 'welcome':
        return (
          <>
            <div className={css.copy}>
              {t('firstLightWelcomeBody').split('\n\n').map(paragraph =>
                <p key={paragraph}>{paragraph}</p>)}
            </div>
            <div className={css.actions}>
              <Button variant="primary" onClick={advance}>{t('firstLightContinue')}</Button>
            </div>
          </>
        )
      case 'you':
        return (
          <>
            <div className={css.field}>
              <label className={css.label} htmlFor="first-light-name">{t('firstLightName')}</label>
              <input
                id="first-light-name"
                className={css.input}
                value={name}
                autoFocus
                onChange={(event) => { setName(event.target.value) }}
              />
            </div>
            <div className={css.field}>
              <label className={css.label} htmlFor="first-light-building">
                {t('firstLightBuilding')}
              </label>
              <input
                id="first-light-building"
                className={css.input}
                value={building}
                onChange={(event) => { setBuilding(event.target.value) }}
              />
            </div>
            <div className={css.field}>
              <span className={css.label}>{t('firstLightLanguage')}</span>
              <div className={css.choices}>
                {LANGUAGES.map(choice => (
                  <button
                    key={choice}
                    type="button"
                    className={css.choice}
                    aria-pressed={language === choice}
                    onClick={() => { setLanguage(choice) }}
                  >
                    {choice === 'en' ? t('firstLightLanguageEn') : t('firstLightLanguageZh')}
                  </button>
                ))}
              </div>
            </div>
            <div className={css.actions}>
              <button type="button" className={css.secondary} onClick={() => { setStep('welcome') }}>
                {t('firstLightBack')}
              </button>
              <Button
                variant="primary"
                disabled={name.trim().length === 0 || building.trim().length === 0}
                onClick={advance}
              >
                {t('firstLightContinue')}
              </Button>
            </div>
          </>
        )
      case 'model': {
        const chooseProviderLater = (): void => {
          setModelDeferred(true)
          advance()
        }
        if (!deepSeekLane) {
          return (
            <>
              <p className={css.copy}>{t('firstLightModelUnavailable')}</p>
              <div className={css.actions}>
                <Button variant="primary" onClick={chooseProviderLater}>
                  {t('onboardingOtherProvider')}
                </Button>
              </div>
            </>
          )
        }
        // The unavailable branch above already returned when `row` is missing,
        // so only the namespace view can still be absent here.
        const collectKey = readiness.kind === 'credential-missing'
          && namespace !== undefined
        return (
          <>
            <p className={css.copy}>{t('onboardingDescription')}</p>
            {collectKey
              ? (
                <div className={css.editor}>
                  <ProviderEditor
                    provider={row.entry.provider}
                    displayName={row.entry.displayName}
                    namespace={namespace}
                    schema={schema}
                    settingsPath={row.entry.settingsPath}
                    operations={operations}
                    t={t}
                    readOnly={false}
                    hideTitle
                    hideCancel
                    credentialOnly
                    credentialRequired
                    autoFocusCredential
                    submitLabelKey="onboardingSave"
                    submitBusyLabelKey="onboardingSaving"
                    onClose={(changed) => {
                      if (!changed) return
                      void modelsController.load().then(() => verifyModel())
                    }}
                  />
                </div>
              )
              : null}
            {modelStatus === 'checking' ? <p className={css.note}>{t('firstLightChecking')}</p> : null}
            {modelStatus === 'failed' && modelError !== null
              ? <p className={css.error} role="alert">{modelError}</p>
              : null}
            {modelStatus === 'verified' ? <p className={css.status}>{t('firstLightModelVerified')}</p> : null}
            <div className={css.actions}>
              <button type="button" className={css.secondary} onClick={chooseProviderLater}>
                {t('onboardingOtherProvider')}
              </button>
              <button
                type="button"
                className={css.secondary}
                disabled={modelStatus === 'checking'}
                onClick={() => { void verifyModel() }}
              >
                {t('firstLightVerify')}
              </button>
              <Button
                variant="primary"
                disabled={modelStatus !== 'verified'}
                onClick={advance}
              >
                {t('firstLightContinue')}
              </Button>
            </div>
            <p className={css.note}>{t('firstLightOtherProviderDetail')}</p>
          </>
        )
      }
      case 'brain':
        return (
          <>
            <p className={css.copy}>{t('firstLightBrainBody')}</p>
            <p className={css.note}>{t('designBrainEndpointNotice')}</p>
            {brainStatus === 'checking' ? <p className={css.note}>{t('firstLightChecking')}</p> : null}
            {brainStatus === 'verified'
              ? (
                <p className={css.status}>
                  {`${t('firstLightBrainVerified')} (${brainTools.slice(0, 3).join(', ')})`}
                </p>
              )
              : null}
            {brainStatus === 'failed' && brainError !== null
              ? <p className={css.error} role="alert">{`${t('firstLightBrainFailed')}: ${brainError}`}</p>
              : null}
            {brainDeclined ? <p className={css.note}>{t('firstLightBrainDeclined')}</p> : null}
            <div className={css.actions}>
              <button
                type="button"
                className={css.secondary}
                disabled={brainStatus === 'checking' || brainStatus === 'verified'}
                onClick={() => {
                  setBrainStatus('checking')
                  void declineDesignBrain().then((declined) => {
                    setBrainDeclined(declined)
                    setBrainStatus(declined ? 'idle' : 'failed')
                    setBrainError(declined ? null : t('designBrainUnavailable'))
                  })
                }}
              >
                {t('firstLightNotNow')}
              </button>
              <button
                type="button"
                className={css.secondary}
                disabled={brainStatus === 'checking' || brainStatus === 'verified'}
                onClick={() => { void verifyBrain() }}
              >
                {t('designBrainConnect')}
              </button>
              <Button
                variant="primary"
                disabled={brainStatus !== 'verified' && !brainDeclined}
                onClick={advance}
              >
                {t('firstLightContinue')}
              </Button>
            </div>
          </>
        )
      case 'workspace':
        return (
          <>
            <p className={css.copy}>{t('firstLightWorkspaceBody')}</p>
            {workspacePath !== null && !workspaceDeclined
              ? <p className={css.status}>{workspacePath}</p>
              : null}
            {workspaceStatus === 'registering'
              ? <p className={css.note}>{t('firstLightWorkspaceRegistering')}</p>
              : null}
            {workspaceStatus === 'registered'
              ? <p className={css.status}>{t('firstLightWorkspaceRegistered')}</p>
              : null}
            {workspaceStatus === 'failed' && workspaceError !== null
              ? <p className={css.error} role="alert">{workspaceError}</p>
              : null}
            {workspaceDeclined ? <p className={css.note}>{t('firstLightWorkspaceDeclined')}</p> : null}
            <div className={css.actions}>
              <button
                type="button"
                className={css.secondary}
                onClick={() => {
                  setWorkspaceDeclined(true)
                  setWorkspacePath(null)
                  setWorkspaceStatus('idle')
                  setWorkspaceError(null)
                }}
              >
                {t('firstLightNotNow')}
              </button>
              {workspaceStatus === 'failed' && workspacePath !== null
                ? (
                  <button
                    type="button"
                    className={css.secondary}
                    onClick={() => { void retryWorkspace() }}
                  >
                    {t('firstLightWorkspaceRetry')}
                  </button>
                )
                : (
                  <button type="button" className={css.secondary} onClick={() => { void chooseWorkspace() }}>
                    {t('firstLightChooseFolder')}
                  </button>
                )}
              <Button
                variant="primary"
                disabled={workspaceStatus !== 'registered' && !workspaceDeclined}
                onClick={advance}
              >
                {t('firstLightContinue')}
              </Button>
            </div>
          </>
        )
      case 'connectors':
        // Optional connections are declined, never half-configured: a toggle
        // whose verifier does not exist yet would either lie or trap the user,
        // so the step names what is available and lets them say Not now.
        return (
          <>
            <p className={css.copy}>{t('firstLightConnectorsBody')}</p>
            <p className={css.note}>{t('firstLightConnectorsDetail')}</p>
            {connectorsDeclined ? <p className={css.note}>{t('firstLightConnectorsDeclined')}</p> : null}
            <div className={css.actions}>
              <button
                type="button"
                className={css.secondary}
                onClick={() => { setConnectorsDeclined(true) }}
              >
                {t('firstLightNotNow')}
              </button>
              <Button variant="primary" onClick={advance}>{t('firstLightContinue')}</Button>
            </div>
          </>
        )
      case 'voice':
        return (
          <>
            <p className={css.copy}>{t('firstLightVoiceBody')}</p>
            <div className={css.choices}>
              {TONES.map(choice => (
                <button
                  key={choice}
                  type="button"
                  className={css.choice}
                  aria-pressed={tone === choice}
                  onClick={() => { setTone(choice) }}
                >
                  {choice === 'direct'
                    ? t('firstLightToneDirect')
                    : choice === 'warm' ? t('firstLightToneWarm') : t('firstLightToneDetailed')}
                </button>
              ))}
            </div>
            <div className={css.actions}>
              <button type="button" className={css.secondary} onClick={() => { setStep('connectors') }}>
                {t('firstLightBack')}
              </button>
              <Button variant="primary" onClick={advance}>{t('firstLightContinue')}</Button>
            </div>
          </>
        )
      case 'receipt':
        return (
          <>
            <p className={css.copy}>{t('firstLightReceiptBody')}</p>
            <dl className={css.summary}>
              <dt className={css.summaryTerm}>{t('firstLightReceiptYou')}</dt>
              <dd className={css.summaryValue}>{`${name} — ${building}`}</dd>
              <dt className={css.summaryTerm}>{t('firstLightReceiptModel')}</dt>
              <dd className={css.summaryValue}>
                {modelDeferred || modelStatus !== 'verified'
                  ? t('firstLightModelDeferred')
                  : t('firstLightModelVerified')}
              </dd>
              <dt className={css.summaryTerm}>{t('firstLightReceiptBrain')}</dt>
              <dd className={css.summaryValue}>
                {brainStatus === 'verified' ? t('firstLightBrainVerified') : t('firstLightDeclined')}
              </dd>
              <dt className={css.summaryTerm}>{t('firstLightReceiptWorkspace')}</dt>
              <dd className={css.summaryValue}>
                {workspacePath ?? t('firstLightDeclined')}
              </dd>
              <dt className={css.summaryTerm}>{t('firstLightReceiptConnectors')}</dt>
              <dd className={css.summaryValue}>
                {connectorsDeclined ? t('firstLightDeclined') : t('firstLightLater')}
              </dd>
              <dt className={css.summaryTerm}>{t('firstLightReceiptVoice')}</dt>
              <dd className={css.summaryValue}>
                {tone === 'direct'
                  ? t('firstLightToneDirect')
                  : tone === 'warm' ? t('firstLightToneWarm') : t('firstLightToneDetailed')}
              </dd>
            </dl>
            {sealError !== null ? <p className={css.error} role="alert">{sealError}</p> : null}
            <div className={css.actions}>
              <button
                type="button"
                className={css.secondary}
                disabled={sealing}
                onClick={() => { setStep('voice') }}
              >
                {t('firstLightBack')}
              </button>
              <Button variant="primary" disabled={sealing} onClick={() => { void startChatting() }}>
                {sealing ? t('onboardingSaving')
                  : modelDeferred ? t('firstLightOpenModels') : t('firstLightStart')}
              </Button>
            </div>
          </>
        )
      /* v8 ignore next -- every step in the union is handled above */
      default: return assertNever(step)
    }
  }

  return (
    <OnboardingModal title={title}>
      {body()}
    </OnboardingModal>
  )
}
