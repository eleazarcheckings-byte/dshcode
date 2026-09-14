# @saturnai/dsh-client-ui-brand-saturn

Saturn AI brand occupants for the dsh Web client brand slots. A browser-only
Cordis client plugin occupying three UI slots:

- `sidebar.brand.mark` — the gold-ringed Saturn glyph, drawn inline in SVG with
  `currentColor` so it adapts to the active theme.
- `sidebar.brand.name` — the "Saturn AI" text wordmark (no artwork asset).
- `conversation.hero.brand.mark` — the same glyph as the conversation hero mark,
  replacing the declaring package's animated fallback.

## Use

Compose this package in a web profile and remove (or disable) the official
`ui-brand-official` row; slot occupation is the only composition path — there
is no brand configuration surface. The registration set is
declaration-aware (it waits for the sidebar slots before registering), so it
installs and retracts as one unit under HMR.

```yaml
- id: ui-brand-official
  disabled: true
- insert:
    - id: ui-brand-saturn
      name: '@saturnai/dsh-client-ui-brand-saturn'
```

## Layout

| File | Purpose |
|---|---|
| `lib/index.js` | Empty host-side loader seat (the plugin provides no node behavior). |
| `lib/client.js` | Browser half: slot registrations, wordmark stylesheet, glyph component. |

The glyph geometry is shared with the Saturn mark in the product asset set
(64-unit viewBox, planet r=15 at center, ring rx=27 ry=9.5 stroke 4.5 tilted
-18°, front arc redrawn over the bottom via clip).

## License

MIT. This package contains no DeepSeek names, marks, or artwork.
