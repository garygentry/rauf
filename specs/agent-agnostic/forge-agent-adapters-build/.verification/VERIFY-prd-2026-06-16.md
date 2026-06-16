# Verification Report: forge-agent-adapters-build (prd)
Date: 2026-06-16
Pipeline Stage: forge-2-tech (PRD complete, pre-tech-spec)
Artifacts Reviewed:
- `specs/agent-agnostic/forge-agent-adapters-build/PRD.md`
- `specs/agent-agnostic/forge-agent-adapters-build/HANDOFF.md` (context)
- `specs/agent-agnostic/epic-manifest.json` (contract cross-check)
- Canon cross-checked in target repo: `feature-forge/scripts/check-spec-purity.py`, `feature-forge/agents/`, `feature-forge/references/`

## Summary
- Total findings: 3
- Gaps: 2
- Inconsistencies: 1
- Improvements: 0
- Errors: 0

Checks executed: 15 of 15 (12 pass, 3 fail, 0 n/a). The cross-repo verify command
(`bash scripts/validate.sh` in feature-forge, not rauf's `pnpm gate`) is correctly
documented (PRD §5 C-1/C-2 + REQ-CI-04) and was **not** flagged. §6 Out-of-Scope
correctly cedes installer / README / broader-CI scope to downstream members
(`cross-agent-installer`, `packaging-docs-ci`); `AGENTS.md` is legitimately in scope per
EPIC.md and the manifest. Upstream `forge-skill-spec-purity` deliverables
(`check-spec-purity.py`, `scripts/forge-root.sh`) were confirmed present in feature-forge.

## Findings

### V-001: Generator input set omits the canonical `agents/` surface
- **Severity:** gap
- **Location:** `PRD.md`, §3.1 REQ-GEN-01 and REQ-GEN-06
- **Issue:** REQ-GEN-01 scopes the generator walk to "every canonical skill under `skills/`" only, and REQ-GEN-06 names a single example sub-agent (`agents/forge-verifier.md`). The actual canon in feature-forge has **three** first-class sub-agent definitions under `agents/`: `forge-researcher.md`, `forge-spec-writer.md`, `forge-verifier.md`. `agents/` is a first-class canonical surface in `check-spec-purity.py`'s `CANONICAL_SURFACES` (alongside `skills/` and `references/`). As written, the requirement set describes walking only `skills/`, so the generator could legitimately emit adapters that drop two of the three sub-agents with no requirement violated — silent loss of canonical constructs.
- **Suggested fix:** Amend REQ-GEN-01 so the generator's input set explicitly includes the `agents/` surface (not just `skills/`), e.g. "walks every canonical skill under `skills/` **and every sub-agent definition under `agents/`**". In REQ-GEN-06, change the parenthetical from a single example to "all canonical sub-agent definitions under `agents/` (currently `forge-researcher.md`, `forge-spec-writer.md`, `forge-verifier.md`)" so completeness is unambiguous, while keeping the per-agent translate-or-record behavior (REQ-OBS-01) intact. Defer exact per-agent target form to forge-2-tech (already gestured at in REQ-FMT-01).
- **References:** `feature-forge/scripts/check-spec-purity.py` (`CANONICAL_SURFACES`); `feature-forge/agents/` (three files); PRD REQ-FMT-01, REQ-OBS-01.
- **Checklist:** CHECK-P02 (completeness of functional requirements), CHECK-P07 (requirement testability/specificity)

### V-002: Self-containment closure (`references/` dependencies) is underspecified
- **Severity:** gap
- **Location:** `PRD.md`, §3.1 REQ-GEN-04
- **Issue:** REQ-GEN-04 requires each per-agent bundle to be self-contained and names only `shared-conventions.md` as the example shared reference. The repo-root `references/` tree in feature-forge contains ~10 files plus a `stacks/` subtree, several of them load-bearing for skills at runtime (e.g. `portable-root.md`, `stack-resolution.md`, and schema JSON files). The PRD never defines what "any shared references the skill depends on" resolves to — the dependency closure is left undefined, so a generator could satisfy the letter of REQ-GEN-04 while shipping a bundle that breaks when a skill reaches for an un-copied reference.
- **Suggested fix:** Tighten REQ-GEN-04 to require the generator to include the **transitive closure** of references each skill depends on, and add a Note (mirroring the REQ-GEN-04 Note style) listing the candidate shared-reference set actually present in canon (`references/*.md` + `references/stacks/` + schema JSONs) so the tech spec has a concrete inventory to map. Make explicit whether the closure is computed (parse skill bodies for `references/...` mentions) or whole-tree-copied; flag the choice for forge-2-tech but require that the result is runnable without reaching back into canon (consistent with REQ-GEN-04's existing self-containment intent).
- **References:** `feature-forge/references/` (10 files + `stacks/`); PRD REQ-GEN-04 (self-containment), REQ-DET-02 (full regenerate).
- **Checklist:** CHECK-P02, CHECK-P07

### V-003: Agent-target count diverges from the epic manifest contract summary
- **Severity:** inconsistency
- **Location:** `PRD.md` §3.1 REQ-GEN-03 / §8 Success Criteria vs. `epic-manifest.json` `forge-agent-adapters-build.exposes[build-adapters].summary`
- **Issue:** The PRD generates **five** agents — Claude, Codex, Copilot, Cursor, Gemini (REQ-GEN-03, with REQ-VND-01/02 making the Claude target explicit) — whereas the manifest's `build-adapters` contract summary lists only four: "per-agent artifacts (codex/copilot/cursor/gemini)". The PRD scope is the correct one (Claude is deliberately a generated target per REQ-GEN-03 Notes), so this is stale text in the **manifest**, not a PRD defect — but the divergence will read as contract drift to epic-mode verification (CHECK-E06) if left unreconciled.
- **Suggested fix:** Update the epic manifest entry `features[].exposes` for `build-adapters` summary to read "per-agent artifacts (claude/codex/copilot/cursor/gemini)" so it matches REQ-GEN-03. Do **not** change the PRD. (This is a one-line edit to `specs/agent-agnostic/epic-manifest.json`; bump `updatedAt` if the epic write-path requires it.) Leave a note so a later epic-mode verify does not re-flag it.
- **References:** `epic-manifest.json` line ~36 (`build-adapters` summary); PRD REQ-GEN-03, REQ-VND-01, §8 Success Criteria.
- **Checklist:** CHECK-P09 (consistency with epic/parent contracts), CHECK-P02

## Fix Execution Plan

### User Decisions Required
None — all three fixes can be applied directly. V-001 and V-002 are clarifying
amendments to the PRD that preserve existing intent; V-003 is a one-line manifest
correction. (forge-2-tech remains free to decide the exact per-agent on-disk forms and
the closure-computation mechanism; these fixes only fix the requirement set, not the
design.)

### Execution Steps

Apply in order. Each step is self-contained.

#### Step 1: Broaden the generator input set to include `agents/`
- **Files:** `specs/agent-agnostic/forge-agent-adapters-build/PRD.md`
- **Addresses:** V-001
- **Checklist:** CHECK-P02, CHECK-P07
- **Action:** In REQ-GEN-01, change "walks every canonical skill under `skills/`" to also cover the `agents/` surface (e.g. "...under `skills/` and every sub-agent definition under `agents/`"). In REQ-GEN-06, replace the single `forge-verifier.md` example with the full current set: "all canonical sub-agent definitions under `agents/` (currently `forge-researcher.md`, `forge-spec-writer.md`, `forge-verifier.md`)". Keep the translate-or-record behavior pointing at REQ-OBS-01.
- **Depends on:** none
- **Rationale:** Fixes the most material gap (silent drop of two of three sub-agents) and establishes the complete canonical input surface before the closure work in Step 2.

#### Step 2: Define the self-containment reference closure
- **Files:** `specs/agent-agnostic/forge-agent-adapters-build/PRD.md`
- **Addresses:** V-002
- **Checklist:** CHECK-P02, CHECK-P07
- **Action:** In REQ-GEN-04, require the **transitive closure** of references each skill (and now each `agents/` definition) depends on, and add a Note inventorying the canonical shared-reference set actually present (`references/*.md`, `references/stacks/`, schema JSONs). State that the closure-computation method (parse-and-collect vs. whole-tree copy) is a tech-spec decision, but the bundle MUST be runnable without reaching back into canon.
- **Depends on:** Step 1 (closure must cover both the `skills/` and `agents/` inputs broadened in Step 1)
- **Rationale:** Grouped with Step 1 because both edit §3.1 and both concern what the generator reads/copies; ordered second so the input surface is settled first.

#### Step 3: Reconcile the manifest contract summary to five agents
- **Files:** `specs/agent-agnostic/epic-manifest.json`
- **Addresses:** V-003
- **Checklist:** CHECK-P09, CHECK-P02
- **Action:** Edit the `forge-agent-adapters-build` → `exposes` → `build-adapters` `summary` to list five agents: "Generator deriving per-agent artifacts (claude/codex/copilot/cursor/gemini) from the canonical skills." Do not touch the PRD's agent count. Update the epic `updatedAt` only if the epic write-path requires it; this is metadata reconciliation, not a contract change.
- **Depends on:** none (independent of Steps 1–2)
- **Rationale:** Separate file, separate concern (epic contract metadata). Kept last so the PRD edits and the manifest edit don't interleave; prevents epic-mode CHECK-E06 from reading the divergence as real drift.

## Fix Progress

- Step 1: [APPLIED] 2026-06-16 — PRD REQ-GEN-01 now walks `skills/` **and** `agents/` (+Note citing `CANONICAL_SURFACES`); REQ-GEN-06 lists all three sub-agent definitions (`forge-researcher`, `forge-spec-writer`, `forge-verifier`) + completeness/scale Note. (V-001)
- Step 2: [APPLIED] 2026-06-16 — PRD REQ-GEN-04 now requires the **transitive closure** of shared references and inventories the real `references/` set (`*.md` incl. `portable-root.md`/`stack-resolution.md`, `references/stacks/`, schema JSONs); closure-computation method deferred to tech spec. (V-002)
- Step 3: [APPLIED] 2026-06-16 — epic-manifest.json `build-adapters` summary reconciled to five agents (claude/codex/copilot/cursor/gemini); PRD agent count unchanged. (V-003)
