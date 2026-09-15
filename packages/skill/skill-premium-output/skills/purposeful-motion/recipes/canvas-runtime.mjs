/**
 * Framework-neutral canvas clock. Copy this file into the generated project; it has no dependencies.
 * Importing is safe during server rendering. Call attachCanvas only after mounting a canvas.
 */

/**
 * @typedef {object} CanvasFrame
 * @property {number} width Canvas width in CSS pixels.
 * @property {number} height Canvas height in CSS pixels.
 * @property {number} dpr Backing-pixel scale, bounded by maxDpr.
 * @property {number} time Elapsed active animation seconds, retained across pauses.
 * @property {number} delta Active seconds since the previous paint; zero for a requested still frame.
 * @property {boolean} reducedMotion Current operating-system motion preference.
 */

/**
 * Own one canvas clock, its display size, and its visibility listeners.
 * Give the canvas a CSS width and height independent of its backing width/height attributes.
 * The renderer receives a cleared context scaled to CSS pixels. It must balance its own save/restore
 * calls and must not resize the canvas. A thrown render error disposes the runtime and is rethrown.
 * No pointer, keyboard, or scroll events are intercepted. Provide semantic content or an SVG fallback
 * outside the canvas, and mark a purely decorative canvas aria-hidden in the consuming application.
 *
 * @param {HTMLCanvasElement} canvas A mounted, CSS-sized canvas.
 * @param {(context: CanvasRenderingContext2D, frame: CanvasFrame) => void} render Scene renderer.
 * @param {{fps?: number, maxDpr?: number, paused?: boolean}} [options] FPS is clamped to 1–60 and
 * display density to 1–3. Non-finite values throw. Ambient defaults are 30 FPS and display density 2.
 * @returns {{setPaused(paused: boolean): void, repaint(): void, dispose(): void} | null} Controller,
 * or null without a browser window or 2D context. Disposed controllers do nothing. repaint requests
 * an immediate still frame when visible; it never starts another clock.
 * @example
 * // Set CSS dimensions in your stylesheet; this runtime never changes layout styles.
 * // .scene { width: 100%; height: 280px; pointer-events: none; }
 * const scene = attachCanvas(canvas, (ctx, { width, height, time }) => {
 *   const angle = Math.sin(time * 0.2) * 0.08;
 *   ctx.translate(width / 2, height / 2);
 *   ctx.rotate(angle);
 *   ctx.strokeStyle = '#b8b8b8';
 *   ctx.beginPath();
 *   ctx.ellipse(0, 0, Math.min(width * 0.3, 180), 42, 0, 0, Math.PI * 2);
 *   ctx.stroke();
 * });
 * // Wire a labeled pause control to scene?.setPaused(true), and call scene?.dispose() on unmount.
 */
export function attachCanvas(canvas, render, { fps = 30, maxDpr = 2, paused = false } = {}) {
  if (!Number.isFinite(fps) || !Number.isFinite(maxDpr)) {
    throw new TypeError('Canvas fps and maxDpr must be finite numbers.');
  }
  const interval = 1000 / Math.max(1, Math.min(60, fps));
  const densityLimit = Math.max(1, Math.min(3, maxDpr));
  const document = canvas.ownerDocument;
  const browserWindow = document.defaultView;
  if (browserWindow === null) return null;
  const context = canvas.getContext('2d');
  if (context === null) return null;
  const window = browserWindow;
  const ctx = context;

  const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let disposed = false;
  let visible = true;
  let frameId = 0;
  let width = 0;
  let height = 0;
  let dpr = 1;
  let time = 0;
  let pendingDelta = 0;
  /** @type {number | undefined} */
  let lastFrame;
  /** @type {number | undefined} */
  let lastPaint;
  /** @type {ResizeObserver | undefined} */
  let resizeObserver;
  /** @type {IntersectionObserver | undefined} */
  let intersectionObserver;

  const canPresent = () => !disposed && !document.hidden && visible && width > 0 && height > 0;
  const canAnimate = () => canPresent() && !paused && !media?.matches;

  function stop() {
    if (frameId !== 0) window.cancelAnimationFrame(frameId);
    frameId = 0;
    lastFrame = undefined;
    lastPaint = undefined;
    pendingDelta = 0;
  }

  /** @param {number} delta */
  function paint(delta) {
    if (!canPresent()) return;
    ctx.save();
    try {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      render(ctx, { width, height, dpr, time, delta, reducedMotion: media?.matches ?? false });
    } catch (error) {
      dispose();
      throw error;
    } finally {
      ctx.restore();
    }
  }

  /** @param {number} timestamp */
  function tick(timestamp) {
    frameId = 0;
    if (!canAnimate()) { stop(); return; }
    if (lastFrame === undefined) {
      lastFrame = timestamp;
      lastPaint = timestamp;
    } else {
      const elapsed = Math.max(0, Math.min(timestamp - lastFrame, 100)) / 1000;
      time += elapsed;
      pendingDelta += elapsed;
      lastFrame = timestamp;
      if (timestamp - (lastPaint ?? timestamp) >= interval) {
        paint(pendingDelta);
        pendingDelta = 0;
        lastPaint = timestamp;
      }
    }
    if (canAnimate() && frameId === 0) frameId = window.requestAnimationFrame(tick);
  }

  function repaint() {
    paint(0);
    pendingDelta = 0;
    lastPaint = lastFrame;
  }

  function sync() {
    if (disposed) return;
    if (!canAnimate()) stop();
    repaint();
    if (canAnimate() && frameId === 0) frameId = window.requestAnimationFrame(tick);
  }

  function resize() {
    if (disposed) return;
    const bounds = canvas.getBoundingClientRect();
    width = bounds.width;
    height = bounds.height;
    dpr = Math.min(window.devicePixelRatio || 1, densityLimit);
    const pixelsWide = Math.round(width * dpr);
    const pixelsHigh = Math.round(height * dpr);
    if (canvas.width !== pixelsWide) canvas.width = pixelsWide;
    if (canvas.height !== pixelsHigh) canvas.height = pixelsHigh;
    sync();
  }

  /** @param {boolean} value */
  function setPaused(value) {
    if (disposed || paused === value) return;
    paused = value;
    sync();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    stop();
    resizeObserver?.disconnect();
    intersectionObserver?.disconnect();
    media?.removeEventListener('change', sync);
    document.removeEventListener('visibilitychange', sync);
    window.removeEventListener('resize', resize);
  }

  if (typeof window.ResizeObserver === 'function') {
    resizeObserver = new window.ResizeObserver(resize);
    resizeObserver.observe(canvas);
  }
  if (typeof window.IntersectionObserver === 'function') {
    intersectionObserver = new window.IntersectionObserver(entries => {
      visible = entries.some(entry => entry.isIntersecting);
      sync();
    });
    intersectionObserver.observe(canvas);
  }
  // The window listener also refreshes display density when moving between monitors.
  window.addEventListener('resize', resize, { passive: true });
  document.addEventListener('visibilitychange', sync);
  media?.addEventListener('change', sync);
  resize();
  return { setPaused, repaint, dispose };
}
