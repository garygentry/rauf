# Verification Report: ux-overhaul-grammar (specs)
Date: 2026-06-13
Pipeline Stage: forge-4-backlog (specs verification)
Artifacts Reviewed: PRD.md, tech-spec.md, 00-core-definitions.md … 06-testing-strategy.md, TRACEABILITY.md (+ rauf source & feature-forge repo)

Method: 5 parallel `forge-verifier` instances (read-only) — (1) types/contracts, (2) architecture/layout,
(3) traceability, (4) testing, (5) integration/source-accuracy — plus the deterministic
`validate-traceability.py` (26 requirements, **0 uncovered, 0 orphaned**). Findings merged + renumbered.

## Summary
- Total findings: 13
- Errors: 3 (V-011, V-012, V-013 — citation/path accuracy in specs)
- Gaps: 4 (V-001, V-006, V-007, V-008)
- Inconsistencies: 3 (V-002, V-004, V-009)
- Improvements: 3 (V-003, V-005, V-010)

Overall: the suite is strong — **types/contracts dimension clean**; ExitCode table matches CANON §4.4
exactly; all 26 REQs + 6 NFRs covered (deterministic validator confirms). The findings are: 3 spec-internal
citation/path errors (easy fixes, no code), an under-enumerated CLI change-map (matters because the backlog
is generated from these docs), and some missing test-strategy coverage. None block proceeding, but fixing
them sharpens the backlog inputs.

## Findings

### V-001: §1 CLI change-map omits ~8 files broken by the ExitCode redefinition
- **Severity:** gap
- **Location:** 01-architecture-layout.md §1 (@rauf/cli table)
- **Issue:** The ExitCode redefinition removes the old member keys, so every file referencing
  `ExitCode.INVALID_ARGS/.NOT_FOUND/.VALIDATION/.CONFLICT/.PAUSED_HUMAN` becomes a compile error. §1 lists
  only commands/loop-commands/status-commands/parser/server-commands, but source grep shows 11 production
  files reference them — missing: `backlog-commands.ts` (~50 refs), `install-commands.ts` (13),
  `profile-config-commands.ts` (16), `migrate-commands.ts` (3), `main.ts` (3), `follow-command.ts` (2),
  `reset-commands.ts` (2), `resume-commands.ts` (2). Sibling 03 §2 enumerates all of these; 01 (the
  authoritative inventory) undercounts the blast radius by ~8 files / ~90 sites.
- **Suggested fix:** Expand the §1 @rauf/cli table (or add a pointer) to list every ExitCode-touched file,
  cross-referencing 03 §2 ("full per-file/per-line checklist in 03 §2").
- **References:** 01 §1; 03-exit-codes.md §2; tech-spec §6; 00 §1 remap
- **Checklist:** CHECK-S05, CHECK-S06

### V-002: 01 marks `server-commands.ts` "no change" but it needs CONFLICT→USAGE re-points
- **Severity:** inconsistency
- **Location:** 01-architecture-layout.md §1 (last @rauf/cli row)
- **Issue:** The row says `server-commands.ts … reused as-is, no change`. `ensureServerRunning` (in
  loop-commands) is reused as-is, but `server-commands.ts` itself has `ExitCode.CONFLICT` returns at ~:406
  and ~:630 that the redefinition removes — 03 §2 lists them explicitly. 01 contradicts 03 + source.
- **Suggested fix:** Split the row: keep `ensureServerRunning … no change`; change the `server-commands.ts`
  entry to "re-point `ExitCode.CONFLICT` (~:406/:630) → `USAGE` (see 03 §2)".
- **References:** 01 §1; 03 §2; source `packages/cli/src/server-commands.ts:406,630`
- **Checklist:** CHECK-S05, CHECK-S06

### V-003: §3 ordering note understates the ExitCode step's fan-out
- **Severity:** improvement
- **Location:** 01-architecture-layout.md §3 step 3
- **Issue:** The ordering graph is sound, but step 3's "highest-fan-in … one coherent commit" has no concrete
  file list backing it in 01 (per V-001), so a fresh agent executing from 01 alone undercounts the
  coherent-commit scope.
- **Suggested fix:** Add a parenthetical to §3 step 3: "re-point all call sites across the CLI package (8+
  files; full list in 03 §2) — land it (incl. test re-points) as one coherent commit so the build is never
  red mid-sweep."
- **References:** 01 §3; 03 §2; relates to V-001
- **Checklist:** CHECK-S08, CHECK-S05

### V-004: TRACEABILITY cites doc 05 for REQ-EXIT-04, but 05 never self-declares it
- **Severity:** inconsistency
- **Location:** TRACEABILITY.md (REQ-EXIT-04 row, supporting col `00 §1, 05`) vs 05 coverage table
- **Issue:** The matrix lists 05 as supporting REQ-EXIT-04, but `REQ-EXIT-04` appears nowhere in 05 (its §3
  exit-code mention is REQ-CONTRACT-03's "document the contract"). REQ-EXIT-04 is well covered by its primary
  03 §6 + 00 §1, so not a coverage gap — just an inaccurate supporting attribution.
- **Suggested fix:** Drop `05` from the REQ-EXIT-04 supporting column (leave `00 §1`; 03 is primary).
- **References:** TRACEABILITY.md; 05 §3; 03 §6
- **Checklist:** CHECK-S21, CHECK-S23

### V-005: Per-doc Requirement Coverage tables omit the NFRs their bodies cover
- **Severity:** improvement
- **Location:** 02 (table), 05 (table), 06 (table) vs their bodies + TRACEABILITY NFR table
- **Issue:** Doc tables list only functional REQs; NFRs covered in bodies (02 §5 NFR-PARITY-01; 05 §7
  NFR-SAFETY/CUTOVER; 06 §8 NFR-SAFETY) aren't credited in the per-doc tables. NFRs are fully traced
  centrally in TRACEABILITY, so this is cosmetic — the "NFRs tracked centrally" convention is consistent if
  intentional.
- **Suggested fix (optional):** Add NFR rows to the doc tables where the body covers them (02→NFR-PARITY-01 §5;
  05→NFR-SAFETY-01/CUTOVER-01 §7; 06→NFR-SAFETY-01 §8), or leave as-is.
- **References:** 02 §5; 05 §7; 06 §8; TRACEABILITY NFR table
- **Checklist:** CHECK-S20, CHECK-S23

### V-006: `loop stop` exit-code remap + updated hint have no test coverage
- **Severity:** gap
- **Location:** 06-testing-strategy.md §1/§2 (loop stop named only as lifecycle endpoint in §3)
- **Issue:** 02 §4 + 03 §2 specify `loop stop`'s `ERROR`/`NOT_FOUND` paths remap to `USAGE`(2) and its
  `rauf loop start` hint (~loop-commands.ts:431) becomes `rauf loop run --detached`. The §1 audit only greps
  removed member names; it doesn't assert `loop stop`'s `USAGE`(2) exits or the reworded hint.
- **Suggested fix:** Add a §1 bullet: "`loop stop` (no server / no loop) → `USAGE`(2); assert its hint names
  `rauf loop run --detached`, not `loop start`."
- **References:** 02 §4/§8; 03 §2; PRD REQ-EXEC-05, REQ-DOC-02
- **Checklist:** CHECK-S20, CHECK-S22

### V-007: No verification that help/usage carries no stale `loop start` / `--watch` tokens
- **Severity:** gap
- **Location:** 06-testing-strategy.md §6 (flag parsing only)
- **Issue:** REQ-DOC-02 + 02 §8/Verification require help/usage + the loop-stop hint to contain no stale
  removed-verb/flag tokens (only the §7 remediation messages may name them). The §1 audit greps `ExitCode`
  members only — it wouldn't catch a surviving `loop start` in a usage string. No help/usage check exists.
- **Suggested fix:** Add a §6 (or §6a) check: assert no `loop start`/`--watch` token in the `loop`
  `SubcommandDef` usage/help strings or the stop hint (except `REMOVED_TOKENS` messages) — snapshot of
  top-level + `loop --help`, or a registry grep.
- **References:** PRD REQ-DOC-02; 02 §8/Verification; 00 §5
- **Checklist:** CHECK-S20, CHECK-S23

### V-008: REQ-SIG-02 (signal-placement doc reconciliation) has no verification approach
- **Severity:** gap
- **Location:** 06-testing-strategy.md (REQ-SIG-02 absent from coverage table + body)
- **Issue:** 04 §2 is a substantial deliverable (reword SPEC-BACKLOG-TOOL-CONTRACT "final line" → scan-from-end;
  update signal_parsed row/gotcha to include review; reword agent templates). 06 covers only REQ-SIG-01 (§5);
  REQ-SIG-02 isn't mentioned even as a doc-level check.
- **Suggested fix:** Add a REQ-SIG-02 coverage row + a bullet (like §7's doc-level discipline): confirm
  SPEC-BACKLOG-TOOL-CONTRACT §A.2 no longer says "final line", the signal_parsed row/gotcha include review,
  and agent templates drop the strictly-last-line claim; optionally a `parseSignal` trailing-text
  characterization test.
- **References:** PRD REQ-SIG-02; 04 §2/Verification
- **Checklist:** CHECK-S20, CHECK-S21

### V-009: `statusExitCode` test treats BLOCKED(5) as a `LoopStateEnum` value + ignores the widening gap
- **Severity:** inconsistency
- **Location:** 06-testing-strategy.md §1 (`statusExitCode` bullet)
- **Issue:** The bullet says "`it.each` over all 10 `LoopStateEnum` values … blocked→5", but `blocked` is NOT
  a `LoopStateEnum` member (schemas.ts:228-239). 03 §4 + 00 §2b are explicit that BLOCKED(5) is **derived**
  from the backlog summary and needs a **widened `statusExitCode(state, derived)` signature** (or, if
  deferred, a documented known-gap). The test as written can't exercise BLOCKED via a plain enum param.
- **Suggested fix:** Split into (a) `it.each` over the 10 enum values (drop `blocked`), and (b) a derived-BLOCKED
  case (clean terminal + genuine-blocked>0 via the widened signature). If widening is deferred, record the
  known gap per 03 §4.
- **References:** 03 §4; 00 §2b; schemas.ts:228-239
- **Checklist:** CHECK-S20, CHECK-S21, CHECK-S22

### V-010: `--backlog` (REQ-FLAG-03) dropped from flag-canon test coverage without note
- **Severity:** improvement
- **Location:** 06-testing-strategy.md §6 + coverage table ("REQ-FLAG-01/02/04 | §6" — `-03` absent)
- **Issue:** REQ-FLAG-03 (`--backlog` sole spelling) is in 02 §6's canon but omitted from 06's coverage table
  + §6 tests, unexplained (vs §7 which explicitly states its non-testing rationale).
- **Suggested fix:** Add REQ-FLAG-03 to the table + a §6 note: "inherited from Phase 1; no second spelling
  introduced" — or assert the detached POST body forwards `backlogRoot` from `--backlog` (02 §2.2).
- **References:** PRD REQ-FLAG-03; 02 §6/§2.2
- **Checklist:** CHECK-S20, CHECK-S21

### V-011: 05 names the FF event-stream field `runCommandNdjson` — the real field is `eventStreamCommand`
- **Severity:** error
- **Location:** 05-cutover-and-feature-forge.md §4 (the `runCommandNdjson` references)
- **Issue:** The `--ndjson` default at `forge-config-schema.json:70` belongs to a field named
  **`eventStreamCommand`** (declared `:68`), not `runCommandNdjson` (which exists nowhere in feature-forge).
  The cited line + default string are right; only the field name is wrong.
- **Suggested fix:** Rename `runCommandNdjson` → `eventStreamCommand` in 05 §4 (keep the `:68/:70` citation +
  `--ndjson` default string).
- **References:** feature-forge `references/forge-config-schema.json:68/:70`; 05 §4
- **Checklist:** CHECK-S29, CHECK-S31

### V-012: Artifact-template edit paths in 04/05 point to non-existent files
- **Severity:** error
- **Location:** 04-signals-and-events.md §2a/§2c; 05-cutover-and-feature-forge.md §6 (SPEC-ARTIFACTS row)
- **Issue:** 04 names `artifacts/RAUF.md` and `artifacts/CLAUDE_ADDON.md` as agent-template edit targets;
  those top-level paths don't exist. Real files: `artifacts/variants/backlog-json/.rauf/RAUF.md.tmpl` (note
  `.tmpl`) and `artifacts/variants/backlog-json/CLAUDE_ADDON.md`. The "final line" phrase to relax lives in
  `CLAUDE_ADDON.md:18`; `RAUF.md.tmpl` carries the `RAUF_DONE` directive (not a literal "final line"
  sentence). The §2a hedge "and any variants/** copies" is too vague — the primary named paths misdirect.
- **Suggested fix:** Replace cited paths with `artifacts/variants/backlog-json/.rauf/RAUF.md.tmpl` and
  `artifacts/variants/backlog-json/CLAUDE_ADDON.md` (note CLAUDE_ADDON.md:18 holds the "final line" wording);
  in 05 §6 SPEC-ARTIFACTS row, the literal mirror is `docs/SPEC-ARTIFACTS.md:233` + the `loop start` mention
  at `:53`.
- **References:** `artifacts/variants/backlog-json/{.rauf/RAUF.md.tmpl, CLAUDE_ADDON.md:18}`; `docs/SPEC-ARTIFACTS.md:233,:53`; 04 §2a/§2c; 05 §6
- **Checklist:** CHECK-S30, CHECK-S33

### V-013: 04 §3 mis-locates the ignore-unknown promise in SPEC-BACKLOG-TOOL-CONTRACT.md
- **Severity:** error
- **Location:** 04-signals-and-events.md §3 (rule 3, "~lines 180-188")
- **Issue:** 04 §3 says the unknown-tolerance contract "is already promised … ~lines 180-188." The 24-member
  type list is at ~:183 (correct), but the "Consumers MUST ignore unknown event types and unknown fields"
  promise is at **:283**, not 180-188. Citation-locus error (both claims are true, just the line is wrong).
- **Suggested fix:** In 04 §3 rule 3, cite the type list at ~:183 and the ignore-unknown promise at ~:283
  separately.
- **References:** `docs/SPEC-BACKLOG-TOOL-CONTRACT.md:183,:283`; 04 §3
- **Checklist:** CHECK-S32

## Fix Execution Plan

### User Decisions Required
None — all directly applicable. V-005 and V-010 are optional polish (no-op acceptable).

### Execution Steps

#### Step 1: Expand the 01 CLI change-map + fix the server-commands row + ordering pointer
- **Files:** specs/ux-overhaul-grammar/01-architecture-layout.md
- **Addresses:** V-001, V-002, V-003
- **Checklist:** CHECK-S05, CHECK-S06, CHECK-S08
- **Action:** Rewrite the §1 @rauf/cli table to enumerate every ExitCode-touched file (add backlog/install/
  profile-config/migrate/reset/resume-commands, main.ts, follow-command.ts) cross-referencing 03 §2; split
  the server-commands row (ensureServerRunning no-change; server-commands.ts re-points CONFLICT→USAGE at
  ~:406/:630); add the §3 step-3 fan-out pointer ("8+ files; full list in 03 §2; one coherent commit").
- **Depends on:** none

#### Step 2: Fix the three spec-internal citation/path errors
- **Files:** specs/ux-overhaul-grammar/05-cutover-and-feature-forge.md, specs/ux-overhaul-grammar/04-signals-and-events.md
- **Addresses:** V-011, V-012, V-013
- **Checklist:** CHECK-S29, CHECK-S30, CHECK-S31, CHECK-S32, CHECK-S33
- **Action:** V-011 — in 05 §4 rename `runCommandNdjson` → `eventStreamCommand`. V-012 — in 04 §2a/§2c and 05
  §6 replace `artifacts/RAUF.md`/`artifacts/CLAUDE_ADDON.md` with `artifacts/variants/backlog-json/.rauf/
  RAUF.md.tmpl` and `artifacts/variants/backlog-json/CLAUDE_ADDON.md` (note CLAUDE_ADDON.md:18 = "final
  line"; SPEC-ARTIFACTS mirror at :233, `loop start` at :53). V-013 — in 04 §3 rule 3, cite type list ~:183
  and ignore-unknown promise ~:283 separately.
- **Depends on:** none

#### Step 3: Close the testing-strategy coverage gaps + fix the BLOCKED test
- **Files:** specs/ux-overhaul-grammar/06-testing-strategy.md
- **Addresses:** V-006, V-007, V-008, V-009, V-010
- **Checklist:** CHECK-S20, CHECK-S21, CHECK-S22, CHECK-S23
- **Action:** Add a `loop stop` →USAGE(2)+hint test bullet (§1); add a help/usage no-stale-token audit (§6/§6a);
  add a REQ-SIG-02 coverage row + doc-level verification bullet; rewrite the `statusExitCode` bullet so
  BLOCKED(5) is a derived case via the widened signature (drop `blocked` from the enum `it.each`), noting the
  03 §4 known-gap if widening is deferred; add a REQ-FLAG-03 `--backlog` row + note.
- **Depends on:** none

#### Step 4 (optional): Add NFR rows to per-doc coverage tables + fix TRACEABILITY REQ-EXIT-04 attribution
- **Files:** specs/ux-overhaul-grammar/TRACEABILITY.md, 02-execution-grammar.md, 05-cutover-and-feature-forge.md, 06-testing-strategy.md
- **Addresses:** V-004, V-005
- **Checklist:** CHECK-S20, CHECK-S21, CHECK-S23
- **Action:** V-004 — drop `05` from TRACEABILITY's REQ-EXIT-04 supporting column. V-005 (optional) — add NFR
  rows to the 02/05/06 coverage tables where bodies cover them.
- **Depends on:** none

## Fix Progress
- Step 1: [APPLIED] 2026-06-13 — V-001/V-002/V-003: expanded 01 §1 @rauf/cli table with the ExitCode call-site sweep row (8 files: backlog/install/profile-config/migrate/reset/resume-commands, main.ts, follow-command.ts) cross-ref 03 §2; split server-commands.ts into ensureServerRunning(no-change) + server-commands.ts(CONFLICT→USAGE); added §3 step-3 fan-out pointer.
- Step 2: [APPLIED] 2026-06-13 — V-011: 05 §4 runCommandNdjson→eventStreamCommand (schema :68/:70). V-012: 04 §2a/§2c artifact paths → artifacts/variants/backlog-json/{CLAUDE_ADDON.md:18, .rauf/RAUF.md.tmpl:32-34} + embedded-artifacts regen note. V-013: 04 §3 split citation → type list ~:183, ignore-unknown promise ~:283.
- Step 3: [APPLIED] 2026-06-13 — V-006: added loop stop →USAGE(2)+hint test bullet (§1). V-007: added §4a help/usage no-stale-token audit. V-008: added REQ-SIG-02 doc-level verification bullet (§5) + coverage row. V-009: rewrote statusExitCode test — enum it.each (10 values, blocked NOT an enum value) + separate derived-BLOCKED case via widened signature + known-gap note. V-010: added REQ-FLAG-03 --backlog row + §6 note (detached POST forwards backlogRoot).
- Step 4: [APPLIED] 2026-06-13 — V-004: dropped 05 from TRACEABILITY REQ-EXIT-04 supporting col. V-005: added NFR rows (02→NFR-PARITY-01, 05→NFR-SAFETY/CUTOVER, 06→NFR-SAFETY-01).

All 13 findings applied. Verify stage → findings-applied.
