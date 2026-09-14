/**
 * Client face of the definition-of-done domain: the projection-key merges plus
 * the pure value types, with none of the host-side value imports. Client
 * packages import this subpath so `useProjection('done')` type-checks without
 * dragging cordis, dsh-session, or zod into a browser program.
 *
 * @module @saturnai/dsh-done/client
 */

export type { DoneProjection, DoneState, DoneStatus, DoneUnitState } from './types.ts'
