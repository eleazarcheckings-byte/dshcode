# @saturnai/dsh-client-ui-skin-saturn

Saturn Premium skin for the dsh web GUI: a Grok-grade premium palette —
near-black monochrome surfaces with hairline strokes in dark mode and a quiet
paper-white light mode, a restrained steel-blue action color, and Saturn gold
reserved for brand accents and selection. The skin remaps the complete
`--dsw-static-*` token set (73 tokens, both themes) under
`body[data-dsh-saturn]`, plus a gold Saturn favicon.

## Use

Mount as a `dsh.client` row in a web profile; the skin applies its body
attribute and stylesheet at load and retracts both through its effect
disposer. It is a palette skin (no backdrop art), so it composes with the
stock light/dark/system appearance preference.

```yaml
- insert:
    - id: ui-skin-saturn
      name: '@saturnai/dsh-client-ui-skin-saturn'
```

`skin.json` is the skin-center manifest (`id: saturn-premium`, accent
`#dda43a`). The skin ships as a workspace package; it is not staged into the
skin-center extras tree, so it does not appear in the skin-center picker.

## Layout

| File | Purpose |
|---|---|
| `lib/index.js` | Empty host-side loader seat. |
| `lib/client.js` | Browser half: token remap stylesheet, favicon, apply/dispose effect. |
| `skin.json` | Skin manifest consumed by the skin center. |

## License

MIT.
