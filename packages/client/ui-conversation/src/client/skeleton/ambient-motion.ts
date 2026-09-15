/** One browser motion preference shared by the background and its global control. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'

const MOTION_PREFERENCE = 'saturn.hero.motion.v1'

/** Slot-injected preference source and the operator's explicit update action. */
export interface AmbientMotionInjected {
  /** The renderer turns the observable preference into useAmbientMotion. */
  hooks: { ambientMotion: HostObservable<boolean> }
  /** Update this application's preference and persist it when browser storage is available. */
  setAmbientMotion: (enabled: boolean) => void
}

function readMotionPreference(): boolean {
  try {
    return localStorage.getItem(MOTION_PREFERENCE) !== 'off'
  } catch {
    // Browser storage can be unavailable; the mounted preference still remains usable.
    return true
  }
}

/**
 * Create the single motion preference owned by one Conversation plugin application.
 * @returns Shared slot inject face with an observable preference and persistence action.
 */
export function createAmbientMotion(): AmbientMotionInjected {
  const ambientMotion = createSnapshotStore(readMotionPreference())
  return {
    hooks: { ambientMotion },
    setAmbientMotion: (enabled) => {
      ambientMotion.set(enabled)
      try {
        localStorage.setItem(MOTION_PREFERENCE, enabled ? 'on' : 'off')
      } catch {
        // Storage denial does not prevent the current application's motion control.
      }
    },
  }
}
