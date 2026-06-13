# Phase 2 Kickoff — `ux-overhaul-grammar` (Command Grammar + Contract Flip)

> **Purpose of this file.** A self-contained handoff so a *fresh* session can start the
> next phase of the UX/DX overhaul without re-deriving context. Open a clean session, read
> this top to bottom, then run the first command in §6.

## 1. Where we are

**Phase 1 (observation substrate) is DONE and merged to `main`.** It shipped the keystone:
`events.ndjson` per-run event log, the machine-wide active-loop registry, file-backed CLI +
web observation, the clean-break monitor surface (top-level `follow`, `status --follow/-f`,
`status --all`, empty-is-never-silent), and the agent commit-rule fix.

- Branch `forge/ux-overhaul` merged via `e85e878` (no-ff). Full pipeline ran:
  PRD→tech→specs→backlog→loop(15/15)→verify-impl→fix→docs, all green.
- Architecture docs: `docs/architecture/ux-overhaul/`.
- The north-star canon for the **whole** overhaul is `specs/ux-overhaul/CANON.md` — every
  phase references it. **Read CANON.md §4.1, §4.4, §4.5, §4.6, §5, §6, §7 before starting.**

Phase 1 was deliberately **additive** (no `minRunnerVersion` bump, no feature-forge change).
Phase 2 is the opposite: it is the **breaking flip**.

## 2. What this phase is

Per CANON §5, Phase 2 (command grammar) and Phase 3 (contract & machine surfaces) are both
breaking and, per CANON §6.3, **must land in one release**. They were ratified to run as a
**single feature-forge feature: `ux-overhaul-grammar`**, cutting over at **[PROPOSED] v0.5.0**.

### Phase 2 — Command grammar & naming (breaking) · CANON §4.1

- ✂ **Remove `loop start`**; replace with ⟳ **`loop run [path] --detached` (`-d`)** — a
  detached run routes through the server daemon (auto-starts it) and returns immediately.
  One loop verb (`run`): bare = foreground/blocking; `--detached` = runs without you.
- `loop run --detached --follow` attaches the live view (= `rauf follow`) after detaching.
- `loop stop` stays (stops a detached/server-owned loop; foreground `run` is Ctrl-C).
- **Flag canon, applied everywhere** (CANON §4.1 flag table): `--follow`/`-f` for streaming
  (✂ `--watch` — already done for status/log in Phase 1), `--json` (NDJSON where streaming)
  on **every** read/monitor command, `--backlog <dir>` as the **one** way to target a
  non-default root, `--interval <seconds>` for poll cadence.
- `--backlog` discoverability + help/error remediation polish.

### Phase 3 — Contract & machine surfaces (breaking) · CANON §4.4, §4.5

- **Unified exit codes** (CANON §4.4), used by both `status` (current state) and `loop run`
  (terminal state): `0` success · `1` error · `2` usage · `3` needs-human · `4` limit ·
  `5` blocked · `6` running (query-time, `status` only). Today `status` (1/2/3) and
  `loop run` (6=paused_human) disagree and `1=running` collides with `1=error` — this fixes
  it. `backlog validate` keeps its own 0/1/2 triad (leave it).
- **`events.ndjson` → stable, versioned machine surface** (additive-only within a major).
  The `--ndjson` live stream and the persisted file should carry the same event shapes.
  (`EVENTS_SCHEMA_VERSION` already exists from Phase 1; Phase 3 formalizes the discipline.)
- **Fix `signal_parsed.signal` review→done collapse** — add an explicit `review` signal
  value instead of overloading `done` (clean break).
- **Reconcile signal-placement docs with the parser** — canon wording: "emit the signal on
  a line by itself; the runner scans from the end of output, so trailing summaries/commit
  messages don't break detection." Update contract + agent templates to match reality.

### The cutover (CANON §6)

- **Single breaking flip at v0.5.0.** All renames, removed flags, and exit-code/contract
  changes land in one release — exactly one moment of breakage.
- **Bump feature-forge `minRunnerVersion` to `>= 0.5.0`** in the same change, and update any
  feature-forge templates/scripts that invoke `loop start`, `--watch`, or the old exit codes.
  (feature-forge's `forge-5-loop` reads `rauf version --json` against `minRunnerVersion` and
  reads `status --json` / exit codes — so these are a real contract change for it.)
- **No aliases** (ratified) — old names are removed, not shimmed.

## 3. Decisions to ratify FIRST (CANON §7)

These are the `[PROPOSED]` calls baked into the canon. Surface them in the **forge-1-prd**
interview and confirm before specs are written. Current standing:

| # | Decision | Standing |
| - | -------- | -------- |
| 1 | Execution grammar: `loop run --detached` (one verb+flag) vs `loop run` + `loop serve` | `--detached` **[recommended]** — confirm |
| 2 | Monitoring placement: top-level `follow` | **Already settled** — shipped in Phase 1 |
| 3 | Unified exit-code table values (§4.4) | Confirm — feature-forge depends on them |
| 4 | Cutover version = **v0.5.0** | **[recommended]** — confirm |
| 5 | Agent-addon rename timing | Commit-rule fix already landed (P1). `CLAUDE_ADDON.md → AGENT_ADDON.md` + provider-neutral language stays coupled to the **Part-B provider refactor** (out of scope here) — confirm it's deferred |

> Gary trusts recommendations — saying "use your recommendations" means proceed with the
> recommended option for anything left blank. (See [[project_ux_overhaul]] memory.)

## 4. Critical constraints & landmines

- **Dogfood with `rauf-stable`, mutate `dev rauf` (CANON §6.1).** Run every implementing
  loop with the *frozen* `rauf-stable` binary (`forge.config.json` already sets
  `loopRunner.bin = "rauf-stable"`). **Never run a loop with the binary whose command
  surface that same loop is rewriting** — this phase rewrites `loop run`/`loop start`
  themselves, so this rule is load-bearing, not advisory. See [[rauf_stable_vs_dev_executable]].
- **Per-phase isolation (CANON §6.5).** This feature gets its own branch
  (`forge/ux-overhaul-grammar`) and its own `--backlog` root under
  `specs/ux-overhaul-grammar/`. A half-finished breaking phase must never contaminate the
  self-hosting loop or `main`.
- **The dev runner executes built `dist/`, not `src`.** Rebuild before testing runner edits.
  See [[rauf_dev_runs_dist_not_src]].
- **feature-forge is a downstream consumer.** The exit-code + `minRunnerVersion` changes
  break feature-forge's contract — its templates/scripts and the `forge-5-loop` version gate
  must be updated **in the same flip**. Inventory feature-forge for `loop start`, `--watch`,
  and hard-coded exit codes before flipping.
- **Specs to update on "done" (CANON §5):** `docs/SPEC-CLI.md`, `SPEC-WEB.md`,
  `SPEC-BACKLOG-TOOL-CONTRACT.md`, `SCHEMAS.md`, `ARCHITECTURE.md`, `SPEC-ARTIFACTS.md`.
  (Phase 1 already partially updated SPEC-CLI for the monitor surface.)

## 5. Likely files in play (orientation, not a spec)

- `packages/cli/src/loop-commands.ts` — `loop run`/`start`/`stop` dispatch; add `--detached`,
  remove `start`.
- `packages/cli/src/commands.ts` — subcommand registry + usage strings.
- `packages/cli/src/parser.ts` — flag normalization (`-d`, `--detached`).
- `packages/cli/src/status-commands.ts` + wherever exit codes are computed — unify the table.
- `packages/loop/src/runner.ts` — terminal exit-code mapping; `review` signal value.
- `packages/loop/src/signal*.ts` / signal parser — add explicit `review`, reconcile scan docs.
- `packages/core/src/schemas.ts` — `events.ndjson` versioning discipline; signal enum.
- `packages/web/src/server/routes/loop.ts` — `loop start` route → detached `loop run` route.
- feature-forge skill files (separate repo/dir) — `minRunnerVersion`, `loop start`/`--watch`
  references, exit-code reads.

## 6. How to start (in the new session)

From the repo root on a clean `main`:

```bash
# 1. Create the isolated branch for this phase
git checkout -b forge/ux-overhaul-grammar

# 2. Start the forge pipeline for the new feature
/feature-forge:forge-1-prd ux-overhaul-grammar
```

Then run the pipeline in order, exactly as Phase 1 did:

```
/feature-forge:forge-1-prd      ux-overhaul-grammar   # ratify §7 decisions here
/feature-forge:forge-verify     ux-overhaul-grammar prd
/feature-forge:forge-2-tech     ux-overhaul-grammar
/feature-forge:forge-verify     ux-overhaul-grammar tech
/feature-forge:forge-3-specs    ux-overhaul-grammar
/feature-forge:forge-verify     ux-overhaul-grammar specs
/feature-forge:forge-4-backlog  ux-overhaul-grammar
/feature-forge:forge-verify     ux-overhaul-grammar backlog
/feature-forge:forge-5-loop     ux-overhaul-grammar   # dogfood w/ rauf-stable
/feature-forge:forge-verify     ux-overhaul-grammar impl
/feature-forge:forge-fix        ux-overhaul-grammar
/feature-forge:forge-6-docs     ux-overhaul-grammar
```

### Paste-able kickoff prompt for the new session

> Start Phase 2 of the rauf UX/DX overhaul. Read `specs/ux-overhaul/PHASE-2-KICKOFF.md` and
> `specs/ux-overhaul/CANON.md` (§4.1, §4.4, §4.5, §4.6, §5–§7) first. This is the
> `ux-overhaul-grammar` feature = Phase 2 (command grammar: `loop run --detached` replacing
> `loop start`, flag canon) + Phase 3 (unified exit codes, `events.ndjson` versioning,
> `review` signal fix) as ONE breaking flip cutting over at v0.5.0. It's breaking and bumps
> feature-forge's `minRunnerVersion` — coordinate that in the same change. Create branch
> `forge/ux-overhaul-grammar`, then run `/feature-forge:forge-1-prd ux-overhaul-grammar`,
> ratifying the CANON §7 open decisions in the PRD interview (I lean toward the
> [recommended] options). Dogfood every loop with `rauf-stable`, never the `dev rauf` being
> rewritten.

## 7. Definition of done for the phase

- `loop start` gone; `loop run --detached` works (auto-starts server, returns immediately);
  `--detached --follow` attaches.
- Flag canon consistent across all commands; `--json` works on every read incl. `status --follow`.
- Unified exit codes implemented in `status` + `loop run`; `backlog validate` untouched.
- `events.ndjson` documented as a versioned surface; explicit `review` signal; signal-placement
  docs match the parser.
- feature-forge updated in lockstep: `minRunnerVersion >= 0.5.0`, no `loop start`/`--watch`/old
  exit-code references.
- All affected `docs/SPEC-*.md` updated; full pipeline green; branch merged at the v0.5.0 flip.

## 8. After this phase

**Phase 4 = `ux-overhaul-web`** (mostly additive · CANON §4.3, §4.6): web recovery actions
(reset/resume/review/unblock/validate), the shared status label map + missing badges
(`REVIEWING`, `PAUSED_USAGE_LIMIT`, "Needs Human"), provider-agnostic agent templates. It
depends on the Phase 1 substrate and can parallelize once the canon vocabulary is fixed.
