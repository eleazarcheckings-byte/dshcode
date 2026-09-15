/** Scripted requests exercise real skill/file tools and a later truncated refinement. */
import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { FIRST_ARTIFACT, UNFINISHED_REFINEMENT } from './first-artifact.ts'

function* toolCall(
  ptc: boolean, suffix: string, tool: string, input: Record<string, unknown>, index = 0, complete = true,
): Generator<StreamChunk> {
  const id = ToolCallId(`quality-${suffix}`)
  const name = ptc ? 'run_code' : tool
  const args = JSON.stringify(ptc
    ? { code: `return await tools.${tool}(${JSON.stringify(input)})`, description: `Run the fixture ${tool} step.` }
    : input)
  yield { type: 'block-start', index, blockType: 'tool-call' }
  yield { type: 'tool-call-delta', index, id, name, argumentsDelta: complete ? args : args.slice(0, -1) }
  if (complete) yield { type: 'block-end', index, block: { type: 'tool-call', id, name, arguments: args } }
}

class QualityAdapter extends LlmAdapter {
  private artifactRequests = 0

  private * artifactStep(options: GenerateOptions): Generator<StreamChunk> {
    const step = this.artifactRequests++
    const ptc = options.tools?.some(tool => tool.name === 'run_code') === true
    const result = options.messages.at(-1)?.content.find(block => block.type === 'tool-result')
    if (step > 0 && (result === undefined || result.isError)) throw new Error('Fixture tool step failed')
    const file_path = resolve('checkpoint.html')
    switch (step) {
      case 0:
        yield* toolCall(ptc, 'guide', 'skill', { name: 'premium-web-experience' })
        break
      case 1:
        if (!JSON.stringify(result?.content).includes('Save a working first version')) throw new Error('First-version guide missing from history')
        yield* toolCall(ptc, 'first-write', 'write', { file_path, content: FIRST_ARTIFACT })
        break
      case 2:
        yield* toolCall(ptc, 'check-file', 'read', { file_path })
        break
      case 3:
        if (!JSON.stringify(result?.content).includes('Saved first version')) throw new Error('Saved artifact missing from read result')
        // Even a complete proposal is unsafe when another call in its response is truncated.
        yield* toolCall(ptc, 'replace', 'write', { file_path, content: UNFINISHED_REFINEMENT })
        yield* toolCall(ptc, 'partial', 'write', { file_path: resolve('unfinished.txt'), content: 'unfinished' }, 1, false)
        yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 20 } }
        yield { type: 'finish', reason: { kind: 'max-tokens' } }
        return
      default:
        throw new Error('Fixture unexpectedly continued after truncation')
    }
    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
    yield { type: 'finish', reason: { kind: 'tool-calls' } }
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (!options.system?.includes('premium-web-experience')) throw new Error('Quality policy missing from request')
    if (process.env['DSH_QUALITY_SCENARIO'] === 'retained-artifact') {
      yield* this.artifactStep(options)
      return
    }
    const result = options.messages.at(-1)?.content.find(block => block.type === 'tool-result')
    const guide = process.env['DSH_QUALITY_GUIDE'] ?? 'premium-web-experience'
    if (result === undefined) {
      const ptc = options.tools?.some(tool => tool.name === 'run_code') === true
      const name = ptc ? 'run_code' : 'skill'
      const args = JSON.stringify(ptc
        ? { code: `return await tools.skill({ name: ${JSON.stringify(guide)} })`, description: 'Read the output workflow.' }
        : { name: guide })
      const id = ToolCallId('quality-guide')
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: args } }
      yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    if (result.isError || !JSON.stringify(result.content).includes(guide)) {
      throw new Error('Skill instructions missing from model history')
    }
    const text = 'Guide loaded; visual review is still required.'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/** Fixture plugin name. */
export const name = 'quality-mock'
/** Only the provider registry is required. */
export const inject = ['llm']
/** Register the isolated keyless model. */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['quality-mock'], new QualityAdapter())
}
