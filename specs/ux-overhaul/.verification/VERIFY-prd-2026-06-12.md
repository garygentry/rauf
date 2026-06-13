# Verification Report: ux-overhaul (prd)
Date: 2026-06-12
Pipeline Stage: forge-2-tech (forge-1-prd complete)
Artifacts Reviewed: specs/ux-overhaul/PRD.md, specs/ux-overhaul/CANON.md, specs/ux-overhaul/.pipeline-state.json; cross-checked against packages/core, packages/loop, packages/cli, packages/web, artifacts/variants/backlog-json/

## Summary
- Total findings: 6
- Gaps: 1
- Inconsistencies: 2
- Improvements: 1
- Errors: 2

Check tally: Executed 15 of 15 prd-mode checks. Results: **11 pass, 4 fail, 0 n/a** (failures: CHECK-P09, CHECK-P15 directly; CHECK-P08/P14 via the two factual errors and the missing canon item).

Both `error`-severity findings (V-001, V-002) were independently re-verified against the codebase by the parent session:
- `artifacts/variants/backlog-json/.rauf/RAUF.md.tmpl:32` — `7. Commit with: \`[rauf] <id>: <title>\`` — **confirmed** (RAUF.md.tmpl is a third commit-instructing locus the PRD omits).
- `packages/core/src/schemas.ts` `LoopEventSchema` discriminated union — **confirmed 24 members**, not 26.

Scope-discipline against CANON Phase 1 is otherwise strong: no Phase 2/3/4 work leaked into requirements; the only scope gap is the silently-dropped signal-placement reconciliation (V-004).

## Findings

### V-001: PRD claims RAUF.md forbids committing, but the shipped RAUF.md template instructs the agent TO commit
- **Severity:** error
- **Location:** PRD.md §1 Problem Statement (4th bullet: "while `RAUF.md` forbids it"), §2 (Agent-author story: "stated identically everywhere"), §3.6 REQ-COMMIT-02, §8 SC-5
- **Issue:** The PRD's commit-rule premise rests on the claim that `RAUF.md` already forbids the agent from committing and only the *templates* contradict it. That is false for the shipped artifact. `artifacts/variants/backlog-json/.rauf/RAUF.md.tmpl:32` says `7. Commit with: \`[rauf] <id>: <title>\``. So RAUF.md.tmpl is a **third** locus telling the agent to commit — not the source of truth the PRD treats it as. REQ-COMMIT-02 enumerates "at minimum the two artifact templates (`CLAUDE_ADDON.md`, `CLAUDE_GREENFIELD.md.tmpl`) and the runner's prompt-builder reminder" but omits `RAUF.md.tmpl` entirely. SC-5 says the rule should "read identically across `RAUF.md`, both artifact templates, and the prompt-builder" — implying RAUF.md is already correct, when it currently carries the wrong rule. (The repo-root self-hosting `.rauf/RAUF.md` and the project CLAUDE.md *do* forbid committing — but those are not the installed artifacts this PRD is about. CANON.md §2.7/§4.6 share the same blind spot, citing only `CLAUDE_ADDON.md:21`.)
- **Suggested fix:** (1) Correct §1's 4th bullet to: the templates AND the installed `RAUF.md` template instruct the agent to commit, contradicting the runner-owns-commit behavior the runner actually enforces. (2) Add `artifacts/variants/backlog-json/.rauf/RAUF.md.tmpl` (line 32) to REQ-COMMIT-02's enumerated loci. (3) Reword SC-5 so RAUF.md.tmpl is one of the loci being *fixed*, not the reference of truth — state the canonical rule explicitly ("agent never commits; runner owns the commit") rather than "matches RAUF.md."
- **References:** artifacts/variants/backlog-json/.rauf/RAUF.md.tmpl:32, CLAUDE_ADDON.md:21, CLAUDE_GREENFIELD.md.tmpl:47; CANON.md §2.7, §4.6; packages/loop/src/prompt-builder.ts
- **Checklist:** CHECK-P08, CHECK-P14, CHECK-P15

### V-002: "26 LoopEvent types" is factually wrong — the union has 24 members
- **Severity:** error
- **Location:** PRD.md §1 Problem Statement, first sentence ("26 `LoopEvent` types")
- **Issue:** The `LoopEventSchema` discriminated union in `packages/core/src/schemas.ts` has **24** members (verified by counting the union). No doc sources the figure "26." The number is load-bearing context for REQ-EVT-02 (which events must be representable / coalesced); an inflated count could mislead the tech spec into expecting types that don't exist.
- **Suggested fix:** Change "26 `LoopEvent` types" to "24 `LoopEvent` types," or drop the exact count in favor of "the full `LoopEvent` union (see `packages/core/src/schemas.ts`)" so it can't drift.
- **References:** packages/core/src/schemas.ts (LoopEventSchema discriminated union); packages/loop/src/runner.ts (emitEvent call sites)
- **Checklist:** CHECK-P08, CHECK-P14

### V-003: REQ-COMMIT-02 mis-describes the prompt-builder — there is no commit reminder to "correct"
- **Severity:** inconsistency
- **Location:** PRD.md §3.6 REQ-COMMIT-02 ("and the runner's prompt-builder reminder — so they match `RAUF.md`")
- **Issue:** REQ-COMMIT-02 says the contradicting "Commit your changes" instruction must be corrected in the "runner's prompt-builder reminder." But `packages/loop/src/prompt-builder.ts` contains no commit instruction — it covers signal ownership and "do NOT modify backlog.json/state.json," nothing about who commits. There is nothing to *correct*; the actual work is to *add* a positive "you never commit; the runner commits" reminder. Phrasing it as a correction will lead the tech spec/backlog to hunt for a string that isn't there.
- **Suggested fix:** Reword REQ-COMMIT-02 to distinguish two actions: (a) **remove/replace** the "Commit…" line in the three templates (CLAUDE_ADDON.md, CLAUDE_GREENFIELD.md.tmpl, RAUF.md.tmpl); (b) **add** an explicit no-commit reminder to the prompt-builder, since it currently states no commit rule.
- **References:** packages/loop/src/prompt-builder.ts; see V-001 for the template loci
- **Checklist:** CHECK-P08, CHECK-P14

### V-004: Canon's signal-placement/template reconciliation is silently dropped, not noted as deferred
- **Severity:** gap
- **Location:** PRD.md §6 Out of Scope (vs CANON.md §4.5 and the Phase 1 row of §5's table)
- **Issue:** CANON.md §5's Phase 1 row scopes Phase 1 as "§4.2, §4.1-monitoring, §4.6-commit, P1/P4." The PRD faithfully covers those. However, CANON §4.6 (agent contract) bundles the commit rule together with the **signal-placement doc reconciliation** ("final line" vs the parser's backward scan), and §4.5 lists that reconciliation. The PRD §6 explicitly defers the `signal_parsed review→done` fix and "formal versioning" to Phase 3 — but never mentions the **signal-placement / "final line" wording reconciliation**, which CANON groups with the agent-contract/commit work, not with versioning. A reader cannot tell whether it was deliberately deferred or overlooked. This matters because the commit-rule fix touches the very templates where the "final line" wording lives (RAUF.md.tmpl:33-36 says "output your exit signal"; CLAUDE.md says "output `RAUF_DONE` as your final line").
- **Suggested fix:** Add one bullet to §6 explicitly deferring the signal-placement doc reconciliation to Phase 3 (matching the §4.5 grouping), OR — if it should ride along with the commit-rule template edits in Phase 1 — add it as a requirement under §3.6. Either way, make the decision explicit so it isn't lost between phases.
- **References:** CANON.md §4.5, §4.6, §5 (Phase 1/Phase 3 rows); artifacts/variants/backlog-json/.rauf/RAUF.md.tmpl:33-36
- **Checklist:** CHECK-P03, CHECK-P14

### V-005: Single-writer requirement (REQ-EVT-06) vs registry concurrency (REQ-DISC-04) tension is unstated
- **Severity:** inconsistency
- **Location:** PRD.md §3.1 REQ-EVT-06 vs §3.4 REQ-DISC-03/04
- **Issue:** REQ-EVT-06 asserts "a **single writer** (the loop runner) per backlog root" for `events.ndjson`. REQ-DISC-03/04 require a **central** active-loop registry under `~/.rauf/` that **multiple** loops write to concurrently (register on start, deregister on exit) and multiple readers query. These are two different durability models for two different files, but the PRD never says so — a reader could conflate "single writer" as a global invariant and be surprised the registry is explicitly multi-writer. REQ-DISC-04 demands the registry be "concurrency-safe … without corruption" but gives no hint how (atomic index vs per-loop entry files), and OQ-1 leaves the shape fully open. The tension (single-writer-per-file simplicity vs multi-writer-registry correctness) is real and currently invisible.
- **Suggested fix:** Add a one-line note to REQ-EVT-06 or REQ-DISC-04 clarifying scope: "single-writer applies per-root to `events.ndjson`; the active-loop registry is a distinct, intentionally multi-writer surface whose concurrency-safety mechanism is a tech-spec decision (OQ-1)." Makes the boundary explicit without pre-deciding storage shape.
- **References:** PRD.md §3.1 REQ-EVT-06, §3.4 REQ-DISC-03/04, §7 OQ-1; C-3 (lock is ground truth)
- **Checklist:** CHECK-P15, CHECK-P14

### V-006: REQ-PERF-02 embeds an implementation choice (`fs.watch`) without a constraint label
- **Severity:** improvement
- **Location:** PRD.md §4.1 REQ-PERF-02, Notes ("prefer push/tail (`fs.watch`, already used for `rauf.log`) over fixed polling")
- **Issue:** CHECK-P09 wants requirements free of specific implementation choices unless labeled as justified constraints. REQ-PERF-02 names `fs.watch` directly. It IS hedged ("Implementation *guidance* (not mandate)"), so this is minor, but the guidance sits inside a requirement rather than a constraint and could read as binding. The "already used for `rauf.log`" justification is good and worth keeping.
- **Suggested fix:** Leave the guidance (useful and correctly hedged), but consider moving the `fs.watch` mention into §5 Constraints as a soft preference, or prefix the note with "Non-binding tech-spec hint:". No functional change needed; polish item.
- **References:** PRD.md §4.1 REQ-PERF-02; existing `rauf.log` follow implementation in packages/cli
- **Checklist:** CHECK-P09

## Fix Execution Plan

### User Decisions Required
- **V-004 — RESOLVED (2026-06-12): Defer to Phase 3.** Per CANON §4.5's grouping with formal versioning, the signal-placement / "final line" doc reconciliation is deferred to Phase 3. Apply via Step 4 by adding a §6 Out-of-Scope bullet (NOT a §3.6 requirement).

### Execution Steps

Apply in order. Each step is self-contained — a fresh agent can execute it without prior context beyond this document.

#### Step 1: Correct the commit-rule factual errors (V-001, V-003)
- **Files:** specs/ux-overhaul/PRD.md (§1 4th bullet, §3.6 REQ-COMMIT-02, §8 SC-5)
- **Addresses:** V-001, V-003
- **Checklist:** CHECK-P08, CHECK-P14, CHECK-P15
- **Action:** (a) Rewrite §1's 4th bullet so it states the templates **and the installed `RAUF.md` template** instruct committing, contradicting the runner-owns-commit behavior. (b) In REQ-COMMIT-02, add `artifacts/variants/backlog-json/.rauf/RAUF.md.tmpl` (line 32) to the enumerated loci, and split the action into "remove the Commit line from the three templates" vs "add a no-commit reminder to the prompt-builder (which currently has none)." (c) In SC-5, replace "reads identically across `RAUF.md`…" with an explicit canonical rule string and list RAUF.md.tmpl among the loci being fixed rather than the source of truth.
- **Depends on:** none
- **Rationale:** All three edits concern one factual cluster (the commit rule) and touch overlapping sentences; doing them together avoids re-contradiction.

#### Step 2: Fix the LoopEvent count (V-002)
- **Files:** specs/ux-overhaul/PRD.md (§1 first sentence)
- **Addresses:** V-002
- **Checklist:** CHECK-P08
- **Action:** Change "26 `LoopEvent` types" → "24 `LoopEvent` types" (or remove the literal count, referencing `packages/core/src/schemas.ts` `LoopEventSchema`).
- **Depends on:** none

#### Step 3: Make the single-writer vs registry-concurrency boundary explicit (V-005)
- **Files:** specs/ux-overhaul/PRD.md (§3.1 REQ-EVT-06 or §3.4 REQ-DISC-04)
- **Addresses:** V-005
- **Checklist:** CHECK-P15
- **Action:** Add a sentence clarifying that single-writer applies per-root to `events.ndjson`, while the active-loop registry is an intentionally multi-writer surface whose concurrency mechanism is a tech-spec decision (OQ-1).
- **Depends on:** none

#### Step 4: Resolve the signal-placement scope decision (V-004)
- **Files:** specs/ux-overhaul/PRD.md (§6, or new bullet under §3.6)
- **Addresses:** V-004
- **Checklist:** CHECK-P03, CHECK-P14
- **Action:** Per the user decision above, either add a §6 bullet deferring signal-placement reconciliation to Phase 3, or add a requirement under §3.6 to fix the template wording in Phase 1.
- **Depends on:** User decision
- **Rationale:** Requires a scoping call, so isolated from the mechanical fixes.

#### Step 5: Soften the fs.watch implementation hint (V-006)
- **Files:** specs/ux-overhaul/PRD.md (§4.1 REQ-PERF-02 Notes)
- **Addresses:** V-006
- **Checklist:** CHECK-P09
- **Action:** Prefix the `fs.watch` note with "Non-binding tech-spec hint:" or relocate to §5 Constraints as a soft preference. Optional polish.
- **Depends on:** none

## Fix Progress

- Step 1: [APPLIED] 2026-06-12 — Corrected commit-rule loci: §1 4th bullet now names the installed RAUF.md template as a commit-instructing locus; REQ-COMMIT-02 split into (a) remove from three templates incl. RAUF.md.tmpl, (b) add no-commit reminder to prompt-builder; SC-5 states canonical rule explicitly and lists RAUF.md.tmpl among loci being fixed. (V-001, V-003)
- Step 2: [APPLIED] 2026-06-12 — §1 "26 LoopEvent types" → "24". (V-002)
- Step 3: [APPLIED] 2026-06-12 — REQ-EVT-06 note added clarifying single-writer is per-root for events.ndjson; registry is intentionally multi-writer (OQ-1). (V-005)
- Step 4: [APPLIED] 2026-06-12 — User decision: defer to Phase 3. Note: §6 already listed signal-placement reconciliation (bundled with the versioning bullet); split it into its own explicit §6 bullet clarifying it is deferred to Phase 3 despite Phase 1 touching the same templates. (V-004)
- Step 5: [APPLIED] 2026-06-12 — REQ-PERF-02 fs.watch note re-labeled "Non-binding tech-spec hint". (V-006)
