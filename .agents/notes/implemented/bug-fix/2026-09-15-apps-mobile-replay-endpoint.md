# Agent Note: apps/mobile — background tick switched to the bounded replay endpoint (Mars r3 R3-F1)

Status: implemented

English | [中文](2026-09-15-apps-mobile-replay-endpoint.zh.md)

## Problem

Mars r3 (`M3-apps-mobile-r3.md`, finding R3-F1, blocking) proved the previous fix for R2-F1 was itself broken
on iOS. That fix had the background-runner tick read the host's held-open `GET /saturn/remote/events` SSE
stream directly, with a `Last-Event-ID` header and an 8-second read deadline meant to bound
`response.body.getReader()`. The plugin's own shipped Swift source falsifies the assumption the read
depended on: `node_modules/@capacitor/background-runner/ios/Sources/RunnerEngine/JSResponse.swift`'s
`JSResponseExports` exposes only `ok`/`status`/`url`/`text()`/`json()` — no `body`, no `ReadableStream` — and
`JSFetch.swift`'s `fetch()` (a `URLSession.dataTask`) resolves the returned promise itself only inside the
completion handler, i.e. only once the entire response body has already buffered. A fetch against a stream
the host never closes on its own therefore never resolves on iOS at all: the identical hang R2-F1 flagged,
relocated from `response.text()` to the `fetch()` call itself, and undiscoverable by anything short of
reading the plugin's committed source (no device was involved). Android's engine ships as a prebuilt native
`.aar` with no source in this checkout, so streaming was unproven there too, not disproven — Mars r3 flagged
both.

## Decision

- **Consume SPEC.md §8's bounded replay contract instead of the SSE stream.** `scripts/background-runner.entry.js`'s
  `checkRemoteEvents` tick now calls `GET <hostUrl>/saturn/remote/events/replay?after=<lastSeen>&limit=100`
  and reads the whole response with a single `response.json()` — no `response.body` access anywhere in this
  path, on either platform, so the class of bug Mars r3 found has no equivalent here. `after` starts at `0`
  on first run and otherwise at the id persisted from the prior tick.
- **Truncated paging, bounded.** When the response reports `truncated: true` (more events were available
  than `limit`), the tick fetches up to `MAX_REPLAY_PAGES = 5` pages in the same run, advancing `after` each
  time, so one large backlog doesn't take several 15-minute ticks to drain — while still bounding a single
  OS-scheduled tick against a pathological or buggy host.
- **`gap: true` needs no special branch.** When the requested `after` was older than the host's ring buffer
  retains, the response starts at the oldest retained event instead and is processed exactly like any other
  page; some events are unrecoverably missed, but the cursor still advances correctly from what the host
  reports next. `hasReplayGap()` makes the condition observable/testable without changing tick behavior.
- **Cursor resolution never regresses.** `resolveReplayCursor(reportedNewest, observedNewest)` takes the
  host's `newest` field when it parses as numerically at or ahead of what this page actually scheduled a
  notification for, else falls back to the observed id — so a missing or malformed `newest` (or one that
  incorrectly reports behind what was just delivered) can never move the persisted cursor backward.
- **`parseSseFrames` removed from `src/lib/backgroundEventsCore.js`.** It parsed SSE-framed text; the replay
  endpoint returns a single JSON object, never an SSE body, on this path — keeping it would have been the
  "dead capability branch" the mandate named. `parseReplayEvents`, `hasReplayGap`, `isReplayTruncated`, and
  `resolveReplayCursor` replace it as the pure, tested surface the tick and its regenerated
  `assets/background-runner.js` share (via `scripts/backgroundRunnerBuild.mjs`'s inlining — unchanged; the
  isolated engine still has no module loader).
- **Numeric id ordering and the notification `extra` shape are unchanged in substance.** `compareEventIds`/
  `isNewerEventId`/`mapBackgroundEvent` (R2-F2/R2-F3) still gate and shape every scheduled notification;
  `isNewerEventId` is kept as a defensive per-event check even though the contract guarantees ids strictly
  greater than `after` — cheap, and it means a page boundary quirk can't double-notify.
- **Shared Xcode scheme committed.** `ios/App/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme` (build +
  test + launch + profile + archive actions, `BuildableReference` targeting `504EC3031FED79650016851F` — the
  `App` target's own identifier, read from `project.pbxproj`). A sibling M5 commit
  (`37a454920ec84abcb1e6bdd9ff7738db721f1324`) had already documented the CI failure this file's absence would
  cause and added an `xcodebuild -list` guard for it; this commit supplies the file the guard expects.
  `ios/.gitignore` ignores `xcuserdata` but not `xcshareddata`, so nothing needed to change there.
- **README correction, both languages, "Background event delivery."** Rewritten to describe the replay
  mechanism honestly (a bounded poll on the OS's own tick cadence; iOS's BGAppRefresh/BGTaskScheduler cadence
  is OS-controlled, not this app's), with a new "Why not the SSE stream" subsection citing the two Swift files
  directly and a "Fixed across rounds" paragraph tying r1/r2/r3 together. Re-recorded `README.i18n.yaml` via
  `pnpm run verify-translation-pairing --write`.

## A live concurrent-write incident during this cell (observed, not caused, resolved by the time of this commit)

Mid-session, `apps/mobile/src/lib/remoteApi.ts`, `backgroundSync.ts`, and `main.ts` changed on disk while this
cell was working, and an untracked `tests/remoteApi.test.ts` (pinning `RemoteEventsClient` to have no
`pollOnce()`) appeared in the working tree — none of it this cell's doing. `git reflog` at the time showed
`HEAD` had advanced roughly ten commits past this cell's own last commit, including `1321a485b5` (`test(saturn):
RED for the mobile RemoteEventsClient -- EventSource-only, no pollOnce()`), `f49a3ffaad` (`fix(saturn): mobile
RemoteEventsClient drops the never-resolving pollOnce() -- EventSource-only`), and an `undo racy commit` /
`restore dropped commit` pair on an unrelated `saturnbot` commit — direct evidence of another live process
committing to `apps/mobile/**` (a path SPEC.md §8 M3 assigns to this cell alone) and of at least one genuine
`git commit` race on the shared branch. This cell made no commits and no destructive git operations while that
was in flight: it read-checked (`git status`, `git diff`, `git show`) rather than staging, did not delete the
untracked test file (deleting it would have risked destroying a concurrent session's only copy of real,
uncommitted work), and held its own README edits back from the one paragraph (`pollOnce()`'s status) that
overlapped the concurrent work, to avoid a second writer contradicting a fix already in flight on the same
lines. By the time this commit was prepared, `f49a3ffaad` and `1321a485b5` had landed cleanly, `remoteApi.ts`
no longer has `pollOnce()`, `apps/mobile`'s full suite is 8/8 files and 72/72 tests green, and no further
churn appeared in `apps/mobile/**` across a repeated `git status` check. This paragraph is the governance
record; per the Always-self-improving law this is a repeat of the pattern `2026-09-15-model-router-mars-r2-fixes.md`'s
"New test file, not an edit..." section already named once this session (a stopped/duplicate agent leaving
uncommitted edits behind) — worth a `system-evolve` look at whether `apps/mobile/**`'s single-cell-ownership
guarantee needs the worktree isolation C5 is building, applied to fix-round dispatches too, not only initial
builds.

## Deviations from the fix list (declared, not silent)

None beyond the concurrency-driven scoping above: every DELIVER item in the mandate (replay endpoint switch,
pure-core tests, drift guard, Xcode scheme, README honesty, `npm test`/`tsc`/`npm run build`/Gradle) was
carried out as specified.

## Alternatives considered

**Keep the streaming read but gate it behind a runtime feature check (`typeof response.body?.getReader ===
'function'`), falling back to the replay endpoint only when absent.** Rejected: Mars r3's fix list offered
this as option (b) only paired with "a *working* non-streaming fallback — and on iOS that requires (a),
since `fetch` itself never resolves." Since the fetch call itself hangs before any feature check on the
response could run, a feature check buys nothing on the one platform it exists to protect; it would only add
a second, never-exercised code path (a "dead capability branch" the same way the removed streaming code was).

## Consequences

**Cost:** the tick may now make up to 5 sequential HTTP requests in one run instead of one held-open stream
read (bounded, and only when the backlog is genuinely large enough to truncate); each is a plain
request/response with no persistent connection, so per-request cost is lower than the stream's per-connection
overhead even in the worst case.

**Bought:** the background notification path is reachable on iOS at all, which it was not before this round
regardless of how it appeared in tests — `parseReplayEvents`/`hasReplayGap`/`isReplayTruncated`/
`resolveReplayCursor` are pure and fully covered; the tick itself (network + OS scheduling) remains unverified
on-device, disclosed as such in the README, consistent with every prior round.

## Testing

New: `tests/backgroundEventsCore.test.ts` gains `parseReplayEvents` (well-formed body, missing/non-array
`events`, non-object payload — never throws), `hasReplayGap`/`isReplayTruncated` (each flag, and their
absence), and `resolveReplayCursor` (reported-ahead, reported-missing/malformed, reported-behind-observed,
and a modeled two-page truncated tick landing on the correct final cursor) — 9 new assertions, committed RED
first (`test(saturn): RED for the mobile background-runner replay contract (Mars r3 R3-F1)`, confirmed 9
failing / 8 passing before the fix) and not edited afterward; only new test files/cases were added, per the
rule. Removed the now-dead `parseSseFrames` describe block in the same RED commit (dead code, not a behavior
regression — nothing else in the tree imports it after this round).

Full results (after the concurrent `pollOnce()` removal above had landed): `node_modules/.bin/vitest run`
inside `apps/mobile` — 8/8 test files, 72/72 tests green. `node_modules/.bin/tsc -p tsconfig.json --noEmit` is
clean. `npm run build` succeeds (prebuild regenerates `assets/background-runner.js` byte-identically,
confirmed by `tests/backgroundRunnerGenerated.test.ts` and the build's own output). `pnpm run
verify-translation-pairing apps/mobile/README.md` reports "1 named pair(s) consistent" after `--write`
re-recorded `README.i18n.yaml`. Gradle `assembleDebug` and the Xcode scheme's XML well-formedness are
reported verbatim in `report_path` (this note does not restate raw command output per "no doc sprawl").

## Deferred

True push-while-locked delivery via APNs/FCM (out of this cell's scope, unchanged since the feature note);
on-device verification of an actual OS-scheduled tick on either platform.
