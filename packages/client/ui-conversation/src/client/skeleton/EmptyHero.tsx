// The composer remains in ConversationRoot so switching out of the blank-draft
// phase does not remount its textarea.

import { type ReactNode, type RefObject } from 'react'
import {
  SaturnLogo, IconChevronDownOutline14, IconFolderClose16, IconFolderOpen16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { workspaceTitleOf } from '@deepseek-ai/dsh-util-workspace-path'
import type { ConversationSlotProps } from '../contract/slots.ts'
import css from './HeroShell.module.css'

/** The owner's locale seat type, passed to hero chrome as a plain prop. */
type HeroTranslate = ConversationSlotProps['t']

/**
 * Basename label for the workspace chip (the shared derivation);
 * separator-only paths echo the raw cwd.
 * @param cwd - workspace directory path (non-empty).
 * @returns chip label.
 */
export function workspaceLabel(cwd: string): string {
  const base = workspaceTitleOf(cwd)
  return base !== '' ? base : cwd
}

/**
 * The workspace chip (folder + label + chevron), always interactive: before
 * the first message the workspace stays switchable — picking another one
 * moves the New Session flow to that workspace's blank session. Without a
 * label the chip renders its placeholder state: closed folder + the
 * "Choose workspace" call to action.
 * @param props.label - chip label (see {@link workspaceLabel}); omitted → placeholder.
 * @param props.menuOpen - menu expansion echo.
 * @param props.onClick - menu toggle.
 * @returns the chip button element.
 */
export function WorkspaceChip({ buttonRef, label, menuOpen = false, onClick, t }: {
  buttonRef?: RefObject<HTMLButtonElement>
  label?: string | undefined
  menuOpen?: boolean
  onClick?: () => void
  t: HeroTranslate
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      className={css.workspace}
      aria-label={t('hero.chooseWorkspace')}
      aria-haspopup="menu"
      aria-expanded={menuOpen}
      onClick={onClick}
    >
      {label === undefined
        ? <IconFolderClose16 className={css.folder} size={16} />
        : <IconFolderOpen16 className={css.folder} size={16} />}
      <span className={css.workspaceLabel}>{label ?? t('hero.chooseWorkspace')}</span>
      <IconChevronDownOutline14 className={css.chevron} size={12} />
    </button>
  )
}

/** Hero chrome props. The workspace row rides the InputBar accessory hole, not here. */
export interface HeroShellProps {
  /** The owner's locale seat, passed down as a plain prop. */
  t: HeroTranslate
  /** Authorized renderer for the hero brand-mark slot. */
  renderSlot: ConversationSlotProps['renderSlot']
  /**
   * The First Light profile, when setup collected one. Absent — or nameless —
   * keeps the generic headline: a name the app does not actually hold is never
   * guessed at.
   */
  profile?: { readonly name: string; readonly building: string } | undefined
  /** Overlay content after the stack (modals). */
  children?: ReactNode
}

/**
 * Reserve the global canvas planet's layout area and render the welcome headline.
 * @param props - see {@link HeroShellProps}.
 * @returns the centered hero element tree.
 */
export function HeroShell({ t, renderSlot, profile, children }: HeroShellProps) {
  return (
    <div className={css.root}>
      <div className={css.stack}>
        <div className={css.planetAnchor} data-saturn-anchor="" aria-hidden="true" />
        <div className={css.eyebrow}>
          <span className={css.brandMark} aria-hidden="true">
            {renderSlot('conversation.hero.brand.mark', { size: 34, className: css.fish }, {
              fallback: <SaturnLogo size={34} className={css.fish} />,
            })}
          </span>
          <span className={css.previewBadge}>{t('hero.preview')}</span>
          <span className={css.eyebrowRule} aria-hidden="true" />
          <span>{t('hero.workspace')}</span>
        </div>
        <h1 className={css.headline}>
          {profile !== undefined && profile.name.trim() !== ''
            ? t('hero.headlineFor', { name: profile.name, building: profile.building })
            : t('hero.headline')}
        </h1>
        <p className={css.description}>{t('hero.description')}</p>
      </div>
      {children}
    </div>
  )
}

/**
 * Render draft starters beneath the resident composer. Selecting one never submits a turn.
 * @param props - Localized copy, draft availability, and the owner's guarded draft write.
 * @returns A compact row of keyboard-accessible starter actions.
 */
export function HeroStarters({ t, hidden, onChoose }: {
  t: HeroTranslate
  hidden: boolean
  onChoose: (text: string) => void
}) {
  const starters = ['build', 'explore', 'review'] as const
  return (
    <div className={css.starters} data-hidden={hidden || undefined} aria-hidden={hidden || undefined}>
      {starters.map((starter, index) => (
        <button
          key={starter}
          type="button"
          className={css.starter}
          disabled={hidden}
          onClick={() => { onChoose(t(`hero.starter.${starter}.prompt`)) }}
        >
          <span className={css.starterNumber} aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
          <span className={css.starterCopy}>
            <span className={css.starterTitle}>{t(`hero.starter.${starter}.title`)}</span>
            <span className={css.starterDetail}>{t(`hero.starter.${starter}.detail`)}</span>
          </span>
          <svg className={css.starterArrow} viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
            <path d="M4 12 12 4M4.5 4H12v7.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      ))}
    </div>
  )
}
