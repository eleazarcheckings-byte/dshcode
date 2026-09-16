/** Copy dictionary for the Saturn wordmark's two text spans. */

/** English strings (the key-set source of truth for this pair). Wordmark stays "Saturn" / "AI" in both languages. */
export const en = {
  name: 'Saturn',
  ai: 'AI',
} satisfies Record<string, string>

/** Simplified Chinese strings, checked complete against the English key set. */
export const zh: { [Key in keyof typeof en]: string } = {
  name: 'Saturn',
  ai: 'AI',
}
