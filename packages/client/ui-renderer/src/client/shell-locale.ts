/**
 * Locale reader for the root shell chrome (title bar, document title, version
 * caption): these render above the renderer's own Slot registry, before any
 * `t` seat exists, so they resolve their own small dictionary straight from
 * the browser's declared languages rather than riding the injected seat.
 */
import { en, zh } from './locales.ts'

type ShellLocaleKey = keyof typeof en

/** Chinese wins when any declared browser language is Chinese; English otherwise. */
function shellLocale(): 'en' | 'zh' {
  if (typeof navigator === 'undefined') return 'en'
  const languages = (navigator as { readonly languages?: readonly string[] }).languages ?? [navigator.language]
  return languages.some(tag => tag.toLowerCase().startsWith('zh')) ? 'zh' : 'en'
}

/**
 * Resolve one shell-chrome string, filling any `{name}` placeholders.
 * @param key - a key shared by both shipped dictionaries.
 * @param params - values substituted for the template's placeholders.
 * @returns the resolved, interpolated string.
 */
export function shellText(key: ShellLocaleKey, params?: Record<string, string>): string {
  const dict = shellLocale() === 'zh' ? zh : en
  const template = dict[key]
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => params[name] ?? match)
}
