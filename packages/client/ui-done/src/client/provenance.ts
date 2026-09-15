/**
 * Provenance: the one line that says what a PROVEN contract actually stands on.
 *
 * The status label answers "is it done"; this answers "says who" — and the
 * second question is the one the harness exists to make answerable. A receipt
 * names the call that ran, a countersign names an independent review, and a
 * human attestation says plainly that a person vouched for it rather than a
 * machine checking anything.
 *
 * Pure: the strip and the panel both read it, so the bar and the record can
 * never disagree about how a contract was proven.
 */

import type { DoneProof } from '@saturnai/dsh-done/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'

/** The `done` namespace translate seat, as both surfaces receive it. */
type Translate = PropsLocale<'done'>['t']

/**
 * The provenance line for one contract.
 * @param proof - the proof a proven contract carries, or undefined while none does.
 * @param t - the `done` namespace translate seat.
 * @returns the line to show, or null when there is no proof to describe.
 */
export function provenance(proof: DoneProof | undefined, t: Translate): string | null {
  if (proof === undefined) return null
  switch (proof.kind) {
    case 'receipt':
      return t('proof.receipt', { tool: proof.toolName })
    case 'countersign':
      return t('proof.countersign')
    case 'human':
      return t('proof.human')
  }
}

/**
 * The screen-reader form of the same fact, spelled out rather than compressed.
 * @param proof - the proof a proven contract carries, or undefined while none does.
 * @param t - the `done` namespace translate seat.
 * @returns the description, or null when there is no proof to describe.
 */
export function provenanceLabel(proof: DoneProof | undefined, t: Translate): string | null {
  if (proof === undefined) return null
  switch (proof.kind) {
    case 'receipt':
      return t('proof.aria.receipt', { tool: proof.toolName })
    case 'countersign':
      return t('proof.aria.countersign')
    case 'human':
      return t('proof.aria.human')
  }
}
