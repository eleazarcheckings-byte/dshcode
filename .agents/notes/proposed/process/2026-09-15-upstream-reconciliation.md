# Agent Note: Upstream reconciliation with deepseek-ai/deepseek-harness

Status: proposed

English | [中文](2026-09-15-upstream-reconciliation.zh.md)

## Problem

`dshcode` (`origin` = `whitelonng/dshcode`) is a fork of DeepSeek's `deepseek-harness`. Twenty `@saturnai/*` packages and a repository-wide rebrand sit on top of it. This session's own siblings are committing to the same repository concurrently, so `HEAD` moves turn over turn — every count in this note is therefore pinned to one explicit commit, printed beside the number, rather than to the floating `HEAD`. The fork has not taken an upstream release since `dsh-v0.1.2-alpha.4` (`4e84901e6471b79ec0338099867ebb4606d12bb5`, 2026-09-01). Nine upstream releases have shipped since then, the newest `dsh-v0.1.6-alpha.1` (`0a15e36e7f82b6ed45af6fa9759f29b40dcd965d`, 2026-09-15) — including an MCP SDK v2 upgrade, a subagent/Team-mode rewrite (`spawn_teammate` replacing `subagent`/`subagent_fork`, teammate cap 8 → 16), a DeepSeek-adapter protocol switch (Messages replaces the old completions default), and a `PTC`/`workflow` package rename family. Deciding whether and how to take these releases — before divergence compounds further — needs a real conflict estimate, not a guess.

## Proposal

**Round-3 correction: the tag-side conflict count was obtainable, and it is now the primary measurement.** `origin/master` and `upstream-dsh/master` (`https://github.com/deepseek-ai/deepseek-harness.git`, remote `upstream-dsh`, fetched — 17 tags, `master` at `0d1f500`) share no common ancestor: `git merge-base origin/master upstream-dsh/master` exits 1, and `git merge-base --is-ancestor dsh-v0.1.2-alpha.4 HEAD` also exits 1, even though the fork's own `REBRAND.md`/recon record it as descending from that version — `whitelonng/dshcode` was built as a content snapshot of upstream at some point, not a preserved fork. `git merge-tree --write-tree HEAD <upstream-tag>` accordingly fails outright (`fatal: refusing to merge unrelated histories`), and `--allow-unrelated-histories` does not return inside this session's 8-minute command cap on this ~460k-object monorepo. But the **legacy 3-argument `git merge-tree <base> <ours> <theirs>` form takes an explicit base and needs no shared history** — it does not require `origin/master` and `upstream-dsh/master` to be related, only that a base commit is named. That command is the real conflict measurement this note was missing; the file-overlap proxy below is demoted to a lower bound.

### Primary measurement — real 3-way merge-tree conflicts

`git merge-tree dsh-v0.1.2-alpha.4 <SHA> dsh-v0.1.6-alpha.1`, run against this cell's own commit `e92f2e7c725a62078de5c73138bf5c02be6ccb98` (2026-09-15T16:21:22-04:00) as `<SHA>` — exit 0, **45 s**, 1,368,118 lines of output:

| Merge-tree category | Count |
|---|---|
| `changed in both` (files both sides edited) | **734** |
| `merged` (clean auto-merge, no marker) | 2,854 |
| `added in both` | 20 |
| `added in remote` (upstream-only new files) | 4,096 |
| `removed in one` (41 removed-in-local + 1,731 removed-in-remote) | **1,772** |
| **Files carrying real `<<<<<<<` conflict markers** (`grep -c '<<<<<<<'` = 902 marker occurrences, deduplicated to distinct files across the `changed in both` **and** `added in both` blocks) | **353** |

**Round-3 correction:** the dedup pass behind the 338 figure a prior round reported scanned only `changed in both` blocks. `git merge-tree` conflict-marks an `added in both` entry exactly the same way it marks a `changed in both` one whenever the two sides independently add the same path with different content, and 15 `added in both` files carry markers that prior pass had missed entirely. 338 (`changed in both`) + 15 (`added in both`) = **353** distinct conflict-marker files, the two sets sharing no file in common. The 15: four archived Agent Note pairs under `.agents/notes/archived/` — `architecture/2026-08-10-message-feedback-sidecar.md`/`.zh.md`, `feature/2026-08-11-message-feedback-web-surface.md`/`.zh.md`, `process/2026-07-27-dependabot-version-updates.md`/`.zh.md`, `simplification/2026-07-31-drop-user-message-edit-stub.md`/`.zh.md` (8 files) — plus the entire `apps/desktop` shell: `README.md`, `README.zh.md`, `package.json`, `src/main.ts`, `src/preload.ts`, `tsconfig.json`, `tsdown.config.ts` (7 files). **`apps/desktop` is itself an added-in-both collision, not a hypothetical one worth flagging in the abstract** — both histories independently created a desktop shell at this exact path, and the desktop release lane is active in this repository (`apps/desktop/RELEASE.md` and `electron-builder.yml` already exist here), so a future reconciliation attempt will hit this collision for real.

The 353-file conflict-marker set, by top-level path (git version 2.53.0.windows.2):

`packages/` 165 (**82** distinct package directories, not 42), `snapshots/` 69, `apps/` 61, `docs/` 18, root/other 12, `scripts/` 11, `.agents/notes/` 17 — total 353.

The 734-file `changed in both` set (every file both sides touched, conflict-marked or cleanly auto-mergeable) — the outer bound used below:

`packages/` 453 (**204** distinct package directories), `snapshots/` 98, `apps/` 78, `docs/` 51, root/other 22, `scripts/` 19, `.agents/notes/` 13 — total 734.

### Lower-bound proxy — file-level identity overlap (kept, demoted)

The file-overlap measure from the prior round is retained as a cheaper, cross-check lower bound, not the headline number:

1. `git diff --name-only origin/master..e92f2e7c725a62078de5c73138bf5c02be6ccb98` (`origin/master` = `058e9f949ca15bcd973164d4d4e9218923f4eb26`) → **1,160 files** — Saturn's total change surface at this SHA (this number moves every time a sibling cell commits in this shared repo; it was 947 at the note's first draft and 974 at Mars's r2 measurement).
2. Of those, **827 files** sit outside the (corrected — see Findings) **20** `@saturnai/*` package directories, counted via `git ls-tree -r --name-only e92f2e7c725a62078de5c73138bf5c02be6ccb98 | grep package.json$` and grepping each blob for `"name": "@saturnai/`, not by directory-name guessing.
3. `git diff --name-only dsh-v0.1.2-alpha.4..dsh-v0.1.6-alpha.1` → **8,570 files** (tag-to-tag; independent of our HEAD).
4. Intersection of (1) and (3) → **457 files** (was 436 at the prior HEAD), spanning **46** distinct shared packages (was 42): `packages/` 168, `snapshots/` 184, `apps/` 61, `docs/` 21, `scripts/` 10, root/other 8, `.agents/notes/` 5 (same 5 paths as before: the agent-teams Agent Note triplet plus two workspace-alias/agent-teams-web `.i18n.yaml` files).

This proxy is now demonstrably a **lower bound on the package dimension only, not a working file-level estimate**: its distinct-package count (46) is barely half the primary measurement's 82. On the file dimension it is not a lower bound at all — 457 exceeds the corrected 353-file conflict-marker set outright — and the two sets disagree on which files carry real risk: the proxy is a path-identity set that **neither contains nor is contained by** the conflict-marker set. It includes files that in fact merge cleanly (present on both sides at the same path, absent from the 353), and it misses files the 3-way merge marks conflicted whose path never entered the tag-to-tag/HEAD-to-`origin/master` intersection this proxy samples.

**Upstream features since `dsh-v0.1.2-alpha.4`** (GitHub Releases API, `deepseek-ai/deepseek-harness`, English release-note bodies; dates are `published_at`) — unchanged from the prior round, not re-verified this round because no fix named it:

| Release | Date | Notable for Saturn |
|---|---|---|
| `0.1.2-alpha.5` | 2026-09-02 | Bug-fix only (upgrade-path session-title regression). |
| `0.1.2-rc.1` | 2026-09-03 | 71-item release. Subagent model selection (provider/model/reasoning-effort/max-output per call, plus Claude Code/Codex model config) — directly overlaps C6's model-router mandate; `send_message` replaces one-way `report` for parent↔child agents — overlaps C5's agent-team work; public `WebFetch` enabled by default with SSRF protection; `Session.events` replaced by `seq`/`eventAt()`/`snapshotEvents()`; Remote gateway replaces legacy APIProxy; Rename Code Mode → PTC mode. |
| `0.1.3-alpha.1` | 2026-09-04 | Arbitrary-file-type Web uploads; **breaking**: Session persistence now owned by lifecycle-scoped `SessionHandle`s, `agentLoop.create()` becomes async, one-process-per-session lock; Session format v2 migration. Known perf regression flagged by upstream itself, unresolved in this release. |
| `0.1.3-alpha.2` | 2026-09-07 | pi-ai upgraded to 0.85.1 (new models); continuable-subagent message queue/edit/delete/steer/stop. |
| `0.1.5-alpha.1` | 2026-09-08 | Dynamic system-prompt edits without breaking KV cache; experimental right Sidebar (multi-tab/split/fullscreen); bundled Codex 0.153.4 / Claude Code 2.1.263 runtimes for the optional subagent-provider plugins — directly relevant to C6's `dsh-subagent-claude-code`/`dsh-subagent-codex` rows. |
| `0.1.5-alpha.2` | 2026-09-09 | Sidebar document preview (Markdown/code/HTML/PDF/image); models can explicitly deliver files into the sidebar. |
| `0.1.5-rc.1` | 2026-09-10 | `DeepSeek-V41-Flash` model default for new sessions. |
| `0.1.5-rc.2` | 2026-09-10 | UX polish only (feedback dialog, delivered-file card layout). |
| `0.1.6-alpha.1` | 2026-09-15 | Web-sidebar terminals; archived-session list; MCP resource discovery + URI templates + official SDK v2 (protocol negotiation, tool pagination); Headless stdin tasks + `--session-id` resume + `--json` event stream; SSH-remote-workspace file/command/PTC tools; experimental Browser Use (Playwright MCP / Chrome DevTools MCP / Stagehand) and experimental Computer Use (Cua Driver MCP / native driver) — both pre-empt ground SPEC §3's C7 (`tool-media`) and any future Saturn browser-automation work claims as novel; experimental Auto-review mode. **Breaking/chores**: DeepSeek adapter defaults to the Messages protocol (old completions root URL must be removed or repointed to `/anthropic`); Ralph disabled by default; built-in E2B backend removed; PTC package/service family renamed to `ptc-runtime` (no legacy aliases); workflow executor renamed to `workflow-ptc` (Python PTC unsupported); `agent/session-start` replaced by async `agent/created`; **Team mode: `spawn_teammate` becomes the only path, `subagent`/`subagent_fork` disabled, default teammate cap raised 8 → 16** — this is the same surface C5 is modifying this session (`packages/saturn/agent-team`, `packages/saturn/tool-agent-team`) and needs to be read before, not after, a future vendor-bump attempt. |

## Recommendation

**Unchanged: deliberate divergence, with selective cherry-picking of named upstream commits — not a vendor-bump.** The two histories share no common ancestor; the real 3-way `merge-tree` run above proves it directly rather than by inference — 353 files carry actual textual conflict markers, not merely path overlap. Nothing in the primary measurement points the other way; if anything the larger true conflict surface (82 packages, not 42) makes an all-at-once vendor-bump attempt *less* attractive than the prior round estimated, not more. Cherry-picking the handful of upstream commits that matter (MCP SDK v2, subagent model selection), evaluated and landed one at a time, still carries a fraction of the risk of absorbing all nine releases at once, and still lets each pick get its own writer≠reviewer pass.

**Re-derived effort estimate, from the primary conflict-marker set (bucket-per-package basis, same ~0.5–1 engineer-day/package heuristic as before) with the `changed in both` set as the outer bound:**

| Bucket | Primary (353 conflict-marker files, 82 packages) | Outer bound (734 changed-in-both files, 204 packages) |
|---|---|---|
| `packages/` (risk-bearing core, ~0.5–1 day/package) | 82 pkgs × 0.5–1 day → **41–82 days** | 204 pkgs × 0.5–1 day → **102–204 days** |
| `snapshots/` (bulk regeneration, not per-file) | 69 files → **1–3 days** | 98 files → **2–4 days** |
| `apps/` + `docs/` + `scripts/` + root/other + `.agents/notes/` (single reconciliation pass) | 119 files → **2–4 days** | 183 files → **3–6 days** |
| **Total** | **roughly 44–89 engineer-days** | **roughly 107–214 engineer-days** |

This replaces the prior round's 30–40 engineer-day estimate, which was built on the 436/42-package proxy and is now shown to be a lower bound rather than a working number — the true range (primary measurement) is **about 1.2–2.2x higher**, and the outer bound is **2.7–5.3x higher**. The recommendation itself does not change: divergence with selective cherry-picking, not a vendor-bump; a larger true effort argues for cherry-picking the highest-value commits (MCP SDK v2, subagent model selection) even more strongly, since absorbing everything at once is now shown to be a bigger undertaking than previously stated, not a smaller one.

**Trigger that would flip this recommendation toward an active vendor-bump attempt:** unchanged from the prior round — either the MCP SDK v2 upgrade or the Team-mode `spawn_teammate` rewrite becoming load-bearing for Saturn (a Saturn package coming to depend on protocol or capability surface only the new upstream code provides). At that point the cost of *not* reconciling exceeds the cost of doing it, and the calculus in this note should be re-run against upstream's state at that time, not this one.

**Decision stays with izzy** — this is a recommendation he can reject, not a plan already put in motion.

## Alternatives considered

- **Run `git merge-tree --allow-unrelated-histories` to completion regardless of time.** Rejected for this session: it did not finish in 8 minutes on a monorepo this size with no shared history between `origin/master` and `upstream-dsh/master` directly, the mandate caps commands at 8 minutes, and a half-finished background job proves nothing actionable. The legacy 3-argument form above solves the same problem in 45 s by taking an explicit base instead, so this alternative is no longer needed to get an exact count — it would only add value beyond what the primary measurement already provides if izzy wants the true `origin/master`-vs-`upstream-dsh/master` graph merged rather than the tag-anchored one used here.
- **Treat "1,160 files diverge from origin/master" itself as the conflict count.** Rejected: that count includes Saturn's own new packages and rebrand-only text with zero upstream counterpart, wildly overstating risk.
- **Treat the file-identity proxy (457/46) as the headline number.** Rejected this round: it is a real lower bound, cheap to compute, and worth keeping as a cross-check, but the primary `merge-tree` measurement is now available at acceptable cost (45 s) and is the actual conflict signal a reconciliation plan should be built on.
- **Skip the release-note read and infer features from commit subjects only.** Rejected: DeepSeek's release notes are the only accurate feature-to-date mapping (commit graphs are unrelated-history noise here), and several entries (Team-mode rewrite, MCP SDK v2, Browser/Computer Use) are exactly the kind of "do we already have this" question SPEC's intake explicitly asked C11 to answer.
- **Recommend an immediate vendor-bump.** Rejected, more strongly than before: the underlying histories are unrelated, upstream shipped a one-million-line diff with multiple explicit breaking changes across the same span Saturn's 20 packages were built against, one of upstream's own releases (`0.1.3-alpha.1`) shipped with a self-reported unresolved performance regression, and the real conflict-marker count (353 files, 82 packages) is now known to be larger than the proxy suggested.

## Acceptance criteria

- `git remote -v` in `R` lists `upstream-dsh` → `https://github.com/deepseek-ai/deepseek-harness.git` (added and fetched this session; harmless to leave, fetches no LFS/credentials).
- `git merge-tree --write-tree HEAD origin/master` (control case, common ancestor exists) resolves clean — recorded above as the tool-sanity check.
- **Every count in this note is reproducible at the stated SHA** (`e92f2e7c725a62078de5c73138bf5c02be6ccb98` for the HEAD-anchored numbers, the two named tags for the tag-anchored ones, `058e9f949ca15bcd973164d4d4e9218923f4eb26` for `origin/master`) via: `git merge-tree dsh-v0.1.2-alpha.4 <SHA> dsh-v0.1.6-alpha.1` (primary conflict measurement), the two `git diff --name-only` commands (lower-bound proxy), `git diff --stat dsh-v0.1.2-alpha.4 origin/master` (baseline drift), and one GitHub Releases API call. Because siblings commit to this repository concurrently, re-running against a *different* SHA will not reproduce the same numbers — that is expected, not a defect in the method.
- Nothing in `R` was merged, rebased, or reset; the only commit this cell added is this note (single parent, no merge commit).

## Risks

- **Even the 353-file conflict-marker set can undercount semantic risk.** A textual conflict marker says two sides touched overlapping lines; a file that merges *cleanly* (part of the 2,854 `merged` files, or the 396 `changed in both` files with no marker) can still be wrong afterward if the two sides changed related logic in non-overlapping lines — e.g. one side renaming a function the other side calls. Treat 353/82 as a **better lower bound than the 457/46 proxy, still not a ceiling**.
- **Undisclosed baseline error, now measured.** `git diff --stat dsh-v0.1.2-alpha.4 origin/master` → **1,027 files changed, +51,922/-2,473**. The note treats `dsh-v0.1.2-alpha.4..dsh-v0.1.6-alpha.1` as "what upstream touched since the fork's baseline," but the fork's own `origin/master` already differs from that tag by over a thousand files — this is reconciliation work of its own (whitelonng's rebrand/snapshot process drifting from the tag it claims to descend from) and is **counted in none of the effort buckets above**. Any vendor-bump or cherry-pick plan built from this note should budget separately for reconciling that pre-existing drift, not assume `dsh-v0.1.2-alpha.4` is an exact stand-in for `origin/master`.
- **Nine releases in fourteen days is a fast-moving target.** Any plan drafted from this note stales quickly; re-run the primary `merge-tree` command, the two `git diff --name-only` commands, and the Releases API call immediately before actually attempting a bump or a cherry-pick, at whatever SHA is current then.
- **This session's own HEAD moves under concurrent sibling commits.** Every HEAD-anchored number in this note names the exact SHA it was measured at; a re-run against a later HEAD will show different (likely larger) totals for the proxy measurement, by construction, and is not evidence of a counting error.
- **Decision stays with izzy per SPEC §3 C11**: the Recommendation above names one path with a bounded effort estimate and a trigger to revisit it, but nothing has been acted on — it is his call to accept, adjust, or reject.
