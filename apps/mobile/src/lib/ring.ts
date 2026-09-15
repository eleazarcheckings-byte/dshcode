/**
 * The Saturn signature mark (SPEC §2): "a hairline ellipse tilted -18°,
 * drawn in currentColor. One tilt value everywhere." Emitted as a template
 * so every screen (pairing, lock, offline, notification list) draws the
 * exact same mark instead of each hand-rolling its own ellipse.
 *
 * `animated` adds a `pathLength`-based self-drawing stroke (one of the three
 * "steals" the SPEC keeps from the design compose pass) for the moment the
 * ring should feel alive: the pairing screen's idle state and a PASS verdict
 * arriving in the notification list.
 */
export function ringMarkSvg(options: { size?: number; animated?: boolean; className?: string } = {}): string {
  const size = options.size ?? 48;
  const cls = options.className ? ` class="${options.className}"` : '';
  const animClass = options.animated ? ' saturn-ring--draw' : '';
  return `<svg${cls} width="${size}" height="${size}" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Saturn AI">
  <ellipse class="saturn-ring${animClass}" cx="24" cy="24" rx="19" ry="10.5" transform="rotate(-18 24 24)"
    stroke="currentColor" stroke-width="1.5" pathLength="1"/>
</svg>`;
}
