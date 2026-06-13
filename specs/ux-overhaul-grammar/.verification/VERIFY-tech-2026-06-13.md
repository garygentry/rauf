# Verification Report: ux-overhaul-grammar (tech)
Date: 2026-06-13
Pipeline Stage: forge-3-specs (tech-spec verification)
Artifacts Reviewed:
- specs/ux-overhaul-grammar/tech-spec.md (under test)
- specs/ux-overhaul-grammar/PRD.md (requirements)
- specs/ux-overhaul/CANON.md (cross-cutting source of truth)
- Verified against rauf source (packages/cli, loop, core, web) + feature-forge repo

Method: single `forge-verifier` (read-only), full tech-mode checklist (17 checks). Executed 17/17: 14 pass, 3 fail, 0 n/a.

## Summary
- Total findings: 6
- Gaps: 2 (V-002, V-005)
- Inconsistencies: 1 (V-004)
- Improvements: 3 (V-001, V-003, V-006)
- Errors: 0

Overall: the tech spec is accurate and sound. **Every load-bearing source claim (~20 file:line/value citations — ExitCode, the loop-run ternary, statusExitCode, SignalParsedSchema, the review→done collapse, SignalType, ensureServerRunning/handleLoopRun/handleLoopStart, LoopResult, EVENTS_SCHEMA_VERSION/PersistedEventSchema/LoopEventSchema, the web start route + LoopManager.startLoop, app.ts CSRF, the feature-forge minRunnerVersion default) was verified against source and is correct** — zero `error`-severity findings. The 6 findings are traceability/clarity/scope refinements.

## Findings

### V-001: §10 open question #4 (`<EventTimeline>` tolerance) is resolvable now and mischaracterizes the source
- **Severity:** improvement
- **Location:** tech-spec.md §10 item 4, §6 "signal_parsed consumers" + §6 WARNING block; source `packages/web/src/client/routes/projects/status.tsx:462,498-501,571`
- **Issue:** §10 defers verifying the web timeline tolerates `signal:"review"`, and §6 refers to "its switch." There is no switch on the signal *value*: `EventTimeline` is a local function in `status.tsx`, and the `signal_parsed` case (lines 498-501) renders by string interpolation (`` `#${e.itemId} · ${e.signal}…` ``). It already tolerates any string, so `"review"` is provably additive — answerable now from source, not deferred. "Its switch" mischaracterizes the rendering (the outer `switch` is on `e.type`, not `e.signal`).
- **Suggested fix:** In §10 item 4, replace the deferral with a resolved note: "Confirmed: `EventTimeline` (local fn in `web/src/client/routes/projects/status.tsx`) renders `signal_parsed` via string interpolation of `e.signal` (no value-level switch), so `review` renders as-is — additive, no web change required." Remove `<EventTimeline>` from the §6 WARNING list; reword "verify its switch tolerates" → "renders the value verbatim; no change needed."
- **References:** tech-spec §6, §10; PRD REQ-SIG-01, REQ-EVT-02; CANON §4.5
- **Checklist:** CHECK-T16, CHECK-T05

### V-002: REQ-EXEC-06 (observation parity) has no explicit tracing decision
- **Severity:** gap
- **Location:** tech-spec.md §3 — REQ-EXEC-06 appears in no §3 REQ tag
- **Issue:** PRD REQ-EXEC-06 (P1) requires attended and detached runs to be observationally identical, and NFR-PARITY-01 (P0) requires Phase-1 parity not regress. The spec relies on this implicitly (§1 "substrate reused as-is", §3.1 "zero execution-semantics change") but no §3 decision is tagged REQ-EXEC-06/NFR-PARITY-01, and §8 has no parity-regression test (the `--detached` tests mock the server and assert delegation, not identical observer output). Since §3.1 adds a new code path (the `--detached` branch), parity is no longer purely inherited — it's a property the new branch must preserve.
- **Suggested fix:** Tag §3.1 with REQ-EXEC-06/NFR-PARITY-01 and add a sentence: "Both branches feed the same file-backed substrate (state.json + events.ndjson), so attended and detached runs stay observationally identical (REQ-EXEC-06, NFR-PARITY-01) — the `--detached` branch adds no observation path." Add a §8 testing bullet for attended-vs-detached observation parity (or an explicit rationale for relying on the unchanged substrate + delegation test).
- **References:** PRD REQ-EXEC-06, NFR-PARITY-01; CANON §4.2; tech-spec §1, §3.1, §8
- **Checklist:** CHECK-T01, CHECK-T03, CHECK-T11

### V-003: Alternatives considered only for §3.1; other major decisions assert without alternatives
- **Severity:** improvement
- **Location:** tech-spec.md §3.2, §3.5 (only §3.1 has an "Alternatives considered" line)
- **Issue:** CHECK-T09 expects alternatives for major decisions. Two consequential choices state only rationale: (a) §3.2 "redefine `ExitCode` in place" — the alternative (new enum / additive parallel scheme + migrate) isn't named as considered-and-rejected; (b) §3.5 "do NOT bump `EVENTS_SCHEMA_VERSION`" — the alternative (bump to "2") is a real fork a reader will wonder about. Naming the rejected option guards against an implementer re-introducing it.
- **Suggested fix:** Add a one-line "Alternatives considered" to §3.2 ("new `ExitCodeV2` enum + gradual migration — rejected: parallel schemes are the inconsistency we're removing; zero external users make in-place safe") and §3.5 ("bump to `\"2\"` — rejected: no shape change, so a bump forces consumers to re-gate for nothing; this is the first *formal* version of an existing field, not a breaking change").
- **References:** tech-spec §3.2, §3.5; PRD REQ-EXIT-01, REQ-EVT-01, NFR-COMPAT-01
- **Checklist:** CHECK-T09

### V-004: Old-`CONFLICT`→`USAGE`(2) mapping is presented as both decided (§3.2/§7) and open (§10 item 3)
- **Severity:** inconsistency
- **Location:** tech-spec.md §3.2 + §7 (map 409/already-running → USAGE(2)) vs §10 item 3 (lists it as an open question)
- **Issue:** The spec firmly maps the already-running/409 case to `USAGE`(2) in §3.2 and §7, then lists the same decision as unresolved in §10. A downstream implementer/backlog generator cannot tell if it's settled. It is a real semantic choice (a 409 "loop already running" is arguably a state *conflict*, not a *usage* error — but canon reserves 3/4/5/6 for loop-state outcomes, leaving only 1 or 2). Must be resolved in the tech spec since the §3.2 exit-code table is the machine contract feature-forge depends on (REQ-EXIT-04).
- **Suggested fix:** Resolve in §3.2 and delete §10 item 3. Recommended (consistent with §3.2's logic + CANON §4.4): keep `USAGE`(2) — canon reserves 3/4/5/6 for loop-state outcomes and 1 for generic failure; an already-running 409 is a failed precondition the operator can correct ("bad args / IO / failed precondition"). State the rationale inline so it's not re-litigated. **(USER DECISION — see Fix Execution Plan.)**
- **References:** tech-spec §3.2, §7, §10; PRD REQ-EXIT-01, REQ-EXIT-04; CANON §4.4
- **Checklist:** CHECK-T02, CHECK-T16

### V-005: §3.7 / §6 omit feature-forge's stale `watch` reference in `ralph-loop-contract.md`
- **Severity:** gap
- **Location:** tech-spec.md §3.7 + §6 (feature-forge row); source `/home/gary/workspace/feature-forge/references/ralph-loop-contract.md:51`
- **Issue:** §3.7 correctly notes feature-forge has no `loop start`/`--watch` *invocations*. But `ralph-loop-contract.md:51` enumerates the rauf monitoring surface as "status (+ --json) / list / **watch** / follow / log / version" — documenting `watch`, which REQ-FLAG-01/REQ-RMV-01 remove in this release. §3.7's generic "align the contract notes" doesn't flag this specific stale token, so a fresh agent applying the FF lockstep edit (REQ-CONTRACT-04) could miss it.
- **Suggested fix:** Add an explicit bullet to §3.7 (and a §6 feature-forge-row note): "`ralph-loop-contract.md` line ~51 lists `watch` in the rauf monitoring surface — remove/replace with `follow` to match v0.5.0 (REQ-FLAG-01, REQ-RMV-01)."
- **References:** tech-spec §3.7, §6; PRD REQ-CONTRACT-04, REQ-FLAG-01, REQ-RMV-01; source `feature-forge/references/ralph-loop-contract.md:51`
- **Checklist:** CHECK-T04, CHECK-T16

### V-006: `--detached --follow` data flow — `--follow` must not enter the server request body
- **Severity:** improvement
- **Location:** tech-spec.md §3.1 (`--detached --follow` bullet vs the request-body description); source `packages/cli/src/loop-commands.ts:334-357`
- **Issue:** §3.1 correctly says `--detached --follow` attaches the follow view after the POST returns, but doesn't state that `--follow` must be handled CLI-side and must NOT be added to the request body. The existing `handleLoopStart` body builder (verified `loop-commands.ts:334-357`) carries only loop options (`maxIterations`, `maxRetries`, `model`, `timeout`, `backlogRoot`, `suppressIterationReview`), not observation flags. An implementer folding `handleLoopStart` into the `--detached` branch could mis-route `--follow` into the POST.
- **Suggested fix:** Add to the §3.1 `--detached --follow` bullet: "`--follow` is an observation concern handled CLI-side after the POST returns (attach the top-level `follow` view); it is NOT part of the server request body (which carries only loop options — `handleLoopStart` body builder, `loop-commands.ts:334-357`)."
- **References:** tech-spec §3.1; PRD REQ-EXEC-04, REQ-FLAG-01/02; source `loop-commands.ts:334-357`
- **Checklist:** CHECK-T06, CHECK-T07, CHECK-T16

## Fix Execution Plan

### User Decisions Required
- **V-004 — already-running/409 exit code: RESOLVED (2026-06-13, user) → `USAGE`(2).** Bake `USAGE`(2) into §3.2 and §7 with the failed-precondition rationale and delete §10 item 3. All other fixes apply directly.

### Execution Steps

#### Step 1: Resolve the deferred §10 open questions (EventTimeline + exit code)
- **Files:** specs/ux-overhaul-grammar/tech-spec.md
- **Addresses:** V-001, V-004
- **Checklist:** CHECK-T16, CHECK-T02
- **Action:** In §10, delete item 4 and state the resolved EventTimeline finding in §6 (reword "verify its switch tolerates" → "renders `e.signal` verbatim via string interpolation; no web change needed"; remove `<EventTimeline>` from the §6 WARNING list). Delete §10 item 3 and bake the already-running→`USAGE`(2) decision (or the user's chosen value) into §3.2 and §7 with the failed-precondition rationale.
- **Depends on:** none

#### Step 2: Close the REQ-EXEC-06 / parity traceability gap
- **Files:** specs/ux-overhaul-grammar/tech-spec.md
- **Addresses:** V-002
- **Checklist:** CHECK-T01, CHECK-T03, CHECK-T11
- **Action:** Tag §3.1 with REQ-EXEC-06/NFR-PARITY-01 + the one-sentence parity rationale (both branches feed the same file substrate). Add a §8 testing bullet for attended-vs-detached observation parity (or an explicit rationale for relying on the unchanged substrate + delegation test).
- **Depends on:** none

#### Step 3: Clarify `--detached --follow` data flow
- **Files:** specs/ux-overhaul-grammar/tech-spec.md
- **Addresses:** V-006
- **Checklist:** CHECK-T06, CHECK-T07
- **Action:** Add the §3.1 sentence clarifying `--follow` is CLI-side post-POST and excluded from the request body (loop options only, `loop-commands.ts:334-357`).
- **Depends on:** none

#### Step 4: Add the specific feature-forge `watch`-reference edit
- **Files:** specs/ux-overhaul-grammar/tech-spec.md
- **Addresses:** V-005
- **Checklist:** CHECK-T04, CHECK-T16
- **Action:** Add a §3.7 bullet + §6 note calling out `feature-forge/references/ralph-loop-contract.md:~51` (`watch` in the monitoring surface) for removal/replacement with `follow`.
- **Depends on:** none

#### Step 5: Add named alternatives to §3.2 and §3.5
- **Files:** specs/ux-overhaul-grammar/tech-spec.md
- **Addresses:** V-003
- **Checklist:** CHECK-T09
- **Action:** Add a one-line "Alternatives considered" to §3.2 (new parallel enum — rejected) and §3.5 (bump version — rejected), per V-003.
- **Depends on:** none

## Fix Progress
- Step 1: [APPLIED] 2026-06-13 — V-001: reworded §6 EventTimeline (renders e.signal via string interpolation, no switch → review additive, no web change); V-004: baked 409/already-running → USAGE(2) as resolved decision in §3.2 (§7 already stated it); deleted §10 items 3 (CONFLICT-open) + 4 (EventTimeline), added a resolved-note.
- Step 2: [APPLIED] 2026-06-13 — V-002: tagged §3.1 heading with REQ-EXEC-06, added an Observation-parity bullet (both branches feed the same file substrate) + a §8 parity testing bullet (REQ-EXEC-06/NFR-PARITY-01).
- Step 3: [APPLIED] 2026-06-13 — V-006: added to the §3.1 --detached --follow bullet that --follow is CLI-side post-POST and NOT in the server request body (handleLoopStart body builder loop-commands.ts:334-357).
- Step 4: [APPLIED] 2026-06-13 — V-005: §3.7 bullet + §6 feature-forge-row note calling out ralph-loop-contract.md:51 stale `watch` → replace with `follow` (REQ-FLAG-01/REQ-RMV-01).
- Step 5: [APPLIED] 2026-06-13 — V-003: added "Alternatives considered" to §3.2 (ExitCodeV2 parallel enum — rejected) and §3.5 (bump EVENTS_SCHEMA_VERSION to "2" — rejected).

All 6 findings applied; verify stage → findings-applied.
