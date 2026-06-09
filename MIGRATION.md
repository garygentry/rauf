# Migration: Ralph → Rauf

**This tool was renamed from `ralph` to `rauf`.** The rename disambiguates this
specific tool from the generic "ralph" autonomous-coding-loop technique. It is a
full structural rename — binary, package scope, the per-project state directory,
the marker file, the instruction artifact, environment variable, HTTP header, and
the loop protocol signals all changed.

## What changed

| Old                                                                                | New              |
| ---------------------------------------------------------------------------------- | ---------------- |
| binary `ralph`                                                                     | `rauf`           |
| package scope `@ralph/*`                                                           | `@rauf/*`        |
| project dir `.ralph/`                                                              | `.rauf/`         |
| marker `.ralph.json`                                                               | `.rauf.json`     |
| instruction file `RALPH.md`                                                        | `RAUF.md`        |
| env var `RALPH_ROOT`                                                               | `RAUF_ROOT`      |
| HTTP header `X-Ralph-Request`                                                      | `X-Rauf-Request` |
| global config `~/.ralph/`                                                          | `~/.rauf/`       |
| loop signals `RALPH_DONE` / `RALPH_BLOCKED` / `RALPH_NEEDS_HUMAN` / `RALPH_REVIEW` | `RAUF_*`         |

The loop signal parser **no longer recognizes `RALPH_*`** — an unmigrated
`RALPH.md` instructs Claude to emit `RALPH_*`, which the new parser rejects, so a
project **must be migrated before its loop can run**.

## Migrating an existing project

Run the built-in migrator once per project:

```bash
rauf migrate <project-path>            # preview with --dry-run first
rauf migrate <project-path> --dry-run  # prints the full plan, writes nothing
```

The migrator:

- renames `.ralph/` → `.rauf/` (including nested per-spec multi-backlog dirs that
  contain a `state.json`), `.ralph.json` → `.rauf.json`, `RALPH.md` → `RAUF.md`,
  and `ralph.log` → `rauf.log`;
- rewrites tool-owned content (`RAUF.md`, `REVIEW.md`, `backlog.schema.json`), the
  marker, the managed block in `CLAUDE.md`, and `.ralph/` lines in `.gitignore`;
- preserves your data byte-for-byte (`backlog.json`, `progress.md`, `state.json`,
  `archive/**`, `DONE`) — archived log filenames keep their original `ralph`
  names on purpose;
- leaves backups (`.ralph.bak/`, `.ralph.json.bak`, `CLAUDE.md.ralphbak`) you can
  remove later with `rauf migrate <path> --clean-backups`.

It **reports but does not rewrite** references it doesn't own — stray `ralph`
references in `CLAUDE.md` outside the managed block, and `.ralph` mentions in
foreign config/state files (`biome.json`, `.graphifyignore`,
`.claude/settings.local.json`, feature-forge `.pipeline-state.json`, etc.). Fix
those by hand.

It **refuses** to migrate a project whose loop is currently running (it checks
`.loop.lock` pid-liveness, not `state.json`). Stop the loop first.

## Migrating global state

Move `~/.ralph/` → `~/.rauf/` once:

```bash
rauf migrate --global
```

Stop any running `rauf` server first (its PID/port registry moves).

## Plugin users (agent-plugins)

The rename is **not** auto-migrating for installed plugins:

- Reinstall `rauf-support` (formerly `ralph-support`).
- Use the renamed `forge-5-rauf-loop` skill (formerly `forge-5-ralph-loop`).
- In any `forge.config.json`, rename the key `ralphIterationMultiplier` →
  `raufIterationMultiplier` by hand (outside `rauf migrate`'s scope).
