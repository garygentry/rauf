# Runbook: a feature through the forge pipeline (worked example: release-automation)

End-to-end steps for building a rauf feature by driving feature-forge's pipeline
with rauf's own loop. The worked example is **release-automation** (the deferred
release/CI workflow), but the flow is the same for any feature.

> Prerequisite reading: [`DOGFOODING.md`](./DOGFOODING.md) (the `rauf` vs
> `rauf-stable` split, the loop safety guard, building the runner) and
> feature-forge's
> [README → Local development](https://github.com/garygentry/feature-forge/blob/main/README.md#local-development)
> (loading the plugins live via skills-dir symlinks).

All `/feature-forge:*` and `/feature-forge` commands run **inside Claude Code**;
lines shown with a `$` prefix are shell commands.

## Preconditions (verify once)

| Check                                                    | Command                             | Expect                                          |
| -------------------------------------------------------- | ----------------------------------- | ----------------------------------------------- |
| On a feature branch (not `main`)                         | `git branch --show-current`         | `feature/release-automation`                    |
| Clean working tree (the loop guard refuses a dirty tree) | `git status --porcelain`            | empty                                           |
| Runner installed + current                               | `rauf-stable version --json`        | `{ "version": "0.6.0" }` (≥ `minRunnerVersion`) |
| forge-5 setup gate                                       | `ls .rauf.json`                     | present                                         |
| Runner wired in forge                                    | `grep loopRunner forge.config.json` | `"loopRunner": { "bin": "rauf-stable" }`        |
| forge config exists                                      | `ls forge.config.json`              | present (`forge-init` already run)              |

If the tree is dirty with unrelated local edits (e.g. `.claude/settings.local.json`):

```
$ git stash push .claude/settings.local.json   # restore later with: git stash pop
```

> The loop **auto-commits with `git add -A`** on the current branch, which is why
> a clean tree on a non-default branch is required. Only rebuild `rauf-stable`
> (`pnpm dogfood:runner`) if you change **runner** code. Implementing a feature
> that doesn't touch `packages/loop|core` or the loop CLI leaves the snapshot valid.

## 1. PRD → Tech spec → Implementation specs

```
/feature-forge:forge-1-prd release-automation
/feature-forge:forge-2-tech release-automation
/feature-forge:forge-3-specs release-automation
```

- Produces under `specs/release-automation/`: `PRD.md`, `tech-spec.md`, numbered
  `NN-*.md` implementation specs, `TRACEABILITY.md`, and `.pipeline-state.json`.
- forge-2 detects/sets `stack` / `typeCheckCommand` / `testCommand` in
  `forge.config.json` (here: `typescript` / `pnpm typecheck` / `pnpm test`).
- Each stage auto-commits (`forge(release-automation): …`) because
  `gitCommitAfterStage: true`.
- **Stay on `feature/release-automation`**: if forge-1 offers to create a
  `forge/release-automation` branch, decline (the loop guard needs this
  non-default branch).

**Feature substance to aim the PRD at:** `.github/workflows/release.yml`
(tag → per-platform `bun build --compile --target …` → upload binaries +
`install-binary.sh` to the GitHub Release), install-script polish, and docs.

## 2. Verify specs (gate before backlog)

```
/feature-forge:forge-verify release-automation        # auto-detects the "specs" stage
/feature-forge:forge-fix release-automation            # only if findings were reported
```

Writes `specs/release-automation/.verification/VERIFY-specs-<date>.md`. Re-run
verify after fix until clean.

## 3. Backlog (delegates to rauf, then validates)

```
/feature-forge:forge-4-backlog release-automation
```

- Delegates authoring to the **`rauf:author-backlog`** skill (loaded via the
  skills-dir symlink), writing `specs/release-automation/backlog.json`.
- Validates by rendering
  `rauf-stable backlog validate . --backlog specs/release-automation --specs-dir ./specs --json`
  (exit `0` valid / `1` findings / `2` usage-IO error).
- Auto-commits the backlog.

## 4. Verify backlog (gate before the loop)

```
/feature-forge:forge-verify release-automation backlog
/feature-forge:forge-fix release-automation            # if needed
```

## 5. Run the loop

```
/feature-forge:forge-5-loop release-automation
```

forge-5 automatically:

- **Version gate**: `rauf-stable version --json` must be ≥ `0.5.0` (the feature-forge `minRunnerVersion`).
- **Setup gate**: `.rauf.json` must exist at the project root.
- **Iteration budget**: `ceil(pending × 1.5)`.
- **Renders the run command and asks you to confirm**, then runs it in the
  background:

  ```
  rauf-stable loop run . --backlog specs/release-automation --iterations <N>
  ```

  Optional flags to add at the prompt: `--review` (post-pass diff review),
  `--model`, `--timeout`, `--retry-blocked`.

Per iteration the loop selects one `pending` item, spawns Claude, and on
`RAUF_DONE` **auto-commits** `[rauf] <item-id>: <title>` on this branch.
`RAUF_BLOCKED:<reason>` parks the item; `RAUF_NEEDS_HUMAN:<reason>` stops the loop
for you. The loop does **not** run `pnpm test` itself; each item's acceptance
criteria instruct Claude to verify, and `--review` adds a diff review that can spawn
fix items.

**Monitor** (separate shell, or via the skill's monitor commands). State, log,
and lock live under `specs/release-automation/.rauf/`:

```
$ rauf-stable status . --backlog specs/release-automation --watch
$ rauf-stable log . --backlog specs/release-automation --follow
$ rauf-stable backlog list . --backlog specs/release-automation --json
```

If items end blocked, unblock and re-run:

```
$ rauf-stable loop run . --backlog specs/release-automation --retry-blocked
```

## 6. Docs + implementation verify

```
/feature-forge:forge-6-docs release-automation
/feature-forge:forge-verify release-automation impl     # implementation vs specs
```

Check overall pipeline status any time with `/feature-forge:forge release-automation`.

## 7. CI gate → PR → merge

```
$ git push                                  # push the loop's commits
```

Open a PR for `feature/release-automation`, let GitHub Actions go green, review
`release.yml`, then merge to `main`.

## 8. Cut the release (human-gated, NOT the loop)

Publishing a release is outward-facing and irreversible, so it is a deliberate
manual step. After the PR merges on green CI, push the tag (which is what
triggers `release.yml` to build and publish the binaries):

```
$ git checkout main && git pull
$ git tag vX.Y.Z && git push origin vX.Y.Z
```

Restore any stashed local edits when done: `git stash pop`.
