# Verification Report: ux-overhaul-web (prd)
Date: 2026-06-14
Pipeline Stage: forge-2-tech (forge-1-prd complete; verifying PRD)
Artifacts Reviewed: `specs/ux-overhaul-web/PRD.md` (primary); cross-referenced against `specs/ux-overhaul/CANON.md`, `specs/ux-overhaul/PHASE-4-KICKOFF.md`, `specs/ux-overhaul-web/.pipeline-state.json`, `CLAUDE.md`

Executed 15 of 15 checks. Results: 11 pass, 3 fail, 1 n/a.

Check-by-check:
- CHECK-P01 (all template sections populated): PASS — all 8 sections present.
- CHECK-P02 (no TBD/TODO): PASS.
- CHECK-P03 (out-of-scope specific): PASS — six explicit items, each CANON-cited.
- CHECK-P04 (open questions actionable): PASS — OQ-1/OQ-2 are concrete, tech-spec-scoped.
- CHECK-P05 (success criteria verifiable): PASS — see V-005 (one minor non-verifiable clause flagged as improvement).
- CHECK-P06 (unique category-prefixed IDs): PASS — all IDs unique, REQ-{CAT}-NN format.
- CHECK-P07 (priority assigned): PASS — every REQ has P0/P1.
- CHECK-P08 (testable): PASS overall; see V-002 (one REQ borderline).
- CHECK-P09 (no tech decisions as requirements): FAIL — V-001, V-002, V-003.
- CHECK-P10 (user stories cover all actors): PASS.
- CHECK-P11 (NFRs quantified where applicable): N/A — no latency/throughput/SLA-bearing NFRs in this additive UI/contract phase; nothing to quantify.
- CHECK-P12 (security explicit): PASS — REQ-SEC-01/02 explicit.
- CHECK-P13 (constraints distinguish must vs should): FAIL — V-004.
- CHECK-P14 (implicit requirements made explicit): FAIL — V-006 (concurrency/idempotency of recovery mutations).
- CHECK-P15 (requirement conflicts/tensions): PASS — REQ-WEB-08 + OQ-1 surface the only real tension (rule #1 vs resume/review living outside core) and handle it correctly.

Gap-coverage cross-check (priority focus) — all clean:
- All four ratified decisions are reflected: deferral → §6 + REQ-AGENT scope note; all five actions → REQ-WEB-01..05; exit mapping → REQ-EXIT-01; backend+core-only testing → REQ-TEST-01/02/03.
- CANON §4.3 obligations: rule 1 (total coverage) → REQ-VOCAB-02; rule 2 (REVIEWING/PAUSED_USAGE_LIMIT + badges) → REQ-VOCAB-03/04/07; rule 3 (Needs Human) → REQ-VOCAB-05; rule 4 (one shared map) → REQ-VOCAB-01. Title/SCREAMING casing → REQ-VOCAB-06.
- CANON §4.4 → REQ-EXIT-01 (values match the table: 6=Running, 4=Limit/usage-paused).
- CANON §4.6 phase-4 items → REQ-AGENT-01 (signal spec, incl. `RAUF_REVIEW:<json>` + backward-scan), REQ-AGENT-02 (model cascade, exact precedence), REQ-AGENT-03 (progress.md stub). Rename correctly out-of-scope.
- CANON §8 out-of-scope items all mirrored in §6.

## Summary
- Total findings: 6
- Gaps: 1
- Inconsistencies: 1
- Improvements: 4
- Errors: 0

## Findings

### V-001: REQ-ARCH-01 hard-codes the placement decision (`packages/core`) that OQ-1 explicitly parks for the tech spec
- **Severity:** improvement (implementation-leak; CHECK-P09)
- **Location:** PRD.md §4.3, REQ-ARCH-01 ("...placed so CLI and web both import it without violating rule #1 (i.e. in `packages/core`, with no cli/web dependencies)")
- **Issue:** REQ-ARCH-01 states the requirement (label map must be importable by both CLI and web without violating rule #1) and then names the concrete module location `packages/core`. The *requirement* is "no rule-#1 violation"; "put it in `packages/core`" is the implementation choice that satisfies it. This is the only viable location given rule #1, so it's low-risk, but per CHECK-P09 a specific package placement is a tech-spec/constraint decision, not a requirement. OQ-1 already (correctly) defers the *sibling* placement question (where resume/review logic lands) to the tech spec — so the PRD is internally inconsistent about which placement calls it makes vs. defers.
- **Suggested fix:** Soften REQ-ARCH-01 to state the requirement only: "The shared label-map module must be importable by both CLI and web without violating rule #1 (it must carry no cli/web dependencies)." Drop the parenthetical "i.e. in `packages/core`," or move that as a non-binding note to the Constraints section / OQ-2.
- **References:** CANON §4.3 rule 4; CLAUDE.md rule #1; PRD.md OQ-1, OQ-2; PHASE-4-KICKOFF.md §4 (only *recommends* core placement).
- **Checklist:** CHECK-P09

### V-002: REQ-WEB-01 enumerates CLI reset sub-options ("clear-backlog, keep-progress, keep-log") as a requirement
- **Severity:** improvement (implementation-leak; CHECK-P09 / CHECK-P08)
- **Location:** PRD.md §3.1, REQ-WEB-01 ("...with the same options the CLI exposes (e.g. clear-backlog, keep-progress, keep-log)")
- **Issue:** The requirement is "web reset has parity with CLI reset's option surface." The specific flag list is an implementation detail of the current CLI `reset` command; if the CLI's reset options change, this REQ silently goes stale, and it pins option *names* the PRD shouldn't own. The "e.g." softens it, but it still reads as a normative enumeration.
- **Suggested fix:** Rephrase to express parity without enumerating: "...with the same option surface the CLI `reset` exposes (option parity — the tech spec enumerates the exact flags from the current `reset` command)."
- **References:** core `reset.ts` (resetProject); PRD.md REQ-WEB-08 (parity-over-core principle).
- **Checklist:** CHECK-P09, CHECK-P08

### V-003: REQ-EXIT-01 prescribes the implementation mechanism ("Extend `statusExitCode`") rather than the behavioral requirement
- **Severity:** improvement (implementation-leak; CHECK-P09)
- **Location:** PRD.md §3.3, REQ-EXIT-01 ("Map the two new states in statusExitCode. ...Extend `statusExitCode` so...")
- **Issue:** The requirement is the observable behavior: `rauf status` on a `reviewing` loop exits 6, and on a `paused_usage_limit` loop exits 4 (not the current silent 0). The REQ instead names the concrete function (`statusExitCode`) and instructs to "extend" it — a HOW. The function name belongs to the code map / tech spec. (Mirrors the same pattern flagged in the grammar-phase PRD.)
- **Suggested fix:** Restate REQ-EXIT-01 behaviorally: "`rauf status` must exit `6` (Running) for a `reviewing` loop and `4` (Limit) for a `paused_usage_limit` loop, per CANON §4.4 — correcting today's silent exit `0` for `paused_usage_limit`. The unified v0.5.0 exit table (0–6) is otherwise unchanged." Drop the function name from the requirement body (or move it to a Constraints/code-map note).
- **References:** CANON §4.4; PHASE-4-KICKOFF.md §2b; code map: `statusExitCode` at cli/status-commands.ts:512.
- **Checklist:** CHECK-P09

### V-004: REQ-VOCAB-07 priority skew — a P1 requirement is a precondition of P0 success criteria and P0 REQ-VOCAB-02/03/04
- **Severity:** inconsistency (CHECK-P13 / CHECK-P07 priority sensibility)
- **Location:** PRD.md §3.2, REQ-VOCAB-07 (P1, "Badges for the full enum") vs REQ-VOCAB-03/04 (P0, which each require "and a badge") and §8 Success Criteria ("`REVIEWING` and `PAUSED_USAGE_LIMIT` are distinct, badged values").
- **Issue:** REQ-VOCAB-07 is marked P1 (should-have), but the P0 success criteria require the two new states to be *badged*, and REQ-VOCAB-03/04 (both P0) each explicitly require "and a badge." So badge coverage for at least the two new states is effectively P0, contradicting REQ-VOCAB-07's P1 classification. CANON §4.3 rule 2 ("...and given badges") treats badges as part of the mandatory change.
- **Suggested fix:** Promote REQ-VOCAB-07 to P0 (badges for the full derived enum are part of "no value renders unstyled," and CANON §4.3 rule 2 mandates badges for the new states). [Resolved: option (a) — promote to P0.]
- **References:** CANON §4.3 rule 2; PRD.md REQ-VOCAB-03, REQ-VOCAB-04, §8 success criteria.
- **Checklist:** CHECK-P13, CHECK-P07

### V-005: Success criterion "the branch merges" / "completes the 4-phase overhaul" is a process milestone, not a feature-verifiable criterion
- **Severity:** improvement (CHECK-P05)
- **Location:** PRD.md §8 Success Criteria, final bullet ("the branch merges; this completes the 4-phase UX/DX overhaul.")
- **Issue:** "The branch merges" and "completes the 4-phase overhaul" are project/process outcomes, not properties of the deliverable a fresh agent can verify against the artifact. The rest of §8 is genuinely verifiable; these two dilute it.
- **Suggested fix:** Keep them as a closing narrative note but separate them from the verifiable success-criteria list (prefix "Process:" or move to a "Phase completion note" line). The verifiable criteria are the five-actions / shared-map / exit-code / doc-items / tests-green / specs-updated bullets.
- **References:** PHASE-4-KICKOFF.md §7; CANON §5.
- **Checklist:** CHECK-P05

### V-006: No requirement covers concurrency / idempotency of recovery mutations (implicit requirement)
- **Severity:** gap (CHECK-P14)
- **Location:** PRD.md §3.1 (REQ-WEB-01..08) and §4.1/§4.3 — absent.
- **Issue:** The recovery actions mutate live loop state (`reset`, `resume`, `unblock`) and some target a *running* loop. The PRD does not state what happens when a recovery mutation races a live loop or a concurrent CLI invocation (e.g., web `reset` fired while a detached loop is mid-iteration, or two browser tabs firing `unblock`). CLAUDE.md rule #2 (atomic writes) covers file integrity, but the *behavioral* requirement — should recovery be rejected/guarded when a loop is actively running, or is it idempotent/safe-by-construction? — is implicit. REQ-WEB-07 ("controls reflect applicability") gestures at UI affordance but not at server-side safety under concurrency. rauf has a documented lock model (`.loop.lock` / `~/.rauf/active` registry) the requirement should lean on.
- **Suggested fix:** Add REQ-WEB-09 (P1) under §3.1: "Recovery mutations are safe under concurrency. A recovery action that would corrupt or conflict with an actively-running loop must be rejected with an actionable error (not silently applied), consistent with the existing loop-lock model; recovery endpoints inherit core's atomic-write guarantees (rule #2)." Leave the precise lock mechanism to the tech spec. [Resolved: add REQ-WEB-09 P1.]
- **References:** CLAUDE.md rule #2; ux-overhaul Phase 1 `.loop.lock` / active-loop registry; PRD.md REQ-WEB-07, REQ-SEC-02.
- **Checklist:** CHECK-P14

## Fix Execution Plan

### User Decisions Required
- **V-004 (priority):** RESOLVED — option (a): promote REQ-VOCAB-07 to P0. (Recommended by verifier; ratified.)
- **V-006 (concurrency):** RESOLVED — add explicit REQ-WEB-09 (P1) safety requirement. (Recommended by verifier; ratified.)
- All other fixes (V-001, V-002, V-003, V-005) are direct edits, no decision needed.

### Execution Steps

#### Step 1: De-leak implementation choices from requirements
- **Files:** `specs/ux-overhaul-web/PRD.md`
- **Addresses:** V-001, V-002, V-003
- **Checklist:** CHECK-P09, CHECK-P08
- **Action:** (a) REQ-ARCH-01: remove the "i.e. in `packages/core`" parenthetical; restate as "importable by both CLI and web without violating rule #1 (no cli/web dependencies)." (b) REQ-WEB-01: replace the "(e.g. clear-backlog, keep-progress, keep-log)" enumeration with "the same option surface the CLI `reset` exposes (tech spec enumerates the exact flags)." (c) REQ-EXIT-01: retitle to a behavioral statement ("`rauf status` exits 6 for `reviewing`, 4 for `paused_usage_limit`...") and drop "Extend `statusExitCode`" from the requirement body (keep `statusExitCode` only as a code-map note).
- **Depends on:** none
- **Rationale:** All three are the same class (HOW leaking into requirements); grouping keeps the §3/§4 edits coherent and avoids touching the placement decisions OQ-1/OQ-2 legitimately own.

#### Step 2: Fix priority skew on badge coverage
- **Files:** `specs/ux-overhaul-web/PRD.md`
- **Addresses:** V-004
- **Checklist:** CHECK-P13, CHECK-P07
- **Action:** Change REQ-VOCAB-07 priority `P1` → `P0`. Ensure no P0 success criterion depends on a P1 requirement.
- **Depends on:** none
- **Rationale:** Must align with §8's P0 "badged" criterion and CANON §4.3 rule 2.

#### Step 3: Add concurrency/idempotency requirement for recovery mutations
- **Files:** `specs/ux-overhaul-web/PRD.md`
- **Addresses:** V-006
- **Checklist:** CHECK-P14
- **Action:** Add REQ-WEB-09 (P1) under §3.1 per the suggested-fix wording; reference rule #2 + the loop-lock model; leave the mechanism to the tech spec.
- **Depends on:** none
- **Rationale:** Closes the only true coverage gap; references existing rule #2 + lock model so the tech spec has an anchor.

#### Step 4: Tighten Success Criteria to verifiable items
- **Files:** `specs/ux-overhaul-web/PRD.md`
- **Addresses:** V-005
- **Checklist:** CHECK-P05
- **Action:** In §8, separate "the branch merges" and "completes the 4-phase overhaul" from the verifiable criteria list (prefix "Process:" or a closing "Phase completion note"). Leave the five behavioral/test/docs criteria as the testable set.
- **Depends on:** none
- **Rationale:** Cosmetic clarity; keeps §8 a clean acceptance set without altering scope.

## Fix Progress

- Step 1: [APPLIED] 2026-06-14 — De-leaked HOW from requirements: REQ-ARCH-01 now states "importable by CLI+web with no cli/web deps" (packages/core moved to a tech-spec note → OQ-2); REQ-WEB-01 replaced the flag enumeration with "same option surface … tech spec enumerates the exact flags"; REQ-EXIT-01 retitled to a behavioral statement (rauf status exits 6 for reviewing, 4 for paused_usage_limit), statusExitCode kept only as a code-map note.
- Step 2: [APPLIED] 2026-06-14 — REQ-VOCAB-07 priority P1 → P0, with rationale tying it to CANON §4.3 rule 2 + §8's badged criterion.
- Step 3: [APPLIED] 2026-06-14 — Added REQ-WEB-09 (P1): recovery mutations safe under concurrency — conflicting actions on an actively-running loop rejected with an actionable error, consistent with the loop-lock model; mechanism left to the tech spec.
- Step 4: [APPLIED] 2026-06-14 — §8 success criteria tightened: "branch merges / completes overhaul" split out as a "Phase completion note (process, not a feature criterion)"; the exit-code criterion restated behaviorally to match REQ-EXIT-01.
