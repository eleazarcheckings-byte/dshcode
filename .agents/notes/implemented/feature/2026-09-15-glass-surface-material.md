# Agent Note: Glass surface material in the shared theme

Status: implemented

English | [中文](2026-09-15-glass-surface-material.zh.md)

## Problem

The web client had no shared material for chrome that floats over content. A surface that wanted to read through to the page behind it — the dropdown card, the dialog, the definition-of-done record panel — would have had to choose its own fill alpha, its own blur, and its own light/dark branch, and a translucent fill shipped without a backdrop filter composites with unblurred content, which reads as a washed-out panel rather than a material. The theme's own surface tokens are opaque: `--dsw-specific-menu` is the layer-3 step at full alpha, so it cannot express a panel the reader sees through.

## Decision

`packages/client/ui-theme/src/styles/gradient-shadow-text.css` alone declares the glass material, beside the elevation tokens it composes:

- `--dsw-glass-surface` — the layer-3 surface at 0.72 alpha: `rgba(255, 255, 255, 0.72)` on `body` and `rgba(53, 54, 56, 0.72)` under `body[data-ds-dark-theme]`. Both themes carry one alpha, so a glass surface reads at the same weight either way, and the fill composites with the blurred content behind it instead of replacing it.
- `--dsw-glass-filter: blur(14px) saturate(140%)` — the blur and the saturation lift in one token, declared once for both themes.
- `--dsw-glass-elevation` — the elevation stroke plus two soft layers, re-declared on `body, body *` with the other elevation tokens so a surface's `--dsw-elevation-stroke-color` rebind reaches it.

A surface adopts the material by consuming the three tokens in one rule — never by declaring them, writing a literal color, or adding an engine-prefixed filter of its own:

```css
border: 0;
background: var(--dsw-glass-surface);
backdrop-filter: var(--dsw-glass-filter);
box-shadow: var(--dsw-glass-elevation);
```

`border: 0` follows from the [elevation decision](2026-09-01-web-elevation-stroke-shadows.md): the glass elevation begins with the 0.5px hairline stroke, so a border beside it draws the outline twice.

The tokens are theme-owned rather than per-component because the three declarations only mean anything together. A per-component fill would fork the material — no single home for the light/dark branch, no fallback a surface inherits, and no place to scan for a fill shipped without its blur — and the layer-3 step the fill is derived from is already declared in this sheet.

## Fallbacks

Both fallback paths live in the owning sheet, so no consuming surface carries one:

- `@media (prefers-reduced-transparency: reduce)` resolves the fill to the opaque layer-3 step (`--dsw-static-neutral-bluish-00` light, `--dsw-static-neutral-bluish-800` dark) and the filter to `none`.
- `@supports not (backdrop-filter: blur(1px))` resolves the fill opaque in both themes for the same reason: an unsupported filter leaves the translucent fill compositing with unblurred content.

Both leave `--dsw-glass-elevation` exactly as declared. A reader who asked for less transparency loses the translucency and its blur — the two things that request is about — and keeps the surface: the flat layer-3 fill, the hairline outline, and the soft layers that separate the panel from what it covers. Each block repeats the `body[data-ds-dark-theme]` selector because a bare `body` override loses to the dark fill, and both blocks sit after the theme fills in source order so the light override wins on source order.

## Adopted surfaces

- `packages/client/ui-primitives/src/Menu.module.css` — the dropdown card and its submenus (`.list`, `.submenu`): `border: 0` with radius 20px, the fill, the filter, the glass elevation, and the lightest stroke rebind (`--dsw-elevation-stroke-color: var(--dsw-alias-border-l1)`).
- `packages/client/ui-primitives/src/Modal.module.css` — the dialog: `border: 0` with radius 24px, the fill, the filter, and the glass elevation. The mask behind it keeps `--dsw-mask-blur`.
- `packages/client/ui-done/src/client/DefinitionOfDone.module.css` — the 380px record panel takes the full material with its own radius, the l1 stroke rebind, and the l2 scrollbar rebinds; the chip's own hover and open fill takes the fill and the filter with no elevation, because a seated chip does not float.

Two surfaces stay opaque on purpose. `packages/client/ui-primitives/src/HoverCard.module.css` `.card` fills from a component-local `#2C2C2E` in both themes and draws literal white text over it, so its contrast is defined against that fixed dark fill, which a theme-following translucent material would not preserve. `packages/client/ui-primitives/src/Toast.module.css` `.toast` is a deliberate inverted pair (`--dsw-alias-button-contrast-fill` under `--dsw-alias-label-primary-inverted`), and translucency would let the page behind the banner change the contrast the pair was chosen for. The [elevation decision](2026-09-01-web-elevation-stroke-shadows.md) keeps both surfaces out of its stroke conversion for the same reason.

## Testing

`packages/client/ui-theme/tests/glass-styles.client.spec.ts` asserts the sheet text on disk: the translucent fill in both themes at one alpha, the single filter token carrying both the blur and the saturate, `--dsw-glass-elevation` composed from the stroke per element, both fallback paths resolving the fill opaque and dropping the filter, and the cascade order those fallbacks need. It also scans every stylesheet under `packages/` and rejects a rule that references the glass fill without the filter, and it rejects a second declaration of any glass token outside the owning sheet. The elevation spec counts `--dsw-glass-elevation` as an elevation shadow, so a neutral `--dsw-alias-border-*` border beside it fails there.

## Alternatives considered

**A per-component translucent fill.** Each surface would write its own `rgba()` and blur. It lost because the material is three declarations that only hold together: the light/dark branch, the alpha, and the fallback would each be written per component, drift apart at the first change, and no gate could see a fill that shipped without its blur. The fill is derived from a layer step this sheet owns, so this is where the alpha belongs.

**Make `--dsw-specific-menu` translucent globally.** That alias is the opaque layer-3 step read as a background by ten stylesheets outside the theme package. It lost on both counts: it would have moved all of them onto glass at once, including surfaces that never float over content, and the fallback paths would have had no opaque step left to resolve to.

**A fixed light-only material.** One `rgba(255, 255, 255, 0.72)` fill with no dark branch. It lost because the material is theme values: a near-white panel over the dark theme's surfaces ignores the theme, and this sheet already branches the rest of its layer tokens by `body[data-ds-dark-theme]` ([Web styling](../../../../docs/web-styling.md#glass-surfaces)).

## Consequences

Three surfaces now share one material, and the alpha, the blur, and both fallback targets change in one place. The package reference and the styling rules describe it for consumers ([ui-theme README](../../../../packages/client/ui-theme/README.md), [Web styling](../../../../docs/web-styling.md#glass-surfaces)); the [styling system decision](../process/2026-07-19-web-styling-system.md) owns the framework the tokens are declared in.

Adopting the material is opt-in per surface, and the fallbacks come with it: a consumer writes four declarations and cannot opt out of reduced transparency, which is the property the fallback exists to guarantee. The glass elevation is counted by the elevation spec, so a glass surface may not pair a neutral border with it, and the stroke color stays rebindable per surface.
