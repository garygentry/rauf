# Changelog

## Unreleased

### Added

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

### Changed

- **Codex provider now enables network access by default** — `CodexCliProvider` previously
  hardcoded `--sandbox workspace-write` with no network override, so any network-dependent
  backlog item (dependency installs, lockfile generation, fetches) falsely blocked under
  `--agent codex` even though the host had full network access. It now appends
  `-c sandbox_workspace_write.network_access=true` by default, matching `claude-cli`'s
  unconditional trust posture. Set `providerConfig.networkAccess: false` to restore the old
  fully-restricted behavior. (Closes #93.)

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
