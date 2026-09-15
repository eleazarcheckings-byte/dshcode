/** Isolated git stages, scoped files, and allowlisted validation over managed process trees. */
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, open, realpath, rename, rm } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { z } from 'zod'
import type { BotTool, BotToolContext } from '../contracts.ts'
import type { BotStage } from '../types.ts'
import type { BotToolOptions } from '../tools.ts'
import { ActionRequiredError, MAX_ADAPTER_BYTES, redact, tool } from './shared.ts'

const localRoles = ['developer'] as const
const readRoles = ['orchestrator', 'developer', 'operations'] as const
const protectedPath = /(?:^|[\\/])(?:\.git|\.env(?:\.[^\\/]*)?|\.ssh|\.aws)(?:[\\/]|$)/iu

function identity(context: BotToolContext): string {
  return createHash('sha256').update(`${context.cycleId}:${context.branchId}`).digest('hex').slice(0, 24)
}

/** Predict the only worktree directory this branch may mutate.
 * @param options - Host data directory.
 * @param context - Current cycle and branch identity.
 * @returns absolute managed stage directory.
 */
export function stagePath(options: BotToolOptions, context: BotToolContext): string {
  return resolve(options.dataDirectory, 'worktrees', identity(context))
}

async function childEnvironment(options: BotToolOptions): Promise<NodeJS.ProcessEnv> {
  const source = options.environment ?? process.env
  const env: NodeJS.ProcessEnv = Object.fromEntries(Object.keys({ ...process.env, ...source }).map(key => [key, undefined]))
  for (const [key, value] of Object.entries(source)) {
    if (/^(?:PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|TMPDIR|LANG|LC_[A-Z_]+)$/iu.test(key)) env[key] = value
  }
  const home = resolve(options.dataDirectory, 'process-home')
  await mkdir(home, { recursive: true })
  Object.assign(env, { HOME: home, USERPROFILE: home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(home, 'gitconfig'), GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' })
  return env
}

/** Run an exact executable/argv under the existing managed process service.
 * @param options - Process service and environment dependency.
 * @param context - Tool cancellation and configured deadline.
 * @param cwd - Verified working directory.
 * @param argv - Trusted executable and arguments, never shell-interpreted.
 * @param extraEnv - Explicit narrowly scoped publication authentication.
 * @returns bounded redacted output and the actual exit code.
 */
export async function runProcess(
  options: BotToolOptions, context: BotToolContext, cwd: string, argv: readonly string[], extraEnv: NodeJS.ProcessEnv = {},
): Promise<{ code: number | null; stdout: string; stderr: string; truncated: boolean }> {
  const env = { ...await childEnvironment(options), ...extraEnv }
  const timeout = AbortSignal.timeout(context.config.toolTimeoutMs)
  const signal = AbortSignal.any([context.signal, timeout])
  const lookupEnvironment = Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined))
  const [command, ...args] = argv
  if (command === undefined || command === '') throw new Error('A process command must name an executable.')
  const executable = await options.subprocess.resolveExecutable(command, lookupEnvironment, signal)
  signal.throwIfAborted()
  const handle = options.subprocess.spawn({
    argv: [executable, ...args], cwd, env, signal,
    stdio: { stdin: 'ignore', stdout: { maxBytes: MAX_ADAPTER_BYTES }, stderr: { maxBytes: MAX_ADAPTER_BYTES } },
    graceMs: Math.min(context.config.toolTimeoutMs, 1000),
  })
  try {
    const outcome = await handle.done
    signal.throwIfAborted()
    const { stdout: stdoutCollector, stderr: stderrCollector } = handle.collected
    if (stdoutCollector === undefined || stderrCollector === undefined) throw new Error('Managed process output collectors are missing.')
    const stdout = stdoutCollector.readFrom(0)
    const stderr = stderrCollector.readFrom(0)
    return {
      code: outcome.exitCode, stdout: redact(stdout.text, options, context), stderr: redact(stderr.text, options, context),
      truncated: stdout.lossy || stderr.lossy,
    }
  } finally {
    handle.terminate()
    await handle.waitForExit()
  }
}

/** Execute a Git builtin with credential helpers, hooks, signing, and external diffs disabled.
 * @param options - Process dependency.
 * @param context - Current admitted invocation.
 * @param cwd - Repository directory.
 * @param args - Fixed Git builtin and arguments.
 * @param extraEnv - Explicit authentication used only by approved push.
 * @returns bounded stdout, rejecting failed or truncated identity-producing commands.
 */
export async function git(
  options: BotToolOptions, context: BotToolContext, cwd: string, args: string[], extraEnv: NodeJS.ProcessEnv = {},
): Promise<string> {
  const hooks = resolve(options.dataDirectory, 'empty-hooks')
  await mkdir(hooks, { recursive: true })
  const result = await runProcess(options, context, cwd, [
    'git', '-c', `core.hooksPath=${hooks}`, '-c', 'core.fsmonitor=false', '-c', 'credential.helper=',
    '-c', 'commit.gpgSign=false', '-c', 'tag.gpgSign=false', '-c', 'http.followRedirects=false',
    '-c', 'user.name=SaturnBot', '-c', 'user.email=saturnbot@localhost', ...args,
  ], extraEnv)
  if (result.code !== 0) throw new Error(`Git ${args[0]} failed (${result.code}): ${result.stderr}`)
  if (result.truncated) throw new Error('Git output exceeded the permitted size.')
  return result.stdout.trim()
}

/** Verify stage ownership, exact committed revision, and absence of unreviewed changes.
 * @param options - Managed data directory and process service.
 * @param context - Engine-bound stage revision.
 * @returns canonical stage path after all publication preconditions hold.
 */
export async function verifyStage(options: BotToolOptions, context: BotToolContext): Promise<string> {
  if (context.stage === null) throw new ActionRequiredError('Create an isolated workspace stage first.')
  const expected = stagePath(options, context)
  if ((await lstat(expected)).isSymbolicLink()) throw new Error('Managed stage cannot be a symlink.')
  const actual = await realpath(context.stage.path)
  if (actual !== await realpath(expected)) throw new Error('Stage does not belong to this task.')
  if (await git(options, context, actual, ['rev-parse', 'HEAD']) !== context.stage.revision) throw new Error('Stage revision changed after it was reviewed.')
  if (await git(options, context, actual, ['status', '--porcelain', '--untracked-files=all']) !== '') throw new Error('Stage contains uncommitted changes; it cannot be validated or published.')
  return actual
}

async function scopedPath(root: string, input: string, createParents = false): Promise<string> {
  if (isAbsolute(input) || /[\0\r\n:]/u.test(input) || protectedPath.test(input)) throw new Error('This file path is not permitted.')
  const canonical = await realpath(root)
  const target = resolve(canonical, input)
  const rel = relative(canonical, target)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('File path must stay inside the task workspace.')
  const parts = rel.split(sep)
  if (process.platform === 'win32' && parts.some(part => /[. ]$/u.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part))) throw new Error('Windows device names and normalized path aliases are not permitted.')
  let current = canonical
  for (const [index, part] of parts.entries()) {
    current = join(current, part)
    let info
    try { info = await lstat(current) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      if (index < parts.length - 1 && createParents) { await mkdir(current); info = await lstat(current) }
      else if (index < parts.length - 1) throw error
    }
    if (info?.isSymbolicLink()) throw new Error('Symlink paths are not permitted in task file operations.')
  }
  return target
}

/** Build local tools whose file writes target managed task worktrees.
 * @param options - Host process service and managed artifact directory.
 * @returns trusted tool definitions for the central engine.
 */
export function createLocalTools(options: BotToolOptions): BotTool[] {
  return [
    tool({ name: 'git.status', description: 'Read the configured repository working state.', roles: readRoles, effect: 'read', retry: 'safe', evaluationInput: {} }, {}, async (_, context) => {
      const path = context.stage?.path ?? context.config.workspace
      const status = await git(options, context, await realpath(path), ['status', '--short', '--branch'])
      return { summary: status || 'Working tree is clean.', data: { status } }
    }),
    tool({ name: 'git.diff', description: 'Read the current unstaged and staged repository diff.', roles: readRoles, effect: 'read', retry: 'safe' }, {}, async (_, context) => {
      const root = await realpath(context.stage?.path ?? context.config.workspace)
      const diff = await git(options, context, root, ['diff', 'HEAD', '--no-ext-diff', '--no-textconv', '--'])
      return { summary: diff ? 'Repository diff captured.' : 'No uncommitted diff.', data: { diff } }
    }),
    tool({ name: 'workspace.stage', description: 'Create an isolated task worktree from the committed repository HEAD.', roles: localRoles, effect: 'stage', retry: 'idempotent' }, {}, async (_, context) => {
      const workspace = await realpath(context.config.workspace)
      const path = stagePath(options, context)
      await mkdir(dirname(path), { recursive: true })
      const revision = await git(options, context, workspace, ['rev-parse', 'HEAD'])
      try {
        await lstat(path)
        const existing: BotStage = { path, revision: await git(options, context, path, ['rev-parse', 'HEAD']) }
        await verifyStage(options, { ...context, stage: existing })
        return { summary: 'Existing isolated task workspace is ready.', stage: existing }
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      try {
        await git(options, context, workspace, ['worktree', 'add', '--detach', path, revision])
        return { summary: 'Created isolated task workspace from committed HEAD.', stage: { path, revision } }
      } catch (error) {
        const cleanupContext = { ...context, signal: AbortSignal.timeout(context.config.toolTimeoutMs) }
        try { await git(options, cleanupContext, workspace, ['worktree', 'remove', '--force', path]) } catch { /* A failed worktree add may leave no registered worktree to remove. */ }
        throw error
      }
    }),
    tool({ name: 'fs.read', description: 'Read a bounded UTF-8 source file inside the task workspace.', roles: readRoles, effect: 'read', retry: 'safe' }, { path: z.string().min(1).max(1024) }, async ({ path }, context) => {
      const target = await scopedPath(context.stage?.path ?? context.config.workspace, path)
      const file = await open(target, 'r')
      try {
        const stat = await file.stat()
        if (!stat.isFile() || stat.size > MAX_ADAPTER_BYTES) throw new Error('Only bounded regular text files can be read.')
        const buffer = Buffer.alloc(MAX_ADAPTER_BYTES + 1)
        const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
        if (bytesRead > MAX_ADAPTER_BYTES) throw new Error('File grew beyond the permitted read size.')
        return { summary: `Read ${path}.`, data: { path, text: redact(buffer.subarray(0, bytesRead).toString('utf8'), options, context) } }
      } finally { await file.close() }
    }),
    tool({ name: 'fs.write', description: 'Write one file only in the isolated worktree and commit its exact revision.', roles: localRoles, effect: 'stage', retry: 'never' }, { path: z.string().min(1).max(1024), text: z.string().max(MAX_ADAPTER_BYTES).refine(value => Buffer.byteLength(value) <= MAX_ADAPTER_BYTES, 'File exceeds permitted UTF-8 byte size') }, async ({ path, text }, context) => {
      const root = await verifyStage(options, context)
      const target = await scopedPath(root, path, true)
      const temporary = join(dirname(target), `.saturn-write-${randomUUID()}`)
      const file = await open(temporary, 'wx', 0o600)
      try {
        await file.writeFile(text, 'utf8')
        await file.close()
        context.signal.throwIfAborted()
        await rename(temporary, target)
      } finally { await file.close(); await rm(temporary, { force: true }) }
      await git(options, context, root, ['add', '--', path])
      const changed = await git(options, context, root, ['diff', '--cached', '--name-only'])
      if (changed) await git(options, context, root, ['commit', '-m', `SaturnBot: update ${path}`])
      const revision = await git(options, context, root, ['rev-parse', 'HEAD'])
      return { summary: `Saved ${path} in the isolated task workspace.`, stage: { path: root, revision }, data: { path } }
    }),
    tool({ name: 'shell.validate', description: 'Run only the exact configured validation argv arrays against the current stage.', roles: localRoles, effect: 'validate', retry: 'safe' }, {}, async (_, context) => {
      if (context.config.validationCommands.length === 0) throw new ActionRequiredError('Configure at least one validation command before publishing code.')
      const stage = context.stage
      if (stage === null) throw new ActionRequiredError('Create an isolated workspace stage first.')
      const root = await verifyStage(options, context)
      const results = []
      for (const argv of context.config.validationCommands) {
        if (argv.length === 0 || !argv[0]) throw new Error('Validation command must name an executable.')
        const result = await runProcess(options, context, root, argv)
        results.push({ command: argv, ...result })
        if (result.code !== 0) throw new Error(`Validation failed (${result.code}): ${result.stderr || result.stdout}`)
      }
      await verifyStage(options, context)
      return { summary: `${results.length} configured validation checks passed.`, validatedRevision: stage.revision, data: { checks: results } }
    }),
  ]
}
