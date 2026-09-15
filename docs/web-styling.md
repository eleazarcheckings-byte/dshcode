# Web UI style reference

English | [中文](web-styling.zh.md)

This reference defines styling ownership and component rules for browser client packages. The current token values live in [`packages/client/ui-theme/src/styles/`](../packages/client/ui-theme/src/styles/); this document does not duplicate that generated-by-source inventory.

## Ownership

[`ui-theme`](../packages/client/ui-theme/README.md) owns the `--dsw-*` static scale, semantic aliases, typography, motion, gradients, shadows, scrollbar styles, and light/dark preference. [`ui-layout`](../packages/client/ui-layout/README.md) applies the resolved theme snapshot to the document. Feature packages consume semantic aliases and do not define another global theme.

Global style sheets belong in `ui-theme/src/styles/`. Component styles live beside their component as CSS Modules. A component may define a local custom property when its value is part of that component's layout or presentation contract; shared colors, typography, elevation, and motion belong to the theme package.

## Component rules

- Use CSS Modules and `clsx`; do not add a component library or Tailwind.
- Use `--dsw-alias-*` semantic tokens in feature components. Do not copy static palette values or write literal colors there.
- Keep theme selectors out of feature component CSS. Light/dark overrides belong to the theme owner.
- Pair font sizes with line heights and use the theme typography variables when an existing role matches.
- Keep source text, terminal output, and diff lines unwrapped when their component contract requires column preservation; use the shared scrollbar styles rather than component-specific scrollbar selectors.
- Put presentation in CSS. Inline React styles may pass component-local custom-property values but must not encode theme branches.
- Preserve keyboard focus visibility and reduced-motion behavior when adding transitions or hover-only controls.
- Rounded corners inherit the global superellipse smoothing from ui-theme's `corner-shape.css` on supporting engines. Pair `corner-shape: round` with every full-round `border-radius` (`50%`, `100%`, or a pill radius) so circles and capsules keep circular arcs; the ui-theme corner-shape spec enforces the pairing.
- Elevated surfaces (menus, popovers, modals, panels, floating buttons, the composer) set `border: 0` and take `box-shadow: var(--dsw-elevation-panel)`, `var(--dsw-elevation-prominent)`, or the composer's `var(--dsw-elevation-soft)` (larger blur at lower alpha): the 0.5px hairline stroke is the first shadow layer, and `--dsw-elevation-stroke-color` rebinds or suppresses it per surface or state. Never pair a `--dsw-alias-border-*` border with an lv/elevation shadow — the ui-theme elevation spec rejects the pairing; state-colored borders (warn panels) stay real borders.
- Flat borders and separators that use a neutral `--dsw-alias-border-*` token draw at `0.5px` — buttons, inputs, cards, row dividers, and separators drawn as filled boxes (menu separators, the conversation header seam, markdown `hr`, vertical rails) share the hairline weight, which Chromium paints as one device pixel. Dashed affordances and state-colored borders keep 1px; spinner ring tracks keep their width through the spec's explicit allowlist. The ui-theme elevation spec rejects wider neutral solid borders.

## Glass surfaces

Glass is the app's layered material for chrome that floats over content: a restrained translucent fill, a backdrop blur, and the same 0.5px elevation stroke. It is never a translucent fill applied for its own sake — a surface that does not float keeps its flat fill.

The three tokens live in [`ui-theme`'s `gradient-shadow-text.css`](../packages/client/ui-theme/src/styles/gradient-shadow-text.css) and nowhere else: `--dsw-glass-surface` (the theme's layer-3 surface at 0.72 alpha, branched light/dark by the sheet that also branches the linear gradients), `--dsw-glass-filter` (`blur(14px) saturate(140%)`), and `--dsw-glass-elevation` (the elevation stroke plus two soft layers). A surface adopts the material by consuming those tokens — never by declaring them, writing a literal color, or adding an engine-prefixed filter of its own:

```css
border: 0;
background: var(--dsw-glass-surface);
backdrop-filter: var(--dsw-glass-filter);
box-shadow: var(--dsw-glass-elevation);
```

`border: 0` follows from the elevation rule above: the glass elevation begins with the hairline stroke, so a border beside it would double-draw the outline. The ui-theme elevation spec counts `--dsw-glass-elevation` as an elevation shadow and rejects a neutral `--dsw-alias-border-*` border paired with it; the ui-theme glass spec rejects a glass fill that ships without `--dsw-glass-filter` beside it, because an unfiltered translucent fill composites with unblurred content.

A surface nested inside a glass panel that must mask content scrolling beneath it — a sticky group label, a pinned row — takes the opaque layer-3 step (`--dsw-alias-bg-layer-3`) instead of a second blur: stacking two translucent layers compounds both the cost and the smear, and the opaque step is the colour the glass fill and its reduced-transparency fallback are built from, so the nested surface reads as the same material.

Reduced transparency is resolved inside ui-theme, so consuming surfaces carry no fallback of their own: `@media (prefers-reduced-transparency: reduce)` resolves the fill to its opaque layer-3 step and the filter to `none`, and `@supports not (backdrop-filter: blur(1px))` resolves the fill the same way because an unsupported filter leaves the translucent fill compositing with unblurred content. Both keep `--dsw-glass-elevation` untouched, so the reader who asked for less transparency loses the translucency and the blur, never the surface. A surface whose own stylesheet must survive an engine without custom properties may still name an opaque `var()` fallback such as `var(--dsw-glass-surface, var(--dsw-specific-menu))`.

## Changing the system

Add or change a shared token in the owning `ui-theme` sheet, then consume its semantic alias from feature packages. Update the owning package reference when a public styling contract changes. Visual behavior follows the [testing policy](testing.md); the [styling-system Agent Note](../.agents/notes/implemented/process/2026-07-19-web-styling-system.md) records framework rationale.
