---
name: loop-observability-facts
description: Verified ground truth for the loop-observability PRD (prd mode) — clean PRD, one priority gap, CANON fidelity map
metadata:
  type: project
---

Loop-observability feature = "prescription + rendering on an already-sound data model" (v0.6.0 UX/DX overhaul substrate), NOT a new data model. Enabling change is folding a `health` block ({stuckWarning, iterationFresh}) into DerivedStatus / `status --json` so one poll answers done/needs-human/recoverable-stall/healthy.

**Why:** so a future prd/tech/specs verify of this feature starts from fact, not re-derivation.

**How to apply:**
- PRD.md has 36 unique category-prefixed REQ IDs (validator confirms; zero orphaned refs). validate-traceability.py's "36 uncovered" is EXPECTED at prd stage (no ##-*.md specs yet) — NOT a finding.
- Only real prd-mode finding (V-001): §9 REQ-SUCCESS-01..06 carry NO Priority line while all 30 §3/§4 reqs do. CHECK-P07 gap. Don't re-flag if already fixed to P0.
- Do NOT flag §8 Q1–Q4 (intentionally-open) as gaps. Do NOT flag the concrete field/flag/fn names (health/stuckWarning/deriveStatus/--all/--verbose) as leaked tech (CHECK-P09) — field shape is deferred to forge-2-tech via REQ-CONTRACT-03+Q1; flags are the CLI product surface; infra mandates correctly quarantined in §5 Constraints.
- CANON→PRD map: Gap1→REQ-PRESCRIBE-01/SKILL-01; Gap2→PRESCRIBE-01/06; Gap3→CONTRACT-03/SUCCESS-01. Decisions D1→CMD-02, D2→SCOPE-03, D3→PRESCRIBE-03, D4→CONTRACT-03, D5→SCOPE-01, D6→PRESCRIBE-06.
- Keystone: REQ-SUCCESS-01 / REQ-CONTRACT-01 — one poll = full decision, zero raw-file reads; drive-rauf-loop owns the contract in the rauf repo; forge-5-loop defers decision semantics (feature-forge-side edit is cross-repo follow-up, Q3).

**Tech mode (verified against source):**
- CORRECT file:line: status.ts:365 deriveStatus, :36 ITERATION_STATUS_FRESH_MS, :143 isLoopLive; schemas.ts:249 BacklogSummarySchema, :279 DerivedStatusSchema, :591 LoopEventSchema (exactly 24 variants), :656 ActiveLoopEntrySchema, :680 EVENTS_SCHEMA_VERSION, :710 IterationStatusSchema (has stuckWarning+lastActivityAt+updatedAt); backlog-root.ts:94 resolveBacklogRoot; loop-registry.ts:129 listActiveLoops; event-format.ts:43 formatEvent; formatter.ts:33 detectColorSupport, :113 outputJson; follow-command.ts:52 handleFollow + setInterval poll ~:130.
- WRONG file:line: tech-spec §6 point 10 + §3.4 cite "handleFollow at status-commands.ts:225" — NO handleFollow in status-commands.ts (it's in follow-command.ts; :225 is handleStatusAll). "handleStatusFollow status-commands.ts:471" is actually :439. handleStatus IS at :44 (correct).
- BIG GOTCHA (REQ-PERF-01 zero-I/O claim FALSE in common path): tech-spec §1 decision 3 + §3.1 + §6 pts 1/2 assert deriveStatus "already reads iteration-status.json via isLoopLive" so health adds zero new I/O. NOT TRUE: isLoopLive (status.ts:143) runs ONLY inside deriveFromStateJson's staleness-downgrade branch (status.ts:179) — only when status running/starting AND updatedAt stale; and checkLock short-circuits before readIterationStatus even there. Common healthy-RUNNING path never calls readIterationStatus. Unconditional health DOES add a read. Spec §6 WARNING + §10 OTQ-1 half-acknowledge but keep the false zero-I/O premise.
- Additive-only (REQ-CONTRACT-05/COMPAT-01) claim is TRUE: health + statusSchemaVersion are pure additions to DerivedStatusSchema; renames/removes nothing. C-01 (core zero cli/web imports) preserved: eventAltitude/resolveTarget are pure core fns.
- Tech-mode findings: V-001 perf-claim overclaim (biggest), V-002/003 stale line refs, plus minor CHECK-T09 (health enum "rejected" cited but resolveTarget-home + version-scheme alternatives thin) and CHECK-T14 (no config-approach section — N=3/interval are prescriptions not runtime config; defensible).
