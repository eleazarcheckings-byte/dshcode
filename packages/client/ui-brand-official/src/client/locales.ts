/** Copy dictionary for the official brand mark's name text. */

/** English strings (the key-set source of truth for this pair). Product name stays "Saturn AI" in both languages. */
export const en = {
  name: 'Saturn AI',
} satisfies Record<string, string>

/** Simplified Chinese strings, checked complete against the English key set. */
export const zh: { [Key in keyof typeof en]: string } = {
  name: 'Saturn AI',
}
