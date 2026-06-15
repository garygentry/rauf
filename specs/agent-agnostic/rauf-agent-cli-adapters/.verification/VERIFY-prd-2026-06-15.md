# Verification Report: rauf-agent-cli-adapters (prd)
Date: 2026-06-15
Pipeline Stage: forge-2-tech (forge-1-prd complete)
Artifacts Reviewed: specs/agent-agnostic/rauf-agent-cli-adapters/PRD.md, specs/agent-agnostic/EPIC.md, specs/agent-agnostic/epic-manifest.json

## Summary
- Total findings: 4
- Gaps: 1
- Inconsistencies: 0
- Improvements: 3
- Errors: 0

Checks executed: 15 of 15 (12 pass, 3 soft-fail, 0 n/a). Charter→REQ coverage complete (all three
`exposes` obligations traced); all nine interview decisions reflected; the copilot/cursor first-class
vs. out-of-scope contradiction is fully resolved; no HOW-leakage. None of the four findings block
proceeding to forge-2-tech.

## Findings

### V-001: Success Criteria are not individually tied to the requirements they verify
- **Severity:** improvement
- **Location:** PRD.md §8 (Success Criteria) vs §3 (Functional Requirements)
- **Issue:** SC-1..SC-6 are measurable, but the mapping from each SC back to the REQs it discharges is implicit. REQ-DISC-02 (P1 discovery surface with per-agent status) and REQ-OBS-02 (best-effort telemetry, graceful absence) are only indirectly reflected in SC-5/SC-4. Traceability is looser here than the rest of the doc.
- **Suggested fix:** Append a parenthetical REQ list to each SC (e.g. "SC-3 (REQ-DET-01, REQ-DET-02)"). Extend SC-1 to assert that the mock plain-text agents complete with token/tool telemetry gracefully absent and **no error raised** (verifies REQ-OBS-02's "absence MUST NOT be treated as an error").
- **References:** REQ-DET-01/02, REQ-OBS-02, REQ-DISC-02
- **Checklist:** CHECK-P05, CHECK-P08

### V-002: NFR section skips 4.4 (Accessibility) without an explicit "not applicable" note
- **Severity:** improvement
- **Location:** PRD.md §4 — numbering jumps §4.3 Observability → §4.5 Scalability
- **Issue:** The PRD template lists 4.4 Accessibility. This headless CLI runner has no a11y surface, so omission is correct, but the silent numbering gap reads as accidental deletion rather than a deliberate decision (CHECK-P01 soft-fail).
- **Suggested fix:** Insert "### 4.4 Accessibility — Not applicable: rauf is a headless loop runner with no interactive UI surface in scope." between §4.3 and §4.5; leave §4.5 as-is.
- **References:** prd-template.md §4.4
- **Checklist:** CHECK-P01

### V-003: REQ-SEC-02 conflates existing signal-token redaction with non-existent credential redaction
- **Severity:** gap
- **Location:** PRD.md §4.2, REQ-SEC-02 ("Any signal/credential redaction applied to agent output today MUST apply uniformly to all agents' output")
- **Issue:** REQ-SEC-02 names "signal/credential redaction applied today" as one thing, but they are two different things with different statuses (confirmed against `packages/loop/src/signal-redactor.ts`):
  - **Signal-token redaction EXISTS** (`redactSignalTokens` in `signal-redactor.ts`): it neutralizes literal `RAUF_*` tokens appearing in agent output (replacing `_` with `·`) so an agent merely *quoting* `RAUF_DONE` cannot be mis-parsed as a real completion signal. This is signal-contract robustness, not security, and it MUST apply uniformly to every agent's output (it is part of how signals are safely detected per REQ-SIG-01/02).
  - **Credential/secret redaction DOES NOT EXIST today.** As written, the "credential" half of REQ-SEC-02 is vacuously satisfied and provides zero value — a tech-spec author cannot tell whether net-new credential redaction is mandated.
- **Suggested fix:** Split REQ-SEC-02. (a) Move the signal-token-redaction requirement next to REQ-SIG (or keep in §4.2 but state it explicitly): "Existing `RAUF_*` signal-token neutralization MUST be applied to every agent's output before signal detection, so a quoted signal token in any agent's output cannot be mis-parsed." (b) For credentials, state plainly that rauf performs no credential/secret redaction today and either reclassify net-new credential redaction to §6 Out of Scope / a follow-up, or, if desired in-scope, specify what classes must be redacted (then it becomes a measurable target). Recommend (a) keep+generalize signal redaction, (b) declare credential redaction out of scope for this feature.
- **References:** REQ-SIG-01/02, packages/loop/src/signal-redactor.ts (`redactSignalTokens`), CLAUDE.md (path-sandboxing)
- **Checklist:** CHECK-P12, CHECK-P14

### V-004: Constraints section mixes MUST-level mandates with a modal-less scope statement
- **Severity:** improvement
- **Location:** PRD.md §5 (Constraints) — the fifth bullet ("This feature targets the rauf repo only; cross-repo wiring lives in sibling epic features")
- **Issue:** Most constraints use MUST; this scope bullet has no modal verb, blurring whether it's a hard boundary or a note (CHECK-P13 asks that mandates vs. preferences be unambiguous).
- **Suggested fix:** Rephrase as a mandate: "This feature MUST NOT modify files outside the rauf repo; cross-repo wiring is delivered by sibling epic features (`forge-rauf-loop-default`, `cross-agent-installer`)."
- **References:** §6 Out of Scope, epic-manifest.json (sibling features)
- **Checklist:** CHECK-P13

## Fix Execution Plan

### User Decisions Required
- **V-003:** one decision — whether net-new **credential** redaction is in scope for this feature. The factual precondition is already resolved: signal-token redaction exists (`signal-redactor.ts`); credential redaction does not. Recommended: generalize the existing signal-token redaction to all agents (in-scope), and declare credential redaction out of scope. If the user wants credential redaction in-scope, it must be specified with concrete redaction targets.

### Execution Steps

#### Step 1: Make NFR template structure explicit (4.4 Accessibility)
- **Files:** specs/agent-agnostic/rauf-agent-cli-adapters/PRD.md
- **Addresses:** V-002
- **Checklist:** CHECK-P01
- **Action:** Insert "### 4.4 Accessibility — Not applicable: rauf is a headless loop runner with no interactive UI surface in scope." between §4.3 and §4.5. Leave §4.5 numbering as-is.
- **Depends on:** none
- **Rationale:** Pure structural clarity; no dependency.

#### Step 2: Tighten Success-Criteria ↔ REQ traceability
- **Files:** specs/agent-agnostic/rauf-agent-cli-adapters/PRD.md §8
- **Addresses:** V-001
- **Checklist:** CHECK-P05, CHECK-P08
- **Action:** Append a parenthetical REQ list to each of SC-1..SC-6. Extend SC-1 to assert plain-text mock agents complete with telemetry gracefully absent and no error raised (verifies REQ-OBS-02).
- **Depends on:** none
- **Rationale:** Documentation traceability; independent of other steps.

#### Step 3: Resolve REQ-SEC-02 signal-vs-credential redaction
- **Files:** specs/agent-agnostic/rauf-agent-cli-adapters/PRD.md §4.2 (and optionally §3.4 / §6)
- **Addresses:** V-003
- **Checklist:** CHECK-P12, CHECK-P14
- **Action:** Per the user decision: split REQ-SEC-02 into (a) a generalized signal-token-redaction requirement applied to all agents' output (cross-referencing REQ-SIG), and (b) an explicit statement that rauf performs no credential redaction today — reclassified to §6 Out of Scope unless the user opts it in with concrete targets.
- **Depends on:** User decision (credential redaction in/out of scope)
- **Rationale:** The only finding needing a decision; fixing it sharpens a real security-posture ambiguity before the tech spec consumes it.

#### Step 4: Normalize Constraints modality
- **Files:** specs/agent-agnostic/rauf-agent-cli-adapters/PRD.md §5
- **Addresses:** V-004
- **Checklist:** CHECK-P13
- **Action:** Rephrase the repo-scope constraint bullet to a MUST-level mandate naming the sibling features that own cross-repo wiring.
- **Depends on:** none
- **Rationale:** Aligns one bullet with the section's mandate phrasing.

---

Executed 15 of 15 checks. Results: 12 pass, 3 soft-fail, 0 n/a.
