/** Host-backed connection operations; browser reachability never implies agent capability. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { DesignBrainStatus } from '@saturnai/dsh-design-brain/client'
import type { ModelsKey } from './locales.ts'

/** The optional connection's typed Host operations. */
export interface DesignBrainRemote {
  status(): Promise<RemoteResult<DesignBrainStatus>>
  connect(): Promise<RemoteResult<DesignBrainStatus>>
  disconnect(): Promise<RemoteResult<DesignBrainStatus>>
}

/** A real Host connection result for the setup receipt. */
export type DesignBrainOutcome =
  | { readonly kind: 'verified'; readonly tools: readonly string[] }
  | { readonly kind: 'unreachable'; readonly message: string }

/** Last authoritative Host state and the current request state. */
export interface DesignBrainView {
  snapshot: DesignBrainStatus | null
  busy: boolean
  error: boolean
}

/** Owns the shared settings/onboarding connection projection. */
export class DesignBrainController {
  readonly state = createSnapshotStore<DesignBrainView>({ snapshot: null, busy: false, error: false })
  private disposed = false
  private tail: Promise<void> = Promise.resolve()

  constructor(private readonly remote: DesignBrainRemote, private readonly t: (key: ModelsKey) => string) {}

  private publish(view: DesignBrainView): void {
    if (!this.disposed) this.state.set(view)
  }

  private request(method: keyof DesignBrainRemote): Promise<DesignBrainStatus | null> {
    if (this.disposed) return Promise.resolve(null)
    const pending = this.tail.then(async () => {
      if (this.disposed) return null
      this.state.set({ ...this.state.getSnapshot(), busy: true, error: false })
      try {
        const response = await this.remote[method]()
        if (!response.ok) throw new Error('Design brain Host request failed')
        this.publish({ snapshot: response.value, busy: false, error: false })
        return response.value
      } catch {
        // Do not retain a stale green connection after a failed Host request.
        this.publish({ snapshot: null, busy: false, error: true })
        return null
      }
    })
    this.tail = pending.then(() => {}, () => {})
    return pending
  }

  readonly refresh = async (): Promise<void> => { await this.request('status') }
  readonly connect = async (): Promise<void> => { await this.request('connect') }
  readonly disconnect = async (): Promise<void> => { await this.request('disconnect') }

  readonly verify = async (): Promise<DesignBrainOutcome> => {
    const snapshot = await this.request('connect')
    return snapshot?.state === 'connected'
      ? { kind: 'verified', tools: snapshot.tools }
      : { kind: 'unreachable', message: this.t(snapshot?.issue === 'incomplete-tools' ? 'designBrainPartial' : snapshot?.source === 'profile' ? 'designBrainProfile' : 'designBrainUnavailable') }
  }

  readonly decline = async (): Promise<boolean> => {
    // A separately configured connection remains profile-owned, even during setup.
    const current = await this.request('status')
    if (current === null) return false
    if (current.source === 'profile') return true
    return (await this.request('disconnect'))?.state === 'disabled'
  }

  dispose(): void { this.disposed = true }
}
