# Rauf Manager

> **Which task are you here for?** (`AGENTS.md` is a symlink to this file, so this applies to both.)
> This file is for agents **contributing to the rauf repository itself** — building the CLI,
> loop, and web packages, running the tests, opening PRs against this repo.
> If you were asked to **install or use rauf in another project** (run the loop, author a
> backlog), stop reading this file. Install the CLI and wire it into the project instead:
> `npm i -g @garygentry/rauf` (or `npx @garygentry/rauf`), then `rauf install .` in the target
> project — see the [README "Install"](README.md#install) section. Most feature-forge users
> reach rauf automatically through that pipeline and never need this file.

## Overview

Rauf Manager is a CLI + web tool for installing, managing, and monitoring rauf autonomous coding loops across local software projects. It provides backlog CRUD, status dashboards, and installation wizards — all backed by a shared `packages/core` library.

## Repository Layout

```
rauf/
├── packages/
│   ├── core/    — Shared business logic (discovery, installer, backlog, status, profile, template)
│   ├── loop/    — Loop runner engine (LoopRunner, events, claude process, signal parsing)
│   ├── cli/     — CLI tool (commands call core directly or HTTP when server is running)
│   └── web/     — Hono API server + React frontend (TanStack Router + Query)
├── artifacts/   — Canonical template files installed into target projects
│   └── variants/
│       └── backlog-json/
├── docs/        — Specifications (ARCHITECTURE, SCHEMAS, SPEC-CORE, SPEC-CLI, SPEC-WEB, SPEC-ARTIFACTS)
└── .rauf/      — This project's own rauf loop state (self-hosting)
```

## Tech Stack

- **Runtime:** Bun (TypeScript, native execution, single-binary compilation)
- **Package Manager:** pnpm with workspaces
- **Server:** Hono on Bun (localhost:5173, bound to 127.0.0.1)
- **Frontend:** React + TanStack Router + TanStack Query + Tailwind CSS
- **CLI:** TypeScript, compiled via `bun build --compile`
- **Testing:** Vitest
- **Linting:** ESLint + Prettier

## Key Architecture Rules

1. **`packages/core` has ZERO imports from `cli` or `web`.** All filesystem logic lives in core.
2. **All file writes use atomic write** (write .tmp → rename) with .bak backup for backlog.json.
3. **Path sandboxing:** Never write outside ROOT_DIRECTORY or ~/.rauf/. Validate with `path.resolve()` + `startsWith()`.
4. **The web server binds to 127.0.0.1 ONLY.** All mutation endpoints require `X-Rauf-Request: true` header.
5. **Per-project artifacts are self-contained.** A project with rauf installed must work without the manager tool.
6. **Status derivation reads files directly** — never invokes subprocesses for status.

## Specification Documents

Before implementing any feature, read the relevant spec:

- **System architecture & data flow:** `docs/ARCHITECTURE.md`
- **All TypeScript types & JSON schemas:** `docs/SCHEMAS.md`
- **Core package logic:** `docs/SPEC-CORE.md`
- **CLI commands & behavior:** `docs/SPEC-CLI.md`
- **Web API & frontend:** `docs/SPEC-WEB.md`
- **Artifact templates (RAUF.md, CLAUDE_ADDON.md, etc.):** `docs/SPEC-ARTIFACTS.md`
- **Backlog-tool / loop-runner contract (the protocol consumers like feature-forge conform to) + LLM-agnostic provider architecture:** `docs/SPEC-BACKLOG-TOOL-CONTRACT.md`
- **Claude Code Tasks integration notes:** `docs/CLAUDE-CODE-TASKS.md`

## Development Commands

```bash
pnpm install          # Install all dependencies
pnpm gate             # THE gate — build + schema:check + version:check + typecheck + lint + format:check + test
                      #   This is exactly what CI runs (.github/actions/quality-gate). Run it before pushing.
pnpm build            # Build all packages
pnpm test             # Run all tests (vitest)
pnpm typecheck        # TypeScript type checking
pnpm lint             # ESLint
pnpm format:check     # Prettier check
pnpm version:check    # Assert all package.json versions match packages/core/src/version.ts
```

> **`pnpm gate` is the single source of truth for "is it green?"** — CI runs the identical command, and
> the forge pipeline's per-item acceptance gate uses it too (`forge.config.json`). Run `pnpm gate`
> locally before pushing; don't rely on the narrower `typecheck && test` subset (it misses `build` and
> `schema:check`).

## Branching & merging

`main` is protected: it requires the green `check` status (which runs `pnpm gate`) on every push, so a
direct `git push origin main` is **rejected**. Every change — code, docs, and release-prep — reaches
`main` **via a pull request**:

1. Branch from an up-to-date `main` (`git checkout main && git pull && git checkout -b <type>/<slug>`).
2. Make the change; run `pnpm gate` locally until green.
3. Push the branch and open a PR; let CI's `check` go green.
4. **Squash-merge** (`required_linear_history` is on). Never push to `main` directly.

Releases follow the same rule — see [Publishing & Releasing](#publishing--releasing): `release:prepare`
produces a release-prep PR, and the owner tags the merged commit afterward.

## Test Sandbox

`test-sandbox/` provides a self-contained rauf project with mock Claude scripts for testing the loop runner without API access.

```bash
bash test-sandbox/run.sh                  # Default scenario (stream-done)
bash test-sandbox/run.sh stream-blocked   # Specific scenario
bash test-sandbox/verify.sh               # All scenarios with assertions
```

When modifying `packages/loop/` or loop CLI commands, use the sandbox to verify changes. See `test-sandbox/README.md` for detailed guidance (scenarios, mock Claude, stream/signal parsing).

## Dev Environment Setup

### Prerequisites

- **Bun** — TypeScript runtime (`curl -fsSL https://bun.sh/install | bash`)
- **pnpm** — Package manager (`npm install -g pnpm@9`)
- **direnv** — Auto-loads environment per directory (recommended)

### Installing direnv

```bash
# macOS
brew install direnv

# Ubuntu/Debian
sudo apt install direnv

# Arch
sudo pacman -S direnv
```

Then hook it into your shell by adding to `~/.zshrc` (or `~/.bashrc`):

```bash
eval "$(direnv hook zsh)"   # or: eval "$(direnv hook bash)"
```

Restart your shell, then from the repo root:

```bash
direnv allow
```

### Running the CLI in dev

After `pnpm install`, direnv automatically adds `scripts/bin/rauf` to your PATH. This wrapper runs `bun` directly on the TypeScript source — no build step needed, always uses the latest code:

```bash
rauf status .          # Show loop state + backlog summary
rauf backlog list .    # List all backlog items
rauf loop run .        # Run a loop iteration
```

For global availability outside the repo directory, run the install script to symlink into `~/.local/bin`:

```bash
bash scripts/install-global.sh
```

If you don't use direnv or the global symlink, you can add the PATH manually:

```bash
export PATH="$(pwd)/scripts/bin:$PATH"
```

Alternatively, `pnpm rauf <args>` also works (routes through `node_modules/.bin/rauf` which requires `pnpm build` first).

## Coding Conventions

- Strict TypeScript (`strict: true`, `noUncheckedIndexedAccess: true`)
- Named exports only (no default exports except React components that need them)
- Prefer `node:` prefix for Node built-ins (`node:fs`, `node:path`)
- Error handling: return `Result<T, E>` types from core functions, never throw for expected errors
- File paths: always use `path.resolve()` before any operation
- JSON parsing: always wrap in try/catch, return structured errors
- Tests: colocate with source as `*.test.ts`

### Editor / TypeScript diagnostics — trust `pnpm gate`, not the editor

The single source of truth for "does it type-check" is **`pnpm typecheck`** (and the full
**`pnpm gate`**) — never the in-editor LSP. If the editor reports `@rauf/*` errors that
`pnpm typecheck` does **not** ("Cannot find module `@rauf/core`", "has no exported member",
stale enum members, a signature that "lacks a return"), those are **phantom** — your built
`dist/*.d.ts` is stale or missing, not your code.

Why this happens: the workspace is a TS **project-references** monorepo
(`packages/loop` → `core`; `packages/cli`/`web` → `core` + `loop`, with `core`/`loop`
`composite`). Cross-package types resolve through each dependency's **built** `dist/*.d.ts`
(via package `exports`), so the editor's TS server shows errors whenever that `dist` lags the
source. `pnpm typecheck` is reliable because the gate builds first (`pnpm build` is the
deterministic first step — `dist`-co-located `tsbuildinfo` guarantees a real emit).

Fix when you see phantom errors:

```bash
pnpm build            # refresh every package's dist/*.d.ts (deterministic)
# then, in VS Code: "TypeScript: Restart TS Server" (or "Developer: Reload Window")
```

> A `paths`-to-source remap (`@rauf/* → packages/*/src`) was investigated to make the editor
> resolve from source and side-step this entirely. It is **incompatible** with the current
> `composite`/`references` setup (yields `TS6305` when `dist` is absent; dropping `composite`
> to enable it yields `TS6059` — cross-package source outside each package's `rootDir` — on
> both build and typecheck). Making it work would require splitting build vs. typecheck
> tsconfigs across all four packages, which would jeopardize the deterministic build. Not
> worth it: keep the references setup and `pnpm build` + restart the TS server.

## Claude Code Tasks vs Rauf Backlog

This project uses `.rauf/backlog.json` as the persistent task queue for the rauf loop. Claude Code's native Tasks system (`~/.claude/tasks/`) is a separate, session-scoped mechanism. **Do not confuse them:**

- **backlog.json** = What work items exist (human-managed, persistent, cross-session)
- **Claude Code Tasks** = How the agent decomposes current work within a session (ephemeral)
- The rauf loop reads backlog.json at iteration start — it is the source of truth
- You MAY use Claude Code Tasks internally to plan your approach to a backlog item, but backlog.json status updates are what matter

## Self-Hosting Note

This repository IS a rauf-managed project. The `.rauf/` directory at the repo root is this project's own rauf loop state. Run the loop with `rauf loop run` (direct mode) or `rauf loop run --detached` (server mode). The `artifacts/variants/backlog-json/` directory contains the _templates_ used when installing rauf into OTHER projects. Do not confuse them.

To start a fresh backlog cycle after the loop finishes (all items `done`), clear and re-populate the backlog with `rauf backlog reset <path> --clear` — **never** by hand-editing `backlog.json` (that loses history and desyncs state). See the `author-backlog` skill's "Resetting a Completed Backlog" section.

This project has exactly one backlog home: `.rauf/`. Do **not** create parallel or nested `.rauf/`-style dirs (`subdir/.rauf/`, `.rauf-foo/`) for side work — they become noise in `rauf status`/root selection and are never cleaned up. Reset and reuse the main backlog, or (for a genuine parallel feature under a pipeline) use the `--backlog <specsDir>/<feature>/` convention. See the `author-backlog` skill's "Target Backlog Directory" section.

## Publishing & Releasing

Two separate, **manual, owner-gated** flows — a routine merge to `main` never publishes anything. Both are **PR-based**: like all changes, a release reaches `main` via a PR (see [Branching & merging](#branching--merging)), and only the owner cuts the actual release.

- **Binary release** (the `rauf` CLI binaries + GitHub Release): a **release-prep PR** then an **owner tag**. Run `pnpm release:prepare X.Y.Z` — it bumps all eight version locations, rolls the changelog, commits on a `release/X.Y.Z` branch, and pushes it for a PR (it does **not** push `main` or tag). After the PR merges on green CI, the **owner** tags the merged commit (`git tag -m vX.Y.Z vX.Y.Z && git push origin vX.Y.Z`); the `v*` tag triggers `release.yml`. Full mechanics in `docs/RELEASING.md`.
- **npm launcher** (`@garygentry/rauf` — the `npx @garygentry/rauf` shim in `npm-dist/`): published by `.github/workflows/npm-publish.yml`, whose **only** trigger is `workflow_dispatch` (Actions → "npm Publish (manual)"). The published version is `npm-dist/package.json`'s version, kept in lockstep with the binary release by the version guards — so publish the launcher **after** the matching `vX.Y.Z` GitHub release exists, so `npx @garygentry/rauf@X.Y.Z` resolves to that release's binary.

> rauf and **feature-forge** are versioned **independently** — there is no lockstep. The only coupling is feature-forge's dependency pin on a published rauf coordinate (`RAUF_PIN`) plus its `COMPATIBILITY.md`. Both repos share the same release _process_ (PR-only merges, manual owner-gated publish, bump-before-publish, offer-don't-act).

**Agent guidance — offer, don't act.** When merged changes are user-facing and worth getting to end users, proactively **suggest** the appropriate release/publish and outline the steps; never tag, `npm publish`, or dispatch a publish yourself. These are deliberate, owner-only acts.

---

<!-- rauf:start -->

## Autonomous Loop (Rauf)

When running as a rauf loop iteration, follow these operational rules:

### Reading Your Task

1. Read `RAUF.md` for detailed per-iteration instructions
2. Read the backlog — find the current `in_progress` item
3. The item's `acceptanceCriteria` define "done" for this iteration

### Working

4. Implement the changes described in the item's description
5. Follow acceptance criteria precisely — each one must pass
6. Run the verification command before considering work complete

### Completing

7. If all acceptance criteria pass: output `RAUF_DONE` as your final line
8. If blocked (missing dependency, unclear requirement): output `RAUF_BLOCKED:<reason>`
9. If human input needed (API key, design decision): output `RAUF_NEEDS_HUMAN:<reason>`
10. Do NOT commit or stage — the iteration agent never commits or stages; the loop runner owns the commit. Leave your changes in the working tree.

> Output the signal on a line by itself, as your final line — that's the safest
> habit. The runner scans backwards from the end and uses the **last** signal
> line, so trailing text after it (a commit message, a summary) does **not** break
> detection.
>
> `RAUF_REVIEW:<json>` is emitted only by a review pass, not a normal work
> iteration. If you emit no recognized signal, the runner does **not** auto-block
> the item — it classifies the outcome by exit context and reconciles committed
> work.

### Rules

- ONE item per iteration — do not work on multiple items
- Do not modify `backlog.json` — the loop runner manages status
- Do not modify `state.json` — the loop runner manages state
- Read `progress.md` for accumulated project learnings
- Append new learnings to `progress.md` if you discover important patterns

### Model Selection

The runner picks the model by precedence (highest wins):
`item.model` > `--model` / options > project default > provider default.

<!-- rauf:end -->
