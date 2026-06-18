# Dogfooding rauf

This repo is itself a rauf-managed project. We develop rauf features by running
them through feature-forge's pipeline and driving implementation with rauf's own
autonomous loop. This document is the **loop workflow** for contributors.

> The Claude Code plugin/environment setup (loading feature-forge and rauf live
> from working-tree source via skills-dir symlinks) lives once in
> feature-forge's
> [README → Local development](https://github.com/garygentry/feature-forge/blob/main/README.md#local-development).
> Set that up first; this doc does not repeat it.

## Two binaries, two roles

| Binary        | What it is                                                                              | Use for                                                    |
| ------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `rauf`        | `~/.local/bin/rauf` → `scripts/bin/rauf`, runs the **live TS source** via Bun           | Interactive / ad-hoc commands while developing             |
| `rauf-stable` | A **compiled snapshot** (`bun build --compile`) installed to `~/.local/bin/rauf-stable` | The **loop runner**, decoupled from in-flight source edits |

Running the loop with a compiled snapshot means an edit you make mid-iteration
(or a half-finished refactor) can't change the runner out from under a running
loop. The live `rauf` wrapper stays for everything else.

## Build / refresh the runner

```bash
pnpm dogfood:runner        # = pnpm compile && install-binary.sh --local --name rauf-stable
rauf-stable version --json # sanity-check the installed snapshot
```

Rebuild **whenever you change the runner itself** (anything under
`packages/loop`, `packages/core`, or the loop CLI in `packages/cli`). Feature
code that the loop merely _implements_ does not require a rebuild; only changes
to the runner's own behavior do.

feature-forge drives this binary via the `loopRunner.bin` field in
`forge.config.json` (set to `rauf-stable` in this repo), which it substitutes as
`{bin}` into the rendered `loop run` command. So forge-5 runs
`rauf-stable loop run …` rather than the default `rauf …`.

## Loop safety guard

`rauf loop run` refuses to start when it would be unsafe, because the loop
auto-commits with `git add -A` on the **current** branch:

- on the default branch (`main` / `master`),
- on a detached `HEAD`,
- with a **dirty** working tree (uncommitted changes).

Each refusal exits with `CONFLICT` and an actionable message. Pass `--force` to
bypass the guard, but note `--force` **also force-clears any loop lock** (stale
or live); there is currently no way to skip the guard alone. The guard applies
to `loop run` (direct mode); `loop start` (server mode) is a follow-up.

This is why `plans/` is git-ignored and untracked: plan-mode scratch written to
`plans/<name>.md` at the repo root must never be swept into a loop's `git add -A`
commit.

## A feature, end to end

1. **Branch per feature**: never run the loop on `main` (the guard enforces
   this):

   ```bash
   git checkout -b feature/<name>
   ```

2. **Drive the pipeline** (interactive, in Claude Code):

   ```
   /feature-forge:forge-1-prd <name>     # → forge-2-tech → forge-3-specs
   /feature-forge:forge-4-backlog <name> # author + validate backlog
   ```

   forge-4 validates the generated backlog via `rauf backlog validate`.

3. **Run the loop** against the feature's backlog. State is isolated per
   `--backlog` root, under `specs/<name>/.rauf/`:

   ```bash
   rauf-stable loop run . --backlog specs/<name>
   ```

   On a clean feature branch the guard passes and the loop iterates, committing
   each completed item as `[rauf] <item-id>: <title>`. From `main` or a dirty
   tree it refuses; switch/clean up, or pass `--force` (which also clears the
   lock).

4. **Gate on green CI, merge via PR.** Open a PR for the feature branch; let
   GitHub Actions run. Merge only on green. Publishing anything outward-facing
   (e.g. cutting a release tag) is a deliberate human step, never the loop.

### Review at the gate, not per iteration

If you have a commit/`Stop`-triggered review hook installed globally (e.g. a
security-review plugin), it fires inside **every** loop child session. That is
noise rather than real review, since the child rubber-stamps its own findings. Run the loop
quiet and review the cumulative branch diff **once**, surfaced to you:

```bash
rauf-stable loop run . --backlog specs/<name> --suppress-iteration-review
```

`--suppress-iteration-review` propagates a documented set of hook-suppression
env vars (`REVIEW_HOOK_SUPPRESSION_ENV` in `@rauf/loop`, currently
`ENABLE_CODE_SECURITY_REVIEW=0`) into each child session. It is generic: the
`childEnv` loop option opts out of any hook that honors an env var. Then gate
once over `main..HEAD`: `git diff main..HEAD`, the PR review hook / CI, or
`rauf loop review`. See `docs/SPEC-CLI.md` → "Single-gate review".

## Verify the setup

```bash
# Guard unit tests
npx vitest run packages/loop/src/git-status.test.ts

# Guard in practice: from main, a run is refused
rauf loop run . --backlog specs/<x>     # → CONFLICT, with the message

# Runner snapshot is the expected version
pnpm dogfood:runner && rauf-stable version --json   # → { "version": "0.6.0" }

# plans/ is untracked + ignored
git ls-files plans/                     # → empty
git check-ignore plans/anything.md      # → matches
```
