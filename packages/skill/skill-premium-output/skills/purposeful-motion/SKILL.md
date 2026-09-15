# Purposeful motion and canvas craft

Use this guide for canvas, SVG, interface transitions, ambient scenes, interactive diagrams, and other motion. Keep the user's aesthetic and domain; an expressive visual is appropriate only where it adds clarity, identity, or restrained atmosphere.

## Compose before animating

Identify the focal element and quiet areas needed by text and controls. Establish layers, depth, light direction, material, and negative space. Begin with an attractive static composition. Use a small number of deliberate primitives instead of filling the screen with particles or unrelated effects.

Save that static composition as a small, runnable increment before generating the full animation. Confirm the write or edit succeeded, then add one motion behavior at a time with its pause, reduced-motion, and cleanup handling. Check each increment before expanding it. Keep the working scene available if a later response is interrupted; an unexecuted tool proposal is not a saved scene.

Assign every motion a role: a transition connects states, feedback acknowledges an action, a diagram explains relationships, and ambience establishes tone. Decorative motion must not pretend to be progress, success, or live activity. Real progress visuals must derive from real execution state.

Keep decorative animation quiet around reading and writing. Occasional events should have long calm gaps, a short readable trajectory, and a soft fade. Do not make every element pulse. Avoid cursor chasers, large perspective tilts, and repeated entrance animations unless the interaction calls for them.

## Runtime discipline

The resource directory includes `recipes/canvas-runtime.mjs`, a small framework-neutral example. Copy or adapt it into the user's project; the generated app must not depend on Saturn's installation path. Its single clock handles resizing, bounded display density, hidden/offscreen pause, user pause, reduced motion, and disposal. Supply a renderer that uses elapsed active time in seconds, not the number of frames.

- Start with 30 FPS for ambient work and a maximum display density of 2. Use higher frame rates only for interactions that need them and after measuring cost.
- Precompute stable geometry. Avoid randomizing the scene each frame, allocating unbounded particles, reading layout repeatedly, or updating React state on every animation frame.
- Keep one owner for each scene's clock and listeners. Cancel frames and detach observers/listeners when the scene unmounts.
- Pause when hidden, offscreen, or explicitly paused. Retain composition time across pauses so resuming does not jump. Clamp long frame gaps.
- Honor reduced motion with a useful still frame. Provide a static SVG, image, or semantic representation if a canvas context is unavailable. Essential information must be available outside a decorative canvas.
- Use a visible, labeled pause control for sustained motion. Do not make a decorative canvas intercept clicks, keyboard focus, scrolling, selection, or text entry.
- Pointer proximity can reveal existing detail subtly; gate it behind motion preferences and fine-pointer input. Do not require hover to discover essential content.

## Techniques to adapt

Choose one or two techniques that fit the brief, and implement them in the project's own visual language:

- **Material lighting:** a slowly moving reflection along a stable shape creates depth with little movement.
- **Constellation detail:** a sparse deterministic point set with faint connections; proximity can increase contrast locally. Use it for an appropriate spatial theme or real relationship diagram, not as a default for every site.
- **Occasional trajectories:** a tapered line with an eased head and fade can suggest a shooting star or transfer. Use explicit elapsed-time windows and long quiet intervals, with at most one decorative event in a region.
- **Spatial transitions:** retain an element's identity as its panel expands or changes state; keep keyboard focus and reading order stable.
- **Diagram flow:** animate a line only while its associated operation is actually active. Pair it with text labels and a static equivalent.

Use neutral light and tonal depth when the design is monochrome. If color is appropriate, give it a defined purpose and maintain a coherent palette. Gradients should describe material, light, or state; adding a gradient alone does not make a design premium.

## Verify the motion

Inspect a recording long enough to include an intermittent event. Compare normal motion, user pause, reduced motion, writing/focus states, hidden tabs, and narrow layouts. Watch for flashes, cropped trails, discontinuities on resume, overdraw, and distracting text backgrounds. Use the browser performance tools available to measure work rather than inventing performance claims. Verify that pointer and frame listeners disappear on unmount.

A still screenshot cannot prove motion quality. If recording or visual inspection is unavailable, identify that limitation and verify the lifecycle behavior with focused tests.

## Independent review before handoff

Before handing off a substantial canvas, SVG, or ambient piece, dispatch a fresh reviewer — a separate context with no visibility into your private reasoning — the same way premium-web-experience requires: a desktop and a 400px screenshot graded against the shared rubric (`../../rubric.schema.json`), plus the rendered page's markup graded with `../premium-web-experience/scripts/review-grade.mjs`. That script's static probe can rule out a purposeless particle canvas (present, unlabeled, no `data-engine`) and confirm a `prefers-reduced-motion` CSS gate exists, but it cannot measure device-pixel-ratio sizing, frame-budget discipline, or teardown — those stay runtime facts for the reviewer's recording/inspection pass, never a guessed PASS. Treat REJECT or REVISE as unfinished work, and if a fresh reviewer is genuinely unavailable, say so explicitly rather than skipping the step.
