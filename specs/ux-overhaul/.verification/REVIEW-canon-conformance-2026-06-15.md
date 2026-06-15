# Canon-Conformance Review — UX/DX Overhaul (all 4 phases)

> **Resolution (2026-06-15):** all 9 should-fix findings APPLIED (doc verb/exit-code drift, package.json
> 0.6.0 bump, canon ratified DRAFT→Ratified). Gate re-run green. Branch merged to `main` (no-ff) and
> tagged `v0.6.0`. The 4-phase overhaul is complete. The 5 notes remain as optional follow-ups.


Date: 2026-06-15
Review target: branch tip `forge/ux-overhaul-web` (`21a2529`) — contains all four phases' code.
Yardstick: `specs/ux-overhaul/CANON.md` §3–§8. Method: 7 parallel read-only `forge-verifier` reviewers
(R1–R7) auditing landed source against canon clauses, + an adversarial confirmation pass on every
Deviates finding (direct line-level evidence verification, since all Deviates are exact-citation
doc-staleness claims). Scope: rauf repo + feature-forge 0.10.0 lockstep.

## Bottom line — **GO** for the Phase-4 merge

**Zero blockers. Zero code defects.** Every canon clause that governs *code* conforms in the landed
source; the full gate is green (`pnpm typecheck && lint && format:check && test` — core 930 / loop 300
/ web 232 / cli 456 / release 60). The only findings are **documentation drift** (stale verb / exit-code
references in evergreen + consumer-contract docs), the **package.json version lag**, and the **canon's
own un-ratified status** — plus five low-severity notes. The merge is unblocked; the should-fix batch
(all docs/metadata, no code) should land before tagging v0.6.0 so the release ships coherent.

Severity tally: **0 blocker · 9 should-fix · 5 note.**

## Gate result (§6.1)

| Check | Result |
|---|---|
| `pnpm typecheck` | ✓ all 4 packages |
| `pnpm lint` | ✓ |
| `pnpm format:check` | ✓ |
| `pnpm test` | ✓ core 930 · loop 300 · web 232 · cli 456 · release 60 |
| `version.ts` | `0.6.0` |

## Canon-conformance matrix

| Canon clause | Verdict | Evidence (file:line) | Severity |
|---|---|---|---|
| §3 P1 files = single observation substrate | **Conforms** | runner emits→`appendEvent` (`packages/loop/src/runner.ts:1195-1233`, `core/src/events-log.ts:57`); status/log/follow/web all read files (`core/src/status.ts:364`, `cli/src/follow-command.ts:77`, `web/src/server/routes/loop.ts:283`) | — |
| §3 P2 interface hides execution mode | **Conforms** | one `loop run` verb; `--detached` names intent (`cli/src/loop-commands.ts:693`) | — |
| §3 P3 one way per concept, no aliases | **Conforms (code)** | short forms normalized once (`parser.ts:137-147`); no alias commands/shims. *Doc optics violated by stale verb refs* → R6-001..004 | should-fix (docs) |
| §3 P4 empty is never silent | **Conforms** | `renderInspectedStatus` names dir + live-elsewhere (`cli/src/status-commands.ts:186-215`); registry `core/src/loop-registry.ts:129`; `status --all` :224 | — (note R2-01) |
| §3 P5 machine surfaces explicit/versioned/additive | **Conforms** | `EVENTS_SCHEMA_VERSION="1"` (`core/src/schemas.ts:665`); `PersistedEvent` :616-631 | — (note R4-1) |
| §4.1 command grammar | **Conforms** | full verb/flag audit (R1) — `loop run --detached`, removed `loop start`/`loop watch`/`loop follow`/`--watch`, top-level `follow`, `status --all`, flag canon all present | — (note R1-N1) |
| §4.2 observation model | **Conforms** | events.ndjson persisted; web SSE reads file not buffer (`web/src/server/loop-manager.ts:12-15`); in-process ≡ detached | — (note R2-01) |
| §4.3 status vocabulary (table + 4 rules) | **Conforms** | `state-labels.ts:25-38` labels match canon exactly; `mapLoopStateStatus` total (`status.ts:112-128`); single map (`grep STATE_BADGE web/src/client` empty); PAUSED_HUMAN→"Needs Human" | — (note R3-001) |
| §4.4 exit codes (unified, both commands) | **Conforms (code)** | `ExitCode` (`cli/src/commands.ts:91-97`); `statusExitCode` :514-540; `loopRunExitCode` (`loop-commands.ts:671-683`); validate keeps 0/1/2. *Consumer-contract doc stale* → R7-01/R7-02 | should-fix (docs) |
| §4.5 machine surfaces (events versioning, review signal, placement) | **Conforms** | `SignalParsedSchema` incl. `review` (`schemas.ts:468`); no review→done downcast (`runner.ts:671`); backward scan (`signal-parser.ts:27-68`) | — (note R4-1) |
| §4.6 agent contract | **Conforms** | single commit rule identical (`RAUF.md.tmpl:32`, `CLAUDE_ADDON.md:21`, `prompt-builder.ts:250`; old footgun gone); signal spec + model cascade + progress.md stub present; embedded-artifacts regenerated. *One stale list item* → R5-001 | should-fix (1 doc line) |
| §4.6 AGENT_ADDON rename / "Task tool" wording | **Deferred (Part-B) — clean** | no `AGENT_ADDON*` file/key; "Task tool" intentionally retained (`prompt-builder.ts:102,121,134`); deferral documented (`SPEC-BACKLOG-TOOL-CONTRACT.md:375`) | — |
| §5 phases delivered as scoped | **Conforms** | all 4 phases landed; no later-phase scope pulled forward/dropped | — |
| §5 "done includes updating affected SPEC docs" | **Partial** | several evergreen/contract docs not fully updated (the R5/R6/R7 doc-drift batch) | should-fix |
| §6 cutover/dogfood (single flip, FF lockstep, frozen stable, no aliases) | **Conforms** | breaking changes bundled at v0.5.0; FF 0.10.0 `minRunnerVersion=0.5.0` + new command templates (`feature-forge/references/forge-config-schema.json:95,105,138`); Phase 4 additive | — (note R7-03) |
| §7 five ratified decisions implemented as decided | **Conforms (impl)** | (1) `loop run --detached` (2) top-level `follow` (3) unified exit codes (4) v0.5.0 flip (5) commit-rule in P1 + rename deferred — all in code. *Canon still tags them [PROPOSED]* → R6-006 | should-fix (canon) |
| §8 out of scope not violated | **Conforms** | no provider-arch work; `schemaVersion` still "1"; both execution modes retained; Part-B coupling isolated | — |

## Punch-list (severity-ordered)

### Blockers
None.

### Should-fix (9) — all docs/metadata, no code

| ID | Finding | Location | Fix |
|---|---|---|---|
| R6-001 | README lists removed `loop start` + `loop follow` as live commands | `README.md:145,147` | `loop start`→`loop run --detached`; move `loop follow`→top-level `rauf follow` |
| R6-002 | ARCHITECTURE diagrams reference `rauf loop follow` | `docs/ARCHITECTURE.md:178,212` | →`rauf follow` (leave `/api/.../loop/start` endpoint on :171) |
| R6-003 | SPEC-CORE attributes a path to removed `loop start` | `docs/SPEC-CORE.md:409` | `(loop run, loop start)`→`(loop run, including --detached)` |
| R6-004 | Consumer contract names `rauf loop follow` (verb table + surface table) | `docs/SPEC-BACKLOG-TOOL-CONTRACT.md:119,320,324` | →`rauf follow` |
| R7-01 | Consumer contract `status` exit-code table is the **pre-v0.5.0** scheme (`1=RUNNING,2=PAUSED_HUMAN,3=LIMIT_REACHED`) | `docs/SPEC-BACKLOG-TOOL-CONTRACT.md:274-279` | Replace with unified §4.4 table (6=RUNNING,3=needs-human,4=limit family,5=blocked,1=error,0=clean) |
| R7-02 | Contract says `loop run` exits `6` for needs-human + "two distinct exit-code spaces" note (both false post-unification) | `docs/SPEC-BACKLOG-TOOL-CONTRACT.md:230-241` | needs-human→`3 (NEEDS_HUMAN)`; rewrite the note: status + loop run share the unified scheme (only `6=RUNNING` is status-only) |
| R5-001 | Stale "Exit signal detection" list item contradicts canon + the adjacent corrected note in the same file | `docs/SPEC-ARTIFACTS.md:75` | "No signal → reset item to pending…" → "not auto-blocked; classified by exit context" |
| R6-005 | All 6 `package.json` still `0.5.0` while `version.ts`/docs are `0.6.0` (runtime correct; metadata lags) | `package.json` + `packages/*/package.json` | set `"version": "0.6.0"` (do at the v0.6.0 tag) |
| R6-006 | CANON header still "DRAFT — pending ratification" + `[PROPOSED]` tags, though all shipped | `specs/ux-overhaul/CANON.md:4` + §4.1/4.4/4.5/§7 | flip to Ratified (rauf v0.6.0); mark the 5 §7 decisions `[RATIFIED]` w/ landing phase; keep AGENT_ADDON rename flagged deferred-to-Part-B |

### Notes (5) — acceptable, recorded

| ID | Note | Location |
|---|---|---|
| R1-N1 | `loop watch`/`loop follow` fall through to the generic unknown-subcommand error (only `loop start`/`--watch` get a targeted "use X" remediation) | `cli/src/commands.ts:107`, `parser.ts:29` |
| R2-01 | Web status page can't observe a non-default backlog root (UI affordance gap; the file-backed plumbing + `?backlog=` already exist) | `web/src/client/routes/projects/status.tsx:1360` |
| R3-001 | Web dashboard `?? "IDLE"` on in-flight fetch result (UI nullish on undefined, not a raw→derived mapping fallback) | `web/src/client/routes/projects/index.tsx:113` |
| R4-1 | `--ndjson` live stream omits the `seq`/`schemaVersion` envelope the persisted file carries (canon says "SHOULD"; documented) | `cli/src/loop-commands.ts:890` |
| R7-03 | feature-forge `plans/*.md` mention removed verbs — historical planning artifacts, not templates/contract | `feature-forge/plans/*.md` |

## Recommendation

1. **Apply the 9 should-fix doc/metadata fixes** — all mechanical, no code, no gate risk. Best landed
   as one "review fixes" commit on the branch (R6-005 package.json bump + R6-006 canon ratification
   naturally pair with the v0.6.0 tag).
2. **Ratify the canon** (R6-006): `CANON.md` DRAFT → "Ratified — implemented across Phases 1–4 (rauf
   v0.6.0)".
3. **Merge `forge/ux-overhaul-web` → main** (no-ff, as prior phases) **+ tag `v0.6.0`** — **GO**, on
   the user's say-so.
4. Optionally clear the 5 notes later (R1-N1 remediation symmetry + R2-01 web root selector are the
   most user-visible; both are follow-ups, not overhaul-completion blockers).

On merge + tag, **the 4-phase UX/DX overhaul is complete.** Remaining adjacent effort = Part B
(LLM-agnostic provider architecture; the deferred AGENT_ADDON rename lands there) — a separate
initiative.
