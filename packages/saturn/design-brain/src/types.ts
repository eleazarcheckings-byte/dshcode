/** Public connection facts; Connected means tools are registered in the running harness. */
export interface DesignBrainStatus {
  /** Actual registered-tool state, independent of the saved preference. */
  state: 'disabled' | 'connecting' | 'connected' | 'unavailable'
  /** Whether this connector should start automatically in this profile. */
  enabled: boolean
  /** Existing profile rows remain owned by their profile configuration. */
  source: 'managed' | 'profile'
  /** Configured endpoint, with no credentials or query parameters. */
  endpoint: string | null
  /** Full tool names currently registered for model use. */
  tools: string[]
  /** Bounded failure category for localized UI recovery instructions. */
  issue: 'none' | 'connection-failed' | 'timeout' | 'profile-disabled' | 'profile-unavailable' | 'incomplete-tools'
}
