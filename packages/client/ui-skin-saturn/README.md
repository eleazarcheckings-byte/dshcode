---
description: "Saturn Premium dark skin: palette tokens, the self-hosted Instrument Sans + Commit Mono type system, and the -18deg favicon ring."
kind: "package-reference"
---

# @saturnai/dsh-client-ui-skin-saturn

English | [中文](README.zh.md)

Saturn Premium is the dark application skin: neutral black surfaces, white text, fine gray borders, and white accents for brand, focus, and primary actions. The complete static token scales remain ordered from light to dark so upstream semantic aliases keep their meaning. Status colors retain their own aliases.

## Use

Mount as a `dsh.client` row in a web profile. The effect holds the upstream dark-theme attribute and browser color scheme while the skin is mounted, applies the Saturn body attribute and favicon, and restores those values when disposed. The scoped stylesheet remains inert without the Saturn attribute.

```yaml
- insert:
    - id: ui-skin-saturn
      name: '@saturnai/dsh-client-ui-skin-saturn'
```

`skin.json` identifies `saturn-premium`. The skin ships as a workspace package and is not staged into the skin-center picker.

## Application tokens

The body scope publishes `--saturn-void`, `--saturn-surface`, `--saturn-surface-raised`, `--saturn-surface-hover`, `--saturn-stroke`, `--saturn-stroke-strong`, `--saturn-ink`, `--saturn-muted`, `--saturn-accent`, `--saturn-accent-dim`, and `--saturn-accent-secondary`. Motion uses `--saturn-ease` and `--saturn-duration`. Components consume these with upstream alias fallbacks. The skin owns no canvas or animation clock; components own their visual state, visibility checks, and cleanup. The reduced-motion media rule suppresses CSS transitions and repeating animations.

## Type system

The skin self-hosts one variable display/body family and one mono family, and re-points the two upstream font variables so every existing component inherits them without an edit:

- **Instrument Sans** (variable; `wght` 400-700, `wdth` 75-100; OFL) carries both UI and display roles. `--saturn-font-display` and `--saturn-font-body` both resolve to it; the display role also pins `--saturn-font-display-variation: 'wdth' 100` (the wide/default end of the axis, made explicit rather than relied on as an inherited default) for a consumer to combine with its own tight tracking.
- **Commit Mono** (two static weights, 400/700; OFL — see Licensing below) is `--saturn-font-mono`, for spec plates and receipts.
- Both families ship as self-hosted `woff2` under `apps/web/public/fonts/`, `font-display: swap`, preloaded from `apps/web/index.html`. Each also declares a metrics-matched local fallback face (`size-adjust` plus the three `*-override` descriptors, computed from each font's own `OS/2`/`head` tables against its system fallback with `fontTools`, not guessed) so the swap never visibly reflows layout.
- `--dsw-font-family` and `--ds-font-family-code` — the two variables nearly every existing component already reads for body and mono text — are re-pointed to `--saturn-font-body` / `--saturn-font-mono` at this file's own doubled `body[data-dsh-saturn][data-dsh-saturn]` specificity, so the whole app picks up the Saturn faces with no consumer edit.

### Licensing (verified against the official sources, not assumed)

Both families are **OFL**, not the MIT the original brief assumed for Commit Mono: `eigilnikolajsen/commit-mono`'s root `LICENSE` (MIT) covers its specimen site and build tooling, but the font binaries themselves ship their own `LICENSE-FONT` — the SIL Open Font License, identical to the `license.txt` bundled inside the release zip beside the `.otf` files. `apps/web/public/fonts/` therefore carries `LICENSE-OFL.txt` (Instrument Sans) and `LICENSE-OFL-COMMITMONO.txt` (Commit Mono) rather than a `LICENSE-MIT.txt` that would misrepresent the redistributed bytes' actual terms — see the Agent Note for the fetch/verification trail.

Commit Mono's official repository ships no `woff2`, only `.otf`/`.ttf`; the two weights here were compiled with `fontTools` from the upstream `v1.143` release without altering any outline or metric.

## Model Experience

None, as this package only changes browser presentation.

#### KV Cache effect

None. The skin does not construct model requests.

## Known Limitations and Deferred Work

- **Light appearance is not supported.** The skin enforces dark appearance while mounted; light appearance would require a complete alternate palette and theme policy.
- **This package's own code is MIT** (see `package.json`); the fonts it self-hosts are not — both Instrument Sans and Commit Mono are OFL (see Licensing above).

**Runtime invariant:** No companion is published. Token polarity and contrast are verified by the package's palette tests, and the skin owns no independent runtime data views.
