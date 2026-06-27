# Changelog

## Unreleased

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
