# Verification Report: forge-rauf-loop-default (impl)

Date: 2026-06-17
Pipeline Stage: forge-5-loop complete (5/5 backlog items done); stage now forge-6-docs
Mode: impl
Dispatch: 4 parallel forge-verifier instances (cross-repo — specs in rauf, code in feature-forge on branch `forge/forge-rauf-loop-default`)
Checks Executed: 20 of 20 (CHECK-I01–I20) — 20 pass, 0 fail, 0 not-applicable

Dimension coverage:
- D1 requirement coverage vs specs (I01–I07): 7 pass, 0 findings
- D2 integration correctness (I08–I12): 5 pass, 0 findings
- D3 testing (I16–I17): 2 pass, 1 finding (improvement)
- D4 code-quality / conventions / docs (I13–I15, I18–I20): 6 pass, 1 finding (improvement)

## Summary

- Total findings: 2
- Gaps: 0
- Inconsistencies: 0
- Errors: 0
- Improvements: 2

Overall: the implementation is in strong shape. The full gate `bash scripts/validate.sh`
passes end-to-end (spec-purity → adapters drift-guard → pytest → installer build, 145 node
tests + the agent-selection pytest suite green). All five backlog items' acceptance criteria
are met; every type/constant in spec 00 §4/§2 is implemented; the capability gate
(REQ-PLUG-02/REQ-COMPAT-01) and the `validate`-is-agent-agnostic invariant (REQ-SEAM-02) hold;
the consumed rauf ≥0.6.0 surface (`--agent`, `agents --json` probe shape, `claude-cli` default)
was cross-checked against rauf source and matches. Both findings are discretionary
`improvement`-severity niceties, not defects, and neither affects a spec-mandated requirement
or the gate.

## Findings

### V-001: Fixture `version --json` capability is never exercised by the test suite

- **Severity:** improvement
- **Location:** `feature-forge/tests/test_loop_agent_selection.py` (no test references `version`); fixture `feature-forge/tests/fixtures/mock-rauf/rauf` lines ~76–78
- **Issue:** Spec 07 §4 mandates the fixture implement `version --json` → `{"version":"0.6.0"}` exit 0 because it "feeds the §3.5 / `05` gate path," and the fixture correctly does so. However, no test invokes that subcommand. The 0.6.0 floor is asserted only indirectly via the schema default (`test_schema_loop_runner_agent_defaults`) and the module's `MIN_RUNNER_VERSION` constant — neither drives the fixture's `version` branch. This is consistent with the test plan (the enumerated §3.1–3.6 cases do not include a version-gate test; the version gate is spec 05's own scope), so it is **not a §3.1–3.6 omission** — but it leaves a fixture capability untested: the `version` branch could silently break without any test failing.
- **Suggested fix (optional):** Add a small test that runs the mock-rauf fixture with `["version","--json"]` (reuse the `subprocess.run` pattern from the existing `_probe` helper), asserting `returncode == 0` and `json.loads(stdout) == {"version":"0.6.0"}`. Keep it independent of the schema test. Alternatively, leave as-is and accept that the version gate is covered by spec 05's separate verification — in which case close with no change.
- **References:** spec 07 §4 (fixture MUST on `version --json`), §3.5, §6; spec 05 (version floor); backlog item 003 AC.
- **Checklist:** CHECK-I17

### V-002: Step 1c "do not parse human output" example cites stale version `rauf v0.1.0`

- **Severity:** improvement
- **Location:** `feature-forge/skills/forge-5-loop/SKILL.md`, Step 1c, line ~86
- **Issue:** The line reads: "Do NOT use plain `rauf version` (its human output is `rauf v0.1.0` with a `v` prefix) — always the `--json` form." Spec 05 §2.1 illustrates the current human output as `rauf v0.6.0`. The `v0.1.0` example is a stale illustrative version string. It is **not** part of the agent-surface floor wording the feature was mandated to change (spec 05 §2.3 scopes the Step 1c edit to the floor value `0.5.0`→`0.6.0` and the too-old rationale, both applied correctly), so this is a pre-existing cosmetic staleness in the do-not-parse-human-output instruction, not a functional defect.
- **Suggested fix (optional):** On that line, replace `rauf v0.1.0` with `rauf v0.6.0` so the illustrative human-output version is coherent with the 0.6.0 floor named two lines below. The `v`-prefix point being made is unchanged. **SKILL.md is a canonical adapter source** — after the edit, re-run `python3 scripts/build-adapters.py` then `bash scripts/validate.sh` to keep the adapters drift guard green.
- **References:** spec 05 §2.1 (`rauf v0.6.0` exemplar), spec 05 §2.3 (scope of the Step 1c edit).
- **Checklist:** CHECK-I20

## Fix Execution Plan

Both findings are `improvement`-severity and strictly optional. Applying them is cheap and
is what flips `forge-verify-impl` to `findings-applied`, which (per `00-core-definitions §7`)
keeps the dependent `packaging-docs-ci` unblocked for orchestration.

### User Decisions Required

- **V-001** requires a scope decision: is the fixture's `version --json` branch in-scope for
  this test module, or is it covered by spec 05's separate verification? If the latter, close
  V-001 with no change.
- **V-002** is a cosmetic doc edit and can be applied directly (no decision needed), but may
  legitimately be deferred — it does not affect any spec-mandated requirement or the gate.

### Execution Steps

#### Step 1: Refresh the stale illustrative rauf version in Step 1c (V-002)
- **File:** `feature-forge/skills/forge-5-loop/SKILL.md`
- **Action:** Replace `rauf v0.1.0` with `rauf v0.6.0` on the Step 1c "do not parse human output" line. Then re-run `python3 scripts/build-adapters.py` and `bash scripts/validate.sh` (canonical adapter source — keep drift guard green).
- **Depends on:** none

#### Step 2 (optional): Exercise the fixture version-gate branch (V-001)
- **File:** `feature-forge/tests/test_loop_agent_selection.py`
- **Action:** Add a test invoking the mock-rauf fixture with `["version","--json"]`, asserting exit 0 and `{"version":"0.6.0"}`. Apply only if the team decides the fixture's version branch is in-scope for this module.
- **Depends on:** none

> **Cross-repo note:** the code/test fixes land in the **feature-forge** repo (branch
> `forge/forge-rauf-loop-default`); the gate is `bash scripts/validate.sh` from the
> feature-forge root, not rauf's `pnpm gate`. This findings document and the pipeline state
> live in the **rauf** repo.
