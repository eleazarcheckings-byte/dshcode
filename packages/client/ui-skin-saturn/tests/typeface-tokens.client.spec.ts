// @vitest-environment jsdom
/**
 * Saturn type system (SPEC §2 / §3 C3): the skin self-hosts Instrument Sans
 * (variable, `wght` 400-700 / `wdth` 75-100) and Commit Mono, exposes them as
 * `--saturn-font-display` / `--saturn-font-body` / `--saturn-font-mono`, and
 * re-points the two upstream font variables every existing component already
 * reads (`--dsw-font-family`, `--ds-font-family-code`) so the whole app picks
 * up the Saturn faces without any consumer edit. These tests pin the exact
 * injected declarations rather than merely "a font-face exists somewhere",
 * because a silently wrong url/weight/stretch range is worse than none: it
 * ships a broken swap that never resolves to the intended face.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'

const PLUGIN = '@saturnai/dsh-client-ui-skin-saturn'

/** The single injected stylesheet's raw text (see index.ts's SKIN_TAG_ID guard). */
function skinCss(): string {
  const tag = document.querySelector(`style[data-plugin="${PLUGIN}"]`)
  expect(tag, 'the skin must inject its stylesheet on import').not.toBeNull()
  return (tag as HTMLStyleElement).textContent!
}

describe('Saturn type system', () => {
  beforeAll(async () => {
    await import('../src/client/index.ts')
  })

  it('declares the Instrument Sans variable face self-hosted from /fonts, both axes, swap', () => {
    const css = skinCss()
    expect(css).toContain("@font-face{font-family:'Instrument Sans';src:url(/fonts/InstrumentSans-Variable.woff2) format('woff2');font-weight:400 700;font-stretch:75% 100%;font-style:normal;font-display:swap}")
  })

  it('declares both Commit Mono static weights self-hosted from /fonts, swap', () => {
    const css = skinCss()
    expect(css).toContain("@font-face{font-family:'Commit Mono';src:url(/fonts/CommitMono-400-Regular.woff2) format('woff2');font-weight:400;font-style:normal;font-display:swap}")
    expect(css).toContain("@font-face{font-family:'Commit Mono';src:url(/fonts/CommitMono-700-Regular.woff2) format('woff2');font-weight:700;font-style:normal;font-display:swap}")
  })

  it('declares a metrics-matched local fallback face for each family (size-adjust + the three overrides)', () => {
    const css = skinCss()
    const instrumentFallback = "@font-face\\{font-family:'Instrument Sans Fallback';src:local\\('Arial'\\)"
      + '[^}]*ascent-override:97%;descent-override:25%;line-gap-override:0%;size-adjust:98\\.35%\\}'
    const commitMonoFallback = "@font-face\\{font-family:'Commit Mono Fallback';src:local\\('Consolas'\\)"
      + '[^}]*ascent-override:90%;descent-override:20%;line-gap-override:0%;size-adjust:110\\.15%\\}'
    expect(css).toMatch(new RegExp(instrumentFallback))
    expect(css).toMatch(new RegExp(commitMonoFallback))
  })

  it('exposes the three Saturn font tokens and the explicit wdth display move under the palette scope', () => {
    const css = skinCss()
    const tokens = 'body\\[data-dsh-saturn\\]\\[data-dsh-saturn\\]\\{[^}]*'
      + "--saturn-font-display:'Instrument Sans','Instrument Sans Fallback',[^;]+;"
      + "--saturn-font-body:'Instrument Sans','Instrument Sans Fallback',[^;]+;"
      + "--saturn-font-mono:'Commit Mono','Commit Mono Fallback',[^;]+;"
      + "--saturn-font-display-variation:'wdth' 100\\}"
    expect(css).toMatch(new RegExp(tokens))
  })

  it('re-points the two upstream font variables so every existing component inherits the Saturn faces', () => {
    const css = skinCss()
    const override = 'body\\[data-dsh-saturn\\]\\[data-dsh-saturn\\]\\{'
      + '--dsw-font-family:var\\(--saturn-font-body\\);--ds-font-family-code:var\\(--saturn-font-mono\\)\\}'
    expect(css).toMatch(new RegExp(override))
  })

  it('never references a network font host: every src is a same-origin /fonts path or a local() fallback', () => {
    const css = skinCss()
    for (const match of css.matchAll(/@font-face\{[^}]*\}/g)) {
      expect(match[0]).not.toMatch(/https?:\/\//)
      expect(match[0]).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/)
    }
  })

  it('keeps the favicon ring at the one shared -18deg tilt (SPEC §2/§3 C3, mark + ambient canvas + favicon)', async () => {
    const { apply } = await import('../src/client/index.ts')
    const ctx = new Context()
    apply(ctx)
    const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    expect(favicon, 'apply() must append the favicon link').not.toBeNull()
    const svg = decodeURIComponent(favicon!.href.replace('data:image/svg+xml,', ''))
    expect(svg.match(/rotate\(-18 /g)?.length).toBe(2)
  })
})
