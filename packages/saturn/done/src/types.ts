/**
 * Pure types of the definition-of-done domain: the ONE home of the `done`
 * projection-key declaration plus the durable payload vocabulary it carries,
 * free of this package's host-side value imports (cordis, dsh-agent, zod).
 * Two namespace projections serve it — `./types` for host consumers and
 * `./client` (the browser half-entry's re-export) for client aggregates —
 * with zero content duplication.
 *
 * @module @saturnai/dsh-done/types
 */

/**
 * Whether the stated definition of done has been *proven*. Doctrine: "'Done'
 * means proven. Tests pass, smoke passes, the thing actually runs — not
 * hoped. Missing evidence is NOT_ASSESSED and never counts as green." A
 * statement is `stated` from the moment it is written and becomes `proven`
 * only when it carries both the evidence that met it and the
 * {@link DoneProof proof} that evidence can be checked against.
 */
export type DoneStatus = 'stated' | 'proven'

/**
 * A reviewer's overall judgement of one piece of work. Doctrine tokens, kept
 * in this spelling everywhere they are shown so the word a reader sees is the
 * word the reviewer wrote.
 */
export type ReviewVerdict = 'PASS' | 'REVISE' | 'REJECT'

/**
 * The closed set of criteria an independent review grades. A reviewer that may
 * invent its own axes is not a gate, so the set is fixed here beside the
 * durable payload that carries it.
 */
export type ReviewCriterion =
  | 'factual_accuracy'
  | 'completeness'
  | 'format_compliance'
  | 'internal_consistency'
  | 'edge_case_handling'
  | 'source_quality'

/** One graded criterion: the score out of five and the evidence that earned it. */
export interface ReviewScore {
  /** Which criterion this line grades. */
  readonly criterion: ReviewCriterion
  /** 1–5, where 5 is "no flaw found under this criterion". */
  readonly score: number
  /** What the reviewer looked at to arrive at the score. */
  readonly evidence: string
}

/**
 * One durable review record: a reviewer's verdict on the contract it graded,
 * plus the token that verdict can be cited by. Minted into the session log by
 * the review tool and read back when a proof cites the token, so a proven
 * contract's provenance survives resume and fork.
 */
export interface CountersignRecord {
  /** Opaque single-session token the `prove` action cites. */
  readonly token: string
  /** The exact contract statement the reviewer graded. */
  readonly statement: string
  /** The reviewer's overall judgement. */
  readonly verdict: ReviewVerdict
  /** Who graded it: the reviewer persona and the backend that ran it. */
  readonly reviewer: string
  /** One line per criterion of the rubric. */
  readonly scores: readonly ReviewScore[]
  /** The reviewer's one-paragraph account of the verdict. */
  readonly summary?: string
  /** Epoch milliseconds of the review. */
  readonly at: number
}

/**
 * How a proven contract can be checked by someone who was not there.
 *
 * `receipt` names a tool call in this session whose result was not an error:
 * the run the work actually made. `countersign` names a review an independent
 * agent performed against the rubric and passed. `human` records the one
 * attestation this harness cannot check and does not need to — the person
 * whose work it is, saying so at the `/done prove` command.
 */
export type DoneProof =
  | {
    /** The proof is a tool call this session really made. */
    readonly kind: 'receipt'
    /** The call id cited, as it appears in the session log. */
    readonly toolCallId: string
    /** The tool that ran under that call id. */
    readonly toolName: string
  }
  | {
    /** The proof is an independent reviewer's PASS. */
    readonly kind: 'countersign'
    /** The token the reviewer minted. */
    readonly token: string
    /** Who graded it. */
    readonly reviewer: string
    /** Always `PASS`: no other verdict mints a usable token. */
    readonly verdict: ReviewVerdict
    /** The rubric the reviewer returned. */
    readonly scores: readonly ReviewScore[]
    /** The reviewer's account of the verdict. */
    readonly summary?: string
  }
  | {
    /** The person owning the work attested it at the command. */
    readonly kind: 'human'
  }

/**
 * One durable definition of done: the short contract a piece of work is
 * striving against, plus the evidence that met it and the proof that evidence
 * stands on.
 */
export interface DoneState {
  /**
   * One or two sentences naming what is being built and how we will know it
   * is finished. Concrete enough that a stranger could falsify it.
   */
  readonly statement: string
  /** `stated` until evidence exists; `proven` only alongside {@link evidence}. */
  readonly status: DoneStatus
  /**
   * One-line citation of the evidence that proved it (what was run and what
   * it showed). Present exactly when `status` is `proven`.
   */
  readonly evidence?: string
  /**
   * What the evidence can be checked against. Present exactly when `status` is
   * `proven`: a contract whose proof cannot be named is not proven.
   */
  readonly proof?: DoneProof
  /** Epoch milliseconds of the latest durable mutation. */
  readonly at: number
}

/**
 * The `done` projection value: the session's current definition of done, or
 * `null` before the first statement and after a clear. Capability absence
 * (this plugin not composed) is the key's absence, never a value.
 */
export type DoneProjection = DoneState | null

/** Host fold state used to derive {@link DoneProjection}. */
export interface DoneUnitState {
  /** Latest durable definition of done, or null while none is stated. */
  readonly current: DoneState | null
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Whole-value replace of this session's definition of done: log-only,
     * non-surface. The last `done/change` wins; a log with none folds to
     * `null` — no definition of done has been stated yet.
     */
    'done/change': { readonly next: DoneState | null }
    /**
     * One independent review of this session's contract, minted by the review
     * tool: log-only, non-surface, append-only. A `prove` citing the record's
     * token reads it back from here, so the provenance of a proven contract is
     * durable rather than held in memory.
     */
    'done/countersign': { readonly record: CountersignRecord }
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Host definition-of-done fold state. */
    done: DoneUnitState
  }
  interface SessionProjectionMap {
    /** The session's current definition of done, or `null` when none is stated. */
    done: DoneProjection
  }
}
