/** A plain accounting of what stands between the current configuration and a first run. */
import type { SaturnBotSnapshot } from './contracts.ts'
import type { BotTranslate } from './ui.tsx'
import css from './Dashboard.module.css'

/** One concrete, actionable gap; `step` names the wizard step that resolves it. */
export interface SaturnBotSetupGap {
  readonly key: string
  readonly label: string
  readonly step: 'goal' | 'workspace' | 'model' | 'connections'
}

/**
 * Read the exact facts the runtime already published — required fields left
 * blank, and (when the runtime reports it) credentials it could not resolve —
 * never a guess about health or reachability.
 * @param snapshot - the current dashboard projection.
 * @param t - bound translator for this package's dictionary.
 * @returns ordered gaps; empty means the bot can run now.
 */
export function computeSetupGaps(snapshot: SaturnBotSnapshot, t: BotTranslate): SaturnBotSetupGap[] {
  const gaps: SaturnBotSetupGap[] = []
  if (snapshot.config.workspace.trim() === '') gaps.push({ key: 'workspace', label: t('wizard.gap.workspace'), step: 'workspace' })
  if (snapshot.config.goal.trim() === '') gaps.push({ key: 'goal', label: t('wizard.gap.goal'), step: 'goal' })
  if (snapshot.config.provider.trim() === '' || snapshot.config.model.trim() === '') gaps.push({ key: 'model', label: t('wizard.gap.model'), step: 'model' })
  for (const credential of snapshot.firstRun.credentials) {
    if (!credential.present) gaps.push({ key: `credential:${credential.env}`, label: t('wizard.gap.credential', { name: credential.name, env: credential.env }), step: 'connections' })
  }
  return gaps
}

/** States what is missing before SaturnBot can run, or states plainly that it can. */
export function StatusStrip({ snapshot, t, onFix }: { snapshot: SaturnBotSnapshot; t: BotTranslate; onFix?: (step: SaturnBotSetupGap['step']) => void }) {
  const gaps = computeSetupGaps(snapshot, t)
  if (gaps.length === 0) return <div className={css.statusStrip} data-state="ready" role="status"><span className={css.eyebrow}>{t('wizard.readyHeading')}</span><p className={css.muted}>{t('wizard.ready')}</p></div>
  return <div className={css.statusStrip} data-state="missing" role="status">
    <span className={css.eyebrow}>{t('wizard.missingHeading')}</span>
    <ul className={css.statusGapList}>{gaps.map(gap => <li key={gap.key}>
      {onFix ? <button type="button" className={css.linkButton} onClick={() => { onFix(gap.step) }}>{gap.label}</button> : <span>{gap.label}</span>}
    </li>)}</ul>
  </div>
}
