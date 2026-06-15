# Review Kickoff — Full Canon-Conformance Review of the UX/DX Overhaul

> **Purpose.** A self-contained handoff so a *fresh* session can run an **exhaustive, cross-phase
> conformance review** of the entire UX/DX overhaul (all 4 phases) against its north-star canon,
> `specs/ux-overhaul/CANON.md`. Open a clean session, read this top to bottom, then run §7. The output
> is a **canon-conformance matrix + punch-list** that also serves as the **merge gate** for Phase 4.
> Same format as the `PHASE-N-KICKOFF.md` handoffs.

## 1. Why this review exists

The overhaul shipped in three merge points across two version cutovers and a separate-repo lockstep.
Each *phase* was verified in isolation during its own forge pipeline (prd→tech→specs→backlog→
impl-verify), so **per-phase correctness is already established**. The un-done work is the
**whole-system** view:

- **Canon conformance** — did the *shipped code* actually deliver the canon's target state (§3
  principles, §4 target-state, §7 ratified decisions), or did any clause get dropped, partially done,
  or deviated from during three pipelines?
- **Cross-phase coherence** — do the four phases compose into *one coherent surface*, with no drift
  between them (e.g. status vocabulary ↔ exit codes ↔ observation substrate ↔ web), and **no stale
  references** anywhere to surfaces removed earlier in the effort?
- **Consumer/lockstep integrity** — is feature-forge (separate repo) actually in lockstep, and is the
  `SPEC-BACKLOG-TOOL-CONTRACT` consistent with what shipped?

The canon is the yardstick; the per-phase specs/docs are supporting evidence; **the landed source is
ground truth** (verify against code, not specs).

## 2. Where the effort stands

Four phases, three merges, two cutovers:

| Phase | Feature | Shipped as | Merge |
| --- | --- | --- | --- |
| 1 — observation substrate | `ux-overhaul` | (additive) | merged `e85e878` |
| 2+3 — command grammar + contract flip | `ux-overhaul-grammar` | **v0.5.0** (one breaking flip) | merged `3d98e44`, tagged `v0.5.0`, pushed; feature-forge bumped to 0.10.0 in lockstep |
| 4 — web parity + vocabulary + agent contract | `ux-overhaul-web` | **v0.6.0** (additive) | **UNMERGED** — branch `forge/ux-overhaul-web`, commits `100cacb..7e7d18b` |

**Review target = the branch tip `forge/ux-overhaul-web`.** It was cut off `main` *after* Phases 1 and
2+3 merged, so its tip contains **all four phases' code** — reviewing it audits the complete composed
overhaul **and gates the Phase 4 merge**. (Do not review per-phase merge commits separately; the point
is the composed whole.)

Review **form** (ratified): a **multi-agent dimensioned fan-out** (§5). Review **scope** (ratified):
**rauf repo + the feature-forge 0.10.0 lockstep** (`/home/gary/workspace/feature-forge`) + the
`SPEC-BACKLOG-TOOL-CONTRACT`. External consumers / anvil2 are out of scope this pass.

## 3. The yardstick — what to audit the code against

`specs/ux-overhaul/CANON.md` is the single source of truth. Audit every clause:

- **§3 Design principles (P1–P5)** — the load-bearing invariants:
  - P1 Files are the single observation substrate (every observer reconstructs from files).
  - P2 The interface hides the execution mode (verbs describe intent, not mechanism).
  - P3 One way to do each thing (one verb/flag/label per concept; no aliases).
  - P4 Empty is never silent (absence vs idleness distinguishable; names the inspected dir).
  - P5 Machine surfaces are explicit, versioned, additive-only.
- **§4.1 Command grammar** — the full target-state verb/flag table (every ✂ removed / ✦ new / ⟳
  changed). `loop run [--detached]`, `loop stop/review`, removed `loop start`; monitoring `status`/
  `log`/`follow`/`progress` with `--follow`/`--json`/`--backlog`/`--interval`; removed `loop watch`/
  `loop follow`/`--watch`; `status --all`; removed-command remediation.
- **§4.2 Observation model** — `events.ndjson` persisted; status/log/follow/**web** all read files;
  in-process and detached runs observationally identical.
- **§4.3 Status vocabulary** — the complete raw→derived→label table; one shared label map across CLI +
  dashboard + status page; `REVIEWING`/`PAUSED_USAGE_LIMIT` badged; `PAUSED_HUMAN`→"Needs Human";
  Title-Case human vs SCREAMING_SNAKE machine; **no silent fallback to IDLE**.
- **§4.4 Exit codes** — the unified table (0 success · 1 error · 2 usage · 3 needs-human · 4 limit ·
  5 blocked · 6 running query-time), used by **both** `status` and `loop run`; `backlog validate` keeps
  its own `0/1/2` triad.
- **§4.5 Machine surfaces** — `events.ndjson` versioned + additive-only (`EVENTS_SCHEMA_VERSION`);
  `signal_parsed.signal` includes explicit `review`; signal placement = backward scan from end.
- **§4.6 Agent contract** — single commit rule (agent never commits) identical across RAUF.md /
  addon / prompt-builder; signal spec; model cascade; `progress.md` stub; **AGENT_ADDON rename +
  "Task tool"→provider-neutral correctly DEFERRED to Part-B** (i.e. *not* half-done).
- **§5 plan** — each phase delivered as scoped; nothing from a later phase silently pulled forward or
  dropped.
- **§6 cutover/dogfood** — single breaking flip at v0.5.0; feature-forge `minRunnerVersion ≥ 0.5.0`
  lockstep; rauf-stable frozen; no-alias clean break.
- **§7 open decisions** — all five ratified decisions implemented *as decided* (execution grammar;
  monitoring placement; exit-code values; cutover version; agent-addon rename timing).
- **§8 out of scope** — nothing out-of-scope crept in (no provider-arch work, no backlog-schema
  redesign, no execution-mode elimination); the Part-B coupling is cleanly isolated.

Supporting evidence (read as needed, but verify against code): `specs/ux-overhaul/` (Phase 1),
`specs/ux-overhaul-grammar/` (P2+3), `specs/ux-overhaul-web/` (P4) and their per-feature docs under
`docs/architecture/{ux-overhaul,ux-overhaul-grammar,ux-overhaul-web}/`; the project specs
`docs/SPEC-CLI.md`, `SPEC-WEB.md`, `SPEC-CORE.md`, `SPEC-ARTIFACTS.md`, `SPEC-BACKLOG-TOOL-CONTRACT.md`,
`SCHEMAS.md`, `ARCHITECTURE.md`.

## 4. Conformance verdicts (the rubric every reviewer uses)

For each canon clause it owns, a reviewer returns a verdict + evidence (file:line):

- **Conforms** — shipped code matches the canon clause. Cite the implementing code.
- **Partial** — mostly there, but an aspect is incomplete. Describe the gap.
- **Deviates** — shipped behavior differs from the canon (and not via a ratified decision). Highest
  priority — these are the findings that matter.
- **Dropped** — a canon clause has *no* implementing evidence anywhere.
- **Deferred (Part-B)** — intentionally not done this overhaul (e.g. AGENT_ADDON rename); confirm the
  deferral is clean (no half-done remnants) and recorded.

Severity for the punch-list: `blocker` (must fix before declaring the overhaul done / before Phase-4
merge) · `should-fix` (drift/staleness worth a follow-up) · `note` (acceptable, recorded).

## 5. The fan-out — seven parallel reviewers

Dispatch **seven `forge-verifier` (read-only) subagents in parallel** (one message, multiple Agent
calls — the `superpowers:dispatching-parallel-agents` pattern). Each owns a disjoint slice, audits the
**landed source on the branch tip** against its canon clauses, returns **complete findings in its
FINAL message only**, each finding with verdict + severity + file:line + the canon clause. Tell each it
is one of several parallel instances and to treat `MEMORY.md` as read-only.

| # | Reviewer | Owns (canon) | Primary code/docs to verify against source |
| --- | --- | --- | --- |
| R1 | **Command grammar & flags** | §4.1, P2/P3 | `packages/cli/src/{commands,parser,main,loop-commands,status-commands}.ts` — verbs, flag canon, removed-command remediation (`REMOVED_SUBCOMMAND_MESSAGES`/`REMOVED_FLAG_MESSAGES`), `--help`/usage; `docs/SPEC-CLI.md` |
| R2 | **Observation substrate** | §4.2, P1/P4 | `packages/loop/src/runner.ts` (events.ndjson append), `packages/core/src/{status,loop-registry,events}.ts`, the web SSE + `<EventTimeline>`; confirm status/log/follow/web all read files; "empty is never silent" messages; in-process ≡ detached |
| R3 | **Status vocabulary + exit codes** | §4.3, §4.4 | `packages/core/src/{state-labels,schemas,status}.ts`; `packages/cli/src/status-commands.ts` (`colorLoopState`, `statusExitCode`); web `StateBadge.tsx` + both pages; `loop run` terminal exit mapping (`loopRunExitCode`). Confirm ONE label map, full enum coverage, unified exit table across status + loop run |
| R4 | **Machine surfaces / events** | §4.5 | `packages/core/src/schemas.ts` (`EVENTS_SCHEMA_VERSION`, `SignalParsedSchema` incl. `review`), `PersistedEvent` shape; `packages/loop/src/{runner,signal-parser}.ts` (backward scan, review not collapsed to done); `--ndjson` vs `--json` |
| R5 | **Agent contract** | §4.6 | `artifacts/variants/backlog-json/{.rauf/RAUF.md.tmpl,CLAUDE_ADDON.md,CLAUDE_GREENFIELD.md.tmpl,.rauf/progress.md}`, `packages/core/src/embedded-artifacts.ts` (regenerated, in sync with templates), `packages/loop/src/prompt-builder.ts`; single commit rule everywhere; AGENT_ADDON rename cleanly deferred; "Task tool" still present (Part-B) |
| R6 | **Cross-phase coherence & drift** | §3, §5, all | Grep the WHOLE repo (code, `docs/**`, `artifacts/**`, help strings) for **stale references to removed surfaces**: `loop start`, `loop watch`, `loop follow`, `--watch`, old exit-code numbers, old status collapses. Version coherence (`packages/core/src/version.ts` = 0.6.0; no stray 0.5.0/0.4.0). All `docs/SPEC-*.md` + `docs/architecture/*` consistent with shipped. CANON `[PROPOSED]`/DRAFT status vs reality |
| R7 | **Cutover, consumers & feature-forge lockstep** | §6, §7, §8 | `/home/gary/workspace/feature-forge` 0.10.0: `references/forge-config-schema.json` (minRunnerVersion 0.5.0, command templates), `skills/forge-5-loop`, `COMPATIBILITY.md`/`CHANGELOG.md`, `references/ralph-loop-contract.md`; rauf `docs/SPEC-BACKLOG-TOOL-CONTRACT.md`. Verify §7's five decisions implemented as decided; §8 out-of-scope not violated; rauf-stable frozen note still accurate |

**Each reviewer's prompt must include:** the parent has **already checked out the review target**
(§6.0) — reviewers read the working tree **as-is** and must **NOT** run `git checkout`/`switch`/`stash`
(they run in parallel and share one working tree; a checkout would corrupt the others); read
`specs/ux-overhaul/CANON.md` for its owned sections; verify against **landed source** (file:line),
treating specs/docs as claims to confirm; apply the §4 verdict rubric; return the conformance verdicts
+ findings in the FINAL message only. (R7 also reads `/home/gary/workspace/feature-forge` — a separate
repo/working tree, so it may read there freely.)

## 6. Synthesis (parent session)

0. **Check out the review target — the parent does this once, before anything else** (the §5
   reviewers must NOT). Make it safe and conditional:
   ```bash
   target=forge/ux-overhaul-web
   if git rev-parse --verify --quiet "$target" >/dev/null; then
     if [ "$(git branch --show-current)" != "$target" ]; then
       git status --short            # MUST be clean before switching — if dirty, stop and
                                     # commit/stash (ask the user) rather than risk losing work
       git checkout "$target"
     fi
   else
     # Branch gone → Phase 4 was already merged. Review main (it now contains all 4 phases).
     git checkout main && git pull --ff-only 2>/dev/null || true
   fi
   git log --oneline -1            # confirm the tip you're reviewing
   ```
   Only proceed to the gate + fan-out once you are on the right tip with a clean tree.
1. **Run the full gate on the branch tip** (ground truth): `pnpm typecheck && pnpm lint &&
   pnpm format:check && pnpm test`. Record the result. (Baseline from the Phase-4 build: core 930 /
   loop 300 / web 232 / cli 456 / release 60, all green.)
2. **Build the canon-conformance matrix** — one row per canon clause (§3 P1–P5, §4.1–§4.6, §5, §6, §7,
   §8) → verdict (Conforms/Partial/Deviates/Dropped/Deferred) → evidence (file:line) → severity.
3. **Adversarial confirmation** — for every `Deviates`/`Dropped`/`blocker` finding, dispatch a short
   skeptic `forge-verifier` prompted to **refute** it ("prove this is actually fine; default to
   REFUTED if you can't confirm the defect from source"). Drop refuted findings. This cuts false
   positives before they reach the punch-list.
4. **Write the report** to `specs/ux-overhaul/.verification/REVIEW-canon-conformance-<YYYY-MM-DD>.md`:
   the matrix, the deduped findings (unique IDs, file:line, verdict, severity, fix), and a **punch-list**
   ordered by severity. End with an explicit **GO / NO-GO for the Phase-4 merge**.
5. **If clean (no blockers):** recommend finalizing the canon — flip `CANON.md` status from
   "DRAFT — pending ratification" to ratified/shipped, and (separately, on the user's say-so) merge
   `forge/ux-overhaul-web` → main no-ff + optional `v0.6.0` tag, completing the overhaul.
   **If blockers:** they are fixed on the branch (a forge-fix-style pass) before the merge.

## 7. How to start (in the new session)

The reviewing agent handles everything, including the checkout — **do not assume the branch is already
checked out**. In order:

1. Read this doc + `specs/ux-overhaul/CANON.md` (§3–§8).
2. **Run §6.0** — the safe, conditional checkout of the review target (handles "already on it",
   "branch gone → review main", and "dirty tree → stop"). Then `git log --oneline e85e878~1..HEAD |
   head -40` to orient on the overhaul commits.
3. Run the §6.1 gate. Dispatch the seven §5 reviewers in parallel (they read the tree you checked
   out — they do not checkout). Synthesize per §6. Produce the conformance report + GO/NO-GO.

### Paste-able kickoff prompt

> Run the full canon-conformance review of the rauf UX/DX overhaul. Read
> `specs/ux-overhaul/REVIEW-KICKOFF.md` then `specs/ux-overhaul/CANON.md` (§3–§8). Review target is the
> branch tip `forge/ux-overhaul-web` (it contains all four phases) — **check it out yourself per §6.0**
> (don't assume it's already checked out; if the branch is gone it was merged, so review main). Scope =
> rauf repo + the feature-forge 0.10.0 lockstep. First run the full gate (`pnpm typecheck && lint &&
> format:check && test`) on that tip. Then dispatch the seven parallel `forge-verifier` reviewers per §5
> (grammar, observation substrate, status-vocab+exit-codes, machine-surfaces/events, agent-contract,
> cross-phase coherence/drift, cutover+FF-lockstep), each auditing landed source against its canon
> clauses with the §4 verdict rubric. Synthesize a canon-conformance matrix + punch-list to
> `specs/ux-overhaul/.verification/REVIEW-canon-conformance-<date>.md`, run an adversarial refute pass
> on every Deviates/Dropped/blocker finding, and end with a GO/NO-GO for the Phase-4 merge. Don't push
> or merge without my say-so.

## 8. Specific things known to be worth checking (from the build)

Seed the reviewers with these — they bit us during the effort or are easy to leave half-done:

- **Stale references to removed surfaces** (R6): `loop start`, `loop watch`, `loop follow`, `--watch`,
  pre-0.5.0 exit numbers — in code, `docs/**`, `artifacts/**`, CLI `--help`/usage strings, and any
  README. The clean break means **zero** live references (historical mentions in changelogs/specs are
  fine if clearly historical).
- **embedded-artifacts in sync** (R5): `packages/core/src/embedded-artifacts.ts` is generated from the
  templates — confirm it actually reflects the agent-contract edits (the Phase-1 + Phase-4 landmine
  was editing templates without regen). `grep RAUF_REVIEW` should hit it.
- **Single label map, truly single** (R3): the two old web `STATE_BADGE` copies are gone (`grep -r
  STATE_BADGE packages/web/src/client` empty); CLI + both web pages all consume `STATE_LABELS`.
- **deriveFromStateJson staleness keys on RAW status** (R3): so `REVIEWING` isn't swept into a
  stale-downgrade (TRACEABILITY note from Phase 4).
- **Rule #1 holds post-relocation** (R6/R7): `grep -rn 'from "@rauf/cli"' packages/web/src` empty;
  recovery symbols come from `@rauf/loop`.
- **Exit-code unification is real across BOTH commands** (R3): `status` and `loop run` share the table;
  feature-forge branches on it.
- **CANON status** (R6): the doc still says "DRAFT — pending ratification." If the system conforms, the
  review should recommend ratifying it.
- **Phantom LSP**: reviewers read source, so ignore any editor diagnostics — only `pnpm typecheck`
  (run in §6.1) is authoritative. (Recurred every phase: false "lacks return"/"no exported member".)

## 9. Definition of done

- A `specs/ux-overhaul/.verification/REVIEW-canon-conformance-<date>.md` exists with: the full
  canon-conformance matrix (every §3–§8 clause verdicted with file:line evidence), a severity-ordered
  punch-list, the gate result, and an explicit **GO/NO-GO for the Phase-4 merge**.
- Every `Deviates`/`Dropped`/`blocker` finding survived an adversarial refute pass.
- A clear recommendation: ratify the canon (DRAFT→shipped) + merge Phase 4 if clean, or the blocker
  fix-list if not.
- Nothing merged or pushed without explicit user approval.

## 10. After this review

If GO: the canon is ratified, Phase 4 merges (no-ff + optional `v0.6.0` tag), and **the 4-phase UX/DX
overhaul is complete**. The only remaining adjacent effort is **Part B — the LLM-agnostic provider
architecture** (a separate initiative; the deferred `AGENT_ADDON` rename lands there). See
`specs/ux-overhaul/CANON.md` §8 and the `project_ux_overhaul` memory.
