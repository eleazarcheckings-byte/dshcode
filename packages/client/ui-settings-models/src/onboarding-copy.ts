/** Durable settings namespace for product-wide GUI onboarding facts. */
export const WELCOME_NOTICE_SETTINGS_NAMESPACE = 'ui-onboarding'

/** Field storing the last welcome notice version the user acknowledged. */
export const WELCOME_NOTICE_ACK_FIELD = 'welcomeNoticeVersion'

/**
 * Bump only when the notice changes materially and every user should see it
 * again. The acknowledgement is compared for exact equality.
 */
export const WELCOME_NOTICE_VERSION = '2026-08-13.1'

/**
 * Durable settings namespace for the First Light setup sequence. Kept apart
 * from `ui-onboarding` so the versioned notice and the setup receipt version
 * independently: re-showing the notice must never replay setup, and a future
 * setup version must never re-show the notice.
 */
export const FIRST_LIGHT_SETTINGS_NAMESPACE = 'ui-first-light'

/** Field sealing the whole setup sequence at the current version. */
export const FIRST_LIGHT_COMPLETE_FIELD = 'complete'

/** Field holding the local profile the user typed (name, what they build, language). */
export const FIRST_LIGHT_PROFILE_FIELD = 'profile'

/** Field holding the voice preferences the user chose. */
export const FIRST_LIGHT_VOICE_FIELD = 'voice'

/**
 * Bump only when the sequence changes materially and every user should run it
 * again. The seal is compared for exact equality.
 */
export const FIRST_LIGHT_VERSION = '2026-09-14.1'
