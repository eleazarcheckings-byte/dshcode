/**
 * Browser-half entry of the checkpoint domain: the durable vocabulary a client
 * bundle may read (the `checkpoints` projection value and its record types),
 * with no host-side value import in reach.
 *
 * @module @saturnai/dsh-checkpoints/client
 */

export type {
  CheckpointEntry,
  CheckpointEntryState,
  CheckpointReason,
  CheckpointRecord,
  CheckpointSummary,
  CheckpointsProjection,
  CheckpointsUnitState,
} from './types.ts'
export { MAX_WIRE_CHECKPOINTS } from './types.ts'
