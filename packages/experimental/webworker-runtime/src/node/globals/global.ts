/**
 * The `global` object Node exposes to every module: the worker's own global
 * scope, by identity. Node-compatible npm code reads it directly at module
 * evaluation (cross-spawn's platform probe, picomatch), so a missing alias
 * throws before the Cordis tree finishes activating. Node defines
 * `global === globalThis`; this install keeps that identity.
 */

Object.defineProperty(globalThis, 'global', {
  value: globalThis,
  writable: true,
  configurable: true,
})
