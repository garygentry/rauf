# Install latest ralph into an existing repo

## Context

You want to initialize an existing local project (a different repo, not this one)
with the **latest** ralph. Ralph Manager installs a self-contained `.ralph/`
toolkit plus a merged `CLAUDE.md` block into a target project so it can run the
autonomous coding loop.

Two facts from reviewing the code/docs shape these commands:

1. **"Latest" is automatic from source.** The global CLI is a symlink
   `~/.local/bin/ralph → /home/gary/workspace/ralph/scripts/bin/ralph`, and that
   wrapper runs `bun run packages/cli/src/index.ts "$@"` directly on the
   TypeScript source. There is **no build step** — whatever is checked out in this
   repo *is* the running CLI. So "latest" only requires this repo be up to date.
2. **`install` is the right command** (not `init`). `ralph init` is for greenfield
   scaffolding; `ralph install <path>` is for an existing project. It auto-detects
   the tech stack, runs preflight checks, deploys artifacts, and merges a block
   into the existing `CLAUDE.md`. Source: `packages/cli/src/install-commands.ts:31`,
   `packages/core/src/installer.ts:190`; docs: `docs/SPEC-CLI.md:363`.

Scope for this task: **install only** — drop in the artifacts and merge CLAUDE.md.
Backlog stays empty; populating it and running the loop are deliberately out of scope.

## What `ralph install` does

Preflight (`packages/core/src/installer.ts:133`): dir exists ✓, is a git repo
(warn if not), not already installed (errors if `.ralph.json` exists), `claude` on
PATH (warn if not). Then it detects the profile and writes:

- `.ralph/RALPH.md` — per-iteration agent prompt (rendered from template)
- `.ralph/REVIEW.md` — review-pass prompt
- `.ralph/backlog.json` — **empty** items array (ready to populate later)
- `.ralph/backlog.schema.json` — editor validation schema
- `.ralph/progress.md` — accumulated-learnings file
- `.ralph.json` — marker file (version, detected profile, artifact hashes)
- `CLAUDE.md` — merges a ralph block between `<!-- ralph:start -->` /
  `<!-- ralph:end -->` sentinels (creates the file if absent; never clobbers
  your existing content)

## Commands to run

Replace `<TARGET>` with the absolute path to the existing repo.

### 1. Make sure this ralph repo is the latest

```bash
cd /home/gary/workspace/ralph
git pull            # skip if already current / no upstream changes
pnpm install        # only needed if deps changed since last pull
```

No build needed — the global `ralph` wrapper executes the source directly.

(Optional sanity check that the global CLI resolves to this source:)

```bash
which ralph                       # → /home/gary/.local/bin/ralph
ralph --version                   # confirms the CLI runs
```

If `ralph` is **not** found on PATH, link it once:

```bash
bash /home/gary/workspace/ralph/scripts/install-global.sh
# ensure ~/.local/bin is on PATH
```

### 2. (Recommended) Preview detection with a dry, interactive run first

Run **without** `--yes` so you see the detected tech stack and preflight results
and can confirm before anything is written:

```bash
ralph install <TARGET>
```

Inspect the detected test/typecheck/lint/build/format commands in the report. If
any are wrong, you'll override them in the next step.

### 3. Install

Once the detected profile looks right:

```bash
ralph install <TARGET> --yes
```

With command overrides if detection was off (all optional):

```bash
ralph install <TARGET> --yes \
  --test-cmd "pnpm test" \
  --typecheck-cmd "pnpm typecheck" \
  --lint-cmd "pnpm lint" \
  --build-cmd "pnpm build" \
  --format-cmd "pnpm format:check"
```

Other flags: `--gitignore-scripts` (add `*.sh` to `.gitignore`),
`--json` (machine-readable output).

> If `<TARGET>` is not a git repo, install only *warns*. Recommended to
> `git init` there first so the loop's per-iteration commits work.

## Verification

After installing, confirm the artifacts landed and the project reads as installed:

```bash
ls -la <TARGET>/.ralph                 # RALPH.md, REVIEW.md, backlog.json, progress.md, backlog.schema.json
cat <TARGET>/.ralph.json               # marker: version + detected profile
grep -n "ralph:start" <TARGET>/CLAUDE.md   # confirms the merged block

ralph status <TARGET>                  # should report an idle loop, empty backlog
ralph backlog list <TARGET>            # should show 0 items
```

A clean install + empty backlog list = success for this "install only" scope.

## Next steps (out of scope here, for reference)

- Populate the backlog: invoke the `create-ralph-backlog` skill, or add items
  manually with `ralph backlog add <TARGET> --title "..." --type feature --priority 1 --ac "..."`.
- Run the loop: `ralph loop run <TARGET>` (direct/in-terminal) or
  `ralph loop start <TARGET> --follow` (server mode).
