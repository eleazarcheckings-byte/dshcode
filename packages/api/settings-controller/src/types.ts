/**
 * Browser-safe failure vocabulary of the configuration surfaces this package
 * serves. The redacted views themselves live with their seam in
 * `@deepseek-ai/dsh-settings/types`, whose Cordis event declarations already
 * register that file for the Client compilation face.
 *
 * @module @deepseek-ai/dsh-api-settings-controller/types
 */

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /**
     * Every seam refusal that is not a stale write: an unregistered or malformed
     * namespace, a read-only provider, schema validation, storage.
     */
    'settings/rejected': { readonly ns: string }
    /**
     * The stored revision moved after the caller read it. Its own outcome rather
     * than an invalid request: the caller must re-read and re-apply.
     */
    'settings/conflict': { readonly ns: string; readonly expected: number; readonly actual: number }
    /**
     * The provider refused a valid credential write, for example because a
     * read-only source shadows the reference. The details name only the
     * reference, never the value.
     */
    'credential/rejected': { readonly ref: string }
  }
}

/** Confirmation that the settings document was handed to the native editor. */
export interface SettingsDocumentOpenValue {
  readonly opened: true
}

/** Result of opening or revealing one locally authored Agent preset directory. */
export type AgentPresetDirectoryOpenValue =
  | { readonly opened: true }
  | { readonly opened: false; readonly path: string }

/**
 * Identity and voice facts the setup sequence asks the Harness to remember as
 * agent memory. Deliberately closed and free of credential material: this is
 * what the model reads about the user, so it holds preferences only.
 */
export interface ProfileMemoryFacts {
  /** The name the user goes by. */
  readonly name: string
  /** What the user is building, in their own words. */
  readonly building: string
  /** Primary working language the user chose. */
  readonly language: string
  /** Preferred answer voice. */
  readonly tone: string
  /** Whether the model must consult the design brain before inventing UI. */
  readonly consultDesignBrain: boolean
}

/** Confirmation that the user-global memory file carries the profile. */
export interface ProfileMemoryWriteValue {
  /** Absolute path of the memory file that now holds the block. */
  readonly path: string
}
