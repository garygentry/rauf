# Verification Findings — packaging-docs-ci (impl)

- **Feature:** packaging-docs-ci (capstone of the `agent-agnostic` epic)
- **Mode:** impl
- **Date:** 2026-06-17
- **Method:** Parallel dimensioned fan-out — 4 `forge-verifier` instances over CHECK-I01..I20 (D1 requirement coverage, D2 integration, D3 testing, D4 code-quality/docs). Cross-repo: rauf (`/home/gary/workspace/rauf`) + feature-forge (`/home/gary/workspace/feature-forge`).
- **Checks executed:** 22 of 20 nominal (some checks executed by more than one dimension). Results: 19 pass, 3 fail-mapped (V-001 across I05/I07/I16, V-002 across I15/I18/I20), 2 n/a (I03/I04 — no new runtime types/error classes).
- **Findings:** 4 — **2 error, 0 gap, 2 improvement, 0 inconsistency.**
- **Context:** `pnpm gate` (rauf repo) is green (verified, exit 0). The errors below are in the **feature-forge** repo, outside rauf's gate.

---

## V-001 — feature-forge `bash scripts/validate.sh` exits 1 when the `claude` CLI is present (marketplace.json missing top-level `description`)

- **Severity:** error
- **Location:** root cause `/home/gary/workspace/feature-forge/.claude-plugin/marketplace.json` (top-level keys are only `name`, `owner`, `plugins` — no `description`); manifests at `feature-forge/scripts/validate.sh` step 1 (`claude plugin validate --strict`) and the CI composite `feature-forge/.github/actions/quality-gate/action.yml:37,59`.
- **What's wrong:** `claude plugin validate --strict` emits `⚠ description: No marketplace description provided`, and `--strict` treats the warning as an error, so `validate.sh` prints `FAIL: claude plugin validate --strict reported errors` and **exits 1**. Reproduced independently by two verifiers:
  ```
  $ claude plugin validate --strict /home/gary/workspace/feature-forge
  ⚠ description: No marketplace description provided...
  ✘ Validation failed (--strict treats warnings as errors)
  $ bash scripts/validate.sh ; echo $?   # → 1
  ```
  The specs assumed `claude` would be **absent** on the runner (tech-spec §3.1.1 documents only the CLI-*absent* soft-fallback PASS), so the failure was never observed during implementation. It is not a local quirk: the item-005 CI composite runs `npm install -g @anthropic-ai/claude-code` (`action.yml:37`), so on any runner where that install succeeds (the normal case), the composite's `validate.sh` step (`action.yml:59`, no `continue-on-error`) hits the same `--strict` failure and **breaks the per-PR `ci.yml` gate** — the primary deliverable of this capstone. Every individual testing sub-step inside `validate.sh` passes (spec-purity, adapters-drift, anti-drift pytest 128/128, installer node:test); only step 1 fails.
- **Fails acceptance:** item 004 AC3 ("`bash scripts/validate.sh` exits 0"), item 003 AC4 ("still exits 0"), item 005 AC5 ("`validate.sh` … exits 0"); PRD §8 done bar ("authored + locally validated").
- **Suggested fix:** Add a top-level `"description"` string to `/home/gary/workspace/feature-forge/.claude-plugin/marketplace.json` (sibling of `name`/`owner`/`plugins`), e.g.:
  ```json
  "description": "feature-forge — an agent-agnostic, spec-driven feature pipeline (PRD → tech → specs → backlog → loop → docs) installable across Claude, Codex, Copilot, Cursor, and Gemini.",
  ```
  Then re-run `claude plugin validate --strict .` (expect clean) and `bash scripts/validate.sh` (expect exit 0). **Do NOT** weaken the gate by dropping `--strict` or swallowing its exit code — that would defeat REQ-CI-01/REQ-OBS-01. (If a description is intentionally omitted, the spec/validate.sh must instead document that this specific `--strict` warning is non-fatal — but adding the description is the correct fix.)
- **References:** `feature-forge/scripts/validate.sh:64-83`; `feature-forge/.claude-plugin/marketplace.json`; `feature-forge/.github/actions/quality-gate/action.yml:34-38,57-59,84`; spec `02-ci-blocking-gates.md` §4.1; spec `00-core-definitions.md` §8 (REQ-OBS-01); spec `07-testing-strategy.md` §2.1; backlog items 003 AC4 / 004 AC3 / 005 AC5; PRD §8.
- **Checklist:** CHECK-I05, CHECK-I07, CHECK-I16 (merged from D1-1 + D3-1).

---

## V-002 — feature-forge CHANGELOG 0.10.0 entry mis-states the rauf version floor as 0.5.0 (actual floor is 0.6.0)

- **Severity:** error
- **Location:** `/home/gary/workspace/feature-forge/CHANGELOG.md`, `## [0.10.0] — 2026-06-13` entry — the `### Changed` "Requires rauf ≥ 0.5.0 / Bumped `loopRunner.minRunnerVersion` default `0.2.0` → `0.5.0`" bullet (lines ~33-41) and the `### Requires — rauf ≥ 0.5.0` block (lines ~51-53).
- **What's wrong:** The live `minRunnerVersion` default is **0.6.0** — `references/forge-config-schema.json` → `loopRunner.minRunnerVersion.default = "0.6.0"` ("the AGENT-SURFACE FLOOR"), `skills/forge-5-loop/SKILL.md:87` hard-codes "default `0.6.0`", `docs/agents/claude.md:79-82` says "floors the runner at **rauf 0.6.0**", and spec `05-readme-and-agent-docs.md:356-357,392` fixes the floor at 0.6.0. The CHANGELOG instead documents 0.5.0 — a stale carry-over of the prior ux-overhaul-grammar 0.5.0 grammar-flip narrative. The v0.5.0 *grammar* changes it describes (unified exit codes, `loop run --detached`, `events.ndjson`, verb promotions) are historically accurate, but the **version-requirement number** is wrong: this capstone ships a 0.6.0 floor (the agent-selection surface).
- **Suggested fix:** In the `## [0.10.0]` entry: change "Requires rauf ≥ 0.5.0" → "Requires rauf ≥ 0.6.0"; change "Bumped `loopRunner.minRunnerVersion` default `0.2.0` → `0.5.0`" → "`0.2.0` → `0.6.0`"; update the rationale to "0.6.0 is the floor that ships the agent-selection surface (`--agent` / `rauf agents`)"; change the `### Requires` block to "**rauf ≥ 0.6.0**". Keep the v0.5.0 grammar/exit-code prose if accurate, but stop presenting 0.5.0 as the minimum-version requirement.
- **References:** `feature-forge/references/forge-config-schema.json` (minRunnerVersion default 0.6.0); `feature-forge/skills/forge-5-loop/SKILL.md:87,95`; `feature-forge/docs/agents/claude.md:79-82`; spec `05-readme-and-agent-docs.md:356-357,392`; spec `00-core-definitions.md §5`.
- **Checklist:** CHECK-I15, CHECK-I18, CHECK-I20.

---

## V-003 — eval harness (`run-eval.py`) has no automated PR-gated regression test

- **Severity:** improvement
- **Location:** `/home/gary/workspace/feature-forge/eval/run-eval.py` + `eval/fixtures/{forge-1-prd,forge-5-loop}.json`; no corresponding file under `feature-forge/tests/`.
- **What's wrong:** The no-key skip path and the `--json` EvalReport shape are documented behaviors (spec `04-trigger-accuracy-eval.md`, `07-testing-strategy.md §4`, REQ-EVAL-02/REQ-SEC-02) but are validated only by the manual run-commands in backlog item 007 — `grep` finds zero pytest referencing `run-eval`/`EvalReport`/`eval/fixtures`. The eval CI job (`eval.yml`) runs only on dispatch/weekly, never on PR (by design), so a regression in the no-key/exit-0 contract or the EvalReport JSON schema would not be caught by PR CI. Not a spec gap (specs frame eval validation as manual run-commands), hence `improvement`.
- **Suggested fix:** Add `feature-forge/tests/test_run_eval.py` with two no-network cases: (1) run with `ANTHROPIC_API_KEY` unset → assert exit 0 and stdout contains "skipped (no key)"; (2) `--json` no-key run → assert output parses and `skipped is True`, `accuracy == 0.0`, model `== claude-haiku-4-5-20251001`. No API call needed (both paths are key-absent). This makes the advisory harness's contract a hard, PR-gated test without incurring eval cost.
- **References:** `04-trigger-accuracy-eval.md §4.1/§6`; `07-testing-strategy.md §4`; backlog item 007.
- **Checklist:** CHECK-I17.

---

## V-004 — feature-forge README Configuration table omits the `loopRunner` block

- **Severity:** improvement
- **Location:** `/home/gary/workspace/feature-forge/README.md` §Configuration field table (lines ~273-282).
- **What's wrong:** The forge.config.json field table lists `specsDir`…`testCommand` but not the `loopRunner` block (`defaultAgent`, `minRunnerVersion`, `bin`, command templates). A reader scanning only the README config table would not learn `loopRunner` is configurable. It IS fully documented in `docs/agents/claude.md` ("The default loop runner"), and spec `05-readme-and-agent-docs.md §6` routes that documentation to claude.md rather than the README table — so this is **not** a spec violation (item 010 ACs do not require a loopRunner row). Discoverability improvement only.
- **Suggested fix:** Optionally add a `loopRunner` row to the Configuration table pointing at `docs/agents/claude.md#the-default-loop-runner`, e.g. `| loopRunner | object | rauf defaults | Loop-runner binding for forge-5-loop (bin, command templates, defaultAgent, minRunnerVersion). See docs/agents/claude.md. |`. Low priority — do not block on it.
- **References:** `docs/agents/claude.md` "The default loop runner"; `references/forge-config-schema.json` loopRunner property; spec `05-readme-and-agent-docs.md §6`.
- **Checklist:** CHECK-I20.

---

## Fix Execution Plan

A fresh agent with zero prior context can apply these in order. All changes are in the **feature-forge** repo (`/home/gary/workspace/feature-forge`).

### Step 1 — Restore the central `validate.sh` gate (V-001) — REQUIRED
1. Edit `/home/gary/workspace/feature-forge/.claude-plugin/marketplace.json`: add a top-level `"description"` string (sibling of `name`/`owner`/`plugins`). Suggested value in V-001.
2. Verify: `cd /home/gary/workspace/feature-forge && claude plugin validate --strict .` → expect clean (no `--strict` failure).
3. Verify: `bash scripts/validate.sh ; echo $?` → expect **0**.
4. Do not modify `validate.sh`'s `--strict` handling or the composite's gating — the fix is the manifest content, not the gate.

### Step 2 — Correct the CHANGELOG version floor (V-002) — REQUIRED
1. Edit `/home/gary/workspace/feature-forge/CHANGELOG.md` `## [0.10.0]` entry: replace every "0.5.0" used as the *rauf minimum-version requirement* with "0.6.0" (the `### Changed` bullet and the `### Requires` block). Keep accurate v0.5.0 *grammar* prose.
2. Verify against ground truth: `references/forge-config-schema.json` (`minRunnerVersion.default = "0.6.0"`) and `skills/forge-5-loop/SKILL.md:87`.

### Step 3 — (Optional) eval-harness regression test (V-003)
1. Add `tests/test_run_eval.py` with the two no-network cases in V-003.
2. Verify: `cd /home/gary/workspace/feature-forge && python3 -m pytest tests/test_run_eval.py -q` → expect pass.

### Step 4 — (Optional) README loopRunner row (V-004)
1. Add the `loopRunner` row to the README Configuration table per V-004.

### Decisions required from the user
- None block Steps 1–2. Steps 3–4 are optional improvements; the user may defer them.

### Post-fix verification
- `cd /home/gary/workspace/feature-forge && bash scripts/validate.sh ; echo $?` → 0
- `cd /home/gary/workspace/rauf && pnpm gate` → still green (unaffected; rauf-side untouched)

---

## Fix Progress

- Step 1 (V-001): [APPLIED] 2026-06-17 — Added top-level `description` to `feature-forge/.claude-plugin/marketplace.json`. Verified: `claude plugin validate --strict .` → "Validation passed"; `bash scripts/validate.sh` → exit 0 "All checks passed!".
- Step 2 (V-002): [APPLIED] 2026-06-17 — Corrected rauf floor 0.5.0 → 0.6.0 in `feature-forge/CHANGELOG.md` (0.10.0 entry: `### Changed` bullet + `### Requires` block) and in `feature-forge/COMPATIBILITY.md` (the doc CHANGELOG points to — 0.10.0 table row + "Version gate" prose), preserving the accurate v0.5.0 grammar/contract-flip history. Cross-checked ground truth (`references/forge-config-schema.json` minRunnerVersion default 0.6.0, `skills/forge-5-loop/SKILL.md:87`). Remaining "0.5.0" hits are only in gitignored `.forge-loop/backlog.json` task descriptions (out of scope).
- Step 3 (V-003): [APPLIED] 2026-06-17 — Added `feature-forge/tests/test_run_eval.py` (two no-network cases: human no-key skip+exit-0; `--json` EvalReport skipped/accuracy-0.0/pinned-model). Verified: `pytest tests/test_run_eval.py -q` → 2 passed.
- Step 4 (V-004): [APPLIED] 2026-06-17 — Added a `loopRunner` row to the `feature-forge/README.md` Configuration table, pointing at `docs/agents/claude.md` and noting the rauf ≥ 0.6.0 floor.

**Post-fix gate:** `feature-forge` `bash scripts/validate.sh` → exit 0 ("All checks passed!"); `check-version-sync.py` → PASS (all three fields 0.10.0). rauf `pnpm gate` unaffected (no rauf source changed).
