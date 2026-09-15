/**
 * Deterministic slop-tell and hygiene probe for a rendered page.
 *
 * Ports selected static-analysis probes from the SaturnAI design-brain
 * evidence collector — `collect-evidence.js` (v2), by Saturn AI,
 * `G:/My Drive/Projects/mac/active/izzy-design/collect-evidence.js`
 * (read for reference only; not modified, per SPEC §3 C9). That script runs
 * inside a live browser page (`getComputedStyle` plus a canvas 2D context
 * for exact color normalization) and is the model this script follows: the
 * same *honest instrument* posture — report only what the probe can
 * actually see, mark the rest unverified, never invent a clean result — and
 * several probes ported near-verbatim: gradient/hue tell detection, the
 * uniform-card (identical radius+shadow siblings) census, the blanket
 * fade-up census (a scroll-reveal class with no `animation-timeline` is the
 * tell; the same class driven by a CSS scroll-driven timeline is technique,
 * not a tell), contrast-pair sampling, and the priced-in decoration list
 * (particle canvases, gradient text, grain overlays, dead CTAs).
 *
 * Unlike `collect-evidence.js`, this script targets a *saved HTML file*
 * rather than a live browser tab, so it resolves computed style with
 * `jsdom` instead of a real browser + canvas. That substitution costs two
 * things the rubric below reports honestly rather than guessing around:
 *  - No layout engine: `getBoundingClientRect`/`offsetWidth` are always
 *    zero, so real element geometry (rendered character measure, tap-target
 *    size) cannot be measured here — see `scripts/review-web.mjs` in this
 *    package, which captures real screenshots but explicitly does not
 *    grade them, and the fresh-context reviewer subagent's screenshot pass
 *    (policy.ts) for that half of the verification.
 *  - No canvas 2D context: jsdom's CSSOM already normalizes named/hex
 *    colors to `rgb()`/`rgba()`, which covers every check below, but it
 *    does not resolve `oklch()`/`lab()` — such declarations are reported as
 *    unresolved, never guessed.
 * JS-driven motion (anything not expressed as a CSS `animation`/
 * `animation-timeline`) is likewise invisible to a static probe and is
 * never inferred.
 *
 * Output matches `../rubric.schema.json`: one item per pre-ship checklist
 * entry in `scripts/harness/SATURN-DESIGN-RULES.md`, in that document's
 * order. Four items (Brand test, One named mechanism, Deviation log,
 * Writer ≠ reviewer) are process/judgment facts a page's markup cannot
 * settle — they are always reported `UNVERIFIED` with `score: null`, never
 * scored by guesswork. The other eight are graded from what this probe can
 * actually measure.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const HELP = `Usage: node review-grade.mjs --html ./page.html --out ./artifacts [--source label]
Grades a saved, already-rendered HTML file against the Saturn AI premium-output
rubric (see ../rubric.schema.json) using a static DOM (jsdom), never a live
browser. Writes rubric.json (machine-readable) and rubric.md (human summary)
into a new directory under --out.
--source overrides the "source" field in rubric.json (default: --html path).
Exit codes: 0 overall PASS; 1 overall REVISE or REJECT; 2 invalid arguments,
unreadable input, or jsdom unavailable (never a guessed clean result).`

const CRITERIA_ORDER = /** @type {const} */ ([
  'Brand test',
  'One named mechanism',
  'ai-slop scan',
  'homogenized-premium scan',
  'Motion budget respected',
  'Ambient canvas quality bar',
  'Contrast measured',
  'Spacing, type roles, and real imagery',
  'One primary CTA per section; real routes',
  'Reduced-motion state designed',
  'Deviation log',
  'Writer \u2260 reviewer',
])

/** Judgment/process checklist items no static page probe can settle. */
const UNVERIFIABLE_CRITERIA = new Set([
  'Brand test',
  'One named mechanism',
  'Deviation log',
  'Writer \u2260 reviewer',
])

const SCORE_BY_VERDICT = { PASS: 5, REVISE: 3, REJECT: 1 }

/** Thrown when jsdom (or the supplied HTML) cannot be loaded; the caller reports this as an unavailable review, never a passing one. */
export class GradeUnavailableError extends Error {}

/** Parse a loopback-free CLI argument list without touching the filesystem.
 * @param {string[]} argv CLI arguments without the Node executable and script.
 * @returns {{help: boolean, html?: string, out?: string, source?: string}} Parsed options.
 */
export function parseArgs(argv) {
  if (argv.length > 8 || argv.some(value => value.length > 4096 || value.includes('\0'))) throw new Error('Arguments exceed supported limits.')
  const values = new Map()
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index]
    if (!['--help', '--html', '--out', '--source'].includes(flag)) throw new Error(`Unknown argument: ${flag.slice(0, 60)}`)
    if (values.has(flag)) throw new Error(`Repeated argument: ${flag}`)
    if (flag === '--help') { values.set(flag, true); continue }
    const value = argv[++index]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`)
    values.set(flag, value)
  }
  if (values.has('--help')) return { help: true }
  const html = values.get('--html')
  if (!html) throw new Error('--html is required.')
  if (!values.get('--out')) throw new Error('--out is required.')
  return { help: false, html: resolve(html), out: resolve(values.get('--out')), source: values.get('--source') }
}

/* ------------------------------------------------------------------ */
/* Color + contrast helpers. jsdom's CSSOM already normalizes named and
 * hex colors to rgb()/rgba(); we only need to parse that serialized form. */

/** @param {string} value @returns {{r:number,g:number,b:number,a:number}|null} */
function parseRgb(value) {
  const s = String(value || '').trim()
  if (!s || s === 'transparent' || s === 'none') return s === 'transparent' ? { r: 0, g: 0, b: 0, a: 0 } : null
  const m = s.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)/i)
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : parseFloat(m[4]) }
  const hex = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i)
  if (hex) {
    let h = hex[1]
    if (h.length === 3) h = h.split('').map(c => c + c).join('')
    const n = parseInt(h.slice(0, 6), 16)
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a }
  }
  return null
}

/** @param {{r:number,g:number,b:number}} rgb @returns {string} */
function rgbHex({ r, g, b }) {
  return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')
}

/** @param {{r:number,g:number,b:number}} rgb @returns {[number, number, number]} hue 0-360, saturation/lightness 0-100 */
function rgbToHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  let h = 0; const l = (max + min) / 2
  let s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break
      case g: h = (b - r) / d + 2; break
      default: h = (r - g) / d + 4
    }
    h /= 6
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)]
}

/** The `ai-slop` definer: "a blue→purple gradient (≈#4F46E5 → ≈#A855F7)". Classified by hue band rather than a hex lookup so a near neighbor still trips it; Saturn gold (hue ≈39) and neutral grays fall well outside both bands.
 * @param {{r:number,g:number,b:number}} rgb @returns {'indigo'|'purple'|null} */
function hueBand(rgb) {
  const [h, s, l] = rgbToHsl(rgb)
  if (s < 35 || l < 30 || l > 80) return null
  if (h >= 225 && h <= 252) return 'indigo'
  if (h >= 253 && h <= 305) return 'purple'
  return null
}

function relLuminance({ r, g, b }) {
  const chan = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b)
}

/** WCAG contrast ratio between two solid colors. @returns {number} */
function contrastRatio(a, b) {
  const l1 = relLuminance(a); const l2 = relLuminance(b)
  const lighter = Math.max(l1, l2); const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

/* ------------------------------------------------------------------ */
/* DOM helpers. No layout engine: "visible" is a style-only heuristic
 * (display/visibility/opacity/hidden), never a geometry check. */

function visible(win, el) {
  if (!el || el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') return false
  const cs = win.getComputedStyle(el)
  return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0'
}

function describeEl(el) {
  const id = el.id ? `#${el.id}` : ''
  const cls = el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : ''
  return `<${el.tagName.toLowerCase()}${id}${cls}>`
}

function attrText(el) {
  return `${el.id || ''} ${el.className || ''} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('data-icon') || ''}`.toLowerCase()
}

/** Walk up from `el` to the nearest solid effective background; mirrors collect-evidence.js's `effectiveBg`. Any background-image on the way, or a translucent background-color, marks the pair as not solid-on-solid. */
function effectiveBg(win, el) {
  let node = el
  while (node) {
    const cs = win.getComputedStyle(node)
    const bi = cs.backgroundImage
    const image = !!(bi && bi !== 'none')
    const rgb = parseRgb(cs.backgroundColor)
    if (rgb && rgb.a > 0) {
      const translucent = rgb.a < 0.999
      return { rgb, solid: !image && !translucent }
    }
    node = node.parentElement
  }
  return { rgb: { r: 255, g: 255, b: 255 }, solid: true }
}

/* ------------------------------------------------------------------ */
/* Individual probes. Each takes (win, document) and returns plain data;
 * scoring/verdict logic lives in the CRITERIA table below, kept separate
 * from measurement so either half can be checked on its own. */

function probeGradients(win, document) {
  const els = Array.from(document.querySelectorAll('body *')).filter(el => visible(win, el))
  const gradients = []
  let purpleIndigoHit = null
  for (const el of els) {
    const bi = win.getComputedStyle(el).backgroundImage || ''
    if (!bi.includes('gradient')) continue
    const stops = Array.from(bi.matchAll(/rgba?\([^)]+\)/gi)).map(m => parseRgb(m[0])).filter(Boolean)
    if (stops.length < 2) continue
    gradients.push({ element: describeEl(el), stops: stops.map(rgbHex) })
    if (!purpleIndigoHit) {
      const bands = stops.map(hueBand)
      if (bands.includes('indigo') && bands.includes('purple')) purpleIndigoHit = { element: describeEl(el), stops: stops.map(rgbHex) }
    }
  }
  return { gradients, purpleIndigoHit }
}

const BANNED_FAMILY_RE = /^(inter|roboto)$/i

function probeFonts(win, document) {
  const families = new Set()
  for (const el of document.querySelectorAll('h1,h2,h3,h4,p,a,button,li,span,label')) {
    if (!visible(win, el)) continue
    const fam = (win.getComputedStyle(el).fontFamily || '').split(',')[0].replace(/["']/g, '').trim()
    if (fam) families.add(fam)
  }
  const bannedFamilies = Array.from(families).filter(f => BANNED_FAMILY_RE.test(f))
  const h1 = document.querySelector('h1')
  const p = document.querySelector('p')
  const displayFamily = h1 ? (win.getComputedStyle(h1).fontFamily || '') : ''
  const bodyFamily = p ? (win.getComputedStyle(p).fontFamily || '') : ''
  const root = win.getComputedStyle(document.documentElement)
  const hasRoleTokens = ['--font-display', '--font-body', '--saturn-font-display', '--saturn-font-body']
    .some(name => root.getPropertyValue(name).trim().length > 0)
  return {
    families: Array.from(families),
    fontCount: families.size,
    bannedFamilies,
    rolesSeparated: !!displayFamily && !!bodyFamily && displayFamily !== bodyFamily,
    hasRoleTokens,
  }
}

function probeSparkle(document) {
  const hits = Array.from(document.querySelectorAll('*')).filter(el => attrText(el).includes('sparkle'))
  return { count: hits.length }
}

/** Uniform-card census: 3+ visible siblings under the same parent sharing an identical (radius, shadow, background, border) signature. Radius+shadow alone false-positives on reset-styled lists, so a styled surface (background or shadow) is required, matching collect-evidence.js's `hasSurface` guard. */
/** jsdom's cssstyle reports an unset `box-shadow`/`border-radius` shorthand as `''`, not the browser-standard `none`/`0px` — normalize both before treating either as "present". */
function shadowOf(cs) { return cs.boxShadow || 'none' }
function radiusOf(cs) { return parseFloat(cs.borderRadius) || 0 }

function probeCards(win, document) {
  const candidates = Array.from(document.querySelectorAll('div,section,article,li')).filter(el => visible(win, el))
  const surfaces = candidates.filter((el) => {
    const cs = win.getComputedStyle(el)
    return shadowOf(cs) !== 'none' || radiusOf(cs) > 0
  })
  const byParent = new Map()
  for (const el of surfaces) {
    if (!el.parentElement) continue
    const list = byParent.get(el.parentElement) ?? []
    list.push(el)
    byParent.set(el.parentElement, list)
  }
  const sig = (el) => {
    const cs = win.getComputedStyle(el)
    return [radiusOf(cs), shadowOf(cs), cs.backgroundColor, cs.borderStyle, cs.borderWidth].join('|')
  }
  const uniformGroups = []
  for (const [parent, kids] of byParent) {
    if (kids.length < 3) continue
    const first = sig(kids[0])
    const hasSurface = (parseRgb(win.getComputedStyle(kids[0]).backgroundColor)?.a ?? 0) > 0 || shadowOf(win.getComputedStyle(kids[0])) !== 'none'
    if (hasSurface && kids.every(k => sig(k) === first)) uniformGroups.push({ parent: describeEl(parent), count: kids.length, signature: first })
  }
  return { surfaceCount: surfaces.length, uniformGroups }
}

const REVEAL_MARKER_RE = /^(reveal|fade-?up|fade-?in|scroll-reveal|animate-on-scroll|wow|sr-[\w-]+)$/i

/** Blanket fade-up census. A scroll-reveal class with no `animation-timeline` is the tell every one-prompt page ships; the same class driven by `animation-timeline: view()|scroll()` is a real technique, not a tell (collect-evidence.js's nuance, ported directly). */
function probeFadeUp(win, document) {
  const all = Array.from(document.querySelectorAll('body *'))
  const matches = all.filter(el => el.hasAttribute('data-aos') || Array.from(el.classList).some(c => REVEAL_MARKER_RE.test(c)))
  const withoutTimeline = matches.filter((el) => {
    const t = win.getComputedStyle(el).animationTimeline
    return !t || t === 'auto' || t === 'none' || t === ''
  })
  return { matched: matches.length, withoutTimeline: withoutTimeline.length }
}

function probeMotion(win, document) {
  const names = new Set()
  for (const el of document.querySelectorAll('body *')) {
    const cs = win.getComputedStyle(el)
    const name = cs.animationName
    if (name && name !== 'none') for (const n of name.split(',').map(s => s.trim())) if (n) names.add(n)
  }
  return { distinctAnimationNames: names.size, names: Array.from(names).slice(0, 20) }
}

/** Purposeless-canvas tell: a canvas named like an ambient particle field, with no `data-engine` (the marker an attributed engine like three.js sets on itself, per collect-evidence.js) and no accessible name — "purposeless particle canvas" is a hard slop tell, not a feature. A labeled or `data-engine`-carrying canvas is out of scope for this static check. */
function probeCanvas(document) {
  const canvases = Array.from(document.querySelectorAll('canvas'))
  const purposeless = canvases.filter((c) => {
    if (c.getAttribute('data-engine')) return false
    const labeled = c.hasAttribute('aria-label') || c.hasAttribute('role')
    return /particle|stars|confetti/i.test(`${c.id} ${c.className}`) && !labeled
  })
  return { count: canvases.length, purposeless: purposeless.length }
}

function pickPair(win, el, context) {
  const cs = win.getComputedStyle(el)
  const fg = parseRgb(cs.color)
  if (!fg || fg.a < 0.999) return null
  const bg = effectiveBg(win, el)
  const px = parseFloat(cs.fontSize) || 16
  const bold = parseInt(cs.fontWeight, 10) >= 700
  return {
    fg, bg: bg.rgb, solid: bg.solid,
    large: px >= 24 || (px >= 18.66 && bold),
    context: `${context} ${describeEl(el)} "${(el.textContent || '').trim().slice(0, 40)}"`,
  }
}

function probeContrast(win, document) {
  const pairs = []
  const h1 = document.querySelector('h1')
  if (h1 && visible(win, h1)) { const p = pickPair(win, h1, 'headline'); if (p) pairs.push(p) }
  const bodyEls = Array.from(document.querySelectorAll('p,li')).filter(el => visible(win, el) && (el.textContent || '').trim().length > 2).slice(0, 3)
  bodyEls.forEach((el, i) => { const p = pickPair(win, el, `body ${i + 1}`); if (p) pairs.push(p) })
  const cta = Array.from(document.querySelectorAll('button,a[class*="btn"],a[class*="button"],[role="button"]')).find(el => visible(win, el))
  if (cta) { const p = pickPair(win, cta, 'CTA'); if (p) pairs.push(p) }
  const measured = pairs.filter(p => p.solid).map(p => ({ ...p, ratio: contrastRatio(p.fg, p.bg), threshold: p.large ? 3 : 4.5 }))
  const failing = measured.filter(p => p.ratio < p.threshold)
  return { pairs, measured, failing }
}

function probeDeadLinks(win, document) {
  const anchors = Array.from(document.querySelectorAll('a[href]')).filter(el => visible(win, el))
  const dead = anchors.filter((a) => {
    const href = (a.getAttribute('href') || '').trim()
    return href === '#' || href === '' || /^javascript:\s*void\(0\)/i.test(href)
  })
  return { total: anchors.length, dead: dead.length, samples: dead.slice(0, 5).map(a => (a.textContent || '').trim().slice(0, 40)) }
}

function probeCtaDensity(win, document) {
  const sections = Array.from(document.querySelectorAll('section, header, footer, main > div'))
  const counts = sections.map(sec => Array.from(sec.querySelectorAll('button, a[class*="btn"], a[class*="button"], [role="button"]')).filter(el => visible(win, el)).length)
  return { sections: counts.length, competing: counts.filter(c => c >= 3).length }
}

function probeSpacing(win, document) {
  const els = Array.from(document.querySelectorAll('section, header, footer, main > div, li, .card')).filter(el => visible(win, el))
  const values = []
  for (const el of els) {
    const cs = win.getComputedStyle(el)
    for (const prop of ['paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight', 'rowGap', 'columnGap']) {
      const n = Math.round(parseFloat(cs[prop]) || 0)
      if (n > 0) values.push(n)
    }
  }
  const offGrid = values.filter(v => v % 4 !== 0)
  return { sampleCount: values.length, offGridCount: offGrid.length, ratio: values.length ? offGrid.length / values.length : 0 }
}

function probeImagery(document) {
  const imgs = Array.from(document.querySelectorAll('img'))
  const placeholder = imgs.filter((img) => {
    const s = `${img.getAttribute('src') || ''} ${img.getAttribute('alt') || ''}`.toLowerCase()
    return /placeholder|lorem\s?ipsum|via\.placeholder|unsplash\.com\/random/.test(s)
  })
  return { total: imgs.length, placeholder: placeholder.length }
}

function probeGrain(document) {
  const grainEls = Array.from(document.querySelectorAll('*')).filter(el => /grain|noise/i.test(el.className || ''))
  const hasTurbulence = document.querySelectorAll('feTurbulence').length > 0
  return { count: grainEls.length, untuned: grainEls.length > 0 && !hasTurbulence }
}

/** homogenized-premium's "cream + serif" escape-from-slop-into-a-different-slop tell: a warm, high-lightness solid background paired with a serif body font on the same block. */
function probeCreamSerif(win, document) {
  const blocks = Array.from(document.querySelectorAll('section, main, article, header, body')).filter(el => visible(win, el))
  for (const el of blocks) {
    const bg = effectiveBg(win, el)
    if (!bg.solid) continue
    const [h, s, l] = rgbToHsl(bg.rgb)
    const cream = h >= 20 && h <= 60 && s >= 15 && s <= 65 && l >= 85 && l <= 96
    if (!cream) continue
    const prose = el.querySelector('p, blockquote')
    if (!prose) continue
    const fam = win.getComputedStyle(prose).fontFamily || ''
    if (/serif/i.test(fam) && !/sans-serif/i.test(fam)) return { element: describeEl(el), background: rgbHex(bg.rgb), fontFamily: fam }
  }
  return null
}

function hasReducedMotionQuery(rawHtml) {
  return /@media[^{]*prefers-reduced-motion\s*:\s*reduce[^{]*\{/i.test(rawHtml)
}

/* ------------------------------------------------------------------ */
/* Criteria: measurement -> {score, verdict, evidence}. Kept as small pure
 * functions over the probe results above so the mapping from "what was
 * measured" to "what that means" stays legible and testable on its own. */

function verdictItem(criterion, verdict, evidence) {
  return { criterion, score: verdict === 'UNVERIFIED' ? null : SCORE_BY_VERDICT[verdict], evidence, verdict }
}

function unverified(criterion, why) {
  return verdictItem(criterion, 'UNVERIFIED', why)
}

function gradeAiSlop(m) {
  const hard = []
  const soft = []
  if (m.gradients.purpleIndigoHit) hard.push(`purple/indigo gradient at ${m.gradients.purpleIndigoHit.element} (${m.gradients.purpleIndigoHit.stops.join(' -> ')})`)
  if (m.fonts.bannedFamilies.length) hard.push(`banned font-family literal: ${m.fonts.bannedFamilies.join(', ')}`)
  if (m.sparkle.count) hard.push(`${m.sparkle.count} element(s) named "sparkle" (the four-pointed AI badge glyph)`)
  if (m.cards.uniformGroups.length) hard.push(`${m.cards.uniformGroups.length} group(s) of ${m.cards.uniformGroups.map(g => g.count).join('/')} identical-signature sibling cards`)
  if (m.fadeUp.withoutTimeline >= 6) hard.push(`${m.fadeUp.withoutTimeline} scroll-reveal marker(s) with no animation-timeline — blanket fade-up`)
  else if (m.fadeUp.withoutTimeline >= 1) soft.push(`${m.fadeUp.withoutTimeline} scroll-reveal marker(s) with no animation-timeline`)
  if (m.grain.untuned) soft.push(`${m.grain.count} grain/noise-named element(s) with no feTurbulence backing them`)
  if (hard.length) return verdictItem('ai-slop scan', 'REJECT', hard.join('; '))
  if (soft.length) return verdictItem('ai-slop scan', 'REVISE', soft.join('; '))
  return verdictItem('ai-slop scan', 'PASS', 'No purple/indigo gradient, banned font, sparkle glyph, uniform card group, blanket fade-up, or untuned grain detected.')
}

function gradeHomogenized(m) {
  if (m.creamSerif) return verdictItem('homogenized-premium scan', 'REJECT', `cream background (${m.creamSerif.background}) paired with a serif body font (${m.creamSerif.fontFamily}) at ${m.creamSerif.element} — the quiet-luxury escape from slop, not art direction.`)
  return verdictItem('homogenized-premium scan', 'PASS', 'No warm high-lightness background paired with a serif prose font detected.')
}

function gradeMotionBudget(m) {
  if (m.fadeUp.withoutTimeline >= 6) return verdictItem('Motion budget respected', 'REJECT', `${m.fadeUp.withoutTimeline} untimed scroll-reveal marker(s) — a mass default, not a 2-3 budget.`)
  if (m.motion.distinctAnimationNames > 3) return verdictItem('Motion budget respected', 'REJECT', `${m.motion.distinctAnimationNames} distinct animation-name(s): ${m.motion.names.join(', ')} — over the 2-3 budget.`)
  if (m.fadeUp.withoutTimeline >= 1) return verdictItem('Motion budget respected', 'REVISE', `${m.fadeUp.withoutTimeline} untimed scroll-reveal marker(s) alongside ${m.motion.distinctAnimationNames} named animation(s) — an inconsistent motion system.`)
  return verdictItem('Motion budget respected', 'PASS', `${m.motion.distinctAnimationNames} distinct CSS animation(s)${m.motion.names.length ? ` (${m.motion.names.join(', ')})` : ''}; no untimed scroll-reveal markers.`)
}

function gradeAmbientCanvas(m) {
  if (m.canvas.count === 0) return verdictItem('Ambient canvas quality bar', 'PASS', 'No <canvas> element present.')
  if (m.canvas.purposeless > 0) return verdictItem('Ambient canvas quality bar', 'REJECT', `${m.canvas.purposeless} particle-named canvas with no data-engine or accessible name — "purposeless particle canvas", a hard slop tell.`)
  return verdictItem('Ambient canvas quality bar', 'REVISE', `${m.canvas.count} canvas element(s) present and not obviously purposeless, but DPR, rAF discipline, off-screen/hidden-tab pause, and teardown are runtime facts a static probe cannot verify — confirm them with review-web.mjs or a live audit before PASS.`)
}

function gradeContrast(m) {
  if (m.contrast.measured.length === 0) return unverified('Contrast measured', 'No solid-on-solid text/background pair could be sampled (headline, body, and CTA colors were all transparent, gradient-clipped, or backed by a translucent/imaged surface).')
  if (m.contrast.failing.length) {
    const detail = m.contrast.failing.map(p => `${p.context}: ${p.ratio.toFixed(2)}:1 (needs ${p.threshold}:1)`).join('; ')
    return verdictItem('Contrast measured', 'REJECT', detail)
  }
  const detail = m.contrast.measured.map(p => `${p.context}: ${p.ratio.toFixed(2)}:1`).join('; ')
  return verdictItem('Contrast measured', 'PASS', detail)
}

function gradeSpacingTypeImagery(m) {
  const hard = []
  const soft = []
  if (m.imagery.placeholder) hard.push(`${m.imagery.placeholder} placeholder-named image(s) of ${m.imagery.total}`)
  if (m.spacing.sampleCount && m.spacing.ratio > 0.3) soft.push(`${m.spacing.offGridCount}/${m.spacing.sampleCount} spacing value(s) off a 4px grid`)
  if (!m.fonts.rolesSeparated && !m.fonts.hasRoleTokens) soft.push('no distinct display/body font role and no --font-display/--font-body token declared')
  if (m.fonts.fontCount > 4) soft.push(`${m.fonts.fontCount} distinct font families in use`)
  if (hard.length) return verdictItem('Spacing, type roles, and real imagery', 'REJECT', hard.concat(soft).join('; '))
  if (soft.length) return verdictItem('Spacing, type roles, and real imagery', 'REVISE', soft.join('; '))
  return verdictItem('Spacing, type roles, and real imagery', 'PASS', `Spacing on a 4px grid (${m.spacing.sampleCount} sample(s)); ${m.fonts.fontCount} font role(s) declared; no placeholder imagery.`)
}

function gradeCtaRoutes(m) {
  if (m.deadLinks.total === 0 && m.ctaDensity.sections === 0) return unverified('One primary CTA per section; real routes', 'No CTA-like anchor, button, or section element was found to sample.')
  if (m.deadLinks.dead) return verdictItem('One primary CTA per section; real routes', 'REJECT', `${m.deadLinks.dead} dead link(s) (href="#" or empty): ${m.deadLinks.samples.join(', ') || 'unlabeled'}`)
  if (m.ctaDensity.competing) return verdictItem('One primary CTA per section; real routes', 'REVISE', `${m.ctaDensity.competing} section(s) with 3+ CTA-like controls — competing calls to action.`)
  return verdictItem('One primary CTA per section; real routes', 'PASS', `${m.deadLinks.total} link(s) checked, none dead; no section had 3+ competing CTAs.`)
}

function gradeReducedMotion(m) {
  const hasMotion = m.motion.distinctAnimationNames > 0 || m.canvas.count > 0 || m.fadeUp.matched > 0
  if (!hasMotion) return verdictItem('Reduced-motion state designed', 'PASS', 'No motion (CSS animation, canvas, or scroll-reveal marker) present; a reduced-motion accommodation does not apply.')
  if (!m.hasReducedMotionQuery) return verdictItem('Reduced-motion state designed', 'REJECT', 'Motion is present (animation, canvas, or scroll-reveal marker) but no @media (prefers-reduced-motion: reduce) block was found in the page.')
  return verdictItem('Reduced-motion state designed', 'PASS', '@media (prefers-reduced-motion: reduce) is declared alongside the page\u2019s motion. (JS-side handling, if any, is not verified here.)')
}

/** Run every probe over a parsed document and assemble the 12-item rubric. */
function assembleRubric(win, document, rawHtml) {
  const m = {
    gradients: probeGradients(win, document),
    fonts: probeFonts(win, document),
    sparkle: probeSparkle(document),
    cards: probeCards(win, document),
    fadeUp: probeFadeUp(win, document),
    motion: probeMotion(win, document),
    canvas: probeCanvas(document),
    contrast: probeContrast(win, document),
    deadLinks: probeDeadLinks(win, document),
    ctaDensity: probeCtaDensity(win, document),
    spacing: probeSpacing(win, document),
    imagery: probeImagery(document),
    grain: probeGrain(document),
    creamSerif: probeCreamSerif(win, document),
    hasReducedMotionQuery: hasReducedMotionQuery(rawHtml),
  }

  const items = new Map()
  items.set('Brand test', unverified('Brand test', 'Whether the stripped-logo page is unmistakably this brand is a judgment call for the fresh-context reviewer, not a markup fact.'))
  items.set('One named mechanism', unverified('One named mechanism', 'The page\u2019s signature mechanism is a design decision to state in a sentence, not something derivable from markup.'))
  for (const item of [
    gradeAiSlop(m),
    gradeHomogenized(m),
    gradeMotionBudget(m),
    gradeAmbientCanvas(m),
    gradeContrast(m),
    gradeSpacingTypeImagery(m),
    gradeCtaRoutes(m),
    gradeReducedMotion(m),
  ]) items.set(item.criterion, item)
  items.set('Deviation log', unverified('Deviation log', 'Whether every intentional departure was logged with a reason lives in the accompanying report, not the page itself.'))
  items.set('Writer \u2260 reviewer', unverified('Writer \u2260 reviewer', 'Whether a fresh context (not the building hand) graded this page is a process fact this script cannot observe from the page alone.'))

  const ordered = CRITERIA_ORDER.map(name => items.get(name))
  const mechanical = ordered.filter(item => !UNVERIFIABLE_CRITERIA.has(item.criterion))
  const overallVerdict = mechanical.some(i => i.verdict === 'REJECT') ? 'REJECT'
    : mechanical.some(i => i.verdict === 'REVISE') ? 'REVISE'
      : 'PASS'

  const findings = [
    ...m.gradients.gradients.map(g => ({ tell: 'gradient', severity: /** @type {const} */ ('info'), evidence: `${g.element}: ${g.stops.join(' -> ')}` })),
    ...(m.grain.count ? [{ tell: 'grain_overlay', severity: /** @type {const} */ (m.grain.untuned ? 'soft' : 'info'), evidence: `${m.grain.count} grain/noise-named element(s)` }] : []),
  ]

  return { m, items: ordered, overallVerdict, findings }
}

/**
 * Grade an already-rendered HTML document string. Loads jsdom dynamically —
 * this package never installs it; when it cannot be resolved the grade is
 * unavailable, never a guessed PASS.
 * @param {string} html Rendered HTML markup (from a saved file or a captured page source).
 * @param {{source?: string}} [options]
 */
export async function gradePage(html, options = {}) {
  let JSDOM
  let engineVersion = 'unavailable'
  try {
    const jsdom = await import('jsdom')
    JSDOM = jsdom.JSDOM
    engineVersion = `jsdom@${jsdom.version ?? 'unknown'}`
  } catch (error) {
    throw new GradeUnavailableError(`jsdom is unavailable in this environment (${error instanceof Error ? error.message : String(error)}). Install it in the target project or run the review through a real browser (scripts/review-web.mjs); no dependency was installed automatically.`)
  }
  let dom
  try {
    dom = new JSDOM(html, { pretendToBeVisual: true, url: 'http://localhost/', runScripts: 'outside-only' })
  } catch (error) {
    throw new GradeUnavailableError(`The supplied HTML could not be parsed: ${error instanceof Error ? error.message : String(error)}`)
  }
  try {
    const { window } = dom
    const { document } = window
    const { items, overallVerdict, findings } = assembleRubric(window, document, html)
    const notes = [
      'No layout engine: geometry (rendered character measure, tap-target size) is not measured here.',
      'oklch()/lab() color declarations are not resolved by jsdom\u2019s CSSOM and are reported as unresolved, not guessed.',
      'JS-driven motion is invisible to a static probe; only CSS animation/animation-timeline is measured.',
    ]
    return {
      version: 1,
      source: options.source ?? 'inline HTML',
      generatedAt: new Date().toISOString(),
      engine: engineVersion,
      overallVerdict,
      notes,
      items,
      findings,
    }
  } finally {
    dom.window.close()
  }
}

function markdown(rubric) {
  const lines = [
    '# Premium-output visual review', '',
    `Overall: **${rubric.overallVerdict}**`, '',
    `Source: ${rubric.source}`,
    `Engine: ${rubric.engine}`, '',
    'This is the deterministic half of the review only (scripts/review-grade.mjs). It does not replace the fresh-context reviewer subagent\u2019s screenshot pass (policy.ts) — UNVERIFIED items below are exactly the checklist entries that pass depends on.', '',
  ]
  for (const item of rubric.items) lines.push(`- **${item.criterion}** — ${item.verdict}${item.score === null ? '' : ` (${item.score}/5)`}: ${item.evidence}`)
  if (rubric.notes.length) { lines.push('', '## Instrument limitations', ''); for (const note of rubric.notes) lines.push(`- ${note}`) }
  return `${lines.join('\n')}\n`
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const options = parseArgs(process.argv.slice(2))
    if (options.help) process.stdout.write(`${HELP}\n`)
    else {
      const html = await readFile(options.html, 'utf8')
      const rubric = await gradePage(html, { source: options.source ?? options.html })
      await mkdir(options.out, { recursive: true })
      const rubricPath = resolve(options.out, 'rubric.json')
      const summaryPath = resolve(options.out, 'rubric.md')
      await writeFile(rubricPath, `${JSON.stringify(rubric, null, 2)}\n`)
      await writeFile(summaryPath, markdown(rubric))
      process.stdout.write(`${JSON.stringify({ overallVerdict: rubric.overallVerdict, rubric: rubricPath, summary: summaryPath })}\n`)
      process.exitCode = rubric.overallVerdict === 'PASS' ? 0 : 1
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`${message}\n${HELP}\n`)
    process.exitCode = 2
  }
}
