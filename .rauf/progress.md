# Progress & Learnings

## Codebase Patterns
<!-- Patterns discovered during development will be logged here -->

## Session Log
<!-- Each iteration appends its learnings here -->

### 001 — Scaffold new core modules (2026-03-25)
- All scaffold files (backlog-root.ts, lock.ts) were already created by previous iterations
- Fixed bug in `resetProject` (`packages/core/src/reset.ts`): clearBacklog was blanking `project` and `description` fields; should preserve metadata and only empty `items[]`
- The core reset.test.ts and CLI backlog-commands.test.ts had contradictory expectations for this behavior — aligned both to preserve metadata
- Pre-existing lint errors in `installer.ts:356` and `schemas.test.ts:204` (unused vars) — not related to multi-backlog work
- Web test `GET /api/config > returns default config` is flaky — fails intermittently with 500 instead of 200
- The barrel export in index.ts uses explicit named re-exports from `./backlog.js` to avoid TS2308 conflicts with constants from `./backlog-root.js` (BACKLOG_FILENAME, STATE_FILENAME)

### 004 — Refactor backlog.ts to accept BacklogPaths (2026-03-25)
- Changing function signatures in core requires updating ALL downstream callers (CLI, loop, web) for typecheck to pass — can't defer to later items
- Added `defaultBacklogPaths(projectPath)` bridge function to `backlog-root.ts` — constructs BacklogPaths for default root without filesystem checks, used by callers not yet migrated to `resolveBacklogPaths`
- Barrel export in index.ts simplified from explicit named re-exports to `export * from "./backlog.js"` since constants removed from backlog.ts eliminated the TS2308 conflict
- CLI loop-commands.test.ts has 3 flaky tests (handleLoopStop, handleLoopFollow, path resolution) that depend on server connectivity timing — pass in isolation, fail intermittently in parallel runs
- Pre-existing format issues in many files (specs, some source files) — not related to this work

### 005 — Refactor status.ts, add scanActiveRoots (2026-03-25)
- Same `defaultBacklogPaths` bridge pattern from item 004 applied to all status function callers
- Multi-line function calls (appendLog with args on separate lines) require separate replace_all passes for each indentation level — single-line replace_all misses them
- Removing NOT_INSTALLED check from deriveStatus (per spec 3.4) cascades to integration and web tests that expected that state — updated both to expect IDLE instead
- Previously exported constants (RALPH_DIR, LOG_FILENAME, DONE_FILENAME, CANCEL_FILENAME) from status.ts now removed; integration.test.ts switched to DEFAULT_ROOT_DIR from backlog-root.ts and inline strings
- scanActiveRoots uses SCAN_SKIP_DIRS cast to `readonly string[]` for `.includes()` compatibility with the `as const` tuple type

### 006 — Refactor iteration-status.ts, archive.ts, reset.ts (2026-03-25)
- Three modules refactored in parallel with agent delegation — worked cleanly since modules are independent
- The `defaultBacklogPaths` bridge pattern continues to work well for downstream callers (CLI, loop, web)
- After core package changes, must run `pnpm build` before `pnpm typecheck` so loop/cli/web packages see updated .d.ts files
- New iteration-status.test.ts file created (didn't exist before); archive.test.ts and reset.test.ts updated
- Pre-existing lint errors (installer.ts:356, schemas.test.ts:204) and format issues (specs/, skills/) still present — not related to this work

### 009 — Update LoopRunner to use BacklogPaths and lock lifecycle (2026-03-25)
- Static factory pattern (`LoopRunner.create()`) works cleanly — returns `Result<LoopRunner>` so callers handle errors via standard Result pattern
- Replaced ~60 occurrences of `defaultBacklogPaths(this.projectPath)` with `this.paths` using `replace_all` — very mechanical
- `startReviewOnly()` also needs `this.instructionPaths` set before calling `runReviewPass()` — easy to miss since it's a separate entry point
- Test that created `LoopRunner` without `setupProject()` first failed because `create()` validates directory existence — added `setupProject` call
- Prompt-builder signatures updated to `(paths, instructionPaths, ...)` with internal bridge `const projectPath = paths.projectPath` — full internal refactor deferred to item 010
- CLI callers needed `return 1` (not bare `return`) since handler functions return `Promise<number>`
- The `defaultBacklogPaths` import was cleanly removed from runner.ts — no longer needed since `this.paths` is resolved in `create()`

### 018 — Single-gate review: suppress per-iteration review hooks in child sessions (2026-06-10)
- Generic mechanism, not plugin-hardcoded: `spawnClaude` gained an optional `env` override (merged over `process.env` only when present, so default behavior — child inherits parent env — is untouched). `packages/loop/src/review-hooks.ts` holds `REVIEW_HOOK_SUPPRESSION_ENV` (currently `ENABLE_CODE_SECURITY_REVIEW=0`) + `resolveChildEnv()`; the map is the extension point and `childEnv` lets callers suppress any env-opt-out hook.
- Two new LoopStartOptions fields: `suppressIterationReview` (friendly opt-in → suppression set) and `childEnv` (generic override, wins over the set). Runner computes `this.childEnv` once in the constructor and passes it to BOTH spawnClaude calls (iteration + review pass).
- CLI flag `--suppress-iteration-review` on `rauf loop run`; also threaded through `rauf loop start` body → web `StartLoopBodySchema` → `LoopStartOptions` for server-mode parity.
- Testing child env through the runner: mock-claude writes `$ENABLE_CODE_SECURITY_REVIEW` to an abs file under tmpDir, then `echo RAUF_DONE`. The default-behavior test must `delete process.env.ENABLE_CODE_SECURITY_REVIEW` first (parent may carry it) — child inherits parent env, so the assertion of "unset" is only deterministic after clearing it.
- The "review at the gate" model is documented in `docs/SPEC-CLI.md` (loop run → "Single-gate review") and `docs/DOGFOODING.md`. Gate = `git diff main..HEAD` / PR hook / `rauf loop review`, never per item. See [[rauf_loop_security_review_altitude]].

### 020 — test-sandbox git isolation: dirty-tree guard + auto-commit pollution (2026-06-10)
- Root cause was deeper than fixture drift: `test-sandbox/` is tracked by the parent rauf repo (no nested git), so the loop's git ran against the PARENT. The dirty-tree guard (`packages/loop/src/git-status.ts`) tripped on any parent dirtiness, and worse, after `RAUF_DONE` the runner's `gitCommit` (`git add -A`) created a real `[rauf] 001: …` commit in the parent history. Proven empirically: `--force` alone makes the sandbox pollute the parent's log — so `--force` is NOT a sufficient fix.
- Fix = isolate the sandbox's git. `setup.sh` creates a throwaway repo at `test-sandbox/.sandbox-git` (NOT named `.git`, so the parent never sees an embedded submodule) on branch `sandbox`, writes `.sandbox-git/` to its own `info/exclude`, and commits a clean baseline each reset. `run.sh`/`verify.sh` `export GIT_DIR/GIT_WORK_TREE` so the loop's guard + commit target that repo: guard sees a clean non-protected branch (no `--force` needed) and commits land in the throwaway repo. Parent HEAD stays unchanged across `verify.sh` (asserted).
- Key gotcha: with `GIT_DIR` set explicitly to a dir INSIDE the work-tree, git does NOT auto-exclude it from status/`add` (unlike a discovered `.git`) — must add `.sandbox-git/` to `$GIT_DIR/info/exclude` or `git add -A` tries to commit the git dir into itself.
- Gitignore `test-sandbox/.sandbox-git/` in the parent. Fixtures still fixed per criterion 2: `.rauf/backlog.json` + `.rauf/RAUF.md` `ralph`→`rauf`, `specs/feature-a/backlog.json` reset to pending to match `scenarios/multi-backlog/` source. Sandbox runs still mutate the tracked `specs/feature-a/backlog.json` (→done) during a run; the next `setup.sh` resets it, so verify.sh stays idempotent. See [[rauf_loop_security_review_altitude]].

### 003 — exit-classifier module (2026-06-11)
- New pure module `packages/loop/src/exit-classifier.ts` (no side effects, only imports the `ParsedSignal` type) — trivially unit-testable. Exports `hasUsageLimitInText`, `ExitClass`, `INFRA_FAST_MS=10_000`, `classifyExit`.
- **Key correctness point for item 005**: the moved `USAGE_LIMIT_PATTERNS` MUST include `"session limit"`. The runner's old private set (`usage limit`/`rate limit`/`claude ai usage limit`/`too many requests`) did NOT match the incident banner `You've hit your session limit · resets 5:30pm`. When item 005 deletes `hasUsageLimitInStderr`/`USAGE_LIMIT_PATTERNS` in favor of this shared helper, keep `session limit` or the incident regresses.
- `classifyExit` precedence (tested per branch): explicit signal done/blocked/needs_human → that class; else usage banner in `reconstructedText ?? stdout` OR `stderr` → usage_limited (checked BEFORE timeout/infra so a fast banner death isn't mis-tagged); else timedOut → timeout; else `exitCode!==0 && durationMs<INFRA_FAST_MS` → infra_error; else genuine_retry. A `review` signal is not an explicit class — falls through.
- Did NOT export from the package barrel (`src/index.ts`) — item 003 notes scope it to in-package consumers only; items 005/006 import directly via `./exit-classifier.js`.
- Root-tsconfig LSP emitted a spurious "not under rootDir '/rauf/src'" diagnostic for the new `.test.ts` — false positive; per-package `tsc --noEmit` (the actual `pnpm typecheck`) is clean.

### 004 — deferred/blocked distinction + paused_usage_limit schema (2026-06-11)
- `BacklogItem.deferred?: boolean` (mirrors needsHuman) marks a RUNTIME "false block" — item keeps status `blocked` plus the flag (no new status enum value, so `VALID_STATUS_TRANSITIONS` is untouched). `updateItem` clears it on transition to BOTH done and pending; `unblockItems` clears it too (parallels its needsHuman clearing). Added `deferred?` to `UpdateItemInput` so the runner (item 006) can SET it.
- Test gotcha: `blocked → done` is NOT a valid transition (`VALID_STATUS_TRANSITIONS.blocked = ["pending"]`). A deferred item reaches `done` only via reset/resume requeue (blocked→pending→in_progress→done), so the "clears deferred on done" unit test must start from `in_progress`, not `blocked`.
- `LoopState.deferredItems` uses `z.array(z.string()).default([])` — the OUTPUT type (z.infer) is required `string[]`, so any literal typed `: LoopState` (the `makeLoopState`/`stateContent` helpers in core test files + `test-helpers.ts`) needs `deferredItems: []` added even though `tsc` excludes `*.test.ts` (the editor LSP flags them; the verify pipeline does not). Old state.json missing the field parses to `[]` (backward compat).
- `writeLoopState` keeps callers ergonomic: param is `Omit<LoopState, "updatedAt" | "deferredItems"> & { updatedAt?; deferredItems? }` and defaults `deferredItems` to `[]`, so existing runner call sites (runner.ts:901) compile unchanged.
- `LoopStateStatus` gained `paused_usage_limit` (clean usage-limit halt, item 007). It maps to the existing PAUSED-like derived state — NO new `LoopStateEnum` value: `mapLoopStateStatus` → `"PAUSED"`, and `parseDoneFileState` checks `paused_usage_limit` BEFORE the generic `limit`→LIMIT_REACHED rule so a resumable pause isn't mistaken for the terminal limit state.
- Pre-existing latent type errors surfaced by the LSP in excluded test files (NOT my regression, NOT blocking verify): `status.test.ts` `makeLoopState` returns `updatedAt: string|null` which mismatches `writeLoopState`'s `updatedAt?: string` param; `integration.test.ts:706` has a `status: "completed"` typo (should be `"complete"`). Both live in `*.test.ts` excluded from `tsc`.

### 005 — detect usage-limit banner in stdout/stream, not just stderr (2026-06-11)
- The load-bearing one-line fix: in `runIteration` the pre-signal usage check now runs AFTER `signalText` (`reconstructedText||stdout`) is computed and scans `hasUsageLimitInText(stderr) || hasUsageLimitInText(signalText)` (was stderr-only via the private `hasUsageLimitInStderr`). The incident banner `You've hit your session limit · resets 5:30pm` arrives in the reconstructed stream, never stderr — so the old check missed it, the signal parsed as `none`, and the item was wrongly retried→blocked (all 24 false blocks). Kept the `exitCode !== 0` guard and the existing routing (reset item→pending, `handleStderrUsageLimit` sleep-or-exit).
- Deleted runner.ts's private `USAGE_LIMIT_PATTERNS` + `hasUsageLimitInStderr` in favor of the shared `hasUsageLimitInText` from `./exit-classifier.js` (item 003). The old private set lacked `session limit`; the shared one has it — that's exactly why the migration fixes the incident.
- Sandbox scenario `scenarios/usage-limit-stdout.sh`: emits the banner via a `text_delta` (so it lands in `reconstructedText`) then `exit 1`. **Test-runtime gotcha**: the no-token usage path (`~/.config/claude-code/credentials.json` is absent here AND in CI — the real creds live at `~/.claude/.credentials.json`, a different path) does a flat 60s `interruptibleSleep` (only abortable via the AbortController, NOT the CANCEL file). So verify.sh runs this scenario in the BACKGROUND, polls state.json for `sleeping_limit` (appears in ~1-2s), then `kill`s the process. The item is reset to pending BEFORE the sleep, so it stays pending no matter how the process is stopped — no parent-git pollution (usage path never commits). Assert: item pending + state sleeping_limit + log "Usage limit detected".

### 006 — route no-signal exits through exit-classifier; never block on a missing signal (2026-06-11)
- The old `case "review": case "none":` block did retry→block-after-maxRetries. Now its body calls `classifyExit(claudeResult.value, parsed)` (item 003) and dispatches on the `ExitClass`. `claudeResult.value` already has exactly the `ExitResult` shape (`exitCode/stdout/stderr/reconstructedText/timedOut/durationMs`), so it's passed verbatim — no adapter. The OUTER switch is still on `parsed.signal`; classifyExit is only reached for review/none, so it can only return usage_limited/timeout/infra_error/genuine_retry (the explicit done/blocked/needs_human are handled by their own outer cases).
- Mapping: **usage_limited** → reset item→pending, `currentItemId=null`, `handleStderrUsageLimit()`, `return` its continue/exit (belt-and-suspenders with item 005's pre-signal check). **timeout** → genuine block, reason `Timed out after <s>s`. **infra_error** → item stays **pending**, `consecutiveInfraFailures++`, NO block (this is the core "never block on a missing signal" guarantee). **genuine_retry** → existing retry-up-to-maxRetries; on exhaustion status `blocked`+`deferred:true`, reason `No signal after N attempts (deferred by runner)`, push to `deferredItemIds` (NOT `blockedItemIds`).
- **Deferred ≠ blocked in the counts**: deferred exhaustion does NOT increment `blockedCount` and does NOT push to `blockedItemIds` — only `deferredItemIds`. It still emits `item_blocked` (no `item_deferred` event exists; adding one would touch core schemas, out of scope for 006) and writes state `error`. The item's backlog status is `blocked` + `deferred:true`, distinguishing it from a genuine agent block.
- New class fields `deferredItemIds: string[]` and `consecutiveInfraFailures = 0` (after needsHumanItemIds, ~84-88). `writeState` now passes `deferredItems: this.deferredItemIds`; `buildSummary` appends `deferred=N deferred_items=…` when non-empty. The literal token "deferred" contains no `human`/`limit`/`error` substring, so `parseDoneFileState` still classifies an otherwise-clean run COMPLETE (verified — checked status.ts:195-204).
- `consecutiveInfraFailures` is reset to 0 on every real outcome (done/blocked/needs_human/timeout/genuine_retry) and incremented only on infra_error. Item 008 adds the breaker that ACTS on it; I only maintain the counter here.
- Test update: `runner.test.ts` "retries on 'none' signal and blocks after maxRetries" → renamed to "…and DEFERS (not blocks)…". The mock `echo "random output"` exits **code 0** → genuine_retry (not infra: infra needs exitCode!=0 && <10s). New asserts: `blockedCount===0`, backlog item `status==="blocked"` + `deferred===true` + reason contains "deferred by runner", `state.deferredItems` contains "001" while `state.blockedItems` does not. All OTHER `blockedCount===1` tests use explicit `RAUF_BLOCKED` and are unaffected.
