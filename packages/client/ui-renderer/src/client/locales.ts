/** Copy dictionaries for the renderer's root shell chrome (title bar, document title, version caption). */

/** English strings (the key-set source of truth for this pair). */
export const en = {
  menuLabel: '{product} menu',
  defaultTitle: 'Saturn AI',
  versionPrefix: 'V{version}',
} satisfies Record<string, string>

/** Simplified Chinese strings, checked complete against the English key set. */
export const zh: { [Key in keyof typeof en]: string } = {
  menuLabel: '{product} 菜单',
  defaultTitle: 'Saturn AI',
  versionPrefix: 'V{version}',
}
