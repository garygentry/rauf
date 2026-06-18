---
title: Installation
description: Install the rauf CLI from npm or source, verify it, and get a project ready to run its first loop.
---

Rauf is a CLI (plus an optional web dashboard) that installs and drives autonomous coding
loops in your existing projects. The quickest way to install it is from npm; you can also
**build from source** when you want the current development version.

```bash
npm install -g @garygentry/rauf   # the installed command is still `rauf`
npx @garygentry/rauf status .      # or one-off, no install
```

The package is scoped (`@garygentry/rauf`) because the bare `rauf` name is blocked by npm's
name-similarity filter; the installed command remains `rauf`.

This page covers the prerequisites, the build-from-source steps, verifying the install, adding
rauf to a project, and the common first-run snags.

## Prerequisites

| Tool                                                          | Why rauf needs it                                                     |
| ------------------------------------------------------------- | --------------------------------------------------------------------- |
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | Rauf spawns a fresh Claude Code session for **each** loop iteration.  |
| git                                                           | The runner commits the working tree after every successful iteration. |
| [Bun](https://bun.sh/)                                        | TypeScript runtime used to build (and run) rauf from source.          |
| [pnpm](https://pnpm.io/) 9+                                   | Workspace package manager — `pnpm install` / `pnpm build`.            |
| Node.js >= 22                                                 | Required by the toolchain that builds the packages.                   |

:::note[Claude Code is the engine]
Rauf does not implement an LLM agent itself — it orchestrates Claude Code. Each iteration is a
separate Claude Code session that reads one backlog item, makes changes, and runs your
verification command. Make sure `claude` works on its own before installing rauf.
:::

## Install from source

Clone the repository, install dependencies, and build all packages:

```bash
git clone https://github.com/garygentry/rauf.git
cd rauf
pnpm install
pnpm build
```

`pnpm build` compiles every workspace package (`core`, `loop`, `cli`, `web`). The build must
succeed before the `rauf` command will run.

### Make `rauf` available globally

Symlink the `rauf` command into `~/.local/bin`:

```bash
bash scripts/install-global.sh
```

`~/.local/bin` must be on your `PATH`. If it isn't, add it to your shell profile:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

:::tip[In-repo alternative: direnv]
If you use [direnv](https://direnv.org/), running `direnv allow` inside the cloned repo adds
`scripts/bin/rauf` to your `PATH` automatically while you're in the directory — no symlink
needed. The wrapper runs Bun directly on the TypeScript source, so it always reflects the
latest build. This is handy when hacking on rauf itself; for using rauf across other projects,
prefer `scripts/install-global.sh`.
:::

## Verify the install

```bash
rauf version
```

For a machine-readable check (useful in scripts and CI):

```bash
rauf version --json
```

```json
{ "version": "0.6.0" }
```

If `rauf version` prints a version, the CLI is installed and on your `PATH`.

## Add rauf to a project

Install rauf into an existing project. The installer auto-detects the tech stack (Node, Python,
Go, Rust) and writes the loop artifacts and a `.rauf.json` config:

```bash
rauf install /path/to/my-project --yes
```

`--yes` accepts the detected defaults non-interactively. You can override the detected commands
with flags when they differ from the stack defaults:

| Flag                  | Purpose                                    |
| --------------------- | ------------------------------------------ |
| `--test-cmd`          | Command the loop runs to verify tests.     |
| `--typecheck-cmd`     | Type-check command.                        |
| `--lint-cmd`          | Lint command.                              |
| `--build-cmd`         | Build command.                             |
| `--format-cmd`        | Formatter / format-check command.          |
| `--gitignore-scripts` | Add the installed scripts to `.gitignore`. |

To scaffold a **brand-new** project instead of installing into an existing one, use `rauf init`:

```bash
rauf init /path/to/new-project --stack node-typescript
```

`rauf init` accepts `--name`, `--description`, `--stack`
(`node-typescript`, `node-javascript`, `python`, `go`, `rust`, or `custom`), and `--seed <file>`
to seed an initial backlog.

## Troubleshooting

| Symptom                               | Cause                                              | Fix                                                                                    |
| ------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `rauf: command not found`             | `~/.local/bin` is not on your `PATH`.              | Add `export PATH="$HOME/.local/bin:$PATH"` to your shell profile and reopen the shell. |
| Old behavior after editing rauf       | Stale build — the compiled output lags the source. | Re-run `pnpm build` from the repo root.                                                |
| `rauf status` reports `NOT_INSTALLED` | The project has no `.rauf.json`.                   | Run `rauf install <path>` (or `rauf init <path>` for a new project) first.             |

:::caution[macOS Gatekeeper (compiled binaries only)]
The build-from-source path above is the primary install. If a compiled rauf binary is ever
distributed and macOS quarantines it as unsigned, clear the quarantine attribute before running
it:

```bash
xattr -d com.apple.quarantine ./rauf
```

:::

## Next steps

- [Your First Loop](../your-first-loop/) — add a backlog item and run an end-to-end loop.
- [Core Concepts](../core-concepts/) — the backlog, the loop, signals, and status vocabulary.
