/**
 * First Light state derived from the `ui-first-light` settings scope. The scope
 * is the transport, exactly as the welcome notice's is: a loopback browser
 * follows the durable Host section, while a remote browser's memory-mode scope
 * never answers and the whole sequence stays process-local here. Setup is a
 * hard gate, so completion is written last and judged by re-reading the state
 * the write left behind — a seal that did not persist can never read as done.
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  FIRST_LIGHT_COMPLETE_FIELD, FIRST_LIGHT_PROFILE_FIELD, FIRST_LIGHT_VERSION,
  FIRST_LIGHT_VOICE_FIELD,
} from '../onboarding-copy.ts'

/** The local profile the You step collects. */
export interface FirstLightProfile {
  /** What the assistant should call the user. */
  name: string
  /** What the user is here to build. */
  building: string
  /** Primary language for replies. */
  language: string
}

/** The voice preferences the Voice step collects. */
export interface FirstLightVoice {
  /** Preferred reply tone. */
  tone: string
}

/** State rendered by the setup sequence. */
export interface FirstLightState {
  status: 'idle' | 'loading' | 'ready' | 'saving' | 'error'
  /** Whether the exact current sequence version is durably sealed. */
  complete: boolean
  profile: FirstLightProfile
  voice: FirstLightVoice
  error: string | null
}

/** The first-light section as the store reads it. */
export type FirstLightSection = Record<string, unknown>

/** The profile a user has not filled yet. */
export const EMPTY_FIRST_LIGHT_PROFILE: FirstLightProfile = { name: '', building: '', language: '' }

/** The voice a user has not chosen yet. */
export const EMPTY_FIRST_LIGHT_VOICE: FirstLightVoice = { tone: '' }

/**
 * Accept any object section verbatim; a malformed durable value reads as an
 * empty section, so the sequence restarts instead of leaving the scope stuck
 * on its previous value.
 * @param section - the wire section value.
 * @returns the section object, or an empty one for non-object values.
 */
export function decodeFirstLightSection(section: unknown): FirstLightSection {
  return typeof section === 'object' && section !== null && !Array.isArray(section)
    ? section as FirstLightSection
    : {}
}

/** Read one string field of an object value, or '' when it is not a string. */
function stringField(source: unknown, key: string): string {
  if (typeof source !== 'object' || source === null || Array.isArray(source)) return ''
  const value = (source as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : ''
}

/** Project the stored profile, filling absent fields with the empty profile. */
function readProfile(section: FirstLightSection): FirstLightProfile {
  const stored = section[FIRST_LIGHT_PROFILE_FIELD]
  return {
    name: stringField(stored, 'name'),
    building: stringField(stored, 'building'),
    language: stringField(stored, 'language'),
  }
}

/** Project the stored voice preferences, filling absent fields with the empty voice. */
function readVoice(section: FirstLightSection): FirstLightVoice {
  return { tone: stringField(section[FIRST_LIGHT_VOICE_FIELD], 'tone') }
}

/* v8 ignore next 3 -- closed-union default only defends future source widening */
function assertNever(_value: never): never {
  throw new Error('unexpected first-light settings status')
}

/** Coordinates durable Host persistence or a process-local remote fallback. */
export class FirstLightStore {
  /** uSES-safe state source shared by the registered setup step. */
  readonly store: SnapshotStore<FirstLightState> = createSnapshotStore<FirstLightState>({
    status: 'idle', complete: false, profile: EMPTY_FIRST_LIGHT_PROFILE,
    voice: EMPTY_FIRST_LIGHT_VOICE, error: null,
  })

  private localComplete = false
  private localProfile: FirstLightProfile
  private localVoice: FirstLightVoice
  private saving = false
  private following: (() => void) | undefined

  /**
   * @param scope - the first-light settings namespace scope; its memory mode
   * is what keeps a remote browser process-local.
   */
  constructor(private readonly scope: SettingsScope<FirstLightSection>) {
    this.localProfile = { ...EMPTY_FIRST_LIGHT_PROFILE }
    this.localVoice = { ...EMPTY_FIRST_LIGHT_VOICE }
  }

  /**
   * Begin following the bound scope (idempotent) and publish its current answer.
   * @returns settlement after the current answer is published.
   */
  load(): Promise<void> {
    this.following ??= this.scope.subscribe(() => { this.derive() })
    this.derive()
    return Promise.resolve()
  }

  /**
   * Persist the profile, or advance only this process for a remote browser.
   * @param profile - the collected profile.
   * @returns true when the selected persistence mode holds the profile.
   */
  saveProfile(profile: FirstLightProfile): Promise<boolean> {
    return this.write(FIRST_LIGHT_PROFILE_FIELD, { ...profile }, () => {
      this.localProfile = { ...profile }
    })
  }

  /**
   * Persist the voice preferences, or advance only this process for a remote browser.
   * @param voice - the collected preferences.
   * @returns true when the selected persistence mode holds them.
   */
  saveVoice(voice: FirstLightVoice): Promise<boolean> {
    return this.write(FIRST_LIGHT_VOICE_FIELD, { ...voice }, () => {
      this.localVoice = { ...voice }
    })
  }

  /**
   * Seal the whole sequence at the current version, or advance only this
   * process for a remote browser. Success is judged against the state the
   * write left behind, so a refused or failed write reports false after its
   * recovery read settles.
   * @returns true when the selected persistence mode holds the seal.
   */
  seal(): Promise<boolean> {
    return this.write(FIRST_LIGHT_COMPLETE_FIELD, FIRST_LIGHT_VERSION, () => {
      this.localComplete = true
    })
  }

  /** Stop following the scope. */
  dispose(): void {
    this.following?.()
    this.following = undefined
  }

  /**
   * One durable field write, or the memory-mode local advance. The durable
   * branch judges nothing itself: `derive` re-reads the scope and the caller
   * reads the resulting state, so a write that the Host accepted but did not
   * store cannot read as success.
   */
  private async write(
    field: string,
    value: unknown,
    advanceLocal: () => void,
  ): Promise<boolean> {
    if (this.scope.getSnapshot().mode === 'memory') {
      advanceLocal()
      this.derive()
      return true
    }
    this.saving = true
    this.store.update((state) => { state.status = 'saving'; state.error = null })
    try {
      await this.scope.set(field, value)
    } finally {
      this.saving = false
    }
    this.derive()
    const { profile, voice, complete } = this.store.getSnapshot()
    const held = field === FIRST_LIGHT_COMPLETE_FIELD
      ? complete
      : field === FIRST_LIGHT_PROFILE_FIELD
        ? profile.name !== '' || profile.building !== ''
        : voice.tone !== ''
    if (!held) {
      this.store.update((state) => {
        state.status = 'error'
        state.error = 'the entry did not persist'
      })
    }
    return held
  }

  private derive(): void {
    if (this.saving) return
    const scope = this.scope.getSnapshot()
    if (scope.mode === 'memory') {
      this.store.update((state) => {
        state.status = 'ready'
        state.complete = this.localComplete
        state.profile = { ...this.localProfile }
        state.voice = { ...this.localVoice }
        state.error = null
      })
      return
    }
    switch (scope.status) {
      case 'loading':
        this.store.update((state) => { state.status = 'loading'; state.error = null })
        return
      case 'unavailable':
        this.store.update((state) => {
          state.status = 'error'
          state.complete = false
          state.error = 'first-light settings are unavailable'
        })
        return
      case 'ready': {
        const section = scope.value ?? {}
        this.store.update((state) => {
          state.status = 'ready'
          state.complete = section[FIRST_LIGHT_COMPLETE_FIELD] === FIRST_LIGHT_VERSION
          state.profile = readProfile(section)
          state.voice = readVoice(section)
          state.error = null
        })
        return
      }
      /* v8 ignore next -- every current settings scope status is handled above */
      default: return assertNever(scope.status)
    }
  }
}
