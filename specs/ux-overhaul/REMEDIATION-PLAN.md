# Remediation Plan — CI / DX / Conformance Follow-ups

> Follow-up to the UX/DX overhaul + its canon-conformance review
> (`specs/ux-overhaul/.verification/REVIEW-canon-conformance-2026-06-15.md`). Captures the
> recommendations the effort surfaced — the CI issues found while pushing v0.6.0, plus DX and polish
> observations — as a **prioritized, actionable plan**. Each item: problem · evidence · action ·
> vehicle · priority. Repo-wide (not overhaul-specific); the overhaul is shipped and green.

## Snapshot

The overhaul shipped clean (v0.6.0 merged, CI green), but the path there exposed gaps worth closing so
the **next** effort is more reliable:

- The local/forge gate every phase verified against was **narrower than CI** — `build` and
  `schema:check` were never run until the final push. (Systemic, P1.)
- A **non-deterministic CI build** red-flagged `main` twice on docs-only commits. (Real flake, P1.)
- `package.json` versions **lagged** `version.ts` (caught only in review). (Recurring, P1.)
- DX friction (phantom LSP), docs-build warnings, no CI gating on merge, and 5 small review notes.

## P1 — Ship reliability (do first; small, high-value)

### REM-1 — Define one canonical gate; align CI, forge, and humans to it
- **Problem:** There is no single "gate" command. CI's `quality-gate` runs **6 steps** (`pnpm build`,
  `pnpm schema:check`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`), but the forge
  pipeline's per-item acceptance gate and the local runs used only the last **4**. So `build` and
  `schema:check` failures were invisible until the v0.6.0 push. Every phase's backlog AC asserted an
  incomplete gate.
- **Evidence:** `.github/actions/quality-gate/action.yml` (6 `run:` steps) vs `forge.config.json`
  (`typeCheckCommand`/`testCommand` only) and the backlog AC string used across all phases
  (`pnpm typecheck && pnpm lint && pnpm format:check && pnpm test`). No `gate` script in
  `package.json`.
- **Action:** Add a root script `"gate": "pnpm build && pnpm schema:check && pnpm typecheck && pnpm
  lint && pnpm format:check && pnpm test"` (CI order). Point `.github/actions/quality-gate` at `pnpm
  gate` (single source). Update the documented dev gate in `CLAUDE.md` ("Development Commands") to
  `pnpm gate`. Update the forge backlog-authoring convention (the AC "verify" string) to `pnpm gate` so
  future per-item gates match CI exactly — i.e. the canonical verify command becomes `pnpm gate`, and
  `forge.config.json` should reflect it (a single `gateCommand`, or set `testCommand` to `pnpm gate`).
- **Vehicle:** quick-fix PR (one commit). **Priority: P1.**

### REM-2 — De-flake the CI build (the `@rauf/cli` bin race)
- **Problem:** Two docs-only commits failed CI in `pnpm build` with a non-deterministic
  `Failed to create bin … node_modules/@rauf/cli/dist/index.js ENOENT` race (bin-link attempted before
  `@rauf/cli` is compiled), then `ELIFECYCLE exit 1`. The v0.6.0 merge happened to build clean, so it's
  intermittent — but a red `main` from a flake is a real reliability hole. Not reproducible locally
  (warm `node_modules`/dist mask it); it bites on CI's clean checkout.
- **Evidence:** CI runs `27510607233`, `27510532830` (failure) vs `27518749969` (success) — same gate,
  different outcome. `pnpm build = pnpm -r build`; `@rauf/cli` exposes a `bin` → `dist/index.js` that
  doesn't exist until `tsc` runs.
- **Action:** Make the build deterministic. Options (pick one): (a) ensure topological build order so
  `@rauf/cli` compiles before any bin-link (e.g. an explicit ordered build or `pnpm -r` with the bin
  package built first); (b) gate the `bin` behind a `prepare`/build step so install never tries to link
  a not-yet-built dist; (c) introduce a build orchestrator (turbo) with declared `dependsOn` so
  ordering is guaranteed. Reproduce first in a clean checkout (`rm -rf node_modules **/dist && pnpm
  install && pnpm build`) to confirm the fix kills the flake.
- **Vehicle:** quick-fix, verified by a clean-install reproduction + a green CI run. **Priority: P1.**

### REM-3 — Version-sync guard (`package.json` ↔ `version.ts`)
- **Problem:** All six `package.json` files lagged the authoritative `packages/core/src/version.ts`
  (0.5.0 vs 0.6.0) until the review caught it — a recurring gotcha (also seen at the v0.5.0 cutover).
  Runtime reports the right version, but package metadata disagreeing is a latent release hazard.
- **Evidence:** review finding R6-005; fixed manually in `d84fa90`, but nothing prevents recurrence.
- **Action:** Add a `version:check` (assert all workspace `package.json` `version` === `VERSION` in
  `version.ts`) and wire it into `pnpm gate` (or `schema:check`'s sibling) + CI. Optionally make
  `version.ts` the single source and generate the manifests, or have `release:prepare` bump both.
- **Vehicle:** quick-fix script + gate wiring. **Priority: P1.**

## P2 — DX & process hygiene

### REM-4 — Root-cause the phantom LSP diagnostics
- **Problem:** Every phase, the editor LSP threw false errors (`statusExitCode` "lacks return",
  `@rauf/loop`/`@rauf/core` "no exported member", stale enum members) that real `pnpm typecheck`
  contradicted — wasting attention and risking a real error being dismissed as "probably phantom."
- **Evidence:** recurred Phases 1–4; the review §8 had to call it out explicitly.
- **Action:** Investigate the workspace TS setup — likely the LSP resolves `@rauf/*` from stale built
  `dist/*.d.ts` instead of source. Fix with TS project references and/or `tsconfig` `paths` mapping
  `@rauf/*` → `packages/*/src` so the editor re-indexes from source on save. Interim: a one-line
  "trust `pnpm typecheck`, not the editor" note in `CLAUDE.md`/CONTRIBUTING.
- **Vehicle:** a short investigation spike (timebox); then a config fix. **Priority: P2.**

### REM-5 — Resolve the docs-site duplicate-id warnings
- **Problem:** `astro build` emits `Duplicate id "architecture"/"schemas"/"spec-artifacts"/…` warnings —
  the starlight docs-loader ingests the same doc from two sources. Cosmetic today (build passes) but it
  erodes signal and could become an error on a loader upgrade.
- **Evidence:** `pnpm --filter @rauf/docs build` WARN lines; `packages/docs/src/content/docs/*.md`.
- **Action:** Make each doc have one source (dedupe the loader globs / content collection so
  `docs/*.md` isn't aggregated twice). Verify warnings gone.
- **Vehicle:** quick-fix. **Priority: P2.**

### REM-6 — Gate `main` on green CI
- **Problem:** `main` sat red across two docs commits with no one noticing — merges were done locally
  and pushed, so a failing quality-gate never blocked anything.
- **Action:** Add branch protection on `main` requiring the CI `check` job green before merge (and,
  optionally, route changes through PRs). At minimum, adopt the habit of `gh run watch` after pushes
  (as done for v0.6.0).
- **Vehicle:** repo settings + process note. **Priority: P2.**

## P3 — Conformance-review follow-up notes (the 5 deferred notes)

All non-blocking; from the review report. Best run as a **small rauf backlog** (the first four are
loop-able code items) when convenient.

| ID | Item | Location |
|---|---|---|
| REM-7 (R1-N1) | Add targeted remediation messages for removed `loop watch` / `loop follow` (only `loop start`/`--watch` have them) | `packages/cli/src/commands.ts` `REMOVED_SUBCOMMAND_MESSAGES`, `parser.ts` |
| REM-8 (R2-01) | Web status page: add a non-default backlog-root selector (the file-backed `?backlog=` plumbing already exists) | `packages/web/src/client/routes/projects/status.tsx` |
| REM-9 (R3-001) | Web dashboard: render a loading/unknown affordance instead of `?? "IDLE"` on in-flight fetch | `packages/web/src/client/routes/projects/index.tsx:113` |
| REM-10 (R4-1) | Optionally stamp `seq`/`schemaVersion` on the `--ndjson` live stream for file/wire parity | `packages/cli/src/loop-commands.ts:890` |
| REM-11 (R7-03) | Tidy/ban-banner the historical removed-verb mentions in feature-forge `plans/*.md` | `feature-forge/plans/*.md` |

**Vehicle:** one rauf `.rauf/backlog.json` of REM-7..REM-10 (REM-11 is in the FF repo, separate).
**Priority: P3.**

## Forward pointer (not "address now")

- **Part B — LLM-agnostic provider architecture** (`docs/SPEC-BACKLOG-TOOL-CONTRACT.md` Part B): the
  separate initiative the overhaul deferred to. The `CLAUDE_ADDON.md → AGENT_ADDON.md` rename +
  provider-neutral "Task tool" wording land there (CANON §4.6/§8). Tracked, not part of this plan.

## Suggested sequencing

1. **One "ship-reliability" PR** = REM-1 + REM-2 + REM-3 (canonical gate, build de-flake, version
   guard). These are small, interlock (all touch the gate/CI), and remove the classes of failure that
   bit this effort. Verify with a clean-install build + a green CI run.
2. **REM-4/5/6** opportunistically (DX spike + docs dedupe + branch protection).
3. **REM-7..10** as a small rauf backlog (dogfood the loop on its own polish); **REM-11** in the FF
   repo.
4. **Part B** when it's picked up as its own effort.

## Status (updated 2026-06-15)

- **REM-1/2/3 — DONE.** Shipped as the P1 "ship-reliability" merge (`pnpm gate` canonical, deterministic
  build via `dist`-co-located `tsbuildinfo`, version-sync guard). Merged to `main`, CI green.
- **REM-6 — DONE.** `main` is branch-protected: required status check `check` (strict), `enforce_admins`
  on, force-push/deletion blocked. Changes to `main` now flow through a branch → PR that must pass CI
  (self-merge once green).
- **REM-5 — already resolved (verified, no change needed).** The docs site uses a single-source design —
  `packages/docs/src/content/docs/*.md` are symlinks into the root `docs/`, with one `docsLoader()`
  collection. A clean-checkout `pnpm --filter @rauf/docs build` (what CI runs) emits **zero** `Duplicate
  id` warnings and builds all 10 pages + 404. The warnings in the review were from a stale/cached local
  build state; the committed tree is clean.
- **REM-4 — addressed via documentation (config fix not viable).** Root cause confirmed: the editor's TS
  server resolves `@rauf/*` through each dependency's built `dist/*.d.ts` (project-references monorepo),
  so it shows phantom errors when `dist` lags source while `pnpm typecheck` (run after a build) passes.
  A `paths`-to-source remap was investigated and rejected — it is incompatible with the `composite`/
  `references` setup (`TS6305` when `dist` absent; dropping `composite` yields `TS6059` cross-package
  rootDir errors on build *and* typecheck), and making it work would require a build-vs-typecheck
  tsconfig split across all four packages that jeopardizes the deterministic build (REM-2). Documented the
  gotcha + the one-line remedy (`pnpm build` + restart TS server) in `CLAUDE.md` ("Editor / TypeScript
  diagnostics"), per the plan's sanctioned fallback.
- **REM-7..11 — pending** (P3 conformance-review notes; REM-11 in the feature-forge repo).
