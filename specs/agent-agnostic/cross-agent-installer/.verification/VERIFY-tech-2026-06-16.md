# Verification Report: cross-agent-installer (tech)

- **Date:** 2026-06-16
- **Feature:** cross-agent-installer (member of epic `agent-agnostic`)
- **Mode:** tech
- **Pipeline Stage:** forge-3-specs (verifying the just-completed forge-2-tech artifact)
- **Artifacts Reviewed:** PRD.md, tech-spec.md, epic-manifest.json, EPIC.md; cross-checked against the feature-forge tree (`scripts/validate.sh`, `scripts/forge-root.sh`, `adapters/`, `.gitignore`, `.claude-plugin/plugin.json`) and `rauf/packages/core/src/version.ts`
- **Checks Executed:** 17 of 17 (13 pass, 4 fail, 0 not-applicable)

## Summary

- **Total findings:** 4
- **Gaps:** 2
- **Inconsistencies:** 0
- **Improvements:** 1
- **Errors:** 1

This is a high-quality tech spec. Every load-bearing source claim that was checkable verified accurate (validate.sh = 204 lines with step 7 as the last numbered step; forge-root.sh `is_root()` requires both sentinels; adapter bundles carry 11 skills + forge-root.sh but no `epic-manifest.py`/`plugin.json`; gemini-extension.json = 4631 B; rauf VERSION = 0.6.0). The decision map (D1–D9) is well-structured, alternatives are considered (CHECK-T09 ✓), error handling is complete (CHECK-T10 ✓), and the testing approach maps every requirement cluster (CHECK-T11 ✓). The pre-flagged V-001 (epic-manifest `consumes` mismodeling) is correctly carried forward, not re-litigated.

## Findings

### V-001: Manifest field `featureForgeVersion` sourced from data that is absent in the consumed bundle

- **Severity:** gap
- **Location:** tech-spec.md §4 (Data Model), `InstallManifest.featureForgeVersion`
- **Issue:** The data model declares `featureForgeVersion: string; // from the bundle (plugin.json / version header)`. But the consumed `adapters/{agent}/` bundles contain **no** `.claude-plugin/plugin.json` (verified: `find adapters -name plugin.json` returns nothing — same root cause as IR-1), and the bundled `SKILL.md` files carry **no** version header either. So the documented source for this field does not exist in the read-only input the installer is allowed to consume (C-3). As written, the installer cannot populate `featureForgeVersion` from the bundle. This is distinct from IR-1 (which is about resolver sentinels) — it specifically breaks a manifest field this feature owns and writes.
- **Suggested fix:** Either (a) make `featureForgeVersion` optional/nullable in §4 and add a note that the bundle does not currently carry a version coordinate (deferring the source to a generator change owned by `forge-agent-adapters-build`, tracked alongside OQ-A/IR-1), or (b) specify a concrete present source — e.g. read `adapters/GENERATION-REPORT.md`'s provenance header, or have the installer derive it from its own `installer/package.json` version. Note in §4/§6 that whichever source is chosen must exist in the consumed `adapters/` tree (or be added by the generator under OQ-A), since C-3 forbids the installer from reaching outside `adapters/`.
- **References:** tech-spec.md §4, §6 IR-1, §10 OQ-A; PRD REQ-SAFE-01/03; feature-forge `adapters/` (no plugin.json/version header present)
- **Checklist:** CHECK-T12 (data model aligns with available data), CHECK-T16 (integration surprise)

### V-002: REQ-RAUF-04 is the only requirement with no explicit reconciliation against the lazy-npx model

- **Severity:** gap
- **Location:** tech-spec.md §3.1 (Rauf provisioning) — REQ-RAUF-04 not cited anywhere in the spec
- **Issue:** PRD REQ-RAUF-04 mandates that rauf bundling be "idempotent and reversible in line with the rest of the installer: re-running does not duplicate it, and uninstall accounts for what bundling added (per the manifest, REQ-SAFE-01)." The tech-spec cites REQ-RAUF-01/02/03/05 explicitly but never REQ-RAUF-04. Under D1's lazy-npx model, rauf is **never materialized into the install destination** (it is resolved on demand via `npx rauf@<pin>`), so the premise of REQ-RAUF-04 ("what bundling added") is largely mooted — the only durable trace is `raufPin` in the manifest. That is arguably a clean satisfaction of REQ-RAUF-04, but the spec never states it, leaving an implementer unsure whether uninstall must do anything rauf-specific (it does: clear `raufPin`/the field, but it writes/removes no rauf files).
- **Suggested fix:** Add one sentence to §3.1 (and/or §3.6 uninstall) explicitly closing REQ-RAUF-04: e.g. "REQ-RAUF-04 (idempotent + reversible bundling) is satisfied vacuously by D1 — because rauf is resolved lazily via `npx` and never written into the install destination, re-running provisions nothing to duplicate and uninstall has no rauf files to remove; the only rauf trace is `raufPin` in the manifest, which uninstall removes with the manifest." Add REQ-RAUF-04 to the §3.1 header range so traceability is explicit.
- **References:** tech-spec.md §3.1, §3.6; PRD REQ-RAUF-04, REQ-SAFE-01
- **Checklist:** CHECK-T01 (every requirement traces), CHECK-T03 (every P0/P1 PRD req has a tech decision or explicit deferral)

### V-003: `.gitignore` line count is stated as 17 but the file is 16 lines

- **Severity:** error
- **Location:** tech-spec.md §6 (Integration Points → Extends), line referencing "`.gitignore` (17 lines)"
- **Issue:** The spec asserts the feature-forge `.gitignore` is "17 lines" as a verification anchor. The actual file is **16 lines** (verified). Minor, but the spec uses these line-count anchors as "source-verified" credibility markers, so an incorrect one undermines that signal and could confuse a fresh agent diffing the file.
- **Suggested fix:** Change "(17 lines)" to "(16 lines)" in §6. (The substantive content is correct: the file already contains `.venv-adapters/` and `adapters.tmp-*/` from forge-agent-adapters-build, and the spec's new additions — `installer/node_modules/`, `installer/dist/`, `installer/adapters/` — are genuinely absent and correct to add.)
- **References:** tech-spec.md §6; feature-forge `.gitignore` (16 lines)
- **Checklist:** CHECK-T05 (claims verified against actual source), CHECK-T08 (changes to existing packages specified)

### V-004: EPIC.md carries the same stale `agent-cli-registry` consume as the manifest (V-001 scope should include EPIC.md)

- **Severity:** improvement
- **Location:** tech-spec.md §6 (Manifest reconciliation note, line ~230); cross-references EPIC.md line 140 and epic-manifest.json line 55
- **Issue:** The spec's carried-forward V-001 note correctly states that `epic-manifest.json` should change this feature's consume from `agent-cli-registry` (module) to the published rauf bin (artifact). But the **same stale contract also appears in EPIC.md** (line 140: "`agent-cli-registry` from `rauf-agent-cli-adapters` — rauf's agent adapter layer, bundled as the default loop runner"). The reconciliation note names only `epic-manifest.json`. Since epic verification (CHECK-E06) checks EPIC.md ⇆ manifest drift, fixing only the manifest would create a *new* EPIC.md⇆manifest divergence. The fix scope should cover both documents in lockstep.
- **Suggested fix:** Broaden the §6 reconciliation note (and the eventual epic-manifest update) to say the correction must be applied to **both** `epic-manifest.json` (features[3].consumes) **and** `EPIC.md` (the cross-agent-installer "Consumes" block, line 140), keeping them consistent. No change to this tech-spec's logic is required — this is a scope clarification on the deferred epic-level fix so it doesn't trade one drift for another.
- **References:** tech-spec.md §6 (V-001 note); PRD §5 C-3; EPIC.md line 140; epic-manifest.json line 55
- **Checklist:** CHECK-T02 (no contradiction with epic contracts), CHECK-T16 (cross-doc consistency surprise)

## Checklist Results (all 17 executed)

- CHECK-T01 traceability — **fail** (REQ-RAUF-04 untraced → V-002); all other 39 REQs traced.
- CHECK-T02 no contradictions w/ PRD constraints — pass (C-1..C-7 all honored; V-004 is a deferred-fix scope note, not a contradiction).
- CHECK-T03 every P0 has a tech decision/deferral — pass.
- CHECK-T04 integration analysis complete — pass (both consumed surfaces + both extended files + downstream named).
- CHECK-T05 import paths/signatures verified vs source — **fail** (validate.sh/forge-root.sh/adapters/version all accurate, but `.gitignore` line count wrong → V-003).
- CHECK-T06 shared types/contracts named — pass.
- CHECK-T07 data-flow direction clear — pass (consumes read-only; exposes CLI + map).
- CHECK-T08 changes to existing packages specified — pass.
- CHECK-T09 alternatives considered — pass (D1 rejects eager-install + global-install with reasons).
- CHECK-T10 error-handling strategy — pass (§7: exit 0/1/2, Result-style, per-agent partial, fixed rauf-pin message).
- CHECK-T11 testing approach — pass (§8 maps every REQ cluster, sandboxed HOME, injectable preflight).
- CHECK-T12 data model aligns w/ PRD data — **fail** (featureForgeVersion source absent → V-001).
- CHECK-T13 module structure + exports map — pass (§2 tree + §2/§5 public API surface).
- CHECK-T14 configuration approach — pass (RAUF_PIN single source; flags; `--source` test hook).
- CHECK-T15 migration/deployment — pass (validate.sh step 8, .gitignore, npm `files` bundling, IR-2 publish prerequisite).
- CHECK-T16 integration surprises — pass (IR-1 + IR-2 explicitly documented as source-verified; V-001/V-004 are the residue).
- CHECK-T17 scalability — pass (REQ-SCALE-01/02: add-agent = one table row, add-skill = no change).

## Fix Execution Plan

### User Decisions Required

- **V-001:** choose the `featureForgeVersion` source — (a) make it optional/deferred to the generator (OQ-A), or (b) point at a concrete present source (GENERATION-REPORT.md provenance header, or installer's own package.json version). The author should pick before the spec is final; a fresh agent should `AskUserQuestion` if unsure.
  - **[RESOLVED 2026-06-16]** Option (a) — make `featureForgeVersion` optional/nullable and defer the source to the generator (`forge-agent-adapters-build`) under OQ-A/IR-1. Keeps the installer C-3-clean; avoids recording a semantically-wrong version.
- All others can be applied directly.

### Execution Steps

#### Step 1: Close REQ-RAUF-04 traceability

- **Files:** tech-spec.md (§3.1 header line ~66 and §3.6)
- **Addresses:** V-002
- **Checklist:** CHECK-T01, CHECK-T03
- **Action:** Add `REQ-RAUF-04` to the §3.1 header requirement range, and add one sentence (in §3.1 or §3.6 uninstall) stating that REQ-RAUF-04 is satisfied vacuously by D1's lazy-npx model — rauf is never written to the destination, so nothing is duplicated on re-run and uninstall removes only the `raufPin` field with the manifest.
- **Depends on:** none

#### Step 2: Reconcile the `featureForgeVersion` data-model field

- **Files:** tech-spec.md §4 (InstallManifest), and a note in §6/§10
- **Addresses:** V-001
- **Checklist:** CHECK-T12, CHECK-T16
- **Action:** Per the user decision, either mark `featureForgeVersion` optional/nullable with a note that the bundle carries no version coordinate today (defer to generator under OQ-A/IR-1), or change the comment to name a source that actually exists in `adapters/`. Add a sentence noting C-3 forbids reading outside `adapters/`.
- **Depends on:** the user decision above

#### Step 3: Fix the `.gitignore` line-count anchor

- **Files:** tech-spec.md §6
- **Addresses:** V-003
- **Checklist:** CHECK-T05
- **Action:** Change "`.gitignore` (17 lines)" to "(16 lines)". Leave the listed additions unchanged.
- **Depends on:** none

#### Step 4: Broaden the V-001/epic-manifest reconciliation note to include EPIC.md

- **Files:** tech-spec.md §6 (the "Manifest reconciliation (V-001 …)" note)
- **Addresses:** V-004
- **Checklist:** CHECK-T02, CHECK-T16
- **Action:** Edit the note to state the deferred consume-correction must update **both** `epic-manifest.json` (features[3].consumes) and `EPIC.md` (cross-agent-installer "Consumes" block, line 140) in lockstep, so the fix doesn't introduce a new EPIC.md⇆manifest drift.
- **Depends on:** none
- **Rationale:** grouped last because it is a documentation-scope clarification on an already-deferred epic-level item, not a change to this feature's design.

## Fix Progress

- User Decision V-001: [RESOLVED] 2026-06-16 — option (a), optional/nullable + deferred to generator (OQ-A/IR-1).
- Step 1: [APPLIED] 2026-06-16 — V-002: added an explicit "Idempotent + reversible (REQ-RAUF-04)" paragraph to §3.1 stating REQ-RAUF-04 is satisfied vacuously by D1 (lazy npx; only `raufPin` trace, cleared on uninstall). Header range §3.1 already covers REQ-RAUF-01..05.
- Step 2: [APPLIED] 2026-06-16 — V-001: §4 `featureForgeVersion` changed to `string | null` with a comment that bundles carry no version coordinate today (deferred to generator, C-3); extended §10 OQ-A to track the missing version coordinate alongside the resolver sentinels.
- Step 3: [APPLIED] 2026-06-16 — V-003: §6 `.gitignore` "(17 lines)" → "(16 lines)".
- Step 4: [APPLIED] 2026-06-16 — V-004: §6 V-001 reconciliation note broadened to require the consume correction in **both** `epic-manifest.json` and `EPIC.md` in lockstep (CHECK-E06).
