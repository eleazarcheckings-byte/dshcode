/**
 * Host-side mirror of the setup profile into the user-global agent memory.
 *
 * The durable facts First Light collects — who the user is, what they build,
 * their language and voice — land in the settings document, but settings are
 * read by configuration surfaces, never by the model. What the model actually
 * reads is the instruction loader's user-global scope (`$DSH_HOME/AGENTS.md`),
 * so the same facts are mirrored into one delimited block of that file.
 *
 * Why a delimited block rather than an append: setup can be replayed (a
 * version bump reopens the gate), and the file may already carry hand-written
 * instructions. Replacing the text between the markers is idempotent and never
 * duplicates, reorders, or clobbers what the user wrote by hand.
 *
 * Nothing secret is rendered here. Credentials stay in `.credentials.yaml`
 * under their own reference names; this block holds identity and preferences
 * only, so a leak of agent memory can never leak a key.
 *
 * @module @deepseek-ai/dsh-api-settings-controller/profile-memory
 */

import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ProfileMemoryFacts, ProfileMemoryWriteValue } from './types.ts'

/** Opening marker of the block this module owns. */
export const PROFILE_MEMORY_BEGIN = '<!-- saturn-ai:profile:begin -->'

/** Closing marker of the block this module owns. */
export const PROFILE_MEMORY_END = '<!-- saturn-ai:profile:end -->'

/**
 * The user-global memory file for one settings document. The shipped file
 * provider keeps `settings.yaml` directly under the harness home, which is the
 * same directory the instruction loader reads its user-global `AGENTS.md`
 * from; a deployment that relocates its document keeps memory beside it.
 * @param documentPath - the provider's durable settings document.
 * @returns the absolute path of the memory file.
 */
export function profileMemoryPath(documentPath: string): string {
  return join(dirname(documentPath), 'AGENTS.md')
}

/**
 * Render the replaceable block. The leading marker line is what the replacement
 * scan anchors on, and the trailing newline keeps the block its own paragraph.
 * @param facts - identity and voice preferences the user chose.
 * @returns the block text, markers included.
 */
export function renderProfileMemoryBlock(facts: ProfileMemoryFacts): string {
  return [
    PROFILE_MEMORY_BEGIN,
    '## About me',
    '',
    `- Name: ${facts.name}`,
    `- Building: ${facts.building}`,
    `- Language: ${facts.language}`,
    `- Voice: ${facts.tone}`,
    `- Consult the design brain before inventing UI: ${facts.consultDesignBrain ? 'yes' : 'no'}`,
    PROFILE_MEMORY_END,
    '',
  ].join('\n')
}

/**
 * Replace this module's block in an existing document, or append it when the
 * document has no block yet. Pure, so idempotency is testable without a
 * filesystem.
 * @param existing - current file contents, or undefined when the file is absent.
 * @param block - the rendered block to place.
 * @returns the complete new file contents, byte-stable for repeated calls.
 */
export function applyProfileMemoryBlock(existing: string | undefined, block: string): string {
  if (existing === undefined || existing.length === 0) return block
  const begin = existing.indexOf(PROFILE_MEMORY_BEGIN)
  const end = existing.indexOf(PROFILE_MEMORY_END)
  if (begin !== -1 && end > begin) {
    const after = end + PROFILE_MEMORY_END.length
    const head = existing.slice(0, begin)
    const tail = existing.slice(after).replace(/^\r?\n/, '')
    return `${head}${block}${tail}`
  }
  // No owned block yet: keep every hand-written instruction and append ours,
  // separated by exactly one blank line.
  const separator = existing.endsWith('\n\n') ? '' : existing.endsWith('\n') ? '\n' : '\n\n'
  return `${existing}${separator}${block}`
}

/**
 * Write the facts into the memory file beside one settings document.
 * @param documentPath - the provider's durable settings document.
 * @param facts - identity and voice preferences the user chose.
 * @returns the path written, for the setup receipt.
 */
export async function writeProfileMemory(
  documentPath: string,
  facts: ProfileMemoryFacts,
): Promise<ProfileMemoryWriteValue> {
  const path = profileMemoryPath(documentPath)
  const existing = await readFile(path, 'utf8').catch(() => undefined)
  await writeFile(path, applyProfileMemoryBlock(existing, renderProfileMemoryBlock(facts)), 'utf8')
  return { path }
}
