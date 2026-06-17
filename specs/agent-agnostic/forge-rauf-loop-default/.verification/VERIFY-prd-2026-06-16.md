# Verification Report: forge-rauf-loop-default (prd)

- **Date:** 2026-06-16
- **Pipeline Stage:** forge-verify-prd
- **Epic:** agent-agnostic (this feature is an epic member)
- **Artifacts Reviewed:**
  - `specs/agent-agnostic/forge-rauf-loop-default/PRD.md`
  - `specs/agent-agnostic/epic-manifest.json` (contract cross-reference)
  - Factual-premise sources (read-only): feature-forge `skills/forge-5-loop/SKILL.md`, rauf `version.ts`
- **Checks Executed:** 15 of 15 (11 pass, 4 fail, 0 not-applicable)
- **Verifier dispatch:** single `forge-verifier` (prd is a small ~15-check mode)

## Summary

- **Total findings:** 4
- **Gaps:** 1 (V-001)
- **Inconsistencies:** 0
- **Improvements:** 3 (V-002, V-003, V-004)
- **Errors:** 0

**Contract cross-reference is clean.** The member's `dependsOn`
(`rauf-agent-cli-adapters`, `cross-agent-installer`), `exposes`
(`forge-loop-runner-contract`), and `consumes` (`loop-agent-selection`,
`cross-agent-installer-cli`) in `epic-manifest.json` match the PRD verbatim
(top matter, §3.1 REQ-DEF-03, §3.2, §3.6, CON-02/03). No drift.

**Factual premises verified.** forge-5-loop currently floors
`loopRunner.minRunnerVersion` at `0.5.0` (`skills/forge-5-loop/SKILL.md:87`),
the optional-flags catalog stops at `--review/--model/--timeout/--retry-blocked`
with no `--agent` (`SKILL.md:165-166`), and the `rauf@0.6.0` pin matches rauf's
`version.ts`. The Problem Statement (§1) and REQ-BIN-02 rest on accurate ground.

**Intentionally-open items respected.** OQ-01 (confirm the rauf version that
first shipped `--agent`) and OQ-02 (project-default agent as a dedicated field
vs. tokenized config) are legitimate tech-spec mechanism questions and are NOT
flagged as gaps.

## Findings

### V-001: Unknown / typo agent-id behavior is unspecified

- **Severity:** gap
- **Location:** PRD.md § 3.4 (REQ-AVAIL-01/02), § 4.2 (REQ-SEC-01) — the seam between them
- **Checklist:** CHECK-P14, CHECK-P08
- **What's wrong:** The PRD specifies two adjacent-but-distinct agent-id failure modes and leaves a third uncovered:
  - REQ-SEC-01 says the selector value "MUST be constrained to the runner's known agent ids (no arbitrary string interpolated into a shell command…)" — this states the *constraint* but no *behavior when the constraint is violated* (i.e., what forge does when the user passes an id that is not a known rauf agent id at all, e.g. a typo `--agent codx` or a wholly unknown `--agent foo`).
  - REQ-AVAIL-01/02 cover a *known* agent that is *unavailable* — a recognized agent id whose CLI the `agents` probe reports as not installed. REQ-AVAIL-02's "warn… proceed anyway or choose a different agent" is explicitly the unavailable-but-known path, not the unknown-id path.
  - REQ-AGENT-04 only lists available agents informationally; it does not define rejection of an off-list value.

  So a user who supplies an unrecognized/typo agent id falls through every requirement: it is not "unavailable" (REQ-AVAIL handles known-but-missing), and REQ-SEC-01 forbids interpolating it but does not say whether forge hard-rejects, warns-and-lists-valid-ids, or defers entirely to rauf's own validation. This is a user-facing policy decision, not a mechanism detail, so it belongs in the PRD.
- **Suggested fix:** Add a requirement (suggest **REQ-AVAIL-04** in §3.4, or **REQ-SEC-02** in §4.2) defining the unknown-agent-id policy. Because two reasonable policies exist, this needs a user decision (see *User Decisions Required*): (a) **hard-reject** before launch with an error that lists the valid/known agent ids (consistent with REQ-SEC-01's "constrained to known ids" and REQ-BIN-04's pre-side-effect hard-gate posture), or (b) **delegate to rauf** — forge passes the id through and surfaces rauf's own validation error, keeping forge thin. Whichever is chosen, the requirement should state: where validation occurs (forge pre-check vs. rauf), the user-facing message (must name the valid ids if forge rejects), and that no unknown value is interpolated into the tokenized argument (tie back to REQ-SEC-01). State explicitly that this is distinct from REQ-AVAIL-02's known-but-unavailable path so the contract doc (REQ-DEF-03 / REQ-SEAM-01) can carry both. Add a matching SC clause so the policy is verifiable.
- **References:** PRD.md REQ-SEC-01, REQ-AVAIL-01, REQ-AVAIL-02, REQ-AGENT-04, REQ-BIN-04, REQ-DEF-03, REQ-SEAM-01

### V-002: SC-02 uses unmeasurable "observably honored" without a stated observation point

- **Severity:** improvement
- **Location:** PRD.md § 8, SC-02
- **Checklist:** CHECK-P05
- **What's wrong:** SC-02 reads: "A user can select a non-default agent per run and via a project default, with the documented precedence (item > run > project > default) **observably honored** (REQ-AGENT-01/02, REQ-PREC-01/02)." The phrase "observably honored" names no concrete observation surface, so it is not directly verifiable. REQ-OBS-01 *does* define the observation surface (the selected agent and its source layer must appear "in the pre-launch confirmation and the 'loop started' inform-user output"), but SC-02 does not reference REQ-OBS-01 and the link is left implicit. A fresh agent writing the acceptance test cannot tell from SC-02 alone where to read precedence resolution to confirm it.
- **Suggested fix:** Tighten SC-02 to name the observation surface and add the REQ-OBS-01 reference, e.g.: "…with the documented precedence (item > run > project > default) honored, **verifiable because the resolved agent and its source layer are shown in the pre-launch confirmation and the 'loop started' output** (REQ-AGENT-01/02, REQ-PREC-01/02, **REQ-OBS-01**)." This makes the criterion measurable (read the confirmation/started output for the expected agent+layer) and matches how SC-07's mock-runner test would assert precedence.
- **References:** PRD.md REQ-OBS-01, REQ-PREC-01/02, SC-07

### V-003: REQ-PERF-02 / REQ-AGENT-04 lack a measurable bound and SC hook

- **Severity:** improvement
- **Location:** PRD.md § 3.2 (REQ-AGENT-04 Notes), § 4.1 (REQ-PERF-02); surfaces in § 8 via SC-03/SC-07
- **Checklist:** CHECK-P05, CHECK-P11
- **What's wrong:** REQ-PERF-02 requires the availability pre-check be "a single, bounded one-shot probe that does not materially delay launch" — "materially delay" is unquantified, so no SC can objectively pass/fail it (CHECK-P11). Relatedly, REQ-AGENT-04's listing is "informational at confirm time," but no success criterion verifies the available-agents list is actually shown: SC-03 only covers the *unavailable selected* agent warning path, not the *list available agents* behavior of REQ-AGENT-04. The result is two P1 behaviors (REQ-AGENT-04 listing, REQ-PERF-02 bound) with no measurable success-criterion hook.
- **Suggested fix:** Two small tightenings: (1) For REQ-PERF-02, replace "does not materially delay launch" with a concrete bound, e.g. "completes within a single bounded probe invocation (one `rauf agents` call, no retries) so launch is not delayed beyond that one probe." (2) Extend SC-03 (or add a short SC) to cover REQ-AGENT-04, e.g. amend SC-03 to "…the pre-launch confirmation **also lists the available agents** so the user can choose another (REQ-AGENT-01/02, REQ-AVAIL-01/02, **REQ-AGENT-04**)." This gives both P1 behaviors a verifiable anchor.
- **References:** PRD.md REQ-AGENT-04, REQ-PERF-02, REQ-AVAIL-01/02, SC-03, SC-07

### V-004: User stories omit an actor for runner discovery / version-gate failure (§3.6)

- **Severity:** improvement
- **Location:** PRD.md § 2 (User Stories) vs § 3.6 (REQ-BIN-01..04)
- **Checklist:** CHECK-P10
- **What's wrong:** Section 3.6 (REQ-BIN-01..04) defines substantial user-facing behavior — locating the installer-provisioned rauf, flooring the version gate at the agent-capable rauf, and failing "with a clear, actionable message (which install path to run), before any loop side-effects." This is the experience of a user whose rauf is missing/too-old or whose multi-agent install hasn't run. No user story in § 2 speaks for that actor; the seven stories cover default-claude use, non-claude selection, project default, availability warning, alternate-runner operator, backlog author, and the capstone maintainer — but none expresses "as a forge user with a missing/outdated rauf, I want a clear instruction on which installer to run before the loop touches anything." CHECK-P10 asks that user stories cover all identified actors; the discovery/version-coherence actor is identified by §3.6 yet has no story, so the most-actionable error path in the PRD has no narrative driver.
- **Suggested fix:** Add one user story to § 2, e.g.: "**As a forge user whose rauf is missing or too old for agent selection**, I want forge to fail the version gate before any loop side-effects with a message telling me exactly which install path to run (the cross-agent installer for a multi-agent setup, or the rauf CLI install/upgrade hint), so I can fix provisioning without a half-run." This gives REQ-BIN-02/03/04 (and SC-05) an actor and closes the §2↔§3.6 coverage gap.
- **References:** PRD.md REQ-BIN-01/02/03/04, SC-05, CON-03

## Fix Execution Plan

### User Decisions Required

- **V-001 (unknown-agent-id policy):** Pick the policy before the fix can be written — **(a) forge hard-rejects** an unknown agent id pre-launch with a message listing valid ids, or **(b) forge delegates** validation to rauf and surfaces rauf's error. This is a genuine product decision (thin-forge vs. fail-fast-in-forge) and cannot be defaulted safely. The other three findings (V-002/003/004) are wording/coverage tightenings and apply directly with no decision.
  - **RESOLVED 2026-06-17 → (a) hard-reject, list valid ids.** Forge validates the selected id against the set advertised by rauf's `agents` probe (already invoked by REQ-AGENT-04 / REQ-AVAIL-01) and aborts before any loop side-effects with an error enumerating the valid ids. Reuses the existing probe set — does not re-implement rauf's resolution (CON-02/CON-04). Distinct from REQ-AVAIL-02's known-but-unavailable warn/proceed path.

### Execution Steps

#### Step 1 — Add the unknown-agent-id requirement (V-001)

- **Files:** PRD.md § 3.4 (or § 4.2)
- **Checklist:** CHECK-P14, CHECK-P08
- **Action:** After the user picks policy (a) or (b), add a new requirement (REQ-AVAIL-04 in §3.4 or REQ-SEC-02 in §4.2, Priority P0) stating: the unknown/typo agent-id policy, where validation occurs, the user-facing message (must enumerate valid agent ids if forge rejects), and that no unknown value is interpolated into the tokenized argument (cross-ref REQ-SEC-01). Explicitly distinguish from REQ-AVAIL-02's known-but-unavailable path. Add a matching SC line so the policy is verifiable.
- **Depends on:** User decision (a/b)
- **Rationale:** Highest-severity finding and the only one needing a decision; isolating it lets the other three be applied immediately.

#### Step 2 — Tighten success-criteria measurability (V-002, V-003)

- **Files:** PRD.md § 8 (SC-02, SC-03), § 4.1 (REQ-PERF-02)
- **Checklist:** CHECK-P05, CHECK-P11
- **Action:** Edit SC-02 to name the observation surface and add the REQ-OBS-01 reference (V-002). Replace REQ-PERF-02's "does not materially delay launch" with a concrete bound (one `rauf agents` call, no retries) and extend SC-03 to cover REQ-AGENT-04's available-agents listing (V-003).
- **Depends on:** none
- **Rationale:** All three edits are in the success-criteria/NFR area and reference overlapping reqs (REQ-OBS-01, REQ-AGENT-04); grouping avoids re-touching § 8 twice.

#### Step 3 — Add the runner-discovery/version-gate user story (V-004)

- **Files:** PRD.md § 2
- **Checklist:** CHECK-P10
- **Action:** Add one user story for the actor with a missing/outdated rauf, mapping to REQ-BIN-02/03/04 and SC-05, as quoted in V-004's suggested fix.
- **Depends on:** none
- **Rationale:** Pure additive narrative coverage; independent of the other steps.

## Checklist Coverage

Executed 15 of 15 checks. Results: 11 pass, 4 fail, 0 n/a.

| Check | Result | Findings |
|-------|--------|----------|
| CHECK-P01 | pass | |
| CHECK-P02 | pass | |
| CHECK-P03 | pass | |
| CHECK-P04 | pass | |
| CHECK-P05 | fail | V-002, V-003 |
| CHECK-P06 | pass | |
| CHECK-P07 | pass | |
| CHECK-P08 | pass | (V-001 secondary) |
| CHECK-P09 | pass | |
| CHECK-P10 | fail | V-004 |
| CHECK-P11 | fail | V-003 |
| CHECK-P12 | pass | |
| CHECK-P13 | pass | |
| CHECK-P14 | fail | V-001 |
| CHECK-P15 | pass | |

## Fix Progress

- Step 1: [APPLIED] 2026-06-17 — V-001 resolved (hard-reject). Added REQ-AVAIL-04 (P0) to §3.4, cross-referenced from REQ-SEC-01 Notes, and added SC-08.
- Step 2: [APPLIED] 2026-06-17 — V-002/V-003. SC-02 now names the observation surface + REQ-OBS-01; SC-03 now covers REQ-AGENT-04 available-agents listing; REQ-PERF-02 bounded to "one `rauf agents` call, no retries".
- Step 3: [APPLIED] 2026-06-17 — V-004. Added §2 user story for the missing/too-old-rauf actor (maps REQ-BIN-02/03/04, SC-05).
