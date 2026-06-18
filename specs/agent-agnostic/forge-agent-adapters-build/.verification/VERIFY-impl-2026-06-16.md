# Verification Report: forge-agent-adapters-build (impl)
Date: 2026-06-16
Pipeline Stage: forge-5-loop complete (forge-verify-impl); currentStage=forge-6-docs
Epic: agent-agnostic
Implementation location: **feature-forge** (`/home/gary/workspace/feature-forge`, branch `forge/skill-spec-purity`) — cross-repo: specs/backlog live in rauf, all impl committed in feature-forge as `[rauf]` commits `7ad0f90..ef7e8f0`.
Artifacts Reviewed:
- Specs (rauf): PRD.md, tech-spec.md, 00-core-definitions.md … 06-testing-strategy.md, TRACEABILITY.md, backlog.json (11 items, all `done`)
- Impl (feature-forge): `scripts/build-adapters.py` (1411 lines), `scripts/requirements-adapters.txt` (PyYAML==6.0.2), `tests/test_build_adapters.py` (+6 fixtures), `AGENTS.md`, generated `adapters/` tree (5 agents + GENERATION-REPORT.md), additive edits to `scripts/check-spec-purity.py` and `scripts/validate.sh`

Verification method: parallel `forge-verifier` fan-out across 4 disjoint dimension groups —
requirement-coverage (I01–I07), integration-correctness (I08–I12), testing (I16–I17),
code-quality/conventions/docs (I13–I15, I18–I20). The completion gate `bash scripts/validate.sh`
was executed end-to-end and returned **"All checks passed!"** (spec-purity 0 violations,
`adapters/` matches a fresh generation — no drift, 104 pytest passed).

Checks executed: **20 of 20** — 20 pass, 0 fail, 0 not-applicable. Two pass-with-finding
(both `improvement` severity). No gaps, errors, or inconsistencies. The implementation is
complete and the hard completion gate is green.

## Summary
- Total findings: 2
- Gaps: 0
- Inconsistencies: 0
- Improvements: 2
- Errors: 0

## Findings

### V-001: `cursor` target omitted from the description byte-fidelity assertion
- **Severity:** improvement
- **Location:** `feature-forge/tests/test_build_adapters.py`, `test_description_byte_fidelity` (the per-agent target list, ~lines 301–305)
- **Issue:** Spec 06-testing-strategy.md §3.7 requires description byte-fidelity "for every target with a description field," and the implementer note (06 lines 489–494) explicitly calls out cursor: "a cursor row would read its `.mdc` via the same `_frontmatter_value` scan." The implemented loop parametrizes only `claude` (SKILL.md), `codex`/`copilot` (`<name>.md`), and `gemini` (manifest) — cursor is not asserted. Cursor's emitted `with-refs.mdc` does carry a `description:` field with the colon-and-period fixture value, so it is a description-bearing target the dedicated test skips. It is still indirectly pinned by `test_matches_committed_snapshot` (whole-tree hash equality), so this is NOT a true coverage gap — only the intention-revealing per-target assertion the spec checklist calls for is missing for one of the five targets.
- **Suggested fix:** In `test_description_byte_fidelity`, extend the frontmatter-bearing target list with `("cursor", "with-refs.mdc")`. The existing `_decode_scalar(_frontmatter_value(md, "description"))` logic works unchanged on the `.mdc` (standard `---`…`---` block). One-line addition; re-run `python3 -m pytest tests/test_build_adapters.py -q` to confirm green.
- **References:** 06-testing-strategy.md §3.7 + implementer note lines 489–494; fixture `tests/fixtures/minimal-canon/expected-adapters/cursor/skills/with-refs/with-refs.mdc`.
- **Checklist:** CHECK-I17

### V-002: Form-C `_generated` provenance lacks the source comment that Forms A & B carry
- **Severity:** improvement
- **Location:** `feature-forge/scripts/build-adapters.py`, ~lines 284–289 (`provenance_json` + `PROVENANCE_JSON_KEY`)
- **Issue:** 00-core-definitions.md §7 documents three provenance forms. The implementation reproduces the Form A and Form B explanatory source comments verbatim (lines 270–281), but Form C (strict JSON → `_generated`) is implemented as a bare function + constant with only a one-line docstring and none of the "Form C — strict JSON (gemini-extension.json), no comments possible (OQ-2)" framing the spec's §7 code block carries. Behavior is correct (used at lines 1023/1040) and the function is docstringed (CHECK-I19 still passes) — this is a source self-documentation parity nit only.
- **Suggested fix:** Add a one-line comment above `def provenance_json(...)`, mirroring the Form A/B comment style already at lines 270–272 / 277–278: `# Form C — strict JSON (gemini-extension.json), no comments possible (OQ-2): a documented top-level "_generated" object, serialized with the manifest.` Comment-only; the generator does not read its own source, so it does NOT affect generated output or trip the `--check` drift guard.
- **References:** 00-core-definitions.md §7 (Form C block); build-adapters.py lines 270–289, 1021–1054.
- **Checklist:** CHECK-I19, CHECK-I13

## Per-Check Results (all pass)

**Requirement coverage (I01–I07): 7/7 pass.** All 01 §2 files exist; the three public contracts (build-adapters CLI + `--check`, hand-authored AGENTS.md, committed self-contained `adapters/` tree) match spec; every 00 §2/§5/§6 type/dataclass/constant and error class implemented with correct exit-code semantics (0/1/2); all 11 backlog items `done` with every load-bearing acceptance criterion confirmed against code on disk; ACs are concrete/verifiable.

**Integration correctness (I08–I12): 5/5 pass.** `py_compile` clean; PyYAML==6.0.2 auto-provisioned into gitignored `.venv-adapters`; CLI re-exposes the full spec surface; `check-spec-purity.py` `adapters/**` exemption correctly scoped to `RESIDUAL_VAR_EXEMPT` only (CANONICAL_SURFACES unchanged); `validate.sh` step 6b is a hard top-level gate outside the HELPER guard; canon (`skills/`,`agents/`,`references/`,`forge-root.sh`) git-clean (C-3) and bundled resolvers byte-identical to canon; gate green; sibling checks unregressed.

**Testing (I16–I17): 2/2 pass** (1 improvement, V-001). `test_build_adapters.py` (28 tests) + fixtures present; both determinism approaches (build-twice byte-equality + committed snapshot), `--check` drift guard (clean→0, mutated→1+remediation), idempotence, atomic purge, self-containment (parametrized ×5), verbatim resolver, provenance Forms A/B/C, hint round-trip, per-file drop enumeration, and fail-fast (no partial tree / no tmp leak) all covered and passing.

**Code-quality / conventions / docs (I13–I15, I18–I20): 6/6 pass** (1 improvement, V-002). No TODO/FIXME/stub debt (Protocol `...` and empty `_CODEX_AGENT_KEYS` are deliberate); exit-code + atomic-swap-intact-on-failure error handling matches 00 §9 verbatim; 5-agent registry + YAML pin + determinism constants single-sourced (no magic literals); AGENTS.md satisfies every binding 05 §3.3 item with no DO-NOT-EDIT header (REQ-DOC-03); 16/16 classes and 38/39 functions docstringed (lone exception is `CanonError.__init__`, standard class-level convention); CLI/venv options documented.

## Fix Execution Plan

Both findings are non-blocking `improvement`-severity test/doc-parity tightenings landing in
**feature-forge** (not rauf). They can be applied directly or deferred without risk; neither
affects generated output or the `--check` drift guard. No user decisions required.

### Step 1 — Strengthen the description byte-fidelity test (V-001)
- **File:** `feature-forge/tests/test_build_adapters.py`
- **Action:** Add `("cursor", "with-refs.mdc")` to the frontmatter-bearing target list in `test_description_byte_fidelity`. No helper changes needed.
- **Verify:** `cd /home/gary/workspace/feature-forge && python3 -m pytest tests/test_build_adapters.py -q` stays green.
- **Depends on:** none

### Step 2 — Add the Form-C provenance source comment (V-002)
- **File:** `feature-forge/scripts/build-adapters.py`
- **Action:** Insert the one-line `# Form C — …` comment above `def provenance_json(...)` (~line 284), matching the Form A/B comment style.
- **Verify:** `cd /home/gary/workspace/feature-forge && bash scripts/validate.sh` stays green (comment-only; no drift).
- **Depends on:** none
