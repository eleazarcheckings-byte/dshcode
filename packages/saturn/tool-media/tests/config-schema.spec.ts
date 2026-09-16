import { describe, expect, it } from 'vitest'
import { Config } from '../src/index.ts'

describe('Config schema', () => {
  it('accepts a missing loader config so an include row without `config` can boot', () => {
    const result = (Config as { '~standard': { validate: (value: unknown) => { value?: unknown; issues?: unknown } } })['~standard'].validate(undefined)
    expect(result.issues).toBeUndefined()
    expect(result.value).toEqual(expect.objectContaining({
      defaultImageProvider: 'gemini',
      defaultVideoProvider: 'gemini',
    }))
  })
})
