# Verification Report: agent-agnostic (epic)
Date: 2026-06-15
Pipeline Stage: forge-0-epic complete; all members at forge-1-prd
Artifacts Reviewed: epic-manifest.json, EPIC.md, 6 member `.pipeline-state.json` files, render-status/validate/check-name helper output

## Summary
- Total findings: 1
- Gaps: 0
- Inconsistencies: 0
- Improvements: 1
- Errors: 0

## Findings

### V-001: Target-repo is encoded only in charter prose, not as structured manifest metadata
- **Severity:** improvement
- **Location:** `specs/agent-agnostic/epic-manifest.json` (all six `features[].charter` strings); mirrored in `EPIC.md` "Features" section
- **Issue:** This is a two-repo epic (rauf = this repo; feature-forge = `../feature-forge`). The target repo for each feature is stated only in free-text charter prose ("Target repo: rauf.", "Target repo: feature-forge.", "Target repos: both (capstone)."). There is no machine-readable field, so downstream stages (forge-1-prd onward) and any cross-repo tooling must parse prose to learn where a feature lands. `cross-agent-installer` and `packaging-docs-ci` straddle both repos, which the prose handles ("bundles rauf", "both") but a structured field would disambiguate. The schema may not define such a field today, so this is a forward-looking note rather than a defect.
- **Suggested fix:** Optional. If `epic-manifest-schema.json` permits an extension field, consider adding a structured `targetRepo` (e.g. `"rauf"` | `"feature-forge"` | `"both"`) per feature so PRD/tech stages can route without prose-parsing. If the schema is closed (it is — `additionalProperties: false` on the feature definition), leave as-is — the prose is unambiguous and consistent between manifest and EPIC.md. Do not block the pipeline on this.
- **References:** `epic-manifest.json` features[].charter; `EPIC.md` per-feature charters; project CLAUDE.md (two-repo layout)
- **Checklist:** CHECK-E04

## Notes on delegated checks (not findings)

- **E08 / `check-name`:** Returns exit 1 `duplicate-name` for every member because each member directory already exists on disk; `check-name` reports collision against the very dir that legitimately owns the name. This is expected for already-created members (it is a pre-creation guard), not a true duplicate — `validate` returned `{"valid": true, "findings": []}` (exit 0), which is authoritative for global uniqueness here. No finding.
- **`check-name --json`:** the subcommand does not accept `--json` (exit 2 usage error). Run without the flag. Not an epic defect; a note for whoever scripts these invocations.
- **`.reference/` directory:** holds `AGENT_REFACTOR_RUNBOOK.md`; dotfile-prefixed, so not feature-shaped and correctly excluded by validate/render-status. Not an orphan.

## Fix Execution Plan

### User Decisions Required
- V-001 requires a decision: whether to add a structured `targetRepo` field. The `epic-manifest-schema.json` feature definition is closed (`additionalProperties: false`), so adding the field would require a schema change. Recommend deferring unless cross-repo routing becomes a pain point — the epic is internally consistent as-is.

### Execution Steps

None required. The epic is internally consistent: schema-valid, acyclic, every `consumes.from` resolves to a sibling that exposes the matching contract name, every `dependsOn` is a superset of the feature's consumes set, EPIC.md faithfully mirrors the manifest (no invented or omitted contracts), and all six back-pointers (`epic: agent-agnostic`) match the manifest with no orphaned dirs. V-001 is an optional forward-looking improvement, not a blocker.

---

Executed 8 of 8 checks. Results: 7 pass, 0 fail, 1 n/a (E06 spec-delivery half — no completed members exist yet, as expected for a freshly-created epic; the EPIC.md⇆manifest mirror half of E06 passed).
