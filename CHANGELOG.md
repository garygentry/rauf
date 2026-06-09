# Changelog

## Unreleased

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
