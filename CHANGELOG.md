# Changelog

## Unreleased

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
