/** Local `.env` credential fallback for the SaturnBot data directory; never logs values. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** A hand-edited `.env` file is a small text document; reject rather than silently truncate anything larger. */
const MAX_ENV_FILE_BYTES = 65_536
const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/u

/** Strip one layer of matching quotes from a parsed value, if present. */
function unquote(value: string): string {
  if (value.length < 2) return value
  const first = value[0]
  const last = value[value.length - 1]
  if ((first === '"' && last === '"') || (first === '\'' && last === '\'')) return value.slice(1, -1)
  return value
}

/**
 * Parse simple `KEY=VALUE` lines. Comments (`#`) and blank lines are ignored;
 * lines this parser cannot admit are skipped rather than thrown, since a
 * malformed line elsewhere in the file must not block every credential above
 * it. Values are never logged or included in a thrown error.
 * @param text - the file's raw UTF-8 content.
 * @returns the parsed key/value map.
 */
export function parseDotEnv(text: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const rawLine of text.split(/\r?\n/u)) {
    if (rawLine.trim() === '' || rawLine.trim().startsWith('#')) continue
    const match = LINE.exec(rawLine)
    if (match?.[1] === undefined) continue
    values[match[1]] = unquote(match[2] ?? '')
  }
  return values
}

/**
 * Read `<dataDirectory>/.env` for operator-supplied integration credentials.
 * Absence of the directory or file is the empty store, not an error — most
 * installs never create this file. An oversized file fails loudly instead of
 * a silently truncated secret.
 * @param dataDirectory - the Host-owned SaturnBot data directory.
 * @returns the parsed key/value map, or an empty map when the file is absent.
 */
export function readBotEnvFile(dataDirectory: string): Readonly<Record<string, string>> {
  const path = join(dataDirectory, '.env')
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw new Error('SaturnBot could not read its .env file at the configured data directory.')
  }
  if (Buffer.byteLength(text) > MAX_ENV_FILE_BYTES) throw new Error('SaturnBot .env file exceeds the permitted size.')
  return parseDotEnv(text)
}

/**
 * Merge `<dataDirectory>/.env` beneath the inherited process environment, so
 * an explicit process variable always wins — matching the harness's own
 * environment layering (inherited environment first, file fallback second).
 * @param dataDirectory - the Host-owned SaturnBot data directory.
 * @param base - the process environment to layer over the file; defaults to `process.env`.
 * @returns a frozen merged environment snapshot.
 */
export function resolveBotEnvironment(dataDirectory: string, base: NodeJS.ProcessEnv = process.env): Readonly<NodeJS.ProcessEnv> {
  const fromFile = readBotEnvFile(dataDirectory)
  const merged: NodeJS.ProcessEnv = { ...fromFile }
  for (const [key, value] of Object.entries(base)) if (value !== undefined) merged[key] = value
  return Object.freeze(merged)
}
