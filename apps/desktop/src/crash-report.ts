/**
 * Reviewable crash evidence for the desktop shell.
 *
 * Two complementary mechanisms live here, and they catch different things:
 *
 * 1. **In-process capture** (fed by `crash-monitor.ts`) records the failures a
 *    live process can still observe: an uncaught exception, a fatal unhandled
 *    rejection, a dead renderer/GPU/utility child, a failed page load. Nothing
 *    here can record a hard death, because at that instant no process is left
 *    to run a handler.
 * 2. **The run tombstone**: `current-run.json` says this run is live from the
 *    first millisecond of a launch, carries a heartbeat while the shell serves
 *    a window, and is stamped `clean` only on a graceful exit. The next launch
 *    reads it. Still `starting`/`ready` with no clean stamp means the previous
 *    run was killed by something the process never got to handle
 *    (`TerminateProcess`, `taskkill /F`, an OS access violation, an OOM kill, a
 *    power loss), and the tombstone is the only mechanism that can report those
 *    deaths at all.
 *
 * Everything written here is bounded, redacted, and defensive: a diagnostics
 * writer that can throw, block the shell, or grow without limit is a worse bug
 * than the crashes it describes. Reports are pretty-printed JSON so they can be
 * read in any editor; nothing here needs special tooling to interpret.
 *
 * @module crash-report
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { readdir, stat, unlink } from 'node:fs/promises'
import { basename, join, relative } from 'node:path'

/** Schema tag written into every report. */
export const CRASH_REPORT_SCHEMA = 'saturnai.crash-report/1'

/** Schema tag written into the run tombstone. */
export const RUN_TOMBSTONE_SCHEMA = 'saturnai.run-tombstone/1'

/** Schema tag written into the crash index. */
export const CRASH_INDEX_SCHEMA = 'saturnai.crash-index/1'

/**
 * Schema tag written into the intentional-stop marker.
 *
 * A relauncher writes this *before* it stops a live run, so the next launch can
 * tell a deliberate restart from a real hard death. Without it, a build loop
 * that restarts the app on every reload fills the index with false fatals and
 * hides the genuine ones.
 */
export const INTENTIONAL_STOP_SCHEMA = 'saturnai.intentional-stop/1'

/** Directory under the Harness home holding every crash artifact. */
export const CRASHES_DIR_NAME = 'crashes'

/** The live-run tombstone filename. */
export const RUN_TOMBSTONE_FILENAME = 'current-run.json'

/**
 * The intentional-stop marker filename, beside the tombstone under the crash
 * directory. Its presence, for one launch, means a relauncher declared that it
 * was about to stop the run named inside it.
 */
export const INTENTIONAL_STOP_FILENAME = 'intentional-stop.json'

/** The index and summary filename. */
export const CRASH_INDEX_FILENAME = 'index.json'

/** Human-readable digest of the newest report. */
export const LATEST_SUMMARY_FILENAME = 'latest.txt'

/** Orientation note written into the crash directory on first use. */
export const CRASHES_README_FILENAME = 'README.txt'

/** Directory holding native (crashpad) minidumps, when any exist. */
export const CRASH_DUMPS_DIR_NAME = 'dumps'

/** Filename prefix of one report file. */
export const REPORT_FILE_PREFIX = 'crash-'

/** How many report files are kept; older ones are deleted at write and launch. */
export const MAX_CRASH_REPORT_FILES = 25

/** How many report summaries the index keeps. */
export const MAX_CRASH_INDEX_ENTRIES = 50

/** How many minidumps are kept. */
export const MAX_CRASH_DUMP_FILES = 10

/** Reports and dumps older than this are deleted. */
export const CRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

/** How many recent boot-failure records are folded into a report. */
export const MAX_BOOT_FAILURE_SUMMARIES = 5

/**
 * The installer package count the installed tree is expected to hold (mirrors
 * `scripts/check-installed-app.ps1`). Override with the
 * `DSH_EXPECTED_PACKAGE_COUNT` environment variable if that set ever changes.
 */
export const DEFAULT_EXPECTED_DSH_PACKAGE_COUNT = 231

/** Cap on a recorded failure message. */
export const MAX_FAILURE_MESSAGE = 4_000

/** Cap on a recorded failure stack. */
export const MAX_FAILURE_STACK = 16_000

/** Cap on one short textual field (summary, note, argument). */
export const MAX_REPORT_FIELD = 600

/** Cap on the redacted launch argument list. */
export const MAX_ARGV_ENTRIES = 24

/**
 * How often the monitor refreshes the run heartbeat.
 *
 * This interval is the width of the death window: the last heartbeat is the
 * lower bound on when a hard-killed run died, so it must be short enough to
 * bound the death to a useful interval. One small atomic file write per
 * interval is free next to the work the run is doing, and the heartbeat is
 * wrapped so a failed write is simply a stale heartbeat, never an error path.
 */
export const RUN_HEARTBEAT_INTERVAL_MS = 20_000

/** How a death was observed. */
export type CrashClass =
  /** The previous run stopped without a clean exit (hard kill, OOM, power loss). */
  | 'dirty-shutdown'
  /**
   * The previous run was stopped on purpose by a relauncher that declared the
   * intent first. Recorded as a warning, never as a death: it is a controlled
   * event, not a fault.
   */
  | 'intentional-stop'
  /** The boot sequence failed and the shell deliberately exited. */
  | 'boot-failure'
  /** An uncaught exception in the main process. */
  | 'uncaught-exception'
  /** A fatal (pre-readiness) unhandled rejection in the main process. */
  | 'unhandled-rejection'
  /** A renderer process died. */
  | 'renderer-crash'
  /** A GPU, utility, or helper child process died. */
  | 'child-process-gone'
  /** The application page failed to load. */
  | 'load-failure'
  /** The renderer stopped answering (a black screen in progress). */
  | 'renderer-unresponsive'

/** How much the shell should care about a class. */
export type CrashSeverity = 'fatal' | 'error' | 'warning'

/** Lifecycle phase of one launch. */
export type RunPhase = 'starting' | 'ready' | 'reported' | 'clean'

/** How a launch was invoked. */
export type LaunchMode = 'packaged' | 'dev' | 'diagnostic'

/** Severity for each class: only `fatal` marks a run that ended unexpectedly. */
const SEVERITY_BY_CLASS: Record<CrashClass, CrashSeverity> = {
  'dirty-shutdown': 'fatal',
  // A declared stop is a controlled event: it ends the run, but nothing went
  // wrong. It must never count toward the fatal streak, or a build loop's
  // routine restarts would read as a crash loop.
  'intentional-stop': 'warning',
  'boot-failure': 'fatal',
  // Electron answers an uncaught main-process exception with a native error
  // dialog and keeps the process alive, so it is a severe event rather than a
  // proven death; when the run does die, the next launch files the
  // dirty-shutdown report and names this one. Claiming fatal here would both
  // overstate the evidence and mask a later death in the same run.
  'uncaught-exception': 'error',
  // Before readiness the harness fail-loud guard treats an unhandled rejection
  // as fatal and exits, so the class default is a death. After readiness the
  // guard keeps the session alive, and that case is filed with an explicit
  // `error` override from the monitor so it is not counted as a death.
  'unhandled-rejection': 'fatal',
  'renderer-crash': 'error',
  'child-process-gone': 'error',
  'load-failure': 'error',
  'renderer-unresponsive': 'warning',
}

/** Build facts of the running application. */
export interface BuildFacts {
  /** Product name the shell reports. */
  productName: string
  /** Packaged application version. */
  appVersion: string
  /** Electron runtime version. */
  electron: string
  /** Chromium version. */
  chrome: string
  /** Node.js version embedded in the runtime. */
  node: string
  /** Absolute application directory (`resources/app` when packaged). */
  appPath: string
  /** sha256 of the main module actually executing (empty when unreadable). */
  mainModuleSha256: string
}

/** How the launch was invoked, with the switches that change what it means. */
export interface LaunchProfile {
  /** `dev` for an unpackaged run, `diagnostic` for a debug-port run, else `packaged`. */
  mode: LaunchMode
  /** Whether the run accepts an inspector or debugger connection. */
  debuggable: boolean
  /** `--remote-debugging-port` value, when the launch carried one. */
  remoteDebuggingPort?: number
  /** Whether the launch overrides the Electron user-data directory. */
  userDataDirOverridden: boolean
  /** Redacted, bounded arguments worth keeping. */
  args: string[]
}

/** Install-tree facts, measured when a report is written. */
export interface InstallFacts {
  /** Absolute application directory the count was measured in. */
  appPath: string
  /** `@deepseek-ai` package directories present. */
  dshPackageCount: number
  /** Package count the installer is expected to produce. */
  expectedDshPackageCount: number
  /** Whether the count matches the installer invariant. */
  matchesExpected: boolean
  /** Package directories present with no manifest (resolve without a main). */
  packagesMissingManifest: number
  /** When the measurement was taken, not when the process died (ISO). */
  measuredAt: string
}

/** The most recently modified session log, read-only. */
export interface SessionFacts {
  /** Session id taken from the log filename. */
  sessionId: string
  /** Log path relative to the Harness home. */
  sessionFile: string
  /** Log size in bytes at report time. */
  sizeBytes: number
  /** Log mtime (ISO). */
  modifiedAt: string
  /** Log mtime on the local wall clock. */
  modifiedAtLocal: string
  /** How long before the report the log last moved. */
  staleForMs: number
}

/** Failure detail of one crash event. */
export interface CrashFailure {
  /** Error class name. */
  name: string
  /** Redacted, bounded message. */
  message: string
  /** Redacted, bounded stack. */
  stack: string
}

/** Which process died or misbehaved. */
export interface CrashProcessFacts {
  /** Process family. */
  type: 'main' | 'renderer' | 'gpu' | 'utility' | 'unknown'
  /** OS process id, when the event names one. */
  pid?: number
  /** Framework reason string (`crashed`, `oom`, `abnormal-exit`, ...). */
  reason?: string
  /** Exit code, when the event carries one. */
  exitCode?: number
  /** Framework child-process kind or service name. */
  kind?: string
}

/** The heartbeat record that proves a run was live, and how it ended. */
export interface RunTombstone {
  /** Schema tag. */
  schema: typeof RUN_TOMBSTONE_SCHEMA
  /** Identifier of this launch. */
  runId: string
  /** 1-based launch ordinal for this installation. */
  ordinal: number
  /** Main-process id. */
  pid: number
  /** Launch time (ISO). */
  startedAt: string
  /** Last heartbeat (ISO): the lower bound of the death window. */
  lastAliveAt: string
  /** Current phase of the launch. */
  phase: RunPhase
  /** Boot marker state carried over from the previous launch. */
  bootMarkerState?: 'started' | 'ok'
  /** Consecutive non-ok boot attempts, from the previous marker. */
  bootAttempts?: number
  /** Session logs present at launch, for context. */
  sessionsOnDisk?: number
  /** How many windows this run showed (0 means it never got that far). */
  windowsShown: number
  /** How the run was launched. */
  launch: LaunchProfile
  /** Build fingerprint of the run. */
  build: BuildFacts
  /** Report id of a death this run recorded itself. */
  deathReportId?: string
  /** Class of the death this run recorded itself. */
  deathClass?: CrashClass
  /** Exit code, once the run exited. */
  exitCode?: number
  /**
   * When the run ran Node's exit hook (ISO). Present means the process reached
   * its own exit path — an OOM kill, an access violation, or a TerminateProcess
   * never gets here, so this is what separates a soft exit from a hard one.
   */
  exitedAt?: string
  /** Graceful-exit time (ISO). */
  cleanedAt?: string
}

/**
 * A relauncher's declaration that it is about to stop the live run on purpose.
 *
 * Written before the stop, consumed by the next launch, and single-use. It names
 * the run it authorizes, so it cannot excuse a different run's death, and it
 * carries the time it was declared, so a marker the run outlived is treated as
 * stale and ignored.
 */
export interface IntentionalStopMarker {
  /** Schema tag. */
  schema: typeof INTENTIONAL_STOP_SCHEMA
  /** When the intent was declared (ISO). */
  requestedAt: string
  /** The live run (`current-run.json` `runId`) this marker authorizes stopping. */
  runId: string
  /** Main-process id of that run, when the writer knew it. */
  pid?: number
  /** What declared the intent: a script, a task, an operator. */
  requestedBy?: string
  /** Why the run is being stopped. */
  reason?: string
}

/** One line in the crash index. */
export interface CrashIndexEntry {
  /** Report id (also the filename stem). */
  id: string
  /** Failure class. */
  class: CrashClass
  /** Severity derived from the class. */
  severity: CrashSeverity
  /** Detection time (ISO). */
  detectedAt: string
  /** Best-known death time (ISO), absent when the process died silently. */
  deathAt?: string
  /** Launch identifier the death belongs to. */
  runId: string
  /** Main-process id, when known. */
  pid?: number
  /** Report filename. */
  file: string
  /** One-line summary. */
  summary: string
}

/** The durable summary beside the reports: counters plus the newest entries. */
export interface CrashIndex {
  /** Schema tag. */
  schema: typeof CRASH_INDEX_SCHEMA
  /** Last index update (ISO). */
  updatedAt: string
  /** Launches observed by this mechanism. */
  runsSeen: number
  /** Launches that ended through the shell graceful quit path. */
  cleanExits: number
  /** Runs that ended unexpectedly (severity fatal). */
  unexpectedDeaths: number
  /** Unexpected deaths since the last clean exit: a crash loop when high. */
  consecutiveUnexpectedDeaths: number
  /** Total run count at the last unexpected death. */
  ordinalAtLastUnexpectedDeath: number
  /** Consecutive reports of the same class. */
  sameClassStreak: number
  /**
   * Runs that ended because a relauncher declared the stop on purpose. Kept
   * separate from `cleanExits`: no quit path ran, but nothing failed either.
   */
  intentionalStops: number
  /** Most recent declared stop (ISO). */
  lastIntentionalStopAt?: string
  /** Most recent report id. */
  lastReportId?: string
  /** Most recent report class. */
  lastReportClass?: CrashClass
  /** Most recent unexpected death (ISO). */
  lastUnexpectedDeathAt?: string
  /** Most recent clean exit (ISO). */
  lastCleanExitAt?: string
  /** Newest-first report summaries, capped at the report-file cap. */
  reports: CrashIndexEntry[]
}

/** A boot-failure record read from `boot-failures.json`, bounded. */
export interface BootFailureSummary {
  /** Failure kind the installer recorded. */
  kind: string
  /** Plugin the installer blamed, empty when unattributable. */
  pluginId: string
  /** Redacted, bounded message. */
  message: string
  /** When it was recorded (ISO). */
  at: string
}

/** The death-window facts of a report. */
export interface CrashDeath {
  /** `exact` when the dying process reported itself, `window` for a tombstone death. */
  certainty: 'exact' | 'window'
  /** Exact death time (ISO), for in-process events. */
  at?: string
  /** Lower bound of a tombstone death window (ISO): the last heartbeat. */
  windowFrom?: string
  /** Upper bound of a tombstone death window (ISO): the launch that found it. */
  windowTo?: string
  /** How long the run is known to have been alive. */
  aliveForMs: number
}

/** Rendering of the death window, with local wall-clock twins. */
export interface CrashDeathRendering {
  /** Whether the death instant is known exactly or only bounded. */
  certainty: 'exact' | 'window'
  /** Exact death time (ISO). */
  at?: string
  /** Exact death time on the local wall clock. */
  atLocal?: string
  /** Lower bound of the window (ISO). */
  windowFrom?: string
  /** Lower bound on the local wall clock. */
  windowFromLocal?: string
  /** Upper bound of the window (ISO). */
  windowTo?: string
  /** Upper bound on the local wall clock. */
  windowToLocal?: string
  /** How long the run was alive, in milliseconds. */
  aliveForMs: number
  /** Human rendering of the alive duration. */
  aliveForHuman: string
}

/** The repeat and correlation block. */
export interface CrashRepeat {
  /** Whether this is not the first report. */
  isRepeat: boolean
  /** Consecutive unexpected deaths, including this one. */
  consecutive: number
  /** Consecutive reports of the same class, including this one. */
  sameClassStreak: number
  /** Total unexpected deaths on record. */
  totalUnexpectedDeaths: number
  /** Completed runs since the previous unexpected death. */
  runsSinceLastUnexpectedDeath: number
  /** Previous report id, when there is one. */
  previousReportId?: string
  /** Previous report class, when there is one. */
  previousReportClass?: CrashClass
  /** Previous unexpected death (ISO), when there is one. */
  previousDeathAt?: string
}

/** One reviewable crash report. */
export interface CrashReport {
  /** Schema tag. */
  schema: typeof CRASH_REPORT_SCHEMA
  /** Report id, also the filename stem. */
  id: string
  /** Failure class. */
  class: CrashClass
  /** Severity derived from the class. */
  severity: CrashSeverity
  /** One-line description of what happened. */
  summary: string
  /** Detection time (ISO): when this report was written. */
  detectedAt: string
  /** Detection time on the local wall clock. */
  detectedAtLocal: string
  /** Local timezone offset rendered with the timestamps. */
  timezone: string
  /** The run this report describes. */
  run: CrashReportRun
  /** How the death was observed and when. */
  death: CrashDeathRendering
  /** Build fingerprint. */
  build: BuildFacts
  /** Install-tree parity, measured at report time. */
  install: InstallFacts
  /** The process the event is attributed to. */
  process: CrashProcessFacts
  /** How the run was launched. */
  launch: LaunchProfile
  /** Failure detail, when the event carried any. */
  failure?: CrashFailure
  /** The session log that was being written while the run was alive. */
  session?: SessionFacts
  /** Recent installer-recorded boot failures, read-only context. */
  recentBootFailures: BootFailureSummary[]
  /** Dump files created inside the dead run window. */
  dumps: string[]
  /** Repeat and correlation block. */
  repeat: CrashRepeat
  /** Honest notes about what the report can and cannot prove. */
  notes: string[]
  /** True when this report reconstructs a death that predates the instrument. */
  retroactive?: boolean
}

/** The run block of a report. */
export interface CrashReportRun {
  /** Launch identifier. */
  runId: string
  /** 1-based launch ordinal. */
  ordinal: number
  /** Main-process id. */
  pid: number
  /** Launch time (ISO). */
  startedAt: string
  /** Launch time on the local wall clock. */
  startedAtLocal: string
  /** Phase the run was in when it died. */
  phaseAtDeath: RunPhase
  /** How long the run lived, as far as the evidence reaches. */
  aliveForMs: number
  /** Human rendering of the alive duration. */
  aliveForHuman: string
  /** Boot marker state observed at the next launch. */
  bootMarkerState?: 'started' | 'ok'
  /** Consecutive non-ok boot attempts. */
  bootAttempts?: number
  /** Whether the run reached its own exit path before dying (ISO). */
  exitedAt?: string
  /** Local rendering of `exitedAt`. */
  exitedAtLocal?: string
  /** Exit code the run reported on its own exit path. */
  exitCode?: number
  /** Whether the run ever showed a window. */
  windowsShown: number
}

/** Everything the report builder needs, gathered by the monitor. */
export interface CrashReportInput {
  /** Failure class. */
  crashClass: CrashClass
  /** One-line description. */
  summary: string
  /** Detection instant. */
  detectedAt: Date
  /** The run the report is about. */
  tombstone: RunTombstone
  /** The process the event is attributed to. */
  process: CrashProcessFacts
  /** Install facts, measured now. */
  install: InstallFacts
  /** Index state before this report. */
  index: CrashIndex
  /** Failure detail, when the event carried any. */
  failure?: CrashFailure
  /** Session log snapshot, when readable. */
  session?: SessionFacts
  /** Recent boot failures, when readable. */
  recentBootFailures?: readonly BootFailureSummary[]
  /** Dumps created inside the run window. */
  dumps?: readonly string[]
  /** Death-window facts; defaults to an exact death at `detectedAt`. */
  death?: CrashDeath
  /**
   * Severity to record instead of the class default. Only for the rare event
   * that shares a class with a death but did not kill the run — an
   * `unhandled-rejection` after readiness, say. Severity is what decides
   * whether a report counts as an unexpected death in the index, so an
   * override must never be used to make a real death look survivable.
   */
  severityOverride?: CrashSeverity
  /** Extra honest notes. */
  notes?: readonly string[]
  /** Mark a reconstruction of a pre-instrument death. */
  retroactive?: boolean
}

/** What a launch should do about the previous one. */
export type PreviousRunOutcome =
  /** No tombstone and no unexplained boot marker: nothing to report. */
  | { kind: 'none' }
  /** The previous run exited through the graceful path. */
  | { kind: 'clean'; runId: string; ordinal: number; cleanedAt?: string }
  /** A relauncher declared the stop: the previous run ended on purpose. */
  | { kind: 'intentional'; runId: string; ordinal: number; stoppedAt?: string; requestedBy?: string; reason?: string }
  /** The previous run already reported its own death before exiting. */
  | { kind: 'recorded'; runId: string; ordinal: number; reportId: string; deathClass: CrashClass }
  /** The previous run died without a chance to report; write the report. */
  | { kind: 'unreported'; runId: string; ordinal: number; deathClass: CrashClass; retroactive: boolean }

/** Launch inputs captured once, at start. */
export interface RunStartInput {
  /** Build fingerprint. */
  build: BuildFacts
  /** Launch profile. */
  launch: LaunchProfile
  /** Previous boot marker state, when present. */
  bootMarkerState?: 'started' | 'ok'
  /** Consecutive non-ok boot attempts. */
  bootAttempts?: number
  /** Session logs present at launch, for context. */
  sessionsOnDisk: number
  /** Injectable clock for tests. */
  now?: Date
}

/** The state a launch begins from. */
export interface RunStart {
  /** The previous run tombstone, when one was readable. */
  previous?: RunTombstone
  /** This run tombstone, as persisted. */
  tombstone: RunTombstone
  /** The index as read before anything was written. */
  index: CrashIndex
}

/** Resolve the crash directory under a Harness home. */
export function crashesDir(home: string): string {
  return join(home, CRASHES_DIR_NAME)
}

/** Resolve the minidump directory under a Harness home. */
export function dumpsDir(home: string): string {
  return join(home, CRASHES_DIR_NAME, CRASH_DUMPS_DIR_NAME)
}

/** Resolve the run tombstone path under a Harness home. */
export function runTombstonePath(home: string): string {
  return join(crashesDir(home), RUN_TOMBSTONE_FILENAME)
}

/** Resolve the intentional-stop marker path under a Harness home. */
export function intentionalStopPath(home: string): string {
  return join(crashesDir(home), INTENTIONAL_STOP_FILENAME)
}

/** Resolve the index path under a Harness home. */
export function crashIndexPath(home: string): string {
  return join(crashesDir(home), CRASH_INDEX_FILENAME)
}

/** Resolve one report path from its id. */
export function crashReportPath(home: string, id: string): string {
  return join(crashesDir(home), `${id}.json`)
}

/** Pad a number to two digits. */
function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/** The local timezone offset label, for example -04:00. */
export function timezoneLabel(when: Date): string {
  const offsetMinutes = -when.getTimezoneOffset()
  const sign = offsetMinutes < 0 ? '-' : '+'
  const absolute = Math.abs(offsetMinutes)
  return `${sign}${pad2(Math.floor(absolute / 60))}:${pad2(absolute % 60)}`
}

/** Render an ISO instant on the local wall clock, with its offset. */
export function localTime(iso: string): string {
  const when = new Date(iso)
  if (Number.isNaN(when.getTime())) return ''
  return `${when.getFullYear()}-${pad2(when.getMonth() + 1)}-${pad2(when.getDate())} `
    + `${pad2(when.getHours())}:${pad2(when.getMinutes())}:${pad2(when.getSeconds())} ${timezoneLabel(when)}`
}

/** Human rendering of a duration in milliseconds. */
export function humanDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return 'unknown'
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${String(hours)}h ${pad2(minutes)}m ${pad2(seconds)}s`
  if (minutes > 0) return `${String(minutes)}m ${pad2(seconds)}s`
  return `${String(seconds)}s`
}

/** A compact UTC stamp suitable for a filename: 20260914T104101Z. */
export function compactStamp(when: Date): string {
  return when.toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z')
}

/** A short random suffix for ids that must not collide. */
function randomSuffix(): string {
  return Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0')
}

/** Build a report id: crash-UTC-pid-rand. */
export function newReportId(when: Date, pid: number): string {
  return `${REPORT_FILE_PREFIX}${compactStamp(when)}-${String(pid)}-${randomSuffix()}`
}

/** Build a run id: UTC-pid-rand. */
export function newRunId(when: Date, pid: number): string {
  return `${compactStamp(when)}-${String(pid)}-${randomSuffix()}`
}

/**
 * Remove anything that looks like a credential from text that came out of the
 * process. Reports carry paths and message fragments, never an environment
 * dump, but a stack or an argument can still quote a key, so scrub before
 * truncating.
 * @param text - raw text.
 * @returns the redacted text.
 */
export function redactText(text: string): string {
  return text
    .replace(/\bsk-[A-Za-z0-9_-]{6,}/gu, 'sk-***')
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/-]{6,}=*/gu, '$1 ***')
    .replace(/([?&](?:access_token|api_key|apikey|token|key|secret|password)=)[^&\s\x22\x27]+/giu, '$1***')
    .replace(/((?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token|token|secret|password|passwd|authorization)\s*[:=]\s*[\x22\x27]?)[^\s\x22\x27,;]{4,}/giu, '$1***')
    .replace(/\b([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)[A-Z0-9_]*)=[^\s\x22\x27]+/gu, '$1=***')
    .replace(/:\/\/[^/@\s]+:[^/@\s]+@/gu, '://***@')
}

/** Redact and bound one textual field. */
function scrub(text: string, max: number): string {
  const redacted = redactText(text)
  return redacted.length <= max ? redacted : `${redacted.slice(0, max)}...[truncated]`
}

/** Argument switches that are worth naming in a report. */
const NAMED_SWITCHES = [
  '--no-sandbox',
  '--disable-gpu',
  '--disable-gpu-compositing',
  '--in-process-gpu',
  '--single-process',
  '--disable-software-rasterizer',
  '--enable-logging',
  '--safe-mode',
] as const

/**
 * Classify how this process was launched, keeping only the switches that change
 * what a crash means. A debug-port run is an operator diagnostic session and
 * must never be conflated with a real crash; a dev run is the unpackaged tree.
 * @param argv - the process argument vector captured at start.
 * @param isPackaged - whether the running shell is a packaged application.
 * @returns the launch profile.
 */
export function classifyLaunch(argv: readonly string[], isPackaged: boolean): LaunchProfile {
  const portArg = argv.find(arg => arg.startsWith('--remote-debugging-port'))
  const portMatch = /^--remote-debugging-port(?:=(\d+))?$/u.exec(portArg ?? '')
  const port = portMatch?.[1] === undefined ? undefined : Number.parseInt(portMatch[1], 10)
  const inspector = argv.some(arg => arg === '--inspect' || arg === '--inspect-brk'
    || arg.startsWith('--inspect=') || arg.startsWith('--inspect-brk=') || arg.startsWith('--inspect-port='))
  const debuggable = port !== undefined || inspector
  const args = argv
    .filter((arg) => {
      if (arg.startsWith('--user-data-dir')) return true
      if (arg.startsWith('--remote-debugging-port') || arg.startsWith('--inspect')) return true
      return NAMED_SWITCHES.some(sw => arg === sw || arg.startsWith(`${sw}=`))
    })
    .slice(0, MAX_ARGV_ENTRIES)
    .map(arg => scrub(arg, MAX_REPORT_FIELD))
  return {
    mode: !isPackaged ? 'dev' : debuggable ? 'diagnostic' : 'packaged',
    debuggable,
    ...port === undefined ? {} : { remoteDebuggingPort: port },
    userDataDirOverridden: argv.some(arg => arg.startsWith('--user-data-dir')),
    args,
  }
}

/**
 * Fingerprint a file with sha256, degrading to an empty string when it cannot
 * be read: a build fingerprint that never throws is more useful than an exact
 * one that can.
 * @param path - file to hash.
 * @returns the hex digest, or an empty string.
 */
export function fileSha256(path: string): string {
  try {
    return createHash('sha256').update(readFileSync(path)).digest('hex')
  } catch {
    return ''
  }
}

/**
 * Measure the installed dependency tree against the installer invariant. Runs
 * only when a report is written, never on the launch path: it is a directory
 * scan, and the shell must not pay for diagnostics it may never need.
 * @param appPath - absolute application directory.
 * @param expected - expected package count.
 * @returns the measured facts.
 */
export function readInstallFacts(appPath: string, expected: number): InstallFacts {
  let dshPackageCount = 0
  let packagesMissingManifest = 0
  try {
    const scope = join(appPath, 'node_modules', '@deepseek-ai')
    for (const entry of readdirSync(scope, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      dshPackageCount += 1
      if (!existsSync(join(scope, entry.name, 'package.json'))) packagesMissingManifest += 1
    }
  } catch {
    // A missing scope directory is itself the answer: zero packages, mismatch.
  }
  const expectedCount = Number.isInteger(expected) && expected > 0 ? expected : DEFAULT_EXPECTED_DSH_PACKAGE_COUNT
  return {
    appPath,
    dshPackageCount,
    expectedDshPackageCount: expectedCount,
    matchesExpected: dshPackageCount === expectedCount && packagesMissingManifest === 0,
    packagesMissingManifest,
    measuredAt: new Date().toISOString(),
  }
}

/**
 * Read the expected package count, honouring the environment override.
 * @param env - the environment to read.
 * @returns the expected package count.
 */
export function expectedPackageCountFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.DSH_EXPECTED_PACKAGE_COUNT
  if (raw === undefined || raw === '') return DEFAULT_EXPECTED_DSH_PACKAGE_COUNT
  const parsed = Number.parseInt(raw, 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_EXPECTED_DSH_PACKAGE_COUNT
}

/** List the session log files, without reading any of them. */
function sessionLogPaths(home: string): string[] {
  const paths: string[] = []
  try {
    const sessions = join(home, 'sessions')
    for (const group of readdirSync(sessions, { withFileTypes: true })) {
      if (!group.isDirectory()) continue
      const groupPath = join(sessions, group.name)
      try {
        for (const file of readdirSync(groupPath, { withFileTypes: true })) {
          if (file.isFile() && file.name.endsWith('.jsonl')) paths.push(join(groupPath, file.name))
        }
      } catch {
        // One unreadable group must not hide the rest.
      }
    }
  } catch {
    // No sessions directory yet.
  }
  return paths
}

/**
 * Count the session logs on disk, for the launch context.
 * @param home - the Harness home.
 * @returns the number of session logs.
 */
export function countSessionLogs(home: string): number {
  return sessionLogPaths(home).length
}

/**
 * Find the most recently modified session log. Strictly read-only: sessions are
 * the user work and the reporter only ever stats and names them.
 * @param home - the Harness home.
 * @param now - the reference instant.
 * @returns the snapshot, or undefined when no log is readable.
 */
export function readActiveSession(home: string, now: Date = new Date()): SessionFacts | undefined {
  let bestPath: string | undefined
  let bestMtime = 0
  for (const candidate of sessionLogPaths(home)) {
    try {
      const stat = statSync(candidate)
      if (stat.mtimeMs > bestMtime) {
        bestMtime = stat.mtimeMs
        bestPath = candidate
      }
    } catch {
      // Skip an unstatable entry.
    }
  }
  if (bestPath === undefined) return undefined
  const modifiedAt = new Date(bestMtime)
  return {
    sessionId: basename(bestPath).replace(/\.jsonl$/u, ''),
    sessionFile: relative(home, bestPath).replace(/\\/gu, '/'),
    sizeBytes: statSync(bestPath).size,
    modifiedAt: modifiedAt.toISOString(),
    modifiedAtLocal: localTime(modifiedAt.toISOString()),
    staleForMs: Math.max(0, now.getTime() - bestMtime),
  }
}

/**
 * List crashpad minidumps written inside a window. Only `*.dmp` files count:
 * crashpad keeps its own state (`settings.dat`) and spool directories in the
 * same folder, and reporting those as dumps would claim a native crash that
 * never happened. An empty list is itself evidence that the death was an
 * external kill, because crashpad writes nothing for a TerminateProcess.
 * @param home - the Harness home.
 * @param fromMs - window start (epoch milliseconds).
 * @param toMs - window end (epoch milliseconds).
 * @returns the dump filenames, newest first.
 */
export function listCrashDumps(home: string, fromMs: number, toMs: number): string[] {
  const found: { name: string; mtime: number }[] = []
  try {
    const dir = dumpsDir(home)
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile()) continue
      if (!entry.name.toLowerCase().endsWith('.dmp')) continue
      try {
        const stat = statSync(join(dir, entry.name))
        if (stat.mtimeMs >= fromMs && stat.mtimeMs <= toMs) found.push({ name: entry.name, mtime: stat.mtimeMs })
      } catch {
        // Skip an unstatable entry.
      }
    }
  } catch {
    // No dumps directory: no native crash was captured.
  }
  return found.sort((left, right) => right.mtime - left.mtime).map(entry => entry.name)
}

/**
 * Read the recent installer-recorded boot failures, read-only.
 * @param home - the Harness home.
 * @param max - how many records to keep.
 * @returns the summaries, newest first.
 */
export function readRecentBootFailures(home: string, max: number = MAX_BOOT_FAILURE_SUMMARIES): BootFailureSummary[] {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(home, 'boot-failures.json'), 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) return []
    const failures = (parsed as { failures?: unknown }).failures
    if (!Array.isArray(failures)) return []
    const summaries: BootFailureSummary[] = []
    for (const record of failures.slice(0, max)) {
      if (typeof record !== 'object' || record === null) continue
      const entry = record as Record<string, unknown>
      summaries.push({
        kind: typeof entry.kind === 'string' ? entry.kind : 'unknown',
        pluginId: typeof entry.pluginId === 'string' ? entry.pluginId : '',
        message: scrub(typeof entry.message === 'string' ? entry.message : '', MAX_REPORT_FIELD),
        at: typeof entry.at === 'string' ? entry.at : '',
      })
    }
    return summaries
  } catch {
    return []
  }
}

/** Write a file atomically, without ever throwing. */
function atomicWrite(path: string, text: string): boolean {
  const temp = `${path}.tmp`
  try {
    writeFileSync(temp, text, { mode: 0o600 })
    renameSync(temp, path)
    return true
  } catch {
    try {
      rmSync(temp, { force: true })
    } catch {
      // The temp file is swept at the next launch anyway.
    }
    try {
      writeFileSync(path, text, { mode: 0o600 })
      return true
    } catch {
      return false
    }
  }
}

/** Parse a tombstone, rejecting anything that is not one. */
function parseTombstone(raw: string): RunTombstone | undefined {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const value = parsed as Partial<RunTombstone>
    if (value.schema !== RUN_TOMBSTONE_SCHEMA) return undefined
    if (typeof value.runId !== 'string' || typeof value.pid !== 'number' || typeof value.startedAt !== 'string') return undefined
    if (value.phase !== 'starting' && value.phase !== 'ready' && value.phase !== 'reported' && value.phase !== 'clean') return undefined
    return value as RunTombstone
  } catch {
    return undefined
  }
}

/**
 * Read the previous run tombstone. A missing, unreadable, or malformed file
 * means no evidence, which must degrade to first-run behavior rather than
 * blocking the launch.
 * @param home - the Harness home.
 * @returns the tombstone, or undefined.
 */
export function readRunTombstone(home: string): RunTombstone | undefined {
  try {
    return parseTombstone(readFileSync(runTombstonePath(home), 'utf8'))
  } catch {
    return undefined
  }
}

/**
 * Write the run tombstone synchronously. Called on the launch path, so it is one
 * small file write and it degrades silently: a diagnostics file must never be
 * the reason a launch fails.
 * @param home - the Harness home.
 * @param tombstone - the record to persist.
 * @returns whether the write landed.
 */
export function writeRunTombstoneSync(home: string, tombstone: RunTombstone): boolean {
  try {
    mkdirSync(crashesDir(home), { recursive: true })
    return atomicWrite(runTombstonePath(home), `${JSON.stringify(tombstone, undefined, 2)}\n`)
  } catch {
    return false
  }
}

/**
 * Read the intentional-stop marker a relauncher may have left.
 *
 * Read-only and non-throwing: a marker is a hint, and a malformed or unreadable
 * one must be ignored rather than block the launch. An oversized file is
 * rejected before parsing so a runaway writer cannot stall startup.
 * @param home - the Harness home.
 * @returns the marker, or undefined when none authorizes anything.
 */
export function readIntentionalStopMarker(home: string): IntentionalStopMarker | undefined {
  const path = intentionalStopPath(home)
  try {
    if (statSync(path).size > 64 * 1024) return undefined
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const value = parsed as Partial<IntentionalStopMarker>
    if (value.schema !== INTENTIONAL_STOP_SCHEMA) return undefined
    if (typeof value.requestedAt !== 'string' || Number.isNaN(Date.parse(value.requestedAt))) return undefined
    if (typeof value.runId !== 'string' || value.runId === '') return undefined
    return {
      schema: INTENTIONAL_STOP_SCHEMA,
      requestedAt: value.requestedAt,
      runId: value.runId,
      ...typeof value.pid === 'number' && Number.isInteger(value.pid) ? { pid: value.pid } : {},
      ...typeof value.requestedBy === 'string' && value.requestedBy !== ''
        ? { requestedBy: scrub(value.requestedBy, MAX_REPORT_FIELD) }
        : {},
      ...typeof value.reason === 'string' && value.reason !== ''
        ? { reason: scrub(value.reason, MAX_REPORT_FIELD) }
        : {},
    }
  } catch {
    return undefined
  }
}

/**
 * Write an intentional-stop marker. Used by the relauncher tooling (and by
 * tests): it must run *before* the process is stopped, so the next launch has
 * the evidence when it classifies the death.
 * @param home - the Harness home.
 * @param input - the intent to declare.
 * @returns the marker as persisted, or undefined when it could not be written.
 */
export function writeIntentionalStopMarker(home: string, input: {
  /** The live run being stopped. */
  runId: string
  /** Its main-process id, when known. */
  pid?: number
  /** What declared the intent. */
  requestedBy?: string
  /** Why the run is being stopped. */
  reason?: string
  /** Injectable clock for tests. */
  now?: Date
}): IntentionalStopMarker | undefined {
  const marker: IntentionalStopMarker = {
    schema: INTENTIONAL_STOP_SCHEMA,
    requestedAt: (input.now ?? new Date()).toISOString(),
    runId: input.runId,
    ...input.pid === undefined ? {} : { pid: input.pid },
    ...input.requestedBy === undefined || input.requestedBy === ''
      ? {}
      : { requestedBy: scrub(input.requestedBy, MAX_REPORT_FIELD) },
    ...input.reason === undefined || input.reason === ''
      ? {}
      : { reason: scrub(input.reason, MAX_REPORT_FIELD) },
  }
  try {
    mkdirSync(crashesDir(home), { recursive: true })
    return atomicWrite(intentionalStopPath(home), `${JSON.stringify(marker, undefined, 2)}\n`) ? marker : undefined
  } catch {
    return undefined
  }
}

/**
 * Remove the intentional-stop marker. Called at every launch, unconditionally:
 * the marker is single-use, so a stale one can never be carried into a later
 * death, and a marker that did not match is discarded instead of lingering.
 * @param home - the Harness home.
 * @returns whether a marker was removed.
 */
export function clearIntentionalStopMarker(home: string): boolean {
  try {
    unlinkSync(intentionalStopPath(home))
    return true
  } catch {
    return false
  }
}

/**
 * Decide whether a marker authorizes calling the previous run's end deliberate.
 *
 * Two conditions, and both must hold:
 *
 * 1. **Identity.** The marker names the run it authorizes. A marker left over
 *    from an earlier cycle names a different run and is refused.
 * 2. **Freshness.** The marker must have been written within
 *    {@link RUN_HEARTBEAT_INTERVAL_MS} of the run's last heartbeat — its last
 *    recorded proof of life. A run that kept heartbeating for a full interval
 *    after the intent was declared plainly outlived the intent, so the marker is
 *    stale and the death is *not* downgraded. This is the case that keeps a
 *    failed stop from excusing a later OOM kill or access violation: the run's
 *    own heartbeat refutes the marker.
 *
 * The time is also checked against the future: a marker dated after the launch
 * that found it is malformed and refused.
 * @param marker - the marker read at this launch.
 * @param previous - the previous run's tombstone, when one was readable.
 * @param now - the classifying instant.
 * @returns whether the previous run's end may be recorded as intentional.
 */
export function authorizesIntentionalStop(
  marker: IntentionalStopMarker,
  previous: RunTombstone | undefined,
  now: Date = new Date(),
): boolean {
  if (previous === undefined) return false
  if (marker.runId !== previous.runId) return false
  if (marker.pid !== undefined && previous.pid > 0 && marker.pid !== previous.pid) return false
  const requestedMs = Date.parse(marker.requestedAt)
  if (Number.isNaN(requestedMs)) return false
  if (requestedMs > now.getTime()) return false
  const lastAliveMs = Date.parse(previous.lastAliveAt)
  if (Number.isNaN(lastAliveMs)) return false
  return requestedMs >= lastAliveMs - RUN_HEARTBEAT_INTERVAL_MS
}

/** An empty index, used for a missing or unreadable index file. */
function emptyIndex(): CrashIndex {
  return {
    schema: CRASH_INDEX_SCHEMA,
    updatedAt: '',
    runsSeen: 0,
    cleanExits: 0,
    unexpectedDeaths: 0,
    consecutiveUnexpectedDeaths: 0,
    ordinalAtLastUnexpectedDeath: 0,
    sameClassStreak: 0,
    intentionalStops: 0,
    reports: [],
  }
}

/** Coerce an unknown value to a finite number, or a fallback. */
function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** Whether a value is a known crash class. */
function isCrashClass(value: unknown): value is CrashClass {
  return typeof value === 'string' && Object.hasOwn(SEVERITY_BY_CLASS, value)
}

/** Whether a parsed value looks like an index entry. */
function isIndexEntry(value: unknown): value is CrashIndexEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Partial<CrashIndexEntry>
  return typeof entry.id === 'string' && typeof entry.file === 'string' && isCrashClass(entry.class)
}

/**
 * Read the crash index. A malformed index degrades to an empty one, which the
 * next write rebuilds: it must never throw on the launch path.
 * @param home - the Harness home.
 * @returns the index.
 */
export function readCrashIndex(home: string): CrashIndex {
  try {
    const parsed: unknown = JSON.parse(readFileSync(crashIndexPath(home), 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) return emptyIndex()
    const value = parsed as Partial<CrashIndex>
    if (value.schema !== CRASH_INDEX_SCHEMA || !Array.isArray(value.reports)) return emptyIndex()
    return {
      schema: CRASH_INDEX_SCHEMA,
      updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '',
      runsSeen: numberOr(value.runsSeen, 0),
      cleanExits: numberOr(value.cleanExits, 0),
      unexpectedDeaths: numberOr(value.unexpectedDeaths, 0),
      consecutiveUnexpectedDeaths: numberOr(value.consecutiveUnexpectedDeaths, 0),
      ordinalAtLastUnexpectedDeath: numberOr(value.ordinalAtLastUnexpectedDeath, 0),
      sameClassStreak: numberOr(value.sameClassStreak, 0),
      intentionalStops: numberOr(value.intentionalStops, 0),
      ...typeof value.lastIntentionalStopAt === 'string' ? { lastIntentionalStopAt: value.lastIntentionalStopAt } : {},
      ...typeof value.lastReportId === 'string' ? { lastReportId: value.lastReportId } : {},
      ...isCrashClass(value.lastReportClass) ? { lastReportClass: value.lastReportClass } : {},
      ...typeof value.lastUnexpectedDeathAt === 'string' ? { lastUnexpectedDeathAt: value.lastUnexpectedDeathAt } : {},
      ...typeof value.lastCleanExitAt === 'string' ? { lastCleanExitAt: value.lastCleanExitAt } : {},
      reports: value.reports.filter(isIndexEntry).slice(0, MAX_CRASH_INDEX_ENTRIES),
    }
  } catch {
    return emptyIndex()
  }
}

/**
 * Persist the index, synchronously and defensively.
 * @param home - the Harness home.
 * @param index - the index to write.
 * @returns whether the write landed.
 */
export function persistCrashIndex(home: string, index: CrashIndex): boolean {
  try {
    mkdirSync(crashesDir(home), { recursive: true })
    return atomicWrite(crashIndexPath(home), `${JSON.stringify({ ...index, updatedAt: new Date().toISOString() }, undefined, 2)}\n`)
  } catch {
    return false
  }
}

/**
 * Start a new run: read the previous tombstone, publish this run tombstone, and
 * hand the caller what it needs to decide about the previous one.
 *
 * The tombstone is written before the caller does anything else, because the
 * whole value of the mechanism is that it already says this run is live when the
 * run is killed a second later.
 * @param home - the Harness home.
 * @param input - launch facts.
 * @returns the previous tombstone, the new one, and the index as read.
 */
export function beginRun(home: string, input: RunStartInput): RunStart {
  const now = input.now ?? new Date()
  const previous = readRunTombstone(home)
  const index = readCrashIndex(home)
  const startedAt = now.toISOString()
  const tombstone: RunTombstone = {
    schema: RUN_TOMBSTONE_SCHEMA,
    runId: newRunId(now, process.pid),
    ordinal: index.runsSeen + 1,
    pid: process.pid,
    startedAt,
    lastAliveAt: startedAt,
    phase: 'starting',
    windowsShown: 0,
    launch: input.launch,
    build: input.build,
    ...input.bootMarkerState === undefined ? {} : { bootMarkerState: input.bootMarkerState },
    ...input.bootAttempts === undefined ? {} : { bootAttempts: input.bootAttempts },
    ...input.sessionsOnDisk === 0 ? {} : { sessionsOnDisk: input.sessionsOnDisk },
  }
  writeRunTombstoneSync(home, tombstone)
  return {
    ...previous === undefined ? {} : { previous },
    tombstone,
    index,
  }
}

/**
 * Merge a patch into the tombstone on disk, synchronously and defensively.
 * @param home - the Harness home.
 * @param patch - fields to merge.
 * @returns the tombstone as persisted, or undefined when none exists.
 */
export function updateRunTombstoneSync(home: string, patch: Partial<RunTombstone>): RunTombstone | undefined {
  const current = readRunTombstone(home)
  if (current === undefined) return undefined
  const next: RunTombstone = { ...current, ...patch }
  return writeRunTombstoneSync(home, next) ? next : undefined
}

/**
 * Stamp this run as having exited through the shell graceful path. A run that
 * already recorded its own death keeps the reported phase: the report exists,
 * and marking it clean would erase the evidence.
 * @param home - the Harness home.
 * @param exitCode - the exit code the shell is finishing with.
 * @returns the tombstone as persisted, when one exists.
 */
export function markRunClean(home: string, exitCode: number): RunTombstone | undefined {
  const current = readRunTombstone(home)
  if (current === undefined) return undefined
  if (current.phase === 'reported') return current
  const now = new Date().toISOString()
  return updateRunTombstoneSync(home, { phase: 'clean', exitCode, cleanedAt: now, lastAliveAt: now })
}

/**
 * Stamp this run as having recorded its own death, so the next launch does not
 * write a second report for the same event.
 * @param home - the Harness home.
 * @param reportId - the report that was written.
 * @param deathClass - the class of the recorded death.
 * @returns the tombstone as persisted, when one exists.
 */
export function markRunReported(home: string, reportId: string, deathClass: CrashClass): RunTombstone | undefined {
  return updateRunTombstoneSync(home, {
    phase: 'reported',
    deathReportId: reportId,
    deathClass,
    lastAliveAt: new Date().toISOString(),
  })
}

/**
 * Refresh the heartbeat. The heartbeat is what turns a process that died at some
 * point into a bounded window, so it should run often enough to be useful and
 * rarely enough to be free.
 *
 * The refreshed tombstone is returned rather than a flag, because the caller is
 * the only thing that knows the run is still alive: a report written during the
 * run must render the state the heartbeat last proved (`ready`, the window
 * count) instead of the state the run had at launch.
 * @param home - the Harness home.
 * @param patch - fields to refresh alongside the heartbeat.
 * @returns the tombstone as persisted, or undefined when it was not written.
 */
export function heartbeat(home: string, patch: Partial<RunTombstone> = {}): RunTombstone | undefined {
  const current = readRunTombstone(home)
  if (current === undefined || current.phase === 'clean' || current.phase === 'reported') return undefined
  const next: RunTombstone = { ...current, ...patch, lastAliveAt: new Date().toISOString() }
  return writeRunTombstoneSync(home, next) ? next : undefined
}

/**
 * Decide what the previous launch left behind.
 * @param input - the previous tombstone and the boot marker read at this launch.
 * @returns the outcome the caller must act on.
 */
export function classifyPreviousRun(input: {
  previous?: RunTombstone
  bootMarkerState?: 'started' | 'ok'
  /**
   * The intentional-stop marker read at this launch, when one was present. It is
   * only consulted for a run that left an unexplained tombstone; a clean exit or
   * a self-reported death is classified on its own evidence.
   */
  intentionalStop?: IntentionalStopMarker
  /** Injectable clock for the marker freshness check. */
  now?: Date
}): PreviousRunOutcome {
  const { previous } = input
  if (previous === undefined) {
    // Before this mechanism existed, `boot-marker.json` was the only trace a
    // launch left. A marker still saying `started` is proof of an unexplained
    // death, and it must not be lost just because the tombstone is missing.
    if (input.bootMarkerState === 'started') {
      return { kind: 'unreported', runId: 'unknown', ordinal: 0, deathClass: 'boot-failure', retroactive: true }
    }
    return { kind: 'none' }
  }
  if (previous.phase === 'clean') {
    return {
      kind: 'clean',
      runId: previous.runId,
      ordinal: previous.ordinal,
      ...previous.cleanedAt === undefined ? {} : { cleanedAt: previous.cleanedAt },
    }
  }
  if (previous.phase === 'reported' && previous.deathReportId !== undefined) {
    return {
      kind: 'recorded',
      runId: previous.runId,
      ordinal: previous.ordinal,
      reportId: previous.deathReportId,
      deathClass: previous.deathClass ?? 'dirty-shutdown',
    }
  }
  // The run left an unexplained tombstone. A relauncher's declared intent, if it
  // names this run and is fresh, turns the death into a controlled stop; a stale
  // or mismatched marker is ignored and the death keeps its fatal class.
  if (input.intentionalStop !== undefined
    && authorizesIntentionalStop(input.intentionalStop, previous, input.now ?? new Date())) {
    return {
      kind: 'intentional',
      runId: previous.runId,
      ordinal: previous.ordinal,
      stoppedAt: input.intentionalStop.requestedAt,
      ...input.intentionalStop.requestedBy === undefined ? {} : { requestedBy: input.intentionalStop.requestedBy },
      ...input.intentionalStop.reason === undefined ? {} : { reason: input.intentionalStop.reason },
    }
  }
  return {
    kind: 'unreported',
    runId: previous.runId,
    ordinal: previous.ordinal,
    deathClass: previous.phase === 'starting' ? 'boot-failure' : 'dirty-shutdown',
    retroactive: false,
  }
}

/**
 * Fold the previous run outcome into the index counters. Kept separate from
 * report writing so a clean exit and an already-recorded death both advance the
 * runs-survived arithmetic without inventing a report.
 * @param index - the index as read.
 * @param outcome - what the previous run left behind.
 * @param ordinal - the launching run ordinal.
 * @param now - the reference instant.
 * @returns the updated index.
 */
export function advanceIndexForOutcome(
  index: CrashIndex,
  outcome: PreviousRunOutcome,
  ordinal: number,
  now: Date = new Date(),
): CrashIndex {
  const base: CrashIndex = {
    ...index,
    runsSeen: Math.max(index.runsSeen, ordinal),
    updatedAt: now.toISOString(),
  }
  if (outcome.kind === 'clean') {
    return {
      ...base,
      cleanExits: index.cleanExits + 1,
      consecutiveUnexpectedDeaths: 0,
      sameClassStreak: 0,
      ...outcome.cleanedAt === undefined ? {} : { lastCleanExitAt: outcome.cleanedAt },
    }
  }
  if (outcome.kind === 'intentional') {
    // A declared stop ends the run without a fault, so it does not increment
    // `unexpectedDeaths`; it does break the consecutive-death streak, because a
    // controlled event sat between any earlier crash and the next one.
    return {
      ...base,
      intentionalStops: index.intentionalStops + 1,
      consecutiveUnexpectedDeaths: 0,
      sameClassStreak: 0,
      lastIntentionalStopAt: outcome.stoppedAt ?? now.toISOString(),
    }
  }
  return base
}

/** Severity the report assigns to a class. */
export function severityFor(crashClass: CrashClass): CrashSeverity {
  return SEVERITY_BY_CLASS[crashClass]
}

/**
 * Build one report. Every fact is an input, so the report is pinned by tests and
 * the writer stays a thin, defensive shell.
 * @param input - the gathered facts.
 * @returns the report, without an id until it is assigned one.
 */
export function buildCrashReport(input: CrashReportInput): CrashReport {
  const { tombstone } = input
  const detectedIso = input.detectedAt.toISOString()
  const severity = input.severityOverride ?? SEVERITY_BY_CLASS[input.crashClass]
  const startedMs = Date.parse(tombstone.startedAt)
  const death: CrashDeath = input.death ?? {
    certainty: 'exact',
    at: detectedIso,
    aliveForMs: Math.max(0, input.detectedAt.getTime() - startedMs),
  }
  const deathRendering: CrashDeathRendering = {
    certainty: death.certainty,
    aliveForMs: death.aliveForMs,
    aliveForHuman: humanDuration(death.aliveForMs),
    ...death.at === undefined ? {} : { at: death.at, atLocal: localTime(death.at) },
    ...death.windowFrom === undefined ? {} : { windowFrom: death.windowFrom, windowFromLocal: localTime(death.windowFrom) },
    ...death.windowTo === undefined ? {} : { windowTo: death.windowTo, windowToLocal: localTime(death.windowTo) },
  }
  const previousEntry = input.index.reports[0]
  const isDeath = severity === 'fatal'
  const repeat: CrashRepeat = {
    isRepeat: input.index.reports.length > 0,
    consecutive: isDeath ? input.index.consecutiveUnexpectedDeaths + 1 : input.index.consecutiveUnexpectedDeaths,
    sameClassStreak: input.index.lastReportClass === input.crashClass ? input.index.sameClassStreak + 1 : 1,
    totalUnexpectedDeaths: isDeath ? input.index.unexpectedDeaths + 1 : input.index.unexpectedDeaths,
    runsSinceLastUnexpectedDeath: input.index.ordinalAtLastUnexpectedDeath === 0
      ? tombstone.ordinal
      : Math.max(0, tombstone.ordinal - input.index.ordinalAtLastUnexpectedDeath),
    ...previousEntry === undefined ? {} : { previousReportId: previousEntry.id, previousReportClass: previousEntry.class },
    ...input.index.lastUnexpectedDeathAt === undefined ? {} : { previousDeathAt: input.index.lastUnexpectedDeathAt },
  }
  const notes = [...input.notes ?? []]
  if (death.certainty === 'window') {
    notes.push('Death time is a window, not an instant: the process was killed without running any handler, so the last heartbeat is the lower bound and this launch is the upper bound.')
  }
  if (input.install.matchesExpected === false) {
    notes.push('The installed @deepseek-ai package count does not match the installer invariant; it was measured when this report was written, not at death time.')
  }
  if (repeat.consecutive >= 3) {
    notes.push(`Crash loop: ${String(repeat.consecutive)} consecutive unexpected deaths with no clean exit between them.`)
  }
  if (tombstone.launch.mode === 'packaged' && !tombstone.launch.debuggable) {
    notes.push('This was an ordinary packaged launch: no debug port, no dev tree.')
  }
  if (tombstone.launch.debuggable) {
    notes.push('This run was debuggable (an operator diagnostic launch); its exit may be deliberate and is not necessarily a crash.')
  }
  return {
    schema: CRASH_REPORT_SCHEMA,
    id: '',
    class: input.crashClass,
    severity,
    summary: scrub(input.summary, MAX_REPORT_FIELD),
    detectedAt: detectedIso,
    detectedAtLocal: localTime(detectedIso),
    timezone: timezoneLabel(input.detectedAt),
    run: {
      runId: tombstone.runId,
      ordinal: tombstone.ordinal,
      pid: tombstone.pid,
      startedAt: tombstone.startedAt,
      startedAtLocal: localTime(tombstone.startedAt),
      phaseAtDeath: tombstone.phase,
      aliveForMs: death.aliveForMs,
      aliveForHuman: humanDuration(death.aliveForMs),
      windowsShown: tombstone.windowsShown,
      ...tombstone.bootMarkerState === undefined ? {} : { bootMarkerState: tombstone.bootMarkerState },
      ...tombstone.bootAttempts === undefined ? {} : { bootAttempts: tombstone.bootAttempts },
      ...tombstone.exitedAt === undefined ? {} : { exitedAt: tombstone.exitedAt, exitedAtLocal: localTime(tombstone.exitedAt) },
      ...tombstone.exitCode === undefined ? {} : { exitCode: tombstone.exitCode },
    },
    death: deathRendering,
    build: tombstone.build,
    install: input.install,
    process: input.process,
    launch: tombstone.launch,
    ...input.failure === undefined ? {} : { failure: input.failure },
    ...input.session === undefined ? {} : { session: input.session },
    recentBootFailures: [...input.recentBootFailures ?? []],
    dumps: [...input.dumps ?? []],
    repeat,
    notes,
    ...input.retroactive === true ? { retroactive: true } : {},
  }
}

/**
 * Stamp a built report with a fresh id.
 * @param report - the report to stamp.
 * @param when - the id timestamp.
 * @param pid - the process the id belongs to.
 * @returns the stamped report.
 */
export function assignReportId(report: CrashReport, when: Date = new Date(), pid: number = process.pid): CrashReport {
  return { ...report, id: newReportId(when, pid) }
}

/** Update the index for one written report. */
function indexAfterReport(index: CrashIndex, report: CrashReport, ordinal: number): CrashIndex {
  const isDeath = report.severity === 'fatal'
  // A declared stop is recorded like any other report but must not read as a
  // death, and it breaks the consecutive-death streak rather than extending it.
  const isIntentional = report.class === 'intentional-stop'
  const entry: CrashIndexEntry = {
    id: report.id,
    class: report.class,
    severity: report.severity,
    detectedAt: report.detectedAt,
    runId: report.run.runId,
    file: `${report.id}.json`,
    summary: report.summary,
    ...report.death.at === undefined ? {} : { deathAt: report.death.at },
    ...report.process.pid === undefined ? {} : { pid: report.process.pid },
  }
  return {
    ...index,
    updatedAt: new Date().toISOString(),
    runsSeen: Math.max(index.runsSeen, ordinal),
    unexpectedDeaths: isDeath ? index.unexpectedDeaths + 1 : index.unexpectedDeaths,
    consecutiveUnexpectedDeaths: isDeath
      ? index.consecutiveUnexpectedDeaths + 1
      : isIntentional ? 0 : index.consecutiveUnexpectedDeaths,
    ordinalAtLastUnexpectedDeath: isDeath ? ordinal : index.ordinalAtLastUnexpectedDeath,
    sameClassStreak: isIntentional ? 0 : index.lastReportClass === report.class ? index.sameClassStreak + 1 : 1,
    intentionalStops: isIntentional ? index.intentionalStops + 1 : index.intentionalStops,
    ...isIntentional ? { lastIntentionalStopAt: report.detectedAt } : {},
    lastReportId: report.id,
    lastReportClass: report.class,
    ...isDeath ? { lastUnexpectedDeathAt: report.detectedAt } : {},
    reports: [entry, ...index.reports.filter(existing => existing.id !== entry.id)].slice(0, MAX_CRASH_INDEX_ENTRIES),
  }
}

/** Render a sha256 for a summary line. */
function shortSha(sha: string): string {
  return sha === '' ? 'unavailable' : sha.slice(0, 16)
}

/** Render the plain-text digest that sits beside the reports. */
export function renderLatestSummary(report: CrashReport): string {
  const lines = [
    `Saturn AI crash report - ${report.detectedAtLocal} (${report.detectedAt})`,
    `class      : ${report.class} (${report.severity})`,
    `summary    : ${report.summary}`,
    `run        : ${report.run.runId} (ordinal ${String(report.run.ordinal)}, pid ${String(report.run.pid)})`,
    `started    : ${report.run.startedAtLocal}`,
    report.death.certainty === 'window'
      ? `death      : between ${report.death.windowFromLocal ?? '?'} and ${report.death.windowToLocal ?? '?'} (window; the process could not run a handler)`
      : `death      : ${report.death.atLocal ?? report.detectedAtLocal} (reported by the dying process)`,
    `alive for  : ${report.death.aliveForHuman}`,
    report.run.exitedAt === undefined
      ? 'exit path  : none - the process was killed before it could exit on its own'
      : `exit path  : ran with code ${String(report.run.exitCode ?? 0)} at ${report.run.exitedAtLocal ?? report.run.exitedAt}`,
    `build      : ${report.build.productName} ${report.build.appVersion} / electron ${report.build.electron} / node ${report.build.node} / main.js sha256 ${shortSha(report.build.mainModuleSha256)}`,
    `install    : ${String(report.install.dshPackageCount)}/${String(report.install.expectedDshPackageCount)} @deepseek-ai packages, ${String(report.install.packagesMissingManifest)} missing package.json`,
    `launch     : ${report.launch.mode}${report.launch.debuggable ? ' (debuggable)' : ''}${report.launch.args.length === 0 ? '' : ` / ${report.launch.args.join(' ')}`}`,
    `repeat     : ${report.repeat.isRepeat ? `yes - ${String(repeatLabel(report))}` : 'first report on this installation'}`,
    report.session === undefined
      ? 'session    : no session log found'
      : `session    : ${report.session.sessionId} (${String(Math.round(report.session.sizeBytes / 1024))} KB, last write ${report.session.modifiedAtLocal})`,
    `dumps      : ${report.dumps.length === 0 ? 'none' : report.dumps.join(', ')}`,
    report.recentBootFailures.length === 0
      ? 'boot fails : none recorded'
      : `boot fails : ${report.recentBootFailures.map(entry => `${entry.kind}:${entry.pluginId === '' ? 'unattributed' : entry.pluginId}`).join('; ')}`,
    ...report.notes.map(note => `note       : ${note}`),
    `report     : ${report.id}.json`,
  ]
  return `${lines.join('\n')}\n`
}

/** Render the repeat counters for the digest line. */
function repeatLabel(report: CrashReport): string {
  return `${String(report.repeat.consecutive)} consecutive unexpected death(s), ${String(report.repeat.totalUnexpectedDeaths)} total, ${String(report.repeat.runsSinceLastUnexpectedDeath)} run(s) since the last one`
}

/** List the report files present, oldest first. */
function reportFileNames(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.startsWith(REPORT_FILE_PREFIX) && entry.name.endsWith('.json'))
      .map(entry => entry.name)
      .sort()
  } catch {
    return []
  }
}

/**
 * Enforce the report cap immediately, without any asynchronous work: the
 * pre-exit writer must be able to bound the directory even if the process never
 * gets another turn.
 * @param home - the Harness home.
 * @returns how many report files were removed.
 */
export function enforceReportCapSync(home: string): number {
  const dir = crashesDir(home)
  const names = reportFileNames(dir)
  let removed = 0
  // Age out first: a report older than the window is gone even when the
  // directory still has room, so a long-dormant installation does not carry a
  // year of history forward.
  const cutoff = Date.now() - CRASH_RETENTION_MS
  const kept: string[] = []
  for (const name of names) {
    try {
      if (statSync(join(dir, name)).mtimeMs < cutoff) {
        unlinkSync(join(dir, name))
        removed += 1
        continue
      }
    } catch {
      // An unstatable entry is left for the next sweep.
    }
    kept.push(name)
  }
  const excess = kept.length - MAX_CRASH_REPORT_FILES
  for (const name of kept.slice(0, Math.max(0, excess))) {
    try {
      unlinkSync(join(dir, name))
      removed += 1
    } catch {
      // A file that will not delete is not worth failing a report over.
    }
  }
  try {
    const cutoff = Date.now() - 5 * 60 * 1000
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.tmp')) continue
      const full = join(dir, entry.name)
      if (statSync(full).mtimeMs < cutoff) unlinkSync(full)
    }
  } catch {
    // No stale temp files to sweep.
  }
  return removed
}

/**
 * Write one report, its index entry, and the text digest. Synchronous by design:
 * the fatal in-process path calls it immediately before the process exits, where
 * an unflushed promise would lose the only copy of the evidence.
 * @param home - the Harness home.
 * @param report - the report to persist.
 * @returns the report path, or an empty string when nothing could be written.
 */
export function writeCrashReportSync(home: string, report: CrashReport): string {
  try {
    if (report.id === '') return ''
    mkdirSync(crashesDir(home), { recursive: true })
    mkdirSync(dumpsDir(home), { recursive: true })
    const path = crashReportPath(home, report.id)
    if (!atomicWrite(path, `${JSON.stringify(report, undefined, 2)}\n`)) return ''
    const index = readCrashIndex(home)
    persistCrashIndex(home, indexAfterReport(index, report, report.run.ordinal))
    atomicWrite(join(crashesDir(home), LATEST_SUMMARY_FILENAME), renderLatestSummary(report))
    enforceReportCapSync(home)
    return path
  } catch {
    return ''
  }
}

/** The orientation note placed in the crash directory. */
function crashesReadmeText(): string {
  return [
    'Saturn AI crash reports',
    '',
    'One JSON file per unexpected event, newest first by filename. Write the',
    'folder path into a chat and the report answers: when the run started and',
    'when it died, which build and which install tree, which process failed,',
    'what the session was doing, and whether this is a repeat.',
    '',
    'Files:',
    '  crash-<utc>-<pid>-<rand>.json  one reviewable report; read this one',
    '  latest.txt                     plain-text digest of the newest report',
    '  index.json                     counters and the newest report list',
    '  current-run.json               live-run tombstone; a run that never',
    '                                 reaches a clean exit leaves it behind',
    '  intentional-stop.json          a relauncher declaring it is about to stop',
    '                                 the named run on purpose; single-use, read',
    '                                 and removed by the next launch',
    '  dumps/                         native minidumps, when the OS produced one',
    '',
    'How to read a report',
    '  class       what kind of failure it was. `intentional-stop` is not a',
    '              failure: a relauncher declared the stop in advance, so it is',
    '              recorded as a warning and never counts as an unexpected death',
    '  severity    fatal = the run ended; error/warning = the run continued or was',
    '              stopped on purpose',
    '  death       an exact instant when the dying process reported itself, or a',
    '              window when it was killed too hard to report anything',
    '  install     whether the installed tree still matches the installer set',
    '  repeat      false means this is the first report on this installation',
    '  notes       what the report can and cannot prove',
    '',
    'Retention: the newest 25 reports and 10 dumps are kept, and anything older',
    'than 30 days is removed. Nothing here needs a symbol server to read; a',
    'minidump does, which is why the JSON is the primary artifact.',
    '',
  ].join('\n')
}

/**
 * Ensure the crash directory exists and carries its orientation note.
 * @param home - the Harness home.
 * @returns whether the directory is usable.
 */
export function ensureCrashDirectory(home: string): boolean {
  try {
    const dir = crashesDir(home)
    mkdirSync(dir, { recursive: true })
    mkdirSync(dumpsDir(home), { recursive: true })
    const readme = join(dir, CRASHES_README_FILENAME)
    if (!existsSync(readme)) atomicWrite(readme, crashesReadmeText())
    return true
  } catch {
    return false
  }
}

/**
 * Write one report asynchronously and then enforce retention. Used on the
 * next-launch path, where the process is healthy and may take its time.
 * @param home - the Harness home.
 * @param report - the report to persist.
 * @returns the report path, or an empty string when nothing could be written.
 */
export async function writeCrashReport(home: string, report: CrashReport): Promise<string> {
  const path = writeCrashReportSync(home, report)
  if (path === '') return ''
  await sweepCrashes(home)
  return path
}

/**
 * Delete reports and dumps beyond the caps or older than the retention window.
 * Bounded by construction and cheap: the directory holds tens of files, so a
 * crash loop cannot fill the disk even when every launch writes a report.
 * @param home - the Harness home.
 * @returns how many files were removed.
 */
export async function sweepCrashes(home: string): Promise<number> {
  const cutoff = Date.now() - CRASH_RETENTION_MS
  let removed = enforceReportCapSync(home)
  try {
    const dir = dumpsDir(home)
    const entries = await readdir(dir, { withFileTypes: true })
    const files: { name: string; mtime: number }[] = []
    for (const entry of entries) {
      if (!entry.isFile()) continue
      try {
        const stat2 = await stat(join(dir, entry.name))
        if (stat2.mtimeMs < cutoff) {
          await unlink(join(dir, entry.name))
          removed += 1
          continue
        }
        files.push({ name: entry.name, mtime: stat2.mtimeMs })
      } catch {
        // Skip an unstatable entry.
      }
    }
    files.sort((left, right) => right.mtime - left.mtime)
    for (const stale of files.slice(MAX_CRASH_DUMP_FILES)) {
      try {
        await unlink(join(dir, stale.name))
        removed += 1
      } catch {
        // A file that will not delete is not worth failing a sweep over.
      }
    }
  } catch {
    // No dumps directory.
  }
  return removed
}

/**
 * Fold report files on disk back into the index when the index is missing or
 * was rebuilt, so the counters cannot drift away from the evidence.
 * @param home - the Harness home.
 * @returns the number of report files present.
 */
export function countCrashReports(home: string): number {
  return reportFileNames(crashesDir(home)).length
}
