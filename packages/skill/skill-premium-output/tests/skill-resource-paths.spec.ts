/**
 * Regression test for Mars r1 findings 1-2 on C9 (visual review loop): the
 * three SKILL.md guides tell a model to run `review-grade.mjs` and read
 * `rubric.schema.json` at paths resolved from each guide's own resource
 * base (`skills/<name>/`, see src/index.ts). Both assets must actually live
 * inside `skills/` (so `package.json`'s `files: ["skills", ...]` ships
 * them, and every path a guide names must resolve to a real file) rather
 * than at the package root, which is outside every skill's resource base
 * and outside the published package contents.
 */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const pkgRoot = resolve(import.meta.dirname, '..')

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(path)
    return true
  } catch {
    return false
  }
}

describe('skill resource paths (review-grade + rubric.schema.json ship inside skills/)', () => {
  it('review-grade.mjs lives inside premium-web-experience/scripts, not the package root', async () => {
    expect(await exists(resolve(pkgRoot, 'skills/premium-web-experience/scripts/review-grade.mjs'))).toBe(true)
  })

  it('rubric.schema.json has an in-base copy inside premium-web-experience/, matching the package-root copy tests import', async () => {
    const [root, inBase] = await Promise.all([
      readFile(resolve(pkgRoot, 'rubric.schema.json'), 'utf8'),
      readFile(resolve(pkgRoot, 'skills/premium-web-experience/rubric.schema.json'), 'utf8'),
    ])
    expect(inBase).toBe(root)
  })

  it('premium-web-experience/SKILL.md points at the in-base rubric.schema.json, not an escaping ../.. path', async () => {
    const skill = await readFile(resolve(pkgRoot, 'skills/premium-web-experience/SKILL.md'), 'utf8')
    expect(skill).not.toMatch(/\.\.\/\.\.\/rubric\.schema\.json/)
    expect(skill).toContain('`rubric.schema.json`')
  })

  it('premium-deliverables/SKILL.md and purposeful-motion/SKILL.md point at the sibling in-base rubric.schema.json', async () => {
    for (const guide of ['premium-deliverables', 'purposeful-motion']) {
      const skill = await readFile(resolve(pkgRoot, `skills/${guide}/SKILL.md`), 'utf8')
      expect(skill, guide).not.toMatch(/\.\.\/\.\.\/rubric\.schema\.json/)
      expect(skill, guide).toContain('../premium-web-experience/rubric.schema.json')
      expect(skill, guide).toContain('../premium-web-experience/scripts/review-grade.mjs')
      expect(await exists(resolve(pkgRoot, 'skills/premium-web-experience/rubric.schema.json'))).toBe(true)
      expect(await exists(resolve(pkgRoot, 'skills/premium-web-experience/scripts/review-grade.mjs'))).toBe(true)
    }
  })

  it("package.json's published files cover both the script and the schema now that they live under skills/", async () => {
    const pkg = JSON.parse(await readFile(resolve(pkgRoot, 'package.json'), 'utf8')) as { files: string[] }
    expect(pkg.files).toContain('skills')
  })
})
