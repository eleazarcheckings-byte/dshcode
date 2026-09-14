/**
 * Electron-side crash capture for the desktop shell.
 *
 * This is the wiring half of the crash reporter: it owns the run tombstone, the
 * process and window event hooks, the heartbeat, and the native crash reporter.
 * The report format and the durability rules live in `crash-report.ts`, which
 * knows nothing about Electron and is pinned by unit tests.
 *
 * What each mechanism catches:
 *
 * - **In-process capture** catches what a live process can still observe: an
 *   uncaught exception in the main process, a fatal pre-readiness unhandled
 *   rejection through the harness fail-loud hook, a dead renderer, a dead
 *   GPU/utility child, a renderer that stops answering, and a page that fails to
 *   load.
 * - **The tombstone** catches everything else, on the *next* launch: a
 *   `TerminateProcess`/`taskkill /F`, an OS-level access violation, an OOM kill,
 *   a power loss, or a hard death during startup. Those deaths are structurally
 *   uncatchable at death time, because no handler runs.
 *
 * Nothing here changes how the shell boots, quits, or handles failures. It only
 * observes and records.
 *
 * @module crash-monitor
 */

import { app, crashReporter } from 'electron'
import type { BrowserWindow, WebContents } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  advanceIndexForOutcome,
  assignReportId,
  beginRun,
  buildCrashReport,
  classifyLaunch,
  classifyPreviousRun,
  clearIntentionalStopMarker,
  countSessionLogs,
  dumpsDir,
  ensureCrashDirectory,
  expectedPackageCountFromEnv,
  fileSha256,
  heartbeat,
  listCrashDumps,
  markRunClean,
  markRunReported,
  persistCrashIndex,
  readActiveSession,
  readCrashIndex,
  readInstallFacts,
  readIntentionalStopMarker,
  readRecentBootFailures,
  redactText,
  RUN_HEARTBEAT_INTERVAL_MS,
  updateRunTombstoneSync,
  writeCrashReport,
  writeCrashReportSync,
  MAX_FAILURE_MESSAGE,
  MAX_FAILURE_STACK,
  type CrashClass,
  type CrashFailure,
  type CrashProcessFacts,
  type CrashReport,
  type CrashReportInput,
  type IntentionalStopMarker,
  type PreviousRunOutcome,
  type RunTombstone,
} from './crash-report.ts'

/** Everything the monitor needs to identify the running shell. */
export interface CrashMonitorOptions {
  /** The Harness home the reports are written under. */
  home: string
  /** Product name the shell reports. */
  productName: string
  /** Packaged application version. */
  appVersion: string
  /** Absolute application directory. */
  appPath: string
  /** Absolute path of the executing main module. */
  mainModulePath: string
  /** Whether the shell is a packaged application. */
  isPackaged: boolean
  /** Boot marker state read before this launch overwrote it. */
  bootMarkerState?: 'started' | 'ok'
  /** Consecutive non-ok boot attempts, from the previous marker. */
  bootAttempts?: number
  /** Product version facts for the report build block. */
  runtime: { electron: string; chrome: string; node: string }
  /** Injectable clock for tests. */
  now?: Date
}

/** A boot failure the shell is about to report to the user and exit on. */
export interface BootFailureReportInput {
  /** One-line description of what failed. */
  message: string
  /** Stack of the failure, when there is one. */
  stack: string
  /** Whether the failure was a watchdog timeout rather than a thrown error. */
  hang: boolean
  /** Plugins the recovery decision blamed. */
  pluginIds: readonly string[]
  /** Whether the shell had already entered safe mode. */
  safeMode: boolean
  /** Extra context lines for the report notes. */
  notes?: readonly string[]
}

/** The live crash monitor for one shell run. */
export interface CrashMonitor {
  /** The launch identifier of this run. */
  readonly runId: string
  /** This launch ordinal for the installation. */
  readonly ordinal: number
  /** What the previous launch left behind. */
  readonly previousOutcome: PreviousRunOutcome
  /** Where the reports for this installation land. */
  readonly reportsDir: string
  /** Report path of the previous run death, once it has been written. */
  readonly previousReport: Promise<string>
  /** Whether the native crashpad reporter accepted the configuration. */
  readonly nativeReporterEnabled: boolean
  /** Mark the tree as up and start the heartbeat. */
  markReady(): void
  /** Record that a quit is in flight, so teardown noise is not reported. */
  noteQuitStarted(): void
  /** Stamp the run as a clean exit and stop the heartbeat. */
  markClean(exitCode: number): void
  /** Attach the window-level observers to a main window. */
  attachWindow(window: BrowserWindow): void
  /** Record a boot failure the shell is exiting on. */
  reportBootFailure(input: BootFailureReportInput): string
  /** Record a rejection surfaced by the harness fail-loud guard. */
  reportRejection(error: unknown): string
}

/** Truncate without redacting, for values this module already controls. */
function bound(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}...[truncated]`
}

/** Turn any thrown value into report fields. */
function failureOf(error: unknown): CrashFailure {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: bound(redactText(error.message), MAX_FAILURE_MESSAGE),
      stack: bound(redactText(error.stack ?? error.message), MAX_FAILURE_STACK),
    }
  }
  const text = bound(redactText(String(error)), MAX_FAILURE_STACK)
  return { name: 'NonError', message: text, stack: text }
}

/** Whether a child-process reason is normal teardown rather than a failure. */
function isNormalChildExit(reason: string, exitCode: number): boolean {
  if (reason === 'clean-exit') return true
  // Electron reports an ordinary renderer teardown as a kill with a zero exit
  // code; reporting that would make the instrument cry wolf on every reload.
  return reason === 'killed' && exitCode === 0
}

/** Convert a child-process-gone type into the report process family. */
function processTypeFor(childType: string): CrashProcessFacts['type'] {
  if (childType === 'GPU') return 'gpu'
  if (childType === 'Utility' || childType === 'Pepper Plugin' || childType === 'Pepper Plugin Broker') return 'utility'
  return 'unknown'
}

/** Launch an interval whose handle never keeps the process alive. */
function startHeartbeatTimer(tick: () => void): ReturnType<typeof setInterval> {
  const timer = setInterval(tick, RUN_HEARTBEAT_INTERVAL_MS)
  // Detach the timer from the event loop so a stray heartbeat can never hold the
  // process open. The handle shape depends on which of the Node and DOM timer
  // typings this compile picks up, so probe for the method instead of assuming.
  const handle = timer as unknown as { unref?: () => void }
  if (typeof handle.unref === 'function') handle.unref()
  return timer
}

/**
 * Install the crash monitor for this shell run.
 *
 * Synchronous by design: the tombstone must be on disk before the shell does
 * anything else, and the function never throws. If the diagnostics directory is
 * unusable every method degrades to a no-op so a broken reporter cannot take the
 * app down with it.
 * @param options - the running shell identity and diagnostics options.
 * @returns the monitor handle.
 */
export function installCrashMonitor(options: CrashMonitorOptions): CrashMonitor {
  const { home, productName } = options
  const reportsDir = join(home, 'crashes')
  const usable = ensureCrashDirectory(home)

  const build = {
    productName,
    appVersion: options.appVersion,
    electron: options.runtime.electron,
    chrome: options.runtime.chrome,
    node: options.runtime.node,
    appPath: options.appPath,
    mainModuleSha256: fileSha256(options.mainModulePath),
  }
  const launch = classifyLaunch(process.argv, options.isPackaged)
  const start = usable
    ? beginRun(home, {
      build,
      launch,
      sessionsOnDisk: countSessionLogs(home),
      ...options.bootMarkerState === undefined ? {} : { bootMarkerState: options.bootMarkerState },
      ...options.bootAttempts === undefined ? {} : { bootAttempts: options.bootAttempts },
      ...options.now === undefined ? {} : { now: options.now },
    })
    : undefined
  let tombstone: RunTombstone | undefined = start?.tombstone
  // Consume any intentional-stop marker: read it first so the classifier can see
  // it, then remove it unconditionally so it is single-use. Clearing it on every
  // launch (matched or not) is what stops a stale marker from excusing a later,
  // genuine death — and `authorizesIntentionalStop` additionally refuses a marker
  // the run outlived, so even the one launch that reads it cannot downgrade a
  // death whose own heartbeat refutes the intent.
  const stopMarker: IntentionalStopMarker | undefined = usable ? readIntentionalStopMarker(home) : undefined
  if (usable) clearIntentionalStopMarker(home)
  const outcome: PreviousRunOutcome = start === undefined
    ? { kind: 'none' }
    : classifyPreviousRun({
      ...start.previous === undefined ? {} : { previous: start.previous },
      ...options.bootMarkerState === undefined ? {} : { bootMarkerState: options.bootMarkerState },
      ...stopMarker === undefined ? {} : { intentionalStop: stopMarker },
      ...options.now === undefined ? {} : { now: options.now },
    })

  let ready = false
  let shuttingDown = false
  let deathRecorded = false
  let windowsShown = 0
  let unresponsiveReported = false
  let lastRendererPid: number | undefined
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined

  /**
   * Refresh the heartbeat and keep the in-memory tombstone in step with it.
   *
   * Reports written while the run is alive render `subject = tombstone`, so a
   * heartbeat that only touched the disk would leave every such report claiming
   * the run was still starting and had never shown a window.
   * @param patch - fields to refresh alongside the heartbeat.
   */
  const beat = (patch: Partial<RunTombstone> = {}): void => {
    const written = heartbeat(home, patch)
    if (written !== undefined) tombstone = written
  }

  /** Gather the per-report facts that are read from the tree at write time. */
  const collect = (sessionNow: Date): Pick<CrashReportInput, 'install' | 'session' | 'recentBootFailures'> => {
    const session = readActiveSession(home, sessionNow)
    return {
      install: readInstallFacts(options.appPath, expectedPackageCountFromEnv()),
      ...session === undefined ? {} : { session },
      recentBootFailures: readRecentBootFailures(home),
    }
  }

  /** Assemble a report from the live tombstone, or undefined when unusable. */
  const assemble = (input: {
    crashClass: CrashClass
    summary: string
    process: CrashProcessFacts
    failure?: CrashFailure
    death?: CrashReportInput['death']
    dumps?: readonly string[]
    against?: RunTombstone
    notes?: readonly string[]
    severityOverride?: CrashReportInput['severityOverride']
    retroactive?: boolean
  }): CrashReport | undefined => {
    const subject = input.against ?? tombstone
    if (subject === undefined) return undefined
    try {
      const now = new Date()
      const report = buildCrashReport({
        crashClass: input.crashClass,
        summary: input.summary,
        detectedAt: now,
        tombstone: subject,
        process: input.process,
        index: start?.index ?? readCrashIndex(home),
        ...collect(now),
        ...input.failure === undefined ? {} : { failure: input.failure },
        ...input.death === undefined ? {} : { death: input.death },
        ...input.dumps === undefined ? {} : { dumps: input.dumps },
        ...input.notes === undefined ? {} : { notes: input.notes },
        ...input.severityOverride === undefined ? {} : { severityOverride: input.severityOverride },
        ...input.retroactive === true ? { retroactive: true } : {},
      })
      return assignReportId(report, now)
    } catch (error) {
      console.error(`${productName}: crash report assembly failed`, error)
      return undefined
    }
  }

  /** Write a non-fatal report in the background. */
  const recordAsync = (input: Parameters<typeof assemble>[0]): void => {
    if (!usable || shuttingDown) return
    const report = assemble(input)
    if (report === undefined) return
    void writeCrashReport(home, report).catch((error: unknown) => {
      console.error(`${productName}: crash report write failed`, error)
    })
  }

  /** Write a report synchronously. `death` stamps the run as reported. */
  const recordSyncInternal = (input: Parameters<typeof assemble>[0], death: boolean): string => {
    if (!usable) return ''
    const report = assemble(input)
    if (report === undefined) return ''
    const path = writeCrashReportSync(home, report)
    if (path === '') return ''
    if (death) {
      deathRecorded = true
      markRunReported(home, report.id, report.class)
    }
    return path
  }

  /** Write a severe but survivable event synchronously. */
  const recordSync = (input: Parameters<typeof assemble>[0]): string => recordSyncInternal(input, false)

  /** Write a fatal report synchronously, then stamp the run as reported. */
  const recordFatalSync = (input: Parameters<typeof assemble>[0]): string => recordSyncInternal(input, true)

  // --- Previous run: the tombstone is the only witness for a hard death. -----

  const previousReport = (async (): Promise<string> => {
    if (!usable || start === undefined) return ''
    // Never on the launch path: the previous-run report is valuable but never
    // urgent, so it is assembled on the next tick rather than during the
    // synchronous install that boots the shell.
    await new Promise<void>((resolve) => {
      setImmediate(resolve)
    })
    try {
      if (outcome.kind === 'intentional') {
        const previous = start.previous
        if (previous === undefined) {
          // Unreachable through the classifier (a marker only authorizes a run
          // it names), but the index still advances rather than throwing.
          persistCrashIndex(home, advanceIndexForOutcome(start.index, outcome, tombstone?.ordinal ?? 0))
          return ''
        }
        const startedMs = Date.parse(previous.startedAt)
        const fromMs = Date.parse(previous.lastAliveAt) - RUN_HEARTBEAT_INTERVAL_MS
        const nowMs = Date.now()
        const notes: string[] = [
          'A relauncher declared this stop before it happened, so the run was not killed by a fault: no exception, no OS fault, no out-of-memory kill.',
          'The marker named this run and was written within one heartbeat of its last proof of life. A marker the run outlived is refused as stale, and that death stays fatal.',
        ]
        if (outcome.stoppedAt !== undefined) notes.push(`Intent declared at ${outcome.stoppedAt}.`)
        if (outcome.reason !== undefined) notes.push(`Reason given: ${outcome.reason}`)
        const report = assemble({
          crashClass: 'intentional-stop',
          summary: `The previous run was stopped on purpose by a relauncher${outcome.requestedBy === undefined ? '' : ` (${outcome.requestedBy})`}; it did not crash.`,
          process: { type: 'main', pid: previous.pid },
          death: {
            certainty: 'window',
            windowFrom: previous.lastAliveAt,
            windowTo: new Date(nowMs).toISOString(),
            aliveForMs: Math.max(0, Date.parse(previous.lastAliveAt) - (Number.isNaN(startedMs) ? nowMs : startedMs)),
          },
          dumps: listCrashDumps(home, fromMs, nowMs),
          notes,
          against: previous,
        })
        if (report === undefined) {
          persistCrashIndex(home, advanceIndexForOutcome(start.index, outcome, tombstone?.ordinal ?? 0))
          return ''
        }
        return await writeCrashReport(home, report)
      }
      if (outcome.kind === 'unreported') {
        const previous = start.previous
        const startedMs = previous === undefined ? Date.now() : Date.parse(previous.startedAt)
        const fromMs = previous === undefined ? 0 : Date.parse(previous.lastAliveAt) - RUN_HEARTBEAT_INTERVAL_MS
        const nowMs = Date.now()
        const notes: string[] = [
          previous === undefined
            ? 'Reconstructed from boot-marker.json: this death predates the run tombstone, so the launch identity and process id are unknown.'
            : 'The previous run never reached a clean exit and left no report of its own, so this report reconstructs the death from its tombstone.',
        ]
        if (previous !== undefined && previous.windowsShown === 0) {
          notes.push('The previous run never showed a window; it died during startup.')
        }
        // A severe event recorded by the dead run and then a death is one story,
        // not two: name the earlier report so the pair reads as a sequence.
        const priorForRun = previous === undefined
          ? undefined
          : start.index.reports.find(entry => entry.runId === previous.runId)
        if (priorForRun !== undefined) {
          notes.push(`This run had already filed a report of its own: ${priorForRun.id} (${priorForRun.class}, ${priorForRun.detectedAt}). The run survived that event and died later.`)
        }
        if (previous !== undefined) {
          if (previous.exitedAt !== undefined) {
            notes.push(`The run ran its own exit path with code ${String(previous.exitCode ?? 0)} at ${previous.exitedAt}, so this was not a bare kill from outside.`)
          }
          notes.push(`The previous run survived ${String(previous.ordinal - 1)} completed launch(es) before this one.`)
        }
        const subject: RunTombstone | undefined = previous ?? (tombstone === undefined ? undefined : {
          ...tombstone,
          // The dead run left no tombstone of its own, so its launch identity is
          // unknowable; only the boot marker witnessed it.
          runId: 'unknown',
          ordinal: 0,
          pid: 0,
          phase: 'starting',
          windowsShown: 0,
        })
        const report = assemble({
          crashClass: outcome.deathClass,
          summary: outcome.deathClass === 'dirty-shutdown'
            ? 'The previous run stopped without a clean exit: no handler ran, so it was killed from outside (taskkill, an OS fault, an OOM kill, or a power loss).'
            : 'The previous run died before it finished starting up.',
          process: {
            type: 'main',
            ...previous === undefined ? {} : { pid: previous.pid },
          },
          death: {
            certainty: 'window',
            windowFrom: previous?.lastAliveAt ?? tombstone?.startedAt ?? new Date(nowMs).toISOString(),
            windowTo: new Date(nowMs).toISOString(),
            aliveForMs: Math.max(0, (previous === undefined ? nowMs : Date.parse(previous.lastAliveAt)) - startedMs),
          },
          dumps: listCrashDumps(home, fromMs, nowMs),
          notes,
          ...subject === undefined ? {} : { against: subject },
          ...outcome.retroactive ? { retroactive: true } : {},
        })
        if (report === undefined) {
          persistCrashIndex(home, advanceIndexForOutcome(start.index, outcome, tombstone?.ordinal ?? 0))
          return ''
        }
        const path = await writeCrashReport(home, report)
        return path
      }
      persistCrashIndex(home, advanceIndexForOutcome(start.index, outcome, tombstone?.ordinal ?? 0))
      return ''
    } catch (error) {
      console.error(`${productName}: previous-run crash report failed`, error)
      return ''
    }
  })()

  // --- Native crash reporter: minidumps for OS-level faults. ----------------

  let nativeReporterEnabled = false
  try {
    const dumps = dumpsDir(home)
    mkdirSync(dumps, { recursive: true })
    // crashDumps is an app path, so it must be redirected before start().
    app.setPath('crashDumps', dumps)
    crashReporter.start({
      productName,
      uploadToServer: false,
      compress: true,
      globalExtra: {
        saturnRunId: tombstone?.runId ?? 'unknown',
        saturnAppVersion: options.appVersion,
      },
    })
    nativeReporterEnabled = true
  } catch (error) {
    console.error(`${productName}: native crash reporter unavailable`, error)
  }

  // --- Process-level capture: what a live process can still see. ------------

  // A monitor rather than a handler: it observes the exception and leaves the
  // process default action untouched, so the shell behaves exactly as it did
  // before. It is deliberately NOT recorded as a death: Electron answers an
  // uncaught main-process exception with a native error dialog and keeps the
  // process alive, and stamping the run dead here would swallow a real death
  // later in the same run. The write is synchronous anyway, so the stack
  // survives whatever happens next.
  process.on('uncaughtExceptionMonitor', (error: Error, origin: string) => {
    recordSync({
      crashClass: 'uncaught-exception',
      summary: `Uncaught exception in the main process (origin: ${origin}).`,
      process: { type: 'main', pid: process.pid },
      failure: failureOf(error),
      notes: [
        'Recorded by uncaughtExceptionMonitor, which observes without changing what the process does next.',
        'Electron answers an uncaught main-process exception with a native error dialog and does not exit on its own, so the shell may still be running when you read this.',
        'If the run died anyway, the next launch files the dirty-shutdown report for this same run and names this report as the event that preceded it.',
      ],
    })
  })

  // Adding a listener here is safe: the harness fail-loud guard owns the
  // behaviour of a rejection (it exits before readiness and keeps the session
  // alive afterwards), and this listener only observes. A rejection that
  // happens before readiness is already filed as a death by `reportRejection`;
  // recording it twice would double-count, so this listener stays quiet until
  // readiness and then files the event as a survivable `error`, which is what
  // it is: after readiness the guard deliberately leaves the shell running.
  process.on('unhandledRejection', (reason: unknown) => {
    if (!ready) return
    recordSync({
      crashClass: 'unhandled-rejection',
      severityOverride: 'error',
      summary: 'Unhandled rejection in the main process after the shell reached readiness.',
      process: { type: 'main', pid: process.pid },
      failure: failureOf(reason),
      notes: [
        'The harness fail-loud guard keeps the session alive after readiness, so this rejection did not kill the run and is recorded as a soft failure, not a death.',
        'The guard also writes the rejection to boot-failures.json; this report is the copy that carries the stack.',
        'A death after this point is filed separately by the next launch and names this report as the event that preceded it.',
      ],
    })
  })

  // Backstop for an exit that bypasses the shell quit funnel. It records the
  // exit code as evidence (a run that ran its exit hook was not a bare
  // TerminateProcess) and deliberately does NOT mark the run clean: an exit
  // that never reached the quit funnel is not a graceful quit.
  process.on('exit', (code: number) => {
    try {
      updateRunTombstoneSync(home, { exitedAt: new Date().toISOString(), exitCode: code })
    } catch {
      // An exit hook must never throw.
    }
  })

  app.on('render-process-gone', (_event, contents: WebContents, details) => {
    if (isNormalChildExit(details.reason, details.exitCode)) return
    let url = ''
    let pid: number | undefined
    let fromMemory = false
    try {
      url = requestUrlFor(contents)
      const live = contents.getOSProcessId()
      if (live > 0) pid = live
    } catch {
      // The web contents is already gone.
    }
    if (pid === undefined) {
      // Once the renderer is gone Electron no longer answers for its pid, so
      // the last pid observed while the renderer was alive stands in; the note
      // below keeps that honest.
      pid = lastRendererPid
      fromMemory = pid !== undefined
    }
    recordAsync({
      crashClass: 'renderer-crash',
      summary: `Renderer process died (${details.reason}, exit code ${String(details.exitCode)}) at ${url}.`,
      process: {
        type: 'renderer',
        ...pid === undefined || pid <= 0 ? {} : { pid },
        reason: details.reason,
        exitCode: details.exitCode,
      },
      notes: [
        'The shell kept running; only the renderer died. Reloading the window replaces it.',
        ...fromMemory
          ? ['The renderer pid is the last one observed while the process was alive: Electron stops answering for a dead renderer.']
          : [],
      ],
    })
  })

  app.on('child-process-gone', (_event, details) => {
    if (isNormalChildExit(details.reason, details.exitCode)) return
    recordAsync({
      crashClass: 'child-process-gone',
      summary: `${details.type} child process died (${details.reason}, exit code ${String(details.exitCode)}).`,
      process: {
        type: processTypeFor(details.type),
        reason: details.reason,
        exitCode: details.exitCode,
        kind: details.serviceName ?? details.name ?? details.type,
      },
      notes: ['Electron reports no pid for a gone child process, so it is identified by its type and service name.'],
    })
  })

  /** Read the URL of a web contents without throwing. */
  function requestUrlFor(contents: WebContents): string {
    try {
      return bound(redactText(contents.getURL()), 200)
    } catch {
      return ''
    }
  }

  /** Attach the renderer observers that belong to one window. */
  function attachWindow(window: BrowserWindow): void {
    if (!usable) return
    try {
      const contents = window.webContents
      // `ready-to-show` belongs to the window, not the web contents; it is the
      // first moment a window is actually on screen, so it is the honest count
      // of "how far this run got".
      window.once('ready-to-show', () => {
        windowsShown += 1
        beat({ windowsShown })
      })
      // Track the renderer pid while the renderer is still answering: it is the
      // only way to name the process a later renderer crash is attributed to.
      contents.on('did-finish-load', () => {
        try {
          const pid = contents.getOSProcessId()
          if (pid > 0) lastRendererPid = pid
        } catch {
          // The web contents is already gone.
        }
      })
      contents.on('unresponsive', () => {
        if (unresponsiveReported) return
        unresponsiveReported = true
        recordAsync({
          crashClass: 'renderer-unresponsive',
          summary: `Renderer stopped responding at ${requestUrlFor(contents)}.`,
          process: { type: 'renderer' },
          notes: ['Recorded once per run: a frozen renderer is the black-screen signature, not necessarily a death.'],
        })
      })
      contents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        // ERR_ABORTED is the normal outcome of a navigation being replaced.
        if (errorCode === -3) return
        recordAsync({
          crashClass: 'load-failure',
          summary: `Page load failed (${String(errorCode)} ${errorDescription}) for ${validatedURL}.`,
          process: { type: 'renderer', reason: errorDescription, exitCode: errorCode, kind: isMainFrame ? 'main-frame' : 'sub-frame' },
          notes: [errorCode === -2
            ? 'ERR_FAILED (-2) is what a load in flight reports when the shell restarts mid-load.'
            : 'The application page did not load; the window may be blank.'],
        })
      })
    } catch (error) {
      console.error(`${productName}: crash monitor window hook failed`, error)
    }
  }

  return {
    runId: tombstone?.runId ?? 'unknown',
    ordinal: tombstone?.ordinal ?? 0,
    previousOutcome: outcome,
    reportsDir,
    previousReport,
    nativeReporterEnabled,
    markReady(): void {
      if (!usable) return
      ready = true
      beat({ phase: 'ready' })
      heartbeatTimer = startHeartbeatTimer(() => {
        beat({ windowsShown })
      })
    },
    noteQuitStarted(): void {
      shuttingDown = true
    },
    markClean(exitCode: number): void {
      shuttingDown = true
      if (heartbeatTimer !== undefined) {
        clearInterval(heartbeatTimer)
        heartbeatTimer = undefined
      }
      if (!usable || deathRecorded) return
      markRunClean(home, exitCode)
    },
    attachWindow,
    reportBootFailure(input: BootFailureReportInput): string {
      const notes = [
        input.safeMode
          ? 'The failure happened in safe mode, so the bundled components or the installation itself are implicated, not a user plugin.'
          : input.pluginIds.length > 0
            ? `Recovery attributed the failure to: ${input.pluginIds.join(', ')}.`
            : 'Recovery could not attribute the failure to an installed plugin.',
        input.hang
          ? 'The boot watchdog fired: the profile tree never settled.'
          : 'The boot sequence threw before the shell could serve a window.',
        ...input.notes ?? [],
      ]
      return recordFatalSync({
        crashClass: 'boot-failure',
        summary: `Startup failed: ${input.message}`,
        process: { type: 'main', pid: process.pid },
        failure: {
          name: input.hang ? 'BootHangError' : 'BootFailure',
          message: bound(redactText(input.message), MAX_FAILURE_MESSAGE),
          stack: bound(redactText(input.stack), MAX_FAILURE_STACK),
        },
        notes,
      })
    },
    reportRejection(error: unknown): string {
      // Before readiness the harness fail-loud guard treats an unhandled
      // rejection as fatal, so it is a death and is reported as one. After
      // readiness the guard deliberately keeps the session alive; that case is
      // already recorded in boot-failures.json as a late rejection and must not
      // be promoted to a crash report, or the instrument would cry wolf.
      if (ready) return ''
      return recordFatalSync({
        crashClass: 'unhandled-rejection',
        summary: 'Unhandled rejection before the shell reached readiness; the harness fail-loud guard exited the process.',
        process: { type: 'main', pid: process.pid },
        failure: failureOf(error),
        notes: ['Recorded through the harness fail-loud hook, which is this app unhandledRejection owner.'],
      })
    },
  }
}
