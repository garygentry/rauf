# Follow-ups Execution Handoff — P2 + P3 (everything except Part B)

> Self-contained handoff so a fresh session can execute **all remaining remediation follow-ups except
> Part B**: P2 (DX/process) and P3 (the 5 conformance-review notes). Source of truth for the items:
> `specs/ux-overhaul/REMEDIATION-PLAN.md` (problem/evidence/action per REM). This doc adds the
> **sequencing, vehicles, branch strategy, gates, and stop points**. Read it top to bottom, then work
> the sequence in §3.

## 1. Where we are

- The 4-phase UX/DX overhaul shipped (v0.6.0 on `main`, CI green).
- **P1 ship-reliability is DONE on branch `forge/dx-ship-reliability`** (commit `e255961`), CI green,
  **unmerged**. It adds the canonical `pnpm gate` (build + schema:check + version:check + typecheck +
  lint + format:check + test), fixes the deterministic-build bug (co-located tsbuildinfo), and adds the
  version guard. **`pnpm gate` is now THE gate** — use it everywhere below.
- Remaining: P2 (REM-4/5/6) and P3 (REM-7..11). **Part B is explicitly out of scope.**

## 2. Guardrails (apply throughout)

- **`pnpm gate` green before every push; CI green before every merge.** (CI runs `pnpm gate`.)
- **Pause for explicit user approval before every merge to `main`** and before any push to `main`.
  Branch CI is triggered without a PR via `gh workflow run ci.yml --ref <branch>` (the guardrail is no
  *unapproved* PR/merge; triggering CI on a branch is fine).
- **Dogfood the P3 loop with the frozen `rauf-stable` binary**, never the dev `rauf` (the items rewrite
  CLI/web surfaces). `forge.config.json` pins `loopRunner.bin = rauf-stable`.
- Watch CI after each push (`gh run watch <id> --exit-status`); a red `main` must never go unnoticed
  (that's literally REM-6).
- The recurring **phantom-LSP** gotcha: trust `pnpm typecheck`/`pnpm gate`, not editor diagnostics.

## 3. The sequence

### Step 0 — Merge P1 first (precondition; user-approved)

P2/P3 build on P1's `pnpm gate`. From clean `main`: `git merge --no-ff forge/dx-ship-reliability`,
push, watch CI green. (User has greenlit proceeding with the chain — but still confirm before the
push.) Everything below branches off the updated `main`.

### Step 1 — P2 quick-fixes → branch `forge/dx-p2`

Two code/config changes; one commit each or one combined, your call. Gate green, push, CI green, merge
on approval.

- **REM-5 — docs duplicate-id warnings.** `pnpm --filter @rauf/docs build` emits `Duplicate id
  "architecture"/"schemas"/…` — the Starlight docs-loader ingests the same doc from two sources.
  Investigate `packages/docs/` (astro config + content collection / docs-loader globs) and make each
  doc have ONE source. **Done when** the build has zero `Duplicate id` WARN lines and still produces the
  same pages.
- **REM-4 — phantom LSP root cause.** Confirm the hypothesis: the editor LSP resolves `@rauf/*` from
  built `dist/*.d.ts` (stale/missing) instead of source, so it shows false "no exported member" /
  "cannot find module" errors that `pnpm typecheck` contradicts. **Fix:** add root `tsconfig.json`
  `compilerOptions.paths` mapping `@rauf/*` → `packages/*/src` (incl. subpath exports like
  `@rauf/core/state-labels` → `packages/core/src/state-labels.ts`) so the editor/tsc resolve from
  source; **verify it does NOT change build output** (the build resolves via package `exports`→`dist`;
  `paths` affects type resolution only — confirm `pnpm gate` stays green and `core` still emits). If
  `paths` proves risky, fall back to proper TS project references (`tsc -b`) or, at minimum, a
  CONTRIBUTING/CLAUDE.md note "trust `pnpm typecheck`, not the editor." **Done when** a deliberately
  edited cross-package import shows correct (not phantom) diagnostics in-editor AND `pnpm gate` green.

### Step 2 — REM-6: branch-protect `main` (repo setting, not code)

Require the CI `check` job green before merging to `main`. Attempt via `gh api`:
`gh api -X PUT repos/garygentry/rauf/branches/main/protection …` requiring the status check `check`.
**If it fails on permissions** (needs repo admin), do NOT force it — output the exact `gh` command +
the GitHub UI path (Settings → Branches → add rule for `main` → require status check `check`) for the
user to apply, and mark REM-6 as "handed to user." This closes the "red `main` unnoticed" gap.

### Step 3 — P3: the 4 code review-notes as a dogfood rauf backlog

Author a backlog of REM-7..10 and run the **rauf loop with `rauf-stable`** against it (dogfood). Use an
**isolated backlog dir** so it doesn't touch the repo's self-host `.rauf/` — e.g.
`specs/dx-followups/` with `--backlog specs/dx-followups`. Each item's acceptance gate is **`pnpm gate`**
(now canonical). Items:

- **REM-7** — add targeted removed-verb remediation for `loop watch` / `loop follow` (today only `loop
  start` / `--watch` have them): `REMOVED_SUBCOMMAND_MESSAGES.loop.{watch,follow}` in
  `packages/cli/src/commands.ts` → "use `rauf follow`"; `main.ts` already routes removed subcommands to
  remediation. Test in `commands.test.ts`/`main.test.ts`.
- **REM-8** — web status page: add a non-default backlog-root selector and thread the chosen root
  (`?backlog=`) through `EventTimeline`, `LogPanel`, and the status/backlog queries
  (`packages/web/src/client/routes/projects/status.tsx`). The file-backed plumbing already honors
  `?backlog=`.
- **REM-9** — web dashboard: render a loading/unknown affordance instead of `?? "IDLE"` on an in-flight
  fetch (`packages/web/src/client/routes/projects/index.tsx:113`).
- **REM-10** — optionally stamp `seq`/`schemaVersion` on the `--ndjson` live stream for file/wire parity
  (`packages/cli/src/loop-commands.ts` ~`:890`).

If a full dogfood loop is overkill, hand-implementing these four (each tiny, each gated by `pnpm gate`)
is an acceptable fallback — but the dogfood path also exercises the new canonical gate inside the loop,
which is worthwhile. Gate green, push, CI green, merge on approval.

### Step 4 — REM-11 (separate repo, optional)

In `/home/gary/workspace/feature-forge`, the `plans/*.md` historical planning docs mention removed verbs
(`loop follow`/`loop watch`). Add a "superseded by v0.5.0 grammar" banner or tidy them. This is the FF
repo (not rauf) — a small separate commit; coordinate FF's own push separately. Lowest priority.

## 4. Suggested order & checkpoints

1. **Merge P1** (Step 0) — confirm, push, CI green.
2. **REM-6 branch protection** (Step 2) early — so the rest is gated by it. (Or hand to user.)
3. **P2 quick-fixes** (Step 1) on `forge/dx-p2` — REM-5 then REM-4 — gate, CI, merge.
4. **P3 backlog** (Step 3) — dogfood loop on `specs/dx-followups` — gate, CI, merge.
5. **REM-11** (Step 4) in the FF repo.

Stop and report after each merge. Do **not** touch Part B (provider architecture / AGENT_ADDON rename).

## 5. Definition of done

- P1 merged to `main` (v0.6.0 surface + canonical gate live).
- REM-4 (LSP resolves from source, verified) and REM-5 (zero docs duplicate-id warnings) merged.
- REM-6 applied (branch protection on `main`) or explicitly handed to the user with exact steps.
- REM-7..10 implemented (dogfood loop or hand), gate green, merged.
- REM-11 done in the FF repo (or noted as deferred).
- Every merge was CI-green and user-approved; Part B untouched.
