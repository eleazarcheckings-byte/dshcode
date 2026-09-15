/** Geometric role marks for the SaturnBot roster. */
import type { BotRole } from '@saturnai/dsh-saturnbot/client'
import css from './Dashboard.module.css'

/** Decorative geometry reinforces role identity without replacing its text name. */
export function Avatar({ role, large = false }: { role: BotRole; large?: boolean }) {
  return <span className={css.avatar} data-role={role} data-large={large || undefined} aria-hidden="true"><svg viewBox="0 0 48 48" fill="none">
    <path className={css.avatarShell} d="M24 3 42 13v22L24 45 6 35V13L24 3Z" />
    {role === 'orchestrator' && <><ellipse cx="24" cy="24" rx="15" ry="6" transform="rotate(-24 24 24)" /><circle cx="24" cy="24" r="8" /><path d="M21 18a7 7 0 0 1 6 1" /></>}
    {role === 'developer' && <><path d="m18 17-7 7 7 7M30 17l7 7-7 7M26 15l-4 18" /></>}
    {role === 'growth' && <><path d="M13 32 23 22l5 4 8-11M27 15h9v9" /><path d="M12 15h9M12 21h5" /></>}
    {role === 'operations' && <><path d="M15 14h18M15 24h18M15 34h18" /><circle cx="20" cy="14" r="3" /><circle cx="29" cy="24" r="3" /><circle cx="22" cy="34" r="3" /></>}
    {role === 'finance' && <><path d="M13 33V23h5v10M22 33V14h5v19M31 33V19h5v14M11 35h27" /></>}
  </svg></span>
}
