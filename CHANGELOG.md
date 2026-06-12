# Changelog

## Unreleased

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
