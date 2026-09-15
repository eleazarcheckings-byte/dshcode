/**
 * Peer-lease enforcement around shell dispatch.
 *
 * The file guard covers `write`, `edit`, and `str_replace_editor`, and the
 * Agent Teams policy used to admit the rest out loud: "Bash, formatters, code
 * generators, and scripts are not fully protected by the filesystem version
 * guard". That is the hole this module closes. A shell command is NOT
 * interpreted here — no attempt is made to know what `node build.mjs` will
 * touch. What is decidable from argv alone is scanned: an output redirection,
 * and the operands of a command whose entire purpose is to change a file. Those
 * land on a peer's claimed surface or they do not.
 *
 * Two properties are deliberate. First, reads stay free: a guard that denied
 * `cat` would be routed around within a day, and a lock writers route around
 * protects nothing. Second, the ledger transaction is NOT held across dispatch
 * the way the file guard holds it — a shell command can run for minutes, and
 * the ledger lock is cross-process, so holding it would stall every other
 * session's claims for the length of a build. The check therefore reads the
 * ledger, decides, and releases before the command starts.
 *
 * @module @saturnai/dsh-claims/shell-guard
 */

import { isAbsolute, relative, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolExecutionInput } from '@deepseek-ai/dsh-tools'
import { expireClaims, findConflicts, normalizeScope } from './ledger.ts'
import type { ClaimStore } from './store.ts'
import type { ScopeConflict } from './types.ts'
import { claimWorkspace } from './workspace.ts'

/** Which shell vocabulary a command is written in. */
export type ShellDialect = 'posix' | 'powershell'

/** One shell tool call reduced to what the guard can reason about. */
export interface ShellCall {
  /** The command line as the model wrote it. */
  readonly command: string
  /** The vocabulary its head commands belong to. */
  readonly dialect: ShellDialect
  /** The directory relative operands resolve against, when the call names one. */
  readonly workdir?: string
}

/** POSIX commands whose operands are the files they change. */
const POSIX_MUTATORS = new Set([
  'rm', 'rmdir', 'unlink', 'shred', 'mv', 'cp', 'install', 'mkdir', 'touch',
  'truncate', 'tee', 'ln', 'chmod', 'chown', 'chgrp', 'patch', 'dd',
])

/** POSIX commands that edit in place only when asked to. */
const POSIX_IN_PLACE = new Set(['sed', 'perl', 'ruby'])

/** Git subcommands that overwrite the working tree. */
const GIT_MUTATORS = new Set(['checkout', 'restore', 'apply', 'rm', 'mv', 'clean', 'stash', 'reset', 'switch'])

/** PowerShell cmdlets and aliases whose operands are the items they change. */
const POWERSHELL_MUTATORS = new Set([
  'set-content', 'add-content', 'clear-content', 'out-file', 'new-item', 'remove-item',
  'move-item', 'copy-item', 'rename-item', 'set-item', 'set-itemproperty', 'tee-object',
  'export-csv', 'export-clixml', 'sc', 'ac', 'clc', 'ni', 'ri', 'mi', 'cpi', 'rni', 'si',
  'rm', 'del', 'erase', 'rd', 'rmdir', 'mv', 'move', 'cp', 'copy', 'ren',
])

/** PowerShell parameters whose value is a path rather than content. */
const POWERSHELL_PATH_PARAMETERS = new Set(['-path', '-literalpath', '-filepath', '-destination', '-target', '-outfile'])

/** One tokenized pipeline stage: its words, and everything it redirects output into. */
interface Stage {
  readonly words: string[]
  readonly redirects: string[]
}

/**
 * Split a command line into pipeline stages, separating output-redirection
 * targets from ordinary words. Quotes are honored; a backslash is left alone
 * because on this platform it spells a path far more often than an escape.
 * @param command - the command line as written.
 * @returns each stage's words and redirection targets, in order.
 */
export function shellStages(command: string): Stage[] {
  const stages: Stage[] = []
  let words: string[] = []
  let redirects: string[] = []
  let current = ''
  let quote: string | null = null
  let quoted = false
  let pending: 'redirect' | 'discard' | null = null

  const endWord = (): void => {
    if (current === '' && !quoted) return
    if (pending === 'redirect') redirects.push(current)
    else if (pending !== 'discard') words.push(current)
    pending = null
    current = ''
    quoted = false
  }
  const endStage = (): void => {
    endWord()
    if (words.length > 0 || redirects.length > 0) stages.push({ words, redirects })
    words = []
    redirects = []
  }

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index] as string
    if (quote !== null) {
      if (char === quote) quote = null
      else current += char
      continue
    }
    if (char === '"' || char === '\'') {
      quote = char
      quoted = true
      continue
    }
    if (char === ' ' || char === '\t') {
      endWord()
      continue
    }
    if (char === '\n' || char === '\r' || char === ';' || char === '|') {
      endStage()
      continue
    }
    if (char === '&') {
      if (command[index + 1] === '>') {
        endWord()
        index += 1
        if (command[index + 1] === '>') index += 1
        pending = 'redirect'
        continue
      }
      endStage()
      continue
    }
    if (char === '>') {
      endWord()
      if (command[index + 1] === '>') index += 1
      pending = 'redirect'
      continue
    }
    if (char === '<') {
      endWord()
      pending = 'discard'
      continue
    }
    current += char
  }
  endStage()
  return stages
}

/**
 * The paths one command line would write, as far as argv can say.
 *
 * Only two things count as evidence: a redirection target, and an operand of a
 * command whose job is to change files. Everything else — an interpreter, a
 * build script, a formatter invoked by name — is out of reach of static
 * reading and stays the coordination problem the Team policy describes.
 * @param command - the command line as written.
 * @param dialect - which head-command vocabulary to read it in.
 * @returns candidate write targets, exactly as they were spelled.
 */
export function shellWriteTargets(command: string, dialect: ShellDialect): string[] {
  const targets: string[] = []
  for (const stage of shellStages(command)) {
    targets.push(...stage.redirects)
    targets.push(...(dialect === 'powershell' ? powershellOperands(stage.words) : posixOperands(stage.words)))
  }
  return targets.filter(target => target !== '' && !target.startsWith('-') && !target.includes('$'))
}

/** Operands of a POSIX head command that names files it changes. */
function posixOperands(words: readonly string[]): string[] {
  const head = commandName(words[0])
  if (head === undefined) return []
  const rest = words.slice(1)
  if (head === 'git') {
    const subcommand = rest.find(word => !word.startsWith('-'))
    if (subcommand === undefined || !GIT_MUTATORS.has(subcommand)) return []
    return operandsAfter(rest.slice(rest.indexOf(subcommand) + 1))
  }
  if (POSIX_IN_PLACE.has(head)) {
    if (!rest.some(word => word.startsWith('-') && word.includes('i'))) return []
    // The first bare operand of `sed -i 's/a/b/' file` is the script, not a path.
    const operands = operandsAfter(rest)
    return operands.slice(1)
  }
  if (!POSIX_MUTATORS.has(head)) return []
  return operandsAfter(rest).map(operand => operand.startsWith('of=') ? operand.slice(3) : operand)
}

/** Operands of a PowerShell stage whose head cmdlet changes items. */
function powershellOperands(words: readonly string[]): string[] {
  const head = commandName(words[0])
  if (head === undefined || !POWERSHELL_MUTATORS.has(head)) return []
  const operands: string[] = []
  for (let index = 1; index < words.length; index += 1) {
    const word = words[index] as string
    if (!word.startsWith('-')) {
      operands.push(word)
      continue
    }
    const next = words[index + 1]
    // A named parameter consumes its value; only path-valued ones contribute,
    // so `-Value 'text'` is never mistaken for a file.
    if (next !== undefined && !next.startsWith('-')) {
      if (POWERSHELL_PATH_PARAMETERS.has(word.toLowerCase())) operands.push(next)
      index += 1
    }
  }
  return operands
}

/** Bare operands, honoring the `--` end-of-options marker. */
function operandsAfter(words: readonly string[]): string[] {
  const operands: string[] = []
  let literal = false
  for (const word of words) {
    if (!literal && word === '--') {
      literal = true
      continue
    }
    if (!literal && word.startsWith('-')) continue
    operands.push(word)
  }
  return operands
}

/** The comparable name of a head command: basename, lowercased, unsuffixed. */
function commandName(word: string | undefined): string | undefined {
  if (word === undefined || word === '') return undefined
  const base = word.replace(/\\/gu, '/').split('/').pop() ?? word
  return base.toLowerCase().replace(/\.(?:exe|cmd|bat|ps1)$/u, '')
}

/**
 * Project candidate targets into claim space, dropping everything that does not
 * land inside it. A target outside the claim workspace — another repository, a
 * temporary directory, a teammate's own isolated checkout — is not a surface
 * this ledger governs.
 * @param targets - candidate paths exactly as the command spelled them.
 * @param cwd - the directory the command runs in.
 * @param workspace - the claim space the ledger governs.
 * @returns normalized workspace-relative scopes, deduplicated.
 */
export function targetScopes(targets: readonly string[], cwd: string, workspace: string): string[] {
  const scopes = new Set<string>()
  for (const target of targets) {
    // A glob cannot be resolved, but the literal directory above it can.
    const literal = target.includes('*') || target.includes('?')
      ? target.slice(0, Math.min(...[target.indexOf('*'), target.indexOf('?')].filter(at => at >= 0))).replace(/[^/\\]*$/u, '')
      : target
    if (literal === '') continue
    const absolute = resolve(cwd, literal)
    const within = relative(workspace, absolute)
    if (within === '' || within.startsWith('..') || isAbsolute(within)) continue
    const scope = normalizeScope(within)
    if (scope !== null) scopes.add(scope)
  }
  return [...scopes]
}

/** The shell tool vocabulary this guard reads. */
function shellCall(exec: ToolExecutionInput): ShellCall | undefined {
  const args = exec.arguments
  if (typeof args !== 'object' || args === null) return undefined
  if ((exec.name === 'bash' || exec.name === 'pwsh') && 'command' in args && typeof args.command === 'string') {
    const workdir = 'workdir' in args && typeof args.workdir === 'string' ? args.workdir : undefined
    return {
      command: args.command,
      dialect: exec.name === 'pwsh' ? 'powershell' : 'posix',
      ...workdir === undefined ? {} : { workdir },
    }
  }
  if (exec.name === 'terminal_send' && 'text' in args && typeof args.text === 'string') {
    // A terminal carries whichever shell the session opened; read it in both
    // vocabularies rather than guess, since a missed write is the costly error.
    return { command: args.text, dialect: process.platform === 'win32' ? 'powershell' : 'posix' }
  }
  return undefined
}

/**
 * The refusal, written for the model that has to react to it: what it was
 * about to change, who owns it, and what to do instead.
 */
function renderDenial(toolName: string, paths: readonly string[], conflicts: readonly ScopeConflict[]): string {
  return [
    `${toolName} DENIED: another session holds an active workspace claim. No command was run.`,
    `Blocked paths: ${paths.join(', ')}.`,
    ...conflicts.map(conflict =>
      `"${conflict.scopes.join(', ')}" is held by ${conflict.holder} (lane ${conflict.lane}, claim ${conflict.claimId}, ${Math.ceil(conflict.remainingMs / 60_000)} min left).`),
    'Ask the holder to release the claim, choose a different scope, or wait for the lease to expire. A shell command is not a way around a claim.',
  ].join('\n')
}

/**
 * Mount the shell half of the write guard.
 *
 * @param ctx - claims plugin context, owning the reversible listener.
 * @param store - shared cross-process claim ledger.
 */
export function installShellGuard(ctx: Context, store: ClaimStore): void {
  ctx.on('tools/execute', async (exec, next) => {
    const call = shellCall(exec)
    const session = exec.agent?.session
    const cwd = session?.header.cwd
    if (call === undefined || session === undefined || cwd === undefined || cwd === '') return await next()
    const targets = shellWriteTargets(call.command, call.dialect)
    if (targets.length === 0) return await next()

    exec.signal.throwIfAborted()
    const workspace = await claimWorkspace(cwd)
    const scopes = targetScopes(targets, call.workdir === undefined ? cwd : resolve(cwd, call.workdir), workspace)
    if (scopes.length === 0) return await next()

    const now = Date.now()
    const ledger = expireClaims(await store.read(workspace), now).ledger
    const peers = ledger.claims.filter(claim => claim.sessionId !== session.id)
    const conflicts = findConflicts(peers, scopes, now)
    if (conflicts.length > 0) {
      const blocked = scopes.filter(scope =>
        conflicts.some(conflict => conflict.scopes.some(owned => scope === owned || scope.startsWith(`${owned}/`) || owned.startsWith(`${scope}/`) || owned === '.')))
      throw new Error(renderDenial(exec.name, blocked, conflicts))
    }
    exec.signal.throwIfAborted()
    return await next()
  })
}
