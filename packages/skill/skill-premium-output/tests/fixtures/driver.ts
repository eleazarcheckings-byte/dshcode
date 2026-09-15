/** Drive a keyless guide or artifact-retention turn through the shipped profile. */
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { bootProductionProfile } from '../../../../test-support/loader-smoke/tests/fixtures/production-profile.ts'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('quality driver requires a patch path')
const ctx = await bootProductionProfile({
  binName: 'premium-output-test', profile: 'headless',
  overlayPaths: [resolveConfigPath(configPath, undefined)],
})
try {
  const result = await runFixtureTurn(ctx, { task: 'Build a polished website with an accessible canvas animation.' })
  if (process.env['DSH_QUALITY_SCENARIO'] !== 'retained-artifact'
    && result.output !== 'Guide loaded; visual review is still required.') throw new Error(`Unexpected fixture result: ${result.output}`)
} finally {
  await ctx.fiber.dispose()
}
