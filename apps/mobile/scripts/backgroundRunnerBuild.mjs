// Renders assets/background-runner.js by inlining src/lib/backgroundEventsCore.js's
// pure helpers above scripts/background-runner.entry.js's OS-tick wiring.
// @capacitor/background-runner's isolated JS engine has no module loader
// (see its README's "JavaScript API" section -- no `import`), so the runner
// file it actually loads cannot itself `import` the shared core module; this
// generator is what keeps the two in sync instead of hand-mirroring them
// (Mars r2 R2-F4 on M3-apps-mobile-r2.md).
//
// Both the CLI entry point (scripts/build-background-runner.mjs, run via
// `npm run build:background-runner`, wired as this package's `prebuild` so
// `npm run build` always regenerates before Vite's publicDir copies it into
// www/) and the drift-guard test (tests/backgroundRunnerGenerated.test.ts)
// import renderBackgroundRunner from here.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

export const CORE_PATH = join(packageRoot, 'src', 'lib', 'backgroundEventsCore.js');
export const ENTRY_PATH = join(packageRoot, 'scripts', 'background-runner.entry.js');
export const OUTPUT_PATH = join(packageRoot, 'assets', 'background-runner.js');

const GENERATED_HEADER = `// GENERATED FILE -- do not hand-edit.
//
// Produced by scripts/backgroundRunnerBuild.mjs (run via
// \`npm run build:background-runner\`) from:
//   - src/lib/backgroundEventsCore.js   (pure helpers -- SSE frame parsing,
//     numeric id ordering, event -> notification mapping -- also imported
//     directly by tests/backgroundEventsCore.test.ts)
//   - scripts/background-runner.entry.js (the OS-tick wiring: addEventListener,
//     CapacitorKV, CapacitorNotifications, fetch)
//
// @capacitor/background-runner's isolated JS engine has no module loader
// (see its README's "JavaScript API" section), so this file inlines the
// pure helpers as plain function declarations rather than importing them --
// that engine cannot execute an \`import\`/\`export\` statement at all. Edit
// one of the two sources above and re-run the generator; hand-editing this
// file fails tests/backgroundRunnerGenerated.test.ts, which compares it
// against a fresh render on every \`npm test\`.
`;

/**
 * Strips the pure module's `export` keywords so its functions become plain
 * top-level declarations the isolated engine's non-module script can call.
 * @param {string} source
 * @returns {string}
 */
function stripExports(source) {
  return source.replace(/^export (function|const)\s/gm, '$1 ');
}

/**
 * @param {string} coreSource - src/lib/backgroundEventsCore.js's contents.
 * @param {string} entrySource - scripts/background-runner.entry.js's contents.
 * @returns {string} The exact assets/background-runner.js contents.
 */
export function renderBackgroundRunner(coreSource, entrySource) {
  return `${GENERATED_HEADER}\n${stripExports(coreSource).trimEnd()}\n\n${entrySource.trimEnd()}\n`;
}

/** Reads both sources, writes the generated file, and returns its contents. */
export function buildBackgroundRunner() {
  const core = readFileSync(CORE_PATH, 'utf8');
  const entry = readFileSync(ENTRY_PATH, 'utf8');
  const output = renderBackgroundRunner(core, entry);
  writeFileSync(OUTPUT_PATH, output);
  return output;
}
