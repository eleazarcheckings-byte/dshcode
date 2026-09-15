# @saturnai/dsh-client-ui-skin-saturn

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

## Model Experience

None. This package only changes browser presentation.

#### KV Cache effect

None. The skin does not construct model requests.

## Known Limitations and Deferred Work

The skin enforces dark appearance while mounted. Light appearance requires a complete alternate palette and theme policy.

**Runtime invariant:** No companion is published. Token polarity and contrast are verified by the package's palette tests, and the skin owns no independent runtime data views.

## License

MIT.
