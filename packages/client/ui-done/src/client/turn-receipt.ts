/**
 * Turn receipt: the join of "what changed" with "how it was proven".
 *
 * `changes` reads the paths the Deliverables Definition published against the
 * closing Turn — that Definition owns the mutation vocabulary, so this reads
 * its published value instead of re-deriving paths from tool arguments. The
 * `verdict` reads the `done` projection. The doctrine is the rule between
 * them: only a contract that carries evidence is PROVEN, and every other state
 * — no contract at all, a stated one, or a status claiming proof while
 * carrying none — is NOT_ASSESSED, never green.
 *
 * Pure on purpose: the join and the NOT_ASSESSED rule are the part that must
 * hold whatever the surfaces do, so they are testable without a DOM.
 */
import type { DoneProjection } from '@saturnai/dsh-done/client'

/**
 * The produced-file facts one Turn published, read for its paths alone. The
 * owning Definition publishes more per path (its settlement sequence); only
 * the path is part of a receipt.
 */
export interface ReceiptDeliverables {
  readonly produced: readonly { readonly path: string }[]
}

/** The Turn facts a receipt reads: turn ids in order, and each one's data. */
export interface ReceiptTimeline {
  readonly turnOrder: readonly number[]
  readonly turns: ReadonlyMap<number, { readonly data: ReceiptTurnData }>
}

/** One Turn's published business values, narrowed to the key a receipt reads. */
export interface ReceiptTurnData {
  get(key: 'deliverables'): ReceiptDeliverables | undefined
}

/**
 * What the turn changed: the paths it published, or the explicit absence of a
 * record. Absence is never zero — a turn whose record is not loaded says so
 * rather than implying it changed nothing.
 */
export type ReceiptChanges =
  | { readonly kind: 'recorded'; readonly paths: readonly string[] }
  | { readonly kind: 'unavailable' }

/** How the session's contract was proven, or the doctrine's explicit absence. */
export type ReceiptVerdict =
  | { readonly kind: 'proven'; readonly evidence: string }
  | { readonly kind: 'not-assessed' }

/** One turn's receipt: the turn it covers, what changed, and how it was proven. */
export interface TurnReceiptValue {
  /** The covered turn, or undefined when the timeline exposes no turn yet. */
  readonly turn: number | undefined
  readonly changes: ReceiptChanges
  readonly verdict: ReceiptVerdict
}

/** The three published values a receipt joins. */
export interface TurnReceiptInput {
  /** Latest loaded Turn from the Chat target's timeline. */
  readonly timeline: ReceiptTimeline
  /** The session's current definition of done, or the key's absence. */
  readonly done: DoneProjection | undefined
}

/**
 * Join one turn's changed paths with the session contract's verdict.
 * @param input - the Chat target's timeline and the `done` projection value.
 * @returns The receipt for the timeline's latest turn.
 */
export function turnReceipt(input: TurnReceiptInput): TurnReceiptValue {
  const turn = input.timeline.turnOrder.at(-1)
  return {
    turn,
    changes: receiptChanges(turn, input.timeline),
    verdict: receiptVerdict(input.done),
  }
}

/**
 * Paths the given turn published, first-seen order, each path once.
 *
 * The dedupe restates the produced-files row's rule (a file written and then
 * edited in one turn is one entry) locally, because a client bundle may not
 * value-import the owning plugin's module. The path vocabulary itself is not
 * restated: the owning Definition publishes the paths, and a turn with no
 * published value reports no record rather than zero changes.
 * @param turn - the covered turn, or undefined when the timeline has none.
 * @param timeline - the Chat target's timeline.
 * @returns The turn's changed paths, or the record's absence.
 */
function receiptChanges(turn: number | undefined, timeline: ReceiptTimeline): ReceiptChanges {
  if (turn === undefined) return { kind: 'unavailable' }
  const data = timeline.turns.get(turn)?.data.get('deliverables')
  if (data === undefined) return { kind: 'unavailable' }
  const paths: string[] = []
  const seen = new Set<string>()
  for (const produced of data.produced) {
    if (seen.has(produced.path)) continue
    seen.add(produced.path)
    paths.push(produced.path)
  }
  return { kind: 'recorded', paths }
}

/**
 * Judge the session's contract.
 *
 * Only a `proven` status that actually carries evidence counts as PROVEN: a
 * status claiming proof without evidence is exactly the state the doctrine
 * forbids reading as green, so it is NOT_ASSESSED here. Capability absence
 * (undefined) and no contract (null) are NOT_ASSESSED too — an unproven
 * session must never look proven by omission.
 * @param done - the `done` projection value.
 * @returns The verdict this receipt states.
 */
function receiptVerdict(done: DoneProjection | undefined): ReceiptVerdict {
  if (done === undefined || done === null) return { kind: 'not-assessed' }
  const evidence = done.evidence?.trim() ?? ''
  return done.status === 'proven' && evidence !== ''
    ? { kind: 'proven', evidence }
    : { kind: 'not-assessed' }
}
