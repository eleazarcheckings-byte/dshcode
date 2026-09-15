---
description: "Saturn AI brand occupants for the dsh Web client brand slots: the sidebar mark and wordmark, drawn with no DeepSeek names, marks, or artwork."
kind: "package-reference"
---

# @saturnai/dsh-client-ui-brand-saturn

English | [中文](README.zh.md)

## Summary

Saturn AI brand occupants for the dsh Web client brand slots. A browser-only Cordis client plugin occupying two UI slots: `sidebar.brand.mark` (the monochrome Saturn glyph, drawn inline in SVG with `currentColor` and the skin's `--saturn-accent` token) and `sidebar.brand.name` (the "Saturn AI" text wordmark, no artwork asset). The conversation hero retains its declaring package's animated mark; the wordmark uses the same accent, with the semantic label color as its fallback.

## Table of Contents

- [Use](#use)
- [Layout](#layout)
- [License](#license)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use"></a>
## Use

Compose this package in a web profile and remove (or disable) the official `ui-brand-official` row; slot occupation is the only composition path — there is no brand configuration surface. The registration set is declaration-aware (it waits for the sidebar slots before registering), so it installs and retracts as one unit under HMR.

```yaml
- id: ui-brand-official
  disabled: true
- insert:
    - id: ui-brand-saturn
      name: '@saturnai/dsh-client-ui-brand-saturn'
```

-----

<a id="layout"></a>
## Layout

| File | Purpose |
|---|---|
| `lib/index.js` | Empty host-side loader seat (the plugin provides no node behavior). |
| `lib/client.js` | Browser half: slot registrations, wordmark stylesheet, glyph component. |

The glyph geometry is shared with the Saturn mark in the product asset set (64-unit viewBox, planet r=15 at center, ring rx=27 ry=9.5 stroke 4.5 tilted -18°, front arc redrawn over the bottom via clip).

-----

<a id="license"></a>
## License

MIT. This package contains no DeepSeek names, marks, or artwork.

-----

<a id="model-experience"></a>
## Model Experience

### Sidebar brand presentation

#### What the model sees

Nothing. The plugin registers `SaturnGlyph` and `SaturnName` as pure presentation components against the `sidebar.brand.mark` and `sidebar.brand.name` slots; neither slot, nor any prop it renders, reaches a model prompt, tool schema, or tool result.

#### Token effect

None. The registration set contributes zero prompt tokens; it is a browser-rendered occupant of a UI slot, not a context source.

#### KV Cache effect

None. Slot occupancy never changes between sessions or turns in a way that alters the assembled request, so it cannot invalidate a cache prefix.

## Known Limitations and Deferred Work

- No brand configuration surface exists; swapping the mark or wordmark requires composing a different brand package, not a settings change.
- The conversation hero mark is deliberately left unoccupied (see [Use](#use)); a composition expecting this package to also brand the hero must add that slot itself.
- Slot occupation assumes the declaring packages (`ui-sidebar`, `ui-renderer`, `ui-conversation`) are composed first; this package does not declare the slots it fills.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
