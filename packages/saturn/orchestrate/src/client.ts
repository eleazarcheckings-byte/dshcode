/**
 * Client face of the orchestrate domain: the projection-key merges plus the
 * pure result types, with none of the host-side value imports. Client packages
 * import this subpath so `useProjection('orchestrate')` type-checks without
 * dragging cordis, dsh-agent, or zod into a browser program.
 *
 * @module @saturnai/dsh-orchestrate/client
 */

export type { OrchestrateProjection, OrchestrateUnitState } from './types.ts'
