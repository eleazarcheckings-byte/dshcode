/** The Node-style `global` alias the worker installs before any bundled module evaluates. */
import { describe, expect, it } from 'vitest'
import '../../src/node/globals/global.ts'

describe('node global alias', () => {
  it('exposes the worker global scope as the Node-style global object, by identity', () => {
    const scope = globalThis as unknown as { global?: unknown }
    expect(scope.global).toBe(globalThis)
  })
})
