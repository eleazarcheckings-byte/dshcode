import { SaturnLogo } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { en } from './locales.ts'

/**
 * Render the official mark with the presentation requested by its host surface.
 * @param props - Host-supplied mark presentation.
 * @returns the official Saturn mark.
 */
export function OfficialBrandMark({ size }: SidebarBrandMarkOwnerProps) {
  return <SaturnLogo size={size} />
}

/**
 * Render the official name as plain text without its independently slotted mark.
 * @returns the official name span.
 */
export function OfficialBrandName() {
  return <span>{en.name}</span>
}
