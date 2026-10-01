# Changelog

## Unreleased

### Upgrade notes / behavior changes

- **`copilot` is now a dedicated provider, not a plain-text preset (#131).** `--agent copilot` drives `copilot --output-format json` (JSONL), reconstructs the agent's text from `assistant.message` records for signal parsing, and emits tool activity (`tool.execution_start`/`complete`) to events and the stuck detector. Token telemetry is not available. The prompt is delivered by a private temp file the agent is told to read, not on stdin. Copilot is allowed read/write/shell tools but `git commit`/`git push` are denied: rauf still owns the commit. `providerConfig` is rejected for `copilot` in `.rauf.json`.
- **`rauf agents` table columns changed.** `AVAILABLE` is split into `BINARY` (`present`/`missing`) and `AUTH` (`ready`/`not ready`/`unknown`). `--json` rows gain `binaryAvailable` and `authenticated` (`true`/`false`/`null`); `available` is unchanged.
- **The web start body is now strict.** `POST /api/projects/:id/loop/start` rejects unknown fields (400) instead of ignoring them.

### Added

- **Copilot failure classification (#131).** Auth, invalid-model, permission, malformed-output and no-signal Copilot exits are classified and logged (`copilot failure classified as …`); startup failures count toward the existing infrastructure circuit breaker instead of burning retries.
- **Portable provider selection (#131).** `rauf loop review --agent <id>` and `--no-model`; `rauf install`/`init --agent <id>` set the project default agent; the web review and resume bodies accept `provider` and `ignoreItemModel` (a resume's pending-review rerun honors them too).
- **Native Copilot operator bundle (#131).** `adapters/copilot/` is an Agent Plugins bundle generated from the canonical skills and agents by `pnpm copilot:generate` (`pnpm copilot:check` reports drift). It ships all four skills and the `rauf-backlog-reviewer` and `rauf-loop-driver` custom agents. Each agent is limited to `read`/`search`/`execute` (no edit tool), cannot call subagents, is not user-invocable, and has its required canonical skill (`review-backlog` / `drive-rauf-loop`) written into its body, because Copilot agents have no skill-dependency field. Unknown frontmatter keys, tool aliases or required skills fail generation. `COPILOT-BUNDLE-REPORT.md` lists each source, mapping and dropped field.
- **`AgentStreamEvent`** is the provider-neutral name for the loop's stream event union; `ClaudeStreamEvent` remains as a deprecated alias.

### Changed

- **`author-backlog` no longer names Claude's `Task tool`.** The `agentDelegation` guidance now says the loop agent uses its host's subagent or delegation mechanism when one is available. The Codex, Pi and Copilot copies were regenerated.

## 0.18.0

### Upgrade notes / behavior changes

- **`drive-rauf-loop` now prescribes the wait loop.** Step 2 is "wait on `rauf loop wait`, decide from `status --json`" (the 5 s poll remains for hosts that can't block). A new "Supervising from your harness" section gives the Claude Code / Pi / Codex recipes and one hard rule: never end the turn while a supervised loop runs unless your host wakes you. The decision tree is unchanged; row 12 now says "keep waiting". Agents and tools that cite Step 2 should re-read it. (#155)
- **`rauf install` now gitignores supervisor state.** It adds `**/.rauf/supervisors/` and `**/.rauf/.forge-supervisor.json` to `.gitignore`, and the runner never commits them. They hold the Pi extension's mirror, Codex Stop-hook markers and feature-forge's legacy Pi mirror. Re-run `rauf install` (or `rauf update`) to pick up the entries. (#154, #156)
- **`item_completed` is now emitted after the per-item commit, not before it.** The event can then name the commit. It still comes before the next `item_selected`, and `state.json` already reads the item as done when it arrives. A consumer that ran `git log` on `item_completed` expecting the commit not to exist yet will now find it. (#153)

### Added

- **rauf's Pi package ships a loop supervisor extension (#154).** `pi install npm:@garygentry/rauf` now loads `rauf-loop-supervisor` beside the skills. It adds four tools:
  - `rauf_loop_launch`: starts `rauf loop run <root> --backlog <dir> --detached` and supervises the run. A refused start (dirty tree, protected branch) is reported, not mistaken for a launch.
  - `rauf_loop_status`: `rauf status <root> --backlog <dir> --json`. This fixes feature-forge's root-less query, which always failed with `missing_target`.
  - `rauf_loop_wait`: a bounded `loop wait`.
  - `rauf_loop_stop`: scoped to the backlog, and it refuses a blind stop.

  Each completed item is posted as a card (`sendMessage` with `triggerTurn: false`: saved, visible, in the model's context on its next turn, no model call). The session is woken on needs-human, blocked, stuck, review failure, loop errors, long sleeps and completion. A footer status (`● 7/26 · on 008 · healthy`) and a widget with the last 5 cards track the run. A `tool_call` guard blocks foreground, `nohup`/`setsid`/`&` and subagent loop runs, and points the agent at `rauf_loop_launch`. A bash `--detached` launch is allowed and attached automatically. A restarted session reattaches without repeating reports, including to loops launched by feature-forge's retired `forge-loop-supervisor`. A run that finished while no session was attached is announced once, as stale. The source is in `adapter-src/pi/` (a workspace package with its own tests); `pnpm pi:generate` copies it into `adapters/pi/` and `npm-dist/`, and vendors `@rauf/core`'s card formatter.

- **`rauf hook codex-stop` (#156).** A Codex Stop hook that keeps a Codex session supervising a loop it launched or is waiting on: while that loop runs, it blocks the session from ending its turn and gives it the exact next `rauf loop wait`.
  - **Markers:** `loop wait` and `loop run --detached` record the session (`$CODEX_THREAD_ID`, or `$RAUF_SUPERVISOR_ID`) in `<stateDir>/supervisors/<id>.json`.
  - **When it lets go:** when the loop ends or pauses for a human, while it sleeps on a usage limit, and after 3 stops in a row with no `loop wait` in between.
  - **Setup:** `--print-config` prints the `hooks.json` entry. See SPEC-CLI for install and trust.
- **`rauf loop run --detached` prints a `Wait:` line**: the `rauf loop wait … --since-seq N --run-id R` to start supervising from.
- **`rauf loop wait` (#152).** A bounded, blocking wait for supervising agents: it returns at the first _significant_ loop event after `--since-seq` (an item completed or blocked, needs-human, a stuck warning, a review failure, a long sleep or weekly limit, the loop ending), or at `--timeout` (default 240s). It prints one card, or with `--json` an object `{event, card, nextSeq, runId, runChanged, loopState, progress, terminal, timedOut}`. Exit codes: `0` event, `10` timeout while the loop is live, `11` the loop ended and you are caught up, `2` usage. Pass back `nextSeq` and `runId` each call. A new run (log rotation) is replayed from seq 0, not skipped. A live `.loop.lock` counts as running even while `state.json` still reads the previous run's end. `--notify-cmd <cmd>` runs a shell command with `$RAUF_CARD` on exceptions and loop end. The decision surface stays `rauf status --json`. See SPEC-CLI and the monitoring guide.
- **Enriched `item_completed` (#153).** New optional fields: `commitSha` (full sha of the `[rauf] <id>:` commit), `filesChanged`, `durationMs` (item selection → completion), `attempt` (agent spawns for the item in this run), `doneCount`/`totalCount` (backlog progress) and `summary`. A commit-recovered completion carries the agent's own commit. Older records parse unchanged; the events `schemaVersion` stays `1`.
- **`RAUF_SUMMARY:` iteration contract line (#153).** On success the iteration agent may put one `RAUF_SUMMARY: <text>` line directly above `RAUF_DONE`. It is sanitized (single line, no control characters, ≤120 chars) and carried as `item_completed.summary`. It is optional, and is read only on the nearest non-blank line above `RAUF_DONE`. The runner's prompt now mentions it, so already-installed projects get it without re-installing. The RAUF.md template and the CLAUDE/AGENTS addons describe it too.
- **Shared supervision cards in `@rauf/core` (#153).** `formatItemCard`, `formatSupervisionCard`, `formatLoopEndedCard`, `isSignificantEvent`, `isRunEndingEvent` and `sanitizeSummary` render one deterministic line per event, e.g. `[7/26] ✓ 008 Add login form — wired the form to /api/login · abc1234 · 5 files · 6m`. `loop wait` prints it, and `follow` now uses it for `item_completed`.

### Fixed

- **Usage-limit percentages were shown 100× too large.** `usage_limit_hit.utilization` is already a 0–100 percentage, but `follow` and the web status page multiplied it by 100 (`util 10000%`). They now print it as is, as the new supervision card does.

## 0.17.1

_Released 2026-09-30._

### Upgrade notes / behavior changes

- **`rauf status` now exits 1 for a run whose review pass is still pending.** An `IDLE`/`COMPLETE` status with `reviewPending: true` used to exit 0, so a script branching on `$?` read an unfinished review as a clean finish. It now exits 1 (ERROR), the code `loop run --review` returns for the same failed review, and this takes precedence over BLOCKED (5), in the same order as `loop run`. A review interrupted by a stop or a usage limit keeps its state's own code (`PAUSED` 0/5, `PAUSED_USAGE_LIMIT` 4). The human `rauf status` view gains a `Review: pending (N items)` line. (#149)
- **`rauf loop run` and `rauf loop review` now exit 2 when another live loop holds the root's `.loop.lock`** (`lockConflict`). A refused run no longer deletes the holder's lock or rotates its event log, and a standalone review (`loop review`, `resume`'s review re-run, web review routes) now takes the lock for its whole duration, so it is refused the same way. Scripts that start a run or review on a root that may be busy should handle exit 2. (#149)
- **Web `POST /api/projects/:id/loop/start` returns 409 when another process holds the root**, instead of `started: true` for a run that never starts. Web Resume re-runs a pending review (`reviewRerun: true`) and returns 409/500 when that review cannot start. (#149)

### Fixed

- **The web status page now shows a pending review and usage-API disagreements (#149).** A `reviewPending` status renders a "Review pending" notice naming the review's items (`reviewItemIds`) and the resume remedy. A `usage_limit_hit` event with `reason: "usage_api_disagreement"` renders "banner unconfirmed by usage API ×N" (from `consecutiveDisagreements`), as the CLI event views do.
- **Web Resume now re-runs a pending review (#149).** `POST /api/projects/:id/resume` re-runs a pending review over exactly its `reviewItemIds` instead of relaunching the loop, as `rauf resume` does, and reports it as `reviewRerun: true`. It used to ignore the pending review and answer "no eligible items" when every item was done. It follows the CLI ordering: with no work left it skips recovery, and it surfaces interrupted uncommitted work before recovering anything, so the pending marker is never deleted before the review launches (after a recovery it is restored first). A review that cannot start returns 409/500 and shows as an error. The status page's Resume button is now enabled for a pending review even when every item is done, but not while a live loop owns the root (for example a review sleeping out a usage limit). `readPendingReview` moved from the CLI into `@rauf/loop`, next to the new `restorePendingReview`, so both use the same code.
- **A standalone review now holds the loop lock (#149).** `LoopRunner.startReviewOnly()` (`rauf loop review`, `rauf resume`'s review re-run, and the web review routes) never took `.loop.lock`, so a `loop run`, resume or second review could start on the same root mid-review. It now holds the lock for the whole review. If a live loop already holds it, the review does not start (`lockConflict`; `rauf loop review` exits 2) and a pending review is left alone.
- **A refused `loop run` no longer deletes the live loop's lock or rotates its event log (#149).** `start()` rotated `events.ndjson` before trying the lock, and its `finally` released the lock even when acquiring it had failed. A second run started against a live loop removed that loop's `.loop.lock` and archived its event log. It now takes the lock synchronously before its first await, releases only a lock it holds, and reports the refusal (`lockConflict`, `loop run` exit 2) without writing to the holder's event log. The web server takes the lock at launch, so `POST /loop/start` returns 409 instead of `started: true` when another process holds the root.
- **`rauf resume` and web Resume hand their lock straight to the run (#149).** They used to release the recovery lock and then launch the loop or review, which re-acquired it. In that gap another loop could take the root: the web reported a relaunch that never ran, or a competitor overwrote a restored pending-review marker. The in-process run now adopts the held lock (`LoopRunner.adoptRunLock`), so there is no gap. A `rauf resume --detached` relaunch keeps the old release-then-launch handoff and still delegates to the server.
- **A restored pending-review marker keeps the run baseline (#149).** After recovery it is rebuilt from the pre-recovery state (status normalized to `idle`), so `baseCommitHash` survives. A failed review launch followed by a second resume no longer runs unbounded commit reconciliation, which could mark a fresh item done on a prior cycle's `[rauf] <id>:` commit.
- **Monitoring guide:** exit `4` is a usage limit only; a spent iteration budget (`ITERATIONS_COMPLETE`) exits `0`/`5`.

## 0.17.0

_Released 2026-09-30._

### Upgrade notes / behavior changes

- **`rauf loop run --review` now exits 1 when the review pass fails** (it used to print "Loop finished" and exit 0), and `rauf loop review` exits 1 on a failure and 4 on a usage stop instead of reporting "no issues found". Scripts and CI jobs that run `--review` should treat exit 1 as a failed review. A failed or interrupted review stays pending (`state.json`/`status --json` `reviewPending` + `reviewItemIds`) and `rauf resume` re-runs it via `rauf loop review --items`. (#146)
- **A legacy (pre-0.11) `limit_reached` state now derives `ITERATIONS_COMPLETE` (or `COMPLETE` when the backlog is drained), exit 0 / 5, not `LIMIT_REACHED` exit 4.** `LIMIT_REACHED` stays parseable but is deprecated and never derived. (#144)
- **DONE-file status fallback classifies by leading status token.** The budget stop's DONE file now starts `iterations_complete:`, and with no `state.json`, `weekly_limit:`, `paused_usage_limit:`, `cancel` and `error:` files map to `WEEKLY_LIMIT`, `PAUSED_USAGE_LIMIT` (exit 4), `PAUSED` and `ERROR`. (#144, #146)
- **Supervisors: the `drive-rauf-loop` decision table changed.** It gains a "Budget spent → resume" branch, splits `COMPLETE` into "Stopped short" (unfinished blocked/needs-human work, do not reset) and "Done", and adds a "Review pending → resume" row (row 8, before "Stopped short" and "Done"; later rows renumbered). Agents or tools that cite row numbers should re-read it. (#144, #146)
- **New `.rauf.json` options** `stuckThresholdMs` (default 5 min) and `toolStuckThresholdMs` (default 30 min); `llm_stuck_warning` no longer fires during a quiet in-flight tool call under the tool cap. (#141)
- **`test-sandbox/verify.sh` now runs in CI** after `pnpm gate` (`pnpm sandbox:verify`), hermetically (throwaway `HOME`). It stays out of `pnpm gate` itself. (#144)

### Added

- **Configurable stuck-warning thresholds (#141).** `.rauf.json` `options.stuckThresholdMs` (default `300000`, 5 min) sets how long the stream must be silent before `llm_stuck_warning`. `options.toolStuckThresholdMs` (default `1800000`, 30 min) caps how long a quiet in-flight tool call may hold the warning off, measured from the call's start. Both are positive integers.

### Fixed

- **A usage-limit banner the usage API does not confirm no longer hot-loops the runner (#146).** When an agent died on a usage-limit banner and the usage API then answered "not limited", or was unavailable (429 or error), the runner returned an uncounted `continue` with no backoff. A persistent disagreement spun forever (seen in `test-sandbox/verify.sh`'s usage-limit-stdout scenario on a machine with real Claude credentials). Such an iteration now **counts** against the iteration budget. The runner backs off 30 s after the first disagreement and 60 s after the second. At the 3rd consecutive disagreement it trusts the banner and takes the normal usage-limit path: it sleeps until the banner's reset time (default 30-minute window when the banner has none) in `sleeping_limit`, or halts with `paused_usage_limit` when `sleepOnLimit` is `false`. That `usage_limit_hit` event carries the new optional `reason: "usage_api_disagreement"` and `consecutiveDisagreements` fields, and the CLI event views show them. If the counted attempt used up the budget, there is no backoff or sleep: the loop stops at once as `iterations_complete`. Any iteration that does not end in a usage death resets the streak, and so does any API-confirmed limit. During backoffs and limit sleeps, `state.json` now carries `sleepUntil` (backoffs also clear `currentItem`), so `rauf status --json` is accurate. `checkUsageLimit` now returns `unavailable: true` alongside `limited: false` when the API cannot answer.
- **An API-confirmed usage limit with no usable reset time no longer hot-loops (#146).** A 5h confirmation whose `resets_at` was missing, invalid or already past slept 0 ms, and because the death was uncounted it respawned at once. Every confirmed-limit path (preflight, after a usage death, between iterations) now sleeps at least 60 s, and 3 such confirmations in a row halt as `paused_usage_limit`.
- **A usage limit or failure during the review pass is now resumable instead of reading as `complete` (#146).** A review spawn that died on a usage limit fell through to `review_failed`, and the run finished as `complete`. It now goes through the same usage policy (sleep, back off or halt). A halt, or the 4th usage death (which stops at once, without a final sleep), ends the run as `paused_usage_limit` with `LoopResult.limitReached`. A review now stays pending (new `state.json` `reviewPending` + `reviewItemIds`, its exact scope) from start until it succeeds, so a usage stop, a failure or a crash all leave it for `rauf resume`. Resume re-runs exactly those items via the new `rauf loop review --items`. `rauf loop review` exits 4 (LIMIT) on a usage stop and 1 (ERROR) on a failure (it used to print "no issues found" and exit 0), and it leaves state `idle`. A usage terminal hit while processing review-created fix items is no longer overwritten with `complete`. In `loop run --review`, a failed review now sets `reviewFailed` on the result and exits 1 with an error message (it used to print "Loop finished" and exit 0). A cancel during the review stops the run as `paused` (on request). `rauf status --json` now reports `reviewPending` + `reviewItemIds`, and the drive-rauf-loop decision table gains a "Review pending" row (new row 8, before "Stopped short" and "Done"; later rows renumbered) that resumes it.
- **The iteration-budget stop's DONE file now reads `iterations_complete: <summary>`**, so status derivation can tell it apart from a clean completion. The runner's dead `limit_reached` limit-terminal check was removed; nothing writes that status any more. (#146)
- **The test suites no longer reach the live usage API or read your real `~/.claude` credentials (#146).** Six `runner.test.ts` usage tests failed locally, and only passed in CI because CI has no token. Every package's vitest run now uses a shared setup file (`vitest.hermetic-setup.ts`) that points `HOME` at an empty temp dir and blocks any `fetch` to `api.anthropic.com`. `LoopRunner.create` takes an optional third `deps` argument (`readOAuthToken`, `checkUsageLimit`, `sleep`) so tests can inject the usage client and clock.
- **`llm_stuck_warning` no longer fires on a long, quiet foreground tool call (#141).** A verification gate that ran for more than 5 minutes without output was flagged as a hang on almost every iteration, even though the agent was just waiting on its Bash call. The runner now tracks which tool calls are in flight. The warning still fires after 5 minutes of silence, unless a quiet tool call (one with no nested activity) is in flight that has run for less than 30 minutes, counted from its start. A genuinely hung tool is still surfaced, and later stream activity can't push the cap back. The warning payload gains `currentTool` (`null` when the model itself went silent) and `toolRunningMs`. The CLI, `rauf follow` and the web status page show both. The Claude stream parser used to emit `tool_end` right after `tool_start` on the assistant `tool_use` block, before the CLI even ran the tool, which is why `iteration-status.json` read `currentTool: null` during a Bash call. It now ends the tool on the matching `tool_result`. If a result goes missing, the call is reconciled at the model's next message in the same scope (top level or the same Task), or when its parent Task finishes. A result whose start line was lost still counts as stream activity, and for a Task it counts as subagent activity. The Claude and Codex adapters close every call still open on any process exit (normal, error, timeout/kill, truncated stdout), so every `llm_tool_activity` start has an end. Those ends are marked `reason: "reconciled"`/`"aborted"`, and both phases carry an optional `toolUseId`. The live CLI status line tracks parallel calls and keeps showing the one still running. The runner force-writes `iteration-status.json` on every tool boundary (the 1 s write throttle could previously drop the `tool_start` write) and refreshes `updatedAt` while a tool is in flight, so `health.iterationFresh` stays true. `currentTool` now stays set, with a new `currentToolStartedAt`, until the tool finishes. `llm_tool_activity` `end` events name the tool instead of `"unknown"`. Codex already reported real tool boundaries; its open items are now also closed at `turn.completed`/`turn.failed`. The plain-text agents (gemini, copilot, cursor, pi, generic-cli) emit no stream events and keep the previous behavior.

- **`AGENTS_ADDON.md` now carries the host-neutral `RAUF_REVIEW:<json>` / no-signal paragraph (#132).** The signal-detection blockquote in the cross-agent `AGENTS.md` block ended after the "last signal line" note, so every non-Claude host missed that `RAUF_REVIEW` is review-pass-only and that a missing signal is reconciled by exit context rather than auto-blocked. The paragraph is mirrored from `CLAUDE_ADDON.md` (embedded copy regenerated), the stale "Known gap" note is dropped from `docs/SPEC-ARTIFACTS.md`, and a new installer test asserts the two addons' signal blockquotes stay identical and that the embedded copies match their sources. `scripts/check-agent-commit-rule.sh` now also guards `AGENTS_ADDON.md`'s commit-rule clause (#134).
- **A pre-0.11 `limit_reached` state file now reads as a budget stop, not a usage limit.** Before 0.11.0 the runner wrote `limit_reached` only when the iteration budget ran out, the stop now written as `iterations_complete`. Status still derived it as `LIMIT_REACHED`, which exits **4** with a warning tone, the same "throttled" presentation 0.11.0 removed for new runs. It now derives `ITERATIONS_COMPLETE` when an item is still eligible, or `COMPLETE` when the old run had in fact drained the backlog (the eligibility check the current runner makes). A missing or malformed backlog keeps it `ITERATIONS_COMPLETE`, so the run is never reported as finished, and `resume` surfaces the read error. Both exit **0**, or **5** with genuine blocks, with a success tone. The `LIMIT_REACHED` enum value stays parseable but is deprecated and no longer derived. (#144)
- **DONE-file status fallback no longer misclassifies runner DONE files.** When `state.json` is missing, `rauf status` classifies `.rauf/DONE` by its leading status token before any substring rule. Previously `weekly_limit:` read as `LIMIT_REACHED` (now `WEEKLY_LIMIT`), `paused_usage_limit:` as `PAUSED` (now `PAUSED_USAGE_LIMIT`, exit 4), and `cancel` as `COMPLETE` (now `PAUSED`, matching the state file). An `iterations_complete:` prefix is recognized for the budget-stop DONE file that #147 introduces. An `error:` file whose summary listed needs-human items read as `PAUSED_HUMAN`, and one whose message mentioned a limit read as `LIMIT_REACHED`; both now read as `ERROR`. (#144)
- **`test-sandbox/verify.sh` is green, hermetic, and runs in CI.** Budget-exhaustion expectations were updated for the 0.11.0 `iterations_complete` split. The suite now runs under a throwaway `HOME`, so real `~/.claude` credentials no longer route the usage-limit scenario through the live usage API. The absent-agent scenario no longer resolves a real `codex` installed next to `bun`. CI runs it as a step after `pnpm gate` (`pnpm sandbox:verify`). (#144)
- **Docs: budget exhaustion is `ITERATIONS_COMPLETE`, and `COMPLETE` means "no eligible work left".** The schemas, CLI spec, backlog-tool contract, docs site and `drive-rauf-loop` skill still called budget exhaustion `LIMIT_REACHED`. The supervisor decision table gains a "Budget spent → resume" branch and splits `COMPLETE` into "stopped short" (unfinished blocked/needs-human work, do not reset) and "done". (#144)

## 0.16.1

### Fixed

- **The loop no longer halts when an item blocks with an ignored `backlog.json.bak` present (#137).** `revertAbandonedWork`'s `git stash push --include-untracked` layered a redundant literal `:(exclude)<backlog>.bak` pathspec on top of the shared glob exclude. Git exits non-zero when a literal exclude names an existing, gitignored file — and `backlog.json.bak` always exists (`atomicWrite`) and is always ignored (the installer adds `**/backlog.json.bak`) — so every genuine block or failed iteration that left dirty code halted the whole loop with `status: error`, even though the stash was saved (a regression surfaced by #105 turning the previously-swallowed non-zero exit into a halt). The literal `.bak` exclude is dropped from all three pathspec lists that carried it; the shared glob `:(exclude,glob)**/backlog.json.bak` already covers the file without tripping the error. Reproduced and regression-tested on git 2.34.1.

## 0.16.0

### Added

- **`rauf version --json` now reports the binary's provenance** — output carries
  a `channel` (`npm-launcher` / `release-binary` / `compiled-local` / `source`)
  and the resolved `path`, so a fleet can tell how a host was provisioned and
  feature-forge's doctor can consume it later. `release-binary` vs
  `compiled-local` is stamped at build time via `bun build --define`
  (release.yml → `release-binary`; local `pnpm compile` → `compiled-local`);
  `npm-launcher` and `source` are detected at runtime, and a `source` run adds a
  `distStale` hint when `packages/core/dist` lags `src/version.ts`. (#123)

- **Codex plugin is now installable via the plugin marketplace** — the repo ships
  a generated `.agents/plugins/marketplace.json` root (the marker
  `codex plugin marketplace add` requires), so
  `codex plugin marketplace add garygentry/rauf && codex plugin add rauf@rauf`
  installs the four skills. Previously only `.codex-plugin/plugin.json` shipped,
  which is a plugin manifest, not a marketplace, so the documented install path
  could not succeed. The manifest is emitted by `scripts/build-codex-bundle.ts`
  and guarded by `pnpm codex:check`, and the README documents both the
  marketplace install and the skills-dir symlink alternative. (#122)

- **Every loop child is stamped `FORGE_INTERACTION=non-interactive`** — a headless
  loop child has no reply channel by construction, but the agent inside cannot
  observe that and can guess "interactive", emit a question nobody can answer, and
  burn the iteration (feature-forge #261). The runner — the only party that knows —
  now states it via `resolveChildEnv`, and downstream tooling (feature-forge's
  `doctor` `interaction-mode` check) reads it and takes conservative defaults
  instead of stalling. An attended child overrides it via `childEnv`. (#120)

### Changed

- **`install-binary.sh` refuses to overwrite a target it did not install** —
  the curl installer defaults to `~/.local/bin/rauf`, which collides with the
  npm launcher when that path is npm's global prefix bin (and with a dev
  symlink). It now records an ownership marker (target path + checksum) and
  refuses to clobber an unrecognized or replaced file unless `--force` is given;
  help text and the README name the npm-prefix collision. The three binaries
  (`rauf` published / `rauf-dev` source / `rauf-stable` compiled snapshot) and
  the rule that **the name `rauf` is reserved for the published channel** are now
  documented in `docs/DOGFOODING.md`, and the stale feature-forge "Local
  development" pointers in `DOGFOODING.md` / `RELEASE-AUTOMATION-RUNBOOK.md` now
  point at feature-forge's `docs/DOGFOODING.md` (noting the skills-dir symlink
  method is rauf-specific). (#123)

- **Loop-launch empty-verification warning softened + acknowledgeable** — the
  launch warning that fired whenever the global profile had no verification
  commands claimed "RAUF.md will tell the agent to skip verification entirely,"
  which is misleading on repos that verify per item via each backlog item's
  `acceptanceCriteria`. It now reads "No global verification commands
  configured; per-item acceptance criteria (if any) still apply," and the
  matching `.rauf/RAUF.md` admonition likewise points at per-item
  `acceptanceCriteria` instead of claiming "no automated check." Set
  `.rauf.json` `options.acknowledgeEmptyVerify: true` to silence the warning
  for an intentionally-empty global profile — honored everywhere the warning is
  raised (`loop run`, `update`, the web loop-start route) and preserved across
  re-install. A stale/misconfigured dispatcher command still warns regardless.
  (#121)

### Fixed

- **Loop no longer silently wastes a retry when an agent backgrounds
  verification** — an agent that finished an item's work but backgrounded a slow
  verify command and yielded its turn to "wait for the completion notification"
  exited cleanly with no signal (the notification never arrives in
  non-interactive mode), so the runner re-ran the whole item. The managed
  verification block in `RAUF.md`, the ADDON/GREENFIELD templates, and the
  post-loop `REVIEW.md` now forbid deferring the exit signal behind an async
  completion notification and require emitting it within the same turn; and a
  no-signal genuine-retry whose output shows that pattern is now annotated in
  `rauf.log` with the likely cause (both the work-iteration and review-pass
  paths) instead of a bare retry line. (#125)

- **`release:prepare` now regenerates the Pi adapter bundle** — the bump step
  rebuilds `adapters/pi/` after bumping the version locations, so the generated
  `adapters/pi/package.json` no longer keeps the old version and `pnpm pi:check`
  (in `pnpm gate`) no longer fails on a release-prep PR's first push. (#119)

- **The resume dirty-tree exemption is now scoped to the resumed item by identity**
  — the pre-iteration clean-baseline guard's `allowDirty` exemption was granted by
  iteration ORDER, not item identity, so a higher-priority pending item selected
  first on relaunch could sweep the actually-resumed item's leftover uncommitted
  work into the WRONG item's commit (an audit-trail bug). Resume callers now thread
  `allowDirtyForItemId`, which prefers that item on the resume's first iteration and
  scopes the exemption to it by identity; a different item reaching the guard on a
  dirty tree is still caught. Absent id → the existing order-based fallback (#109),
  no regression. (#115)

## 0.15.0

### Added

- **Pi skill resources published in the npm package** — `@garygentry/rauf`'s npm-dist launcher
  now ships `adapters/pi/` alongside the compiled binaries, so a `npx @garygentry/rauf` install
  carries the Pi skill package too, not just the CLI. (#101)
- **Configurable Codex provider sandbox/network/approval** — the built-in `codex` provider now
  reads a typed `providerConfig` block (`sandboxMode`, `networkAccess`, `approvalPolicy`,
  `extraArgs`), previously ignored entirely. See `docs/SPEC-BACKLOG-TOOL-CONTRACT.md` §5.3.
  (Closes #94.)
- **Sandbox-denial hint on Codex block reasons** — a `codex`-driven `RAUF_BLOCKED`/
  `RAUF_NEEDS_HUMAN` reason (or a fast signal-less exit) that looks like a sandbox denial
  (DNS/connectivity errors, `EPERM` on a subprocess spawn) now gets an appended hint pointing at
  the sandbox/network config instead of reading as a plain environmental outage. (Closes #95.)
- **Effective provider config surfaced in run diagnostics** — every spawn (each iteration and
  the review pass) now logs the resolved policy for providers that expose one, e.g.
  `Spawning codex for item 001 [sandbox=workspace-write network=true approval=never]`, via a new
  optional `LLMProvider.describeConfig()` hook. (Closes #84.)
- **Stdout/stderr diagnostic tail on infra/genuine-retry exits** — an `infra_error` (fast
  non-zero exit) or `genuine_retry` (no-signal exit) death now carries a truncated
  human-readable tail of the spawn's captured output, so a flake is diagnosable without
  re-running the iteration. `rauf.log` gets it inline for both cases (previously only
  `infra_error` did); the new optional `stdoutTail`/`stderrTail` fields on the
  `item_blocked`/`item_retried` events surface it in `events.ndjson`, `rauf log --follow`, and
  the web dashboard's event feed. The tail prefers the same reconstructed human text the signal
  parser uses (raw stdout is an NDJSON event stream under `stream-json` mode, not readable
  text) and is redacted the same as the sibling signal-preview logging. (Closes #74.)

### Changed

- **Codex provider now enables network access by default** — `CodexCliProvider` previously
  hardcoded `--sandbox workspace-write` with no network override, so any network-dependent
  backlog item (dependency installs, lockfile generation, fetches) falsely blocked under
  `--agent codex` even though the host had full network access. It now appends
  `-c sandbox_workspace_write.network_access=true` by default, matching `claude-cli`'s
  unconditional trust posture. Set `providerConfig.networkAccess: false` to restore the old
  fully-restricted behavior. (Closes #93.)

### Fixed

- **Pi provider prompts delivered via stdin to avoid `E2BIG`** — the `pi` preset passed the
  entire prompt as a single argv element, which fails on large aggregated prompts (e.g. the
  post-loop review prompt). Switched to `promptDelivery: "stdin"`, matching the `gemini`/
  `copilot` presets. (#97)
- **Cursor provider prompts delivered via a temp file, not argv** — same `E2BIG` exposure as
  `pi`, fixed for the `cursor-agent` preset: the prompt is now written to a sandboxed temp
  file and a short positional instruction pointing at it is passed as argv instead. (#113)
- **Foreground-and-wait guidance for verify commands** — an iteration agent that backgrounds a
  long verify command and exits before it finishes produced `Signal: none` and wasted a retry
  even though its own work was correct. `RAUF.md`'s managed verification section and the
  ADDON/GREENFIELD templates now warn against backgrounding verify commands explicitly. (#99)
- **Review pass now retries on a missing/unclassified signal** — `--review` treated any
  unclassified signal (including "none") as an immediate hard failure with no retry, unlike
  normal work iterations. It now applies the same bounded-retry policy, and the eventual
  `review_failed` event/log carries a truncated stdout/stderr diagnostic tail. (#102)
- **`process.exitCode` instead of `process.exit()` to prevent stdout truncation** — calling
  `process.exit()` immediately after the CLI resolved could drop pipe-buffered output beyond
  the 64 KiB Linux pipe buffer, since pipe writes are async while file/TTY writes are sync.
  The loop's stuck-iteration timer is now also cleared in a `try`/`finally` so a leaked
  interval can't hang `rauf loop run` under the new graceful-drain exit path. (#103)
- **Loop halts on a failed rollback instead of silently continuing** — a failed
  `revertAbandonedWork` was previously only logged; the loop would continue to the next item
  regardless, and that item's `git add -A` commit could sweep up the blocked item's leftover
  files, breaking per-item commit isolation. A failed revert now halts the loop, and a new
  pre-iteration clean-baseline guard halts before spawning an agent if the tree is
  unexpectedly dirty — scoped to skip the ordinary healthy cases (a same-item retry, a
  needs-human resume, an operator profile edit) so it only fires on genuine contamination.
  (#105, scoping fix #109/#112)
- **`allowDirty` scoped to the first post-resume iteration only** — the pre-iteration
  clean-baseline guard above previously stayed suppressed for a resumed run's entire
  duration instead of just the iteration it was meant to excuse, silently defeating the
  guard for the rest of the run. (#112)
- **Verification dispatcher scripts are now detected, empty profiles warn instead of
  installing silently** — `rauf install`/`init` could generate an all-empty verification
  profile (no test/typecheck/lint/build/format commands) with no operator-visible warning,
  even when an obvious dispatcher script (e.g. `scripts/verify.sh`) existed. Detection now
  falls back to a dispatcher-script check, and a clear warning surfaces through
  `install`/`init`/`update`'s existing `warnings[]` array and a new non-blocking `loop run`
  startup check. (#106)
- **`--retry-blocked` now resolves `--backlog` correctly** — `unblockIfRequested` re-extracted
  `--backlog` from the shared flags map internally, but the extractor destructively deletes
  the flag on read, so by the time it ran the flag was already gone and it silently fell back
  to the default `.rauf/` root — a total no-op for any `--backlog <subdir>` setup (e.g.
  feature-forge's). Fixed by passing the already-extracted value through as a parameter, with
  a warning instead of a silent no-op on failure. (#114)

## 0.14.0

### Added

- **`backlog answer` subcommand** — `rauf backlog answer <path> <id> "<text>"` resolves a
  `blocked` item the loop parked for human input: records the operator's answer as `humanAnswer`,
  sets `status` to `pending`, clears `needsHuman`/`blockedReason`, and emits
  `{answered, status:'pending'}` JSON. Refuses (exit 2, no mutation) when the item is not
  `blocked` or not found. Does not relaunch the loop — the operator drives the next run.
  This is the rauf half of feature-forge's `loop-recovery` feature; the forge half shipped in
  garygentry/feature-forge#204.

### Fixed

- **Codex prompts delivered on stdin instead of argv** — the `CodexCliProvider` previously passed
  the prompt as a trailing argv positional; large backlog/spec prompts hit the per-argument
  `E2BIG` OS limit and failed to spawn. Now builds `codex … exec … -` and delivers the prompt
  on stdin.

## 0.13.0

### Added

- **Pi loop-agent preset** — `rauf loop run <project> --agent pi --no-model` now selects a named
  Pi CLI provider that invokes `pi -p --approve --no-session` with the prompt as the final argv
  element and forwards explicit models as `--model <value>`. The production preset keeps tools
  enabled for loop edits; `--no-tools` remains sentinel-smoke-only.
- **Generated Pi skill package** — rauf now ships `adapters/pi/` with generated Pi package metadata
  and the four canonical rauf skills (`author-backlog`, `review-backlog`, `drive-rauf-loop`, and
  `review-rauf-guidance`). The bundle rewrites repo-level doc/source references to skill-local
  `references/*` files and is guarded by `pnpm pi:check`.

## 0.12.1

### Docs

- **`author-backlog` prescribes regenerating the whole `--check`-gated artifact set**
  (feature-forge #145). When a project's verify command gates on staleness of generated
  artifacts (`<generator> --check`-style sub-commands), an item that regenerates one gated
  artifact but omits a sibling passes locally yet red-gates every commit on the stale-generated
  check. The skill now instructs authors to enumerate the full `--check`-gated set from the verify
  command and spell the complete regeneration + commit sequence into each affected item (with the
  verify command as the last acceptance criterion). Companion to feature-forge's forge-verify
  CHECK-B26.

- **`author-backlog` guards against test items forcing a human-gated lifecycle transition**
  (feature-forge #150). A test/e2e item whose only path to green is "artifact `X` is _published_ /
  _released_ / _approved_ / _reviewed_" — while nothing in the backlog actually publishes it or
  obtains a human sign-off — pushes the autonomous loop to **fabricate** the publication or review
  provenance to make the check pass. The skill now instructs authors that such an item must either
  `dependsOn` an explicit, human-gated publish/review item that legitimately produces the state, or
  assert the state via a **dev-build / fixture path**, and must never be the sole driver of a
  lifecycle transition another item pins the other way. Companion to feature-forge's forge-verify
  CHECK-B27.

## 0.12.0

### Added

- **Loop observability — file-driven loop supervision** (#63). A file-driven
  contract for supervising a running loop without invoking subprocesses:
  a health/status derivation over `state.json` + `events.ndjson`, robust
  backlog-root/target resolution, event-altitude filtering in `follow` /
  `log --follow`, and a live item feed. Surfaced through `status` and the
  follow renderers, with a new supervision guide under the generated docs.

### Fixed

- **`scanBacklogRoots` now skips `artifacts/`** (#67), matching
  `discoverProjects`. Template backlogs shipped under `artifacts/variants/.rauf/`
  (and a legacy `_archive/artifacts/.ralph/`) no longer surface as candidate
  roots in `rauf status` disambiguation or the web root selector.

### Docs

- **`author-backlog` skill prescribes reset-before-repopulate** (#65) — the
  `rauf backlog reset --clear` workflow is now documented where authoring agents
  look, with a decision tree and a "Resetting a Completed Backlog" section, so a
  completed cycle is never cleared by hand-editing `backlog.json`.
- **Sanctioned backlog locations enforced** (#66, #67) — the `author-backlog`
  skill now names the only two valid backlog locations and forbids stray parallel
  `.rauf/`-style dirs; the `review-backlog` skill gained a matching structural
  check and anti-pattern row to flag bespoke locations.

## 0.11.0

### Added

- **Rich live event rendering in `follow` and `log --follow`** — `events.ndjson`
  carries full payloads (item titles, provider, token counts, per-tool activity,
  signals + reasons, durations, review summaries), but both human renderers had been
  reducing each event to a bare `#seq type`. A new shared, exhaustive `formatEvent()`
  — one canonical renderer over the 24-variant `LoopEvent` union — now surfaces that
  detail (e.g. `#2 item selected  [001] Add memory.py read-only seams… (p1)`,
  `#5 tool ▶  [001] Read`, `#23 loop completed  1 done · 0 blocked · 0 needs-human`).
  `--json` output paths are untouched.

### Fixed

- **Iteration-budget exhaustion no longer masquerades as a usage limit** — the
  overloaded `limit_reached` / `LIMIT_REACHED` state meant a successful bounded run
  (`--iterations N`) surfaced with a warning tone and exit code **4** (the
  throttled-by-Claude code). A new distinct `ITERATIONS_COMPLETE` state
  (state.json: `iterations_complete`) is written when the budget is hit with eligible
  work remaining; `complete` is written when the budget lands exactly as the backlog
  drains. The new state is success-toned and resumable, exiting **0** (or **5** if
  blocks remain). **Behavioral change:** `rauf loop run` / `status` now exit **0**
  (or 5) instead of **4** when the iteration budget is reached. The `LIMIT_REACHED`
  enum string is unchanged (no JSON-wire/schema migration); legacy `limit_reached`
  state files still parse.

## 0.10.1

### Fixed

- **`cursor` preset was missing its headless trigger** — the Cursor preset shipped
  `cursor-agent --force <prompt>` but omitted `--print`, the flag that makes
  cursor-agent "print responses to console for scripts/non-interactive use". Without
  it, even an authenticated run would emit no parseable stdout, so rauf would never see
  the agent's output (e.g. `RAUF_DONE`). The preset now builds
  `cursor-agent --print --force <prompt>`, verified against the real binary
  (cursor-agent 2026.06.26): the new argv parses and reaches execution, whereas a bogus
  flag yields a distinct "unknown option" error.

### Changed

- **CLI preset argv validated against the real binaries** (OQ-2) — `copilot`
  (@github/copilot 1.0.65) is now VERIFIED end-to-end (`copilot --allow-all-tools` with
  the prompt on stdin runs headlessly and emits the expected sentinel, exit 0). `gemini`
  (@google/gemini-cli 0.49.0, `--yolo` on stdin) is argv-verified to enter headless and
  consume the prompt (full completion pending a real `GEMINI_API_KEY`). None of the three
  presets exhibit the codex-class argv-rejection/interactive-hang failure. The OQ-2
  warning in `presets.ts` is narrowed to a per-CLI verification status, and
  `presets.test.ts` now asserts the real-CLI-verified argv literals.

## 0.10.0

### Fixed

- **Codex loop start was broken on current Codex CLI** — the preset argv built
  `codex exec … --ask-for-approval never`, but current Codex (≥ 0.141) treats
  `--ask-for-approval` as a **top-level** flag and rejects it after the `exec`
  subcommand (exit 2, "unexpected argument"), so `rauf loop run --agent codex`
  failed to spawn before iteration 1. Codex now has a dedicated adapter
  (`CodexCliProvider`) that builds the correct argv
  (`codex --ask-for-approval never exec [--json] --sandbox workspace-write
[--model <m>] <prompt>`), validated end-to-end against codex-cli 0.141.0.

### Added

- **Codex streaming telemetry** — under `--agent codex`, rauf now drives
  `codex exec --json` and parses the JSON Lines event stream (`CodexStreamParser`)
  into the same `llm_tool_activity` / `llm_token_update` events and reconstructed
  final message that the Claude path produces. Codex runs get real tool/token
  telemetry and tool-aware stuck detection instead of process-silence only —
  telemetry parity with Claude. Other CLI agents stay plain-text (the rich parsing
  is intentionally not forced into the generic `CliAgent`).

- **Codex plugin packaging** — rauf's four agent skills (`author-backlog`,
  `review-backlog`, `drive-rauf-loop`, `review-rauf-guidance`) now also ship as a
  Codex plugin under `.codex-plugin/`, giving Codex users first-class access to
  the same skills the Claude plugin provides. The bundle is **generated** from the
  identical canonical `skills/<name>/SKILL.md` sources by
  `scripts/build-codex-bundle.ts` (no hand-maintained divergent copy), and a new
  `pnpm codex:check` drift guard in the gate keeps it in lockstep. rauf's skill
  frontmatter is already Codex-compatible (`name` + `description`), so skills map
  through with no dropped constructs.
- **Codex subagents** — two repo-level Codex subagents, `rauf-backlog-reviewer`
  and `rauf-loop-driver` (`.codex/agents/*.toml`), generated from canonical
  `agents/<name>.md` definitions by `scripts/build-codex-agents.ts` and guarded by
  the same `pnpm codex:check`. They let a Codex session delegate a backlog QA audit
  or loop supervision to a focused subagent that defers to the canonical
  `review-backlog` / `drive-rauf-loop` skills. Repo-level only — `rauf install`
  does not deploy them, keeping user installs clean.

## 0.9.0

### Added

- **Cross-agent `AGENTS.md` install** — install/update now writes a managed,
  sentinel-bounded rauf block into `AGENTS.md` (the host-agnostic repo-instructions
  file read by Codex and other agents) **alongside** the existing Claude-optimized
  `CLAUDE.md`. The block uses its own `<!-- rauf:agents:start -->` / `:end`
  sentinels, merges idempotently, preserves surrounding user content, and is
  stripped on uninstall (`removeAgentsMdSection`, default true). `AGENTS.md`
  carries the host-agnostic loop rules and delegation guidance; the Claude-only
  Task-tool note stays in `CLAUDE.md`. Greenfield `rauf init` gets `AGENTS.md`
  too (it runs through the same installer). Additive — the Claude path is
  unchanged.

### Docs

- **Marked the provider-refactor draft as historical** — `Part B` of
  `docs/SPEC-BACKLOG-TOOL-CONTRACT.md` described the agent-agnostic refactor as a
  DRAFT plan, but that work has shipped. It now carries a HISTORICAL banner
  pointing to the implemented `docs/architecture/rauf-agent-cli-adapters/*` docs
  and noting the two drifts (the user-facing flag is `--agent`, not the draft's
  `--provider`; some "Must Change" paths were reorganized into
  `packages/loop/src/providers/`).
- **Documented the non-Claude telemetry gap explicitly** — the adapter
  architecture doc now spells out that `llm_spawned`/`llm_exited` are emitted for
  every provider while `llm_tool_activity`/`llm_token_update` may be absent for
  plain CLI agents, and that stuck detection degrades to process silence for them.

### Fixed

- **Reinstall preserves provider configuration** — `install()` now carries every
  existing `.rauf.json` marker option (`provider`, `providerConfig`, `model`,
  `runtime`, sweep settings, `sessionTimeout`, …) across an idempotent reinstall
  instead of keeping only `ignoreInTool`/`gitignoreScripts`/`maxIterations`. A
  project configured to default to `codex` or `generic-cli` no longer silently
  reverts to the Claude default when rauf is reinstalled or refreshed.
- **`generic-cli` configuration is preflighted before state mutation** — the
  setup-time agent detection now validates the project `providerConfig` for
  `generic-cli` (binary present and executable, valid `promptDelivery`/args) and
  fails fast with a clear message before any loop state or backlog item is
  mutated, instead of throwing mid-iteration after an item is marked
  `in_progress`. Enumeration (`rauf agents`) still reports `generic-cli` as
  configurable when no config is supplied.
- **Provider-neutral loop logs and CLI help** — the per-iteration exit log now
  reads `<provider.id> exited (…)` instead of always `Claude exited (…)`, so a
  `codex`/`generic-cli` run no longer produces misleading Claude-named logs.
  `rauf loop run --model` help is now provider-neutral ("Model to pass to the
  selected agent; omit for the provider default") and `--no-model` is now listed
  in the command help. Claude-specific wording is retained only inside
  Claude-specific code paths (usage-limit/credential handling).
- **Host-agnostic delegation language in shared prompts** — the loop prompt and
  installed `RAUF.md` no longer instruct agents to "Use the Task tool" (a
  Claude-only mechanism). Delegation guidance is now capability-neutral ("if your
  host agent provides a subagent/delegation mechanism, use it; otherwise complete
  the subtasks inline"), so non-Claude agents don't waste an iteration chasing a
  missing tool. The Claude-specific Task-tool note now lives only in the
  `CLAUDE.md` managed block.
- **Provider-neutral backlog `model` schema description** — the per-item `model`
  field description in the generated/installed backlog schema no longer calls it a
  "Claude model"; it now explains the field is passed to the selected provider and
  that Claude tier aliases (`opus`/`sonnet`/`opus[1m]`) are Claude-only and may
  fail under non-Claude agents.
- **Backlog skills no longer bias toward Claude** — the `author-backlog` and
  `review-backlog` skills dropped the `"provider": "claude-cli"` line from their
  generic shape examples (a per-item `provider` overrides the run-level `--agent`,
  silently making a backlog non-portable). `author-backlog` now documents
  `provider` as omit-by-default and adds a portable-vs-intentionally-pinned
  example; `review-backlog` gains a provider-pin portability rule mirroring the
  existing `model` rule.

## 0.8.1

### Fixed

- **Codex preset uses current `codex exec` automation flags** — the `codex` CLI
  preset now runs with `--sandbox workspace-write --ask-for-approval never`
  instead of the deprecated `--full-auto`, matching current Codex CLI docs. This
  avoids deprecation noise and makes the sandbox/approval behavior explicit so
  non-interactive loop runs neither hang on approval prompts nor run with implicit
  permissions. Added preset argv tests guarding the exact invocation.

## 0.8.0

Provider-neutral backlogs. Backlog items no longer bind to Claude by default, and
a new loop flag lets a Claude-aliased backlog run portably under any agent without
editing it — closing the #38 failure mode where a `model: "opus"` item silently
halted the loop under a non-Claude agent. Additive minor bump.

### Added

- **`rauf loop run --no-model`** (alias `--model none`) — ephemeral per-run model
  override that makes the loop ignore each backlog item's `model` field for that
  run (the new `ignoreItemModel` loop option). Resolution drops to
  `--model` > project default > provider default, so a backlog whose items carry
  Claude-only tier aliases (`opus`/`sonnet`/…) runs portably under a non-Claude
  `--agent` without a persistent edit to `backlog.json`. Also accepted on the
  `POST /loop/start` body for server-mode parity. (#38)

### Changed

- **`author-backlog` skill is provider-neutral by default** — item `model` is now
  omitted unless the user explicitly opts into a Claude tier, keeping authored
  backlogs agent-portable. Tier aliases are documented as Claude-only and
  agent-binding. (#38)
- **`review-backlog` skill** flags items carrying Claude-only `model` aliases as a
  portability concern (new "Claude-bound model alias" anti-pattern). (#38)

## 0.7.0

The agent-agnostic epic — rauf's loop runner is no longer Claude-only. A pluggable
provider layer (`packages/loop/src/providers/`) lets the loop drive any CLI coding
agent via presets + a generic adapter, with agent selection, availability
pre-checks, and a hardened process-group lifecycle. Additive minor bump.

### Added

- **LLM-agnostic provider architecture** in `packages/loop` — `providers/`
  (registry, presets, generic-CLI + CLI-agent adapters, shared types), an
  `agent-selection` resolver, and a `process-group` lifecycle for clean
  child-process teardown. The runner resolves and launches the configured agent
  by precedence and classifies its outcome provider-agnostically.
- **`.gitattributes`** — LF normalization (`* text=auto eol=lf`) + `export-ignore`
  for dev-only trees (`specs/`, `tests/`, `.github/`, `test-sandbox/`).
- **npm-publishability prep** on the packages the installer's `rauf@0.6.0` pin
  targets (`publishConfig` / `files` / `bin`) — machinery only; **no publish** is
  executed (the `npx rauf@0.6.0` path is documented as "available once rauf 0.6.0
  is published").
- **Optional `npm-publish.yml`** — `workflow_dispatch`-only publish machinery,
  outside the PR gate (not run by this feature).

### Changed

- **README** — added a labeled cross-agent section linking feature-forge's
  cross-agent install story (loop-runner framing retained).

## 0.6.0

Phase 4 of the rauf UX/DX overhaul — web/CLI recovery parity, a shared status
vocabulary, and a ratified agent contract. Additive minor bump (no
`minRunnerVersion` change, no feature-forge lockstep).

### Added

- **Web recovery parity** with the CLI: `reset`, `resume`, `review`, `unblock`,
  and `validate` are now exposed as web server routes with matching status-page
  controls, so the dashboard can drive the same loop-recovery operations the CLI
  offers.
- **Shared status label-map** across CLI and web — `REVIEWING` and
  `PAUSED_USAGE_LIMIT` badges and a "Needs Human" label render identically in
  both surfaces.
- **`rauf update --check`** — report-only drift audit that prints whether a
  project's artifacts are stale (tool-version lag or dead hash keys) and exits
  non-zero if so, writing nothing. Makes fleet-wide staleness scriptable.

### Changed

- `status` exit codes are aligned with the unified scheme via a shared
  `statusExitCode` mapping, so the web `DerivedStatus` and CLI agree on outcome
  semantics.
- Agent-contract documentation finalized and the UX-overhaul canon ratified
  (canon-conformance review: GO, 0 blockers).
- **`rauf update` now prunes stale artifact-hash keys** from the marker (e.g. the
  legacy `ralph.sh`/`ralph-status.sh`/`ralph-add.sh` hashes carried over from a
  pre-rename install) instead of preserving them indefinitely.
- `rauf migrate` documentation sharpened as a legacy one-shot (it renames
  structure but does not backfill artifacts — follow with `rauf update`; non-rauf
  config references to `.ralph` are reported but not auto-rewritten).

### Removed

- **`rauf update --yes`** retired from `--help` — `update` is non-destructive and
  never prompts (the flag is still tolerated for back-compat).

## 0.5.0

The breaking v0.5.0 cutover of the rauf UX/DX overhaul: Phase 1 lays a
file-backed observation substrate, and Phases 2+3 flip the command grammar and
machine contract. feature-forge was updated in lockstep (0.10.0,
`minRunnerVersion >= 0.5.0`).

### Added

- **`events.ndjson` per-run event log** — a single-writer, dense-sequence event
  stream with a `schemaVersion` envelope, tolerant of torn trailing lines, that
  rotates to archive at run start. Formalized as a **versioned, additive-only
  machine surface** so every observer (CLI, web, pipeline) reconstructs
  identical state from files.
- **Machine-wide active-loop registry** (`~/.rauf/active/<hash>.json`) with
  reconcile-on-read and self-heal via lock-file checking, so concurrent loops
  across projects are discoverable.
- **CLI monitor surface:** top-level `follow`, `status --follow`/`-f`, and
  `status --all`, with an empty-is-never-silent guarantee.
- **Web observation parity:** `GET /loop/events` (file-backed SSE),
  `GET /api/loops`, and an `<EventTimeline>` component.

### Changed

- **`loop run --detached` (`-d`) replaces `loop start`** _(breaking)_ — the
  old `loop start` command is removed; invoking it yields a targeted remediation
  error rather than a silent alias.
- **Unified exit codes** across `status` and `loop run`: `0` success, `1` error,
  `2` usage, `3` needs-human, `4` limit, `5` blocked, `6` running.
- **Explicit `review` signal** — a review pass no longer collapses into `done`;
  `RAUF_REVIEW` is emitted only by a review pass.
- **Flag canon** standardized: `--follow`/`-f`, `--json`, `--backlog`,
  `--interval`.
- Agent commit-rule guidance corrected across all template loci (the loop runner
  owns the commit; the iteration agent never commits or stages) and the embedded
  template source regenerated.
- Version bumped to 0.5.0; all six `docs/SPEC-*.md` updated.

### Removed

- **`loop start`** — superseded by `loop run --detached` _(breaking)_.
- **`loop follow`, `loop watch`, and `status --watch`** — superseded by the
  top-level `follow` / `status --follow` monitor surface _(breaking)_.

## 0.4.0

### Added

- **`rauf loop run --pause-on-needs-human`** — opt-in run mode that halts the loop
  (state `paused_human`, with a distinct non-zero exit code) on the first
  `RAUF_NEEDS_HUMAN` instead of setting the item aside and continuing, so a
  supervising session can detect the pause. Emits a `loop_paused` NDJSON event.
- **`rauf resume --answer <id> "<text>"`** (repeatable) — inject a human's answer
  into a paused needs-human item and re-queue it; the answer is threaded into the
  item's next prompt and cleared once it completes.
- Machine-observation surfaces (`loop run --ndjson` event vocabulary and
  `status --json` `DerivedStatus`) are now documented as a **versioned contract**
  in `docs/SPEC-BACKLOG-TOOL-CONTRACT.md`, with the machine-vs-human surface
  distinction made explicit.
- Web dashboard: a specific empty/error state when the configured root directory
  does not exist (with a Settings link) plus pre-save root validation; and a
  favicon (served in dev and from the compiled binary).

### Changed

- Backlog-authoring guidance uses model **tier aliases** (`opus`/`sonnet`) instead
  of pinned IDs, and documents `opus[1m]` for items that need the 1M context
  window (opt-in via the `[1m]` suffix; no cost premium on Opus).
- The web server's startup recovery resolves its root via the standard precedence
  (`RAUF_ROOT` env → config → cwd), honoring an explicit `RAUF_ROOT`/`--root`
  override.
- `--create-branch`, `--pause-on-needs-human`, and `resume --answer` are now listed
  in the CLI `--help` flag tables.
- Purged user-facing `ralph` leftovers from the web UI (theme `localStorage` key,
  migrated transparently; command examples).

### Fixed

- **Loop wedge:** item completion is now authoritative — if an item's on-disk
  status is perturbed (e.g. reverted to `pending`) mid-iteration, the runner
  re-asserts `in_progress` before marking `done` and surfaces failures, instead of
  silently failing the invalid `pending -> done` transition and re-running the
  item indefinitely.
- **Server startup recovery** (`recoverStaleLoops`) no longer resets `in_progress`
  items in projects whose lock is held by a live loop (e.g. a direct-mode
  `rauf loop run`); only genuinely stale loops are recovered.
- `LOG_PATTERNS.needsHuman` now matches the runner's actual
  `Item <id> needs human input (set aside): <reason>` line.
- `RAUF_*` terminal tokens in the diagnostic "Signal text" log dump are redacted so
  agent prose can no longer plant false signals in a grepped `rauf.log`.
- `rauf resume --answer 001 "..."` no longer misreads the answer text as the
  project path in the documented no-path form.
- README: broken images and the loop diagram restored/renamed; the version badge is
  now a dynamic GitHub-release badge; docs builds no longer dirty the working tree.

## 0.3.0

First stable release under the **rauf** name. Promotes `0.3.0-rc.2`; the
`0.3.0-rc.1` and `0.3.0-rc.2` sections below carry the full per-candidate detail.

### Changed (BREAKING) — Ralph is now Rauf

- The tool was renamed from `ralph` to `rauf`: binary, the `@rauf/*` package
  scope, `.rauf/` state dir, `.rauf.json`, `RAUF.md`, `RAUF_ROOT`,
  `X-Rauf-Request`, `~/.rauf/`, and the `RAUF_*` loop signals. See
  [MIGRATION.md](./MIGRATION.md).

### Added

- `rauf migrate <path>` — in-place migration of a legacy `ralph` project to
  `rauf`, with `--dry-run`, `--no-backup`, `--clean-backups`, and `--global`.

### Fixed

- Release binaries for x64 are built with Bun's `-baseline` runtime so they run
  on every x64 CPU; the previous builds required AVX2 and crashed with `SIGILL`
  on CPUs without it.

## 0.3.0-rc.2

### Fixed

- Release binaries for x64 (`rauf-linux-x64`, `rauf-darwin-x64`,
  `rauf-windows-x64.exe`) are now built with Bun's `-baseline` runtime so they run
  on every x64 CPU. The previous builds required AVX2 and crashed with `SIGILL`
  ("Illegal instruction") on CPUs without it. Asset names and checksums are
  unchanged. A release-time smoke test and a `RELEASE_TARGETS` unit guard prevent
  this from regressing.

### Changed

- CI/release workflows bump `actions/checkout@v4`→`@v5` and
  `pnpm/action-setup@v4`→`@v6` (off the deprecated Node 20 runner).

## 0.3.0-rc.1

### Changed (BREAKING) — Ralph is now Rauf

The tool was renamed from `ralph` to `rauf` to disambiguate it from the generic
"ralph" autonomous-coding-loop technique. This is a full structural rename:
binary `ralph` → `rauf`, package scope `@ralph/*` → `@rauf/*`, `.ralph/` →
`.rauf/`, `.ralph.json` → `.rauf.json`, `RALPH.md` → `RAUF.md`, `RALPH_ROOT` →
`RAUF_ROOT`, `X-Ralph-Request` → `X-Rauf-Request`, `~/.ralph/` → `~/.rauf/`, and
loop signals `RALPH_*` → `RAUF_*` (the parser drops `RALPH_*`).

### Added

- `rauf migrate <path>` — in-place migration of a legacy `ralph` project to
  `rauf`, with `--dry-run`, `--no-backup`, `--clean-backups`, and `--global`
  (move `~/.ralph/` → `~/.rauf/`). See [MIGRATION.md](./MIGRATION.md).
- Read-only commands (`status`, `projects`) detect legacy `.ralph/` installs and
  point you to `rauf migrate`; `loop run` refuses an unmigrated project.

### Migration

Run `rauf migrate <project>` per project and `rauf migrate --global` once. Plugin
users must reinstall `rauf-support` and update `forge.config.json`
(`ralphIterationMultiplier` → `raufIterationMultiplier`) by hand. Full details in
[MIGRATION.md](./MIGRATION.md).
