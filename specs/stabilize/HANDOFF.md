# Rauf Stabilization & Repo-Migration — Execution Handoff

> Point a fresh session at this file. **Goal:** get rauf to a clean, stable state — clear every
> known outstanding issue AND bring every rauf-managed repo on this machine up to the latest
> config/artifacts/skills. Work the workstreams below; each is independently shippable.
>
> Predecessor context: the documentation overhaul (Phases A–D) is **complete and merged**
> (PRs #17–#21). See `specs/docs-overhaul/{PLAN,HANDOFF}.md` for that history — it is **done**;
> do not re-open it. `main` is at the post-#21 state, working tree clean.

## Current baseline (verified 2026-06-15)

- **Versions:** source + `packages/core/src/version.ts` = **0.6.0**. Both executables are 0.6.0:
  - **dev `rauf`** → `scripts/bin/rauf` (runs TS source live; for hacking on rauf itself).
  - **frozen `rauf-stable`** → `~/.local/bin/rauf-stable` (compiled 0.6.0 binary; **use this for
    operating on OTHER repos** so a dev rebuild can't disrupt a mid-flight migration). Rebuild it
    any time with `pnpm dogfood:runner`.
- **Published releases lag:** latest GitHub release is **v0.4.0**; `v0.5.0`/`v0.6.0` are tags with
  **no published release**. `CHANGELOG.md` tracks through `0.4.0` with everything since under
  `## Unreleased`. (This is WS2.)
- **`pnpm gate` is green** and now includes `check:docs` (the anti-drift guard added in Phase D).
- **Skills are global, not per-repo:** `skills/{author-backlog,review-backlog,drive-rauf-loop,
  review-rauf-guidance}` are exposed via the Claude Code plugin (`.claude-plugin/plugin.json`) and a
  `~/.claude/skills/rauf` symlink into this repo. A `git pull` of rauf updates skills everywhere —
  **no per-repo skill sync is needed.** (Verify the symlink/plugin are current; that's the whole job.)

## Guardrails

- **`main` (this repo) is branch-protected** (required check `check`, enforce-admins): branch → push
  → PR → `gh run watch <id> --exit-status` → merge on green. No direct pushes. `pnpm gate` green
  before every push.
- **Operate on other repos with `rauf-stable`**, not dev `rauf`.
- **`rauf update` has NO `--dry-run`** (verified). Each target repo is a git repo, so the safety net
  is **`git diff` after** — branch first, run update, review the diff, then commit. `rauf migrate`
  **does** have `--dry-run` — always run it first.
- **Never touch `rauf/test-sandbox/`** — it's a test fixture (`installedBy: "test-sandbox"`), not a
  real project.
- **No active loops right now** (the `~/.rauf/active/` registry is empty, no live `.loop.lock`), so
  migrate/update won't be blocked. Re-check before starting.
- Commit messages end with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## WS1 — Migrate & update all rauf-managed repos (the main ask)

Every managed repo on this machine was installed by an **old** tool version and has stale artifacts.
Bring each to 0.6.0. Skills need no per-repo action (global). The mechanics:

- `rauf migrate <path>` — **only** for the one legacy `.ralph` project (anvil2). Name/structure
  rename only (`.ralph`→`.rauf`, `RALPH.md`→`RAUF.md`, marker rewrite). Has `--dry-run`. Does **not**
  backfill artifacts → must be followed by `rauf update`.
- `rauf update <path>` — re-syncs templated artifacts. **Safe & idempotent:** rewrites only the
  RAUF.md managed sentinel block (`<!-- rauf:managed:start/end -->`), always overwrites
  `backlog.schema.json`, appends `.gitignore` (dedup), refreshes `.rauf.json` (`installedBy` →
  `rauf-manager@0.6.0`, drops stale artifact hashes). **Never touches** `backlog.json`,
  `progress.md`, or a customized `REVIEW.md`. Success signal: `.rauf.json.installedBy` flips to
  `0.6.0` and the legacy `ralph.sh`/`ralph-status.sh`/`ralph-add.sh` hashes disappear from the marker.

### Repo inventory & required action

| Repo (`/home/gary/workspace/…`) | `installedBy` | State | Action |
| --- | --- | --- | --- |
| `anvil2` | `ralph-manager@0.1.0` | **LEGACY ralph** (`.ralph/`, `.ralph.json`, `RALPH.md`) | `migrate --dry-run` → `migrate` → `update` → profile check → commit |
| `ai-os` | `rauf-manager@0.4.0` | rauf, **`profile.verify` is EMPTY**, stack `unknown` | `update` **+ fix profile** (no verify gate today!) → commit |
| `feature-forge` | `rauf-manager@0.4.0` | rauf, **`profile.verify` EMPTY**, stack `unknown` | `update` **+ fix profile** → commit (active sibling tool — see decision Q3) |
| `resume-ai` | `rauf-manager@0.1.0` | rauf, profile OK (`pnpm test && lint && format:check`) | `update` → commit |
| `starter-kitchen-sink-bun` | `rauf-manager@0.1.0` | rauf, profile OK (`bun run verify`), tab-indented marker | `update` → commit |
| `rauf` (self) | `rauf-manager@0.1.0` | **marker still lists legacy `ralph.sh` artifact hashes** | `rauf update .` to refresh the marker — **via branch+PR** (this repo is protected) |
| `rauf/test-sandbox` | `test-sandbox` | fixture | **LEAVE ALONE** |

> **Profile gap is a real bug, not cosmetic:** `ai-os` and `feature-forge` have `profile.verify: ""`
> and `stack: "unknown"` — their loops run with **no verification gate**, so the agent can mark items
> done without tests/typecheck passing. Fix with `rauf-stable profile detect <path>` then
> `rauf-stable profile set <path> …` (or re-run `update` with explicit `--test-cmd/--typecheck-cmd/
> --lint-cmd/--build-cmd/--format-cmd`). Confirm the resulting `verify` string is sane per repo.

### Per-repo runbook (template)

For each non-self repo (using `rauf-stable`):

```bash
cd /home/gary/workspace/<repo>
git switch -c chore/rauf-update-0.6.0          # branch first (no --dry-run on update)
# legacy only (anvil2):
rauf-stable migrate . --dry-run                 # inspect the plan
rauf-stable migrate .                           # rename .ralph→.rauf etc.
# all repos:
rauf-stable update .                            # refresh artifacts to 0.6.0
rauf-stable profile detect .                    # ai-os / feature-forge: fix empty verify
# rauf-stable profile set . <key> <value>       # apply detected/correct commands as needed
git diff                                         # REVIEW — confirm only managed block + schema + marker changed
git add -A && git commit -m "chore: update rauf artifacts to 0.6.0 (migrate legacy state where applicable)"
# push/PR per that repo's own conventions (most are personal repos w/o protection)
```

For the **self** repo (`rauf`): do it on a branch and PR it through CI like any change —
`rauf update .` (dev binary is fine here), review the `.rauf.json` diff (stale `ralph.sh` hashes
should drop, `installedBy`→0.6.0), `pnpm gate`, PR, merge on green.

### Skills (no per-repo work)

Confirm `~/.claude/skills/rauf` resolves to `/home/gary/workspace/rauf` and the plugin
(`.claude-plugin/plugin.json`) is current; a `git pull` keeps all four skills live everywhere. If the
symlink is missing/stale, recreate it. Nothing is copied into individual repos.

---

## WS2 — Release cadence: cut v0.5.0 + v0.6.0 (owner-gated)

The binary-install path documented in the README installs the **latest published release (v0.4.0)**,
which lags source (0.6.0). To make it current:

1. Split `CHANGELOG.md`'s `## Unreleased` into real `## 0.5.0` and `## 0.6.0` sections (mine the git
   log between the `v0.4.0` tag and now; the v0.5.0 grammar flip is the headline of 0.5.0).
2. Cut the releases per `docs/RELEASING.md` (`pnpm release:prepare`, then the tag push that triggers
   `release.yml` → cross-compiles 5 targets + `SHA256SUMS` + `gh release create`).
3. **Blocker:** the `release-tags` ruleset restricts `v*` tag creation to the repo owner
   (`garygentry`). A coding session **cannot push the tag** — Gary must do the tag push (or
   explicitly authorize it). The session can do everything up to the tag.

Once released, the docs need **zero** changes — they deliberately assert no binary version.

## WS3 — Repo & branch hygiene

- **`forge/dx-ship-reliability`** (local branch): merged into `main` but its **remote** tracking
  branch has commits **not** in the local copy — left undeleted in Phase-D cleanup. Investigate:
  if the remote branch is dead, delete both (`git branch -D` + `git push origin --delete`); if it
  holds live work, reconcile it. (All other stale local branches were already pruned.)
- Sanity-sweep remotes: `gh pr list --state open` and `git branch -r` for other abandoned branches.
- Pre-rauf-rename tags (`pre-rauf-rename`, old `v0.3.0-rc.*`) exist — decide keep vs prune
  (historical; low priority).

## WS4 — Minor code cleanups & enhancements (optional, scope to taste)

These are quality/ergonomics items surfaced during the overhaul — **none block "stable"**, but they
close known gaps. Pick what's worth a small PR each (branch → gate → PR → merge):

- **`rauf update` ignores `--yes`** (parsed but unused — `install-commands.ts:~164`). Either wire it
  to a real confirmation prompt or drop the flag from help to avoid implying behavior it lacks.
- **No drift-detection command.** There's no first-class way to ask "are this repo's artifacts
  stale?" — today you compare `.rauf.json.artifactHashes` by hand or read a `git diff` after update.
  Consider `rauf update --dry-run`/`--check` (report-only) or an artifact-staleness line in
  `rauf status`. Would make future bulk-updates one-command-auditable.
- **`rauf migrate` documentation intent (decision Q4).** Phase D documented `rauf migrate` in
  `docs/SPEC-CLI.md` (it was registered but undocumented; the new `check-docs` parity guard requires
  every `commands.ts` command to appear there). If `migrate` is meant to be a one-shot legacy tool
  rather than part of the public surface, decide: keep it documented, or hide it + allowlist it in
  `scripts/check-docs.ts`. Right now it's documented.
- **Tier-2 diagrams (optional, from the docs PLAN §4 WS5.7).** CLI command map; backlog→loop→commit
  flow. Same generator (`scripts/generate-diagrams.ts`), same dark/light discipline, register
  symlinks in `scripts/setup-docs.sh`, embed where relevant.

## NOT issues — do not chase

- **Editor/LSP TypeScript errors on `@rauf/*`** (e.g. `ExitCode.CONFLICT`/`PAUSED_HUMAN` "does not
  exist", `eventsLog` missing, `acquireRecoveryLock` not exported) are **phantom** — stale
  `dist/*.d.ts` in the editor's TS server, not real. `pnpm gate` is the source of truth and is green.
  Fix the editor with `pnpm build` + "TypeScript: Restart TS Server" (see CLAUDE.md). Never "fix"
  source to satisfy these.

---

## Decisions needed from Gary (resolve before/at start)

1. **Executable:** confirm `rauf-stable` (frozen 0.6.0) for operating on other repos. (Recommended.)
2. **Per-repo commit strategy:** branch + `git diff` review + commit in each target repo, pushing/PRing
   per that repo's own norms? (Most are personal, unprotected.) Or just commit on `main` of each?
3. **`feature-forge` in scope?** It's a rauf-managed repo that needs the update + a profile fix, but
   it's an active sibling tool. The docs-overhaul "don't touch feature-forge" rule was scoped to that
   overhaul; for stabilization it's arguably in scope. Confirm include vs defer.
4. **`rauf migrate` surface** (see WS4) — keep documented, or hide + allowlist?
5. **Releases (WS2):** do you want this session to prep everything up to the tag, then you push the
   `v0.5.0`/`v0.6.0` tags? Or defer releases entirely for now?

## Definition of done

- Every managed repo (anvil2, ai-os, feature-forge, resume-ai, starter-kitchen-sink-bun, self) shows
  `installedBy: rauf-manager@0.6.0`, no legacy `ralph.*` artifact hashes, and a **non-empty, correct
  `profile.verify`**; anvil2 has no `.ralph*` remnants. `test-sandbox` untouched.
- Skills confirmed global-current (symlink + plugin); no per-repo skill drift.
- `forge/dx-ship-reliability` reconciled; no other stray branches.
- (If pursued) `CHANGELOG.md` split and v0.5.0/v0.6.0 released — binary install path matches source.
- `pnpm gate` green on rauf `main`; every rauf-repo change merged via approved CI-green PR.
- Any WS4 items taken on are shipped; the rest explicitly deferred here.
