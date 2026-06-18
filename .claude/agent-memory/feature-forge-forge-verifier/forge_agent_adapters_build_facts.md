---
name: forge-agent-adapters-build-facts
description: Verified ground truth for the forge-agent-adapters-build PRD (agent-agnostic epic member 3) — canon surfaces, agents/ set, manifest agent-set divergence
metadata:
  type: project
---

Verified facts for `forge-agent-adapters-build` (epic agent-agnostic, member 3/6), cross-checked against feature-forge canon (`/home/gary/workspace/feature-forge`) on 2026-06-16 while verifying its PRD.

**Why:** PRD makes load-bearing claims about another repo's canon; record ground truth so tech/specs verify passes don't re-derive it.
**How to apply:** Trust unless the tree changed; re-verify before asserting in a fix.

- Upstream dependency `forge-skill-spec-purity` LANDED in feature-forge: `scripts/check-spec-purity.py` AND `scripts/forge-root.sh` now BOTH EXIST (were absent at spec-purity tech stage). So PRD REQ-PUR-01/02 (purity-checker exemption) and REQ-GEN-05 (copy resolver verbatim) reference real present artifacts.
- `check-spec-purity.py` `CANONICAL_SURFACES` = `skills/**/SKILL.md`, `skills/**/references/**/*`, `references/**/*`, `agents/*.md`. So **`agents/*.md` IS canon** — the adapter generator must walk it, and PRD REQ-PUR-02's "(skills/, references/, agents/)" canonical-surface list matches the checker exactly.
- **agents/ has THREE sub-agent defs**: `forge-researcher.md`, `forge-spec-writer.md`, `forge-verifier.md`. PRD REQ-GEN-06 names only `forge-verifier.md` as "e.g." and REQ-GEN-01 scopes the walk to `skills/` only — coverage gap (V-001).
- **Repo-root `references/` has 10 entries + `stacks/`**: epic-manifest-schema.json, forge-config-schema.json, pipeline-state-schema.json, portable-root.md, process-overview.md, ralph-loop-contract.md, shared-conventions.md, stack-resolution.md, vendor-construct-inventory.md, stacks/. PRD REQ-GEN-04 self-containment names only `shared-conventions.md` by example — under-covers shared deps (V-002). NOTE: references/ is at repo ROOT, not under skills/.
- 11 skills (same set as spec-purity memory). AGENTS.md and adapters/ do NOT yet exist in feature-forge (this feature creates them).
- **MANIFEST AGENT-SET DIVERGENCE**: epic-manifest.json `build-adapters` exposes summary + HANDOFF charter list only 4 generator targets "(codex/copilot/cursor/gemini)". PRD REQ-GEN-03 makes it FIVE by adding Claude-as-generated-target (REQ-VND-01: restore native argument-hint). PRD scope is correct/intentional; manifest summary is the stale one (V-003). Watch for CHECK-E06 false-positive at epic verify.
- PRD QUALITY: 32 REQs all uniquely defined, all have Priority (27 P0 / 5 P1), zero TBD/TODO. §6 Out-of-Scope correctly cedes installer→cross-agent-installer and READMEs/broader-CI→packaging-docs-ci. AGENTS.md documenting "install priority" is NOT a downstream grab — EPIC.md line 114 + manifest both assign install-path-priority to AGENTS.md; README/install DOCS are the packaging-docs-ci-owned thing (PRD §6 line 154 draws that line correctly).
- **Cross-repo nuance (do NOT misflag)**: verify = `bash scripts/validate.sh` in feature-forge, NOT rauf's `pnpm gate`. Intentional, documented in PRD §5 C-1/C-2 + REQ-CI-04. Absence of a TS/pnpm gate is by design.
- PRD-verify result: 12 pass / 3 fail / 0 n-a of 15. Findings V-001 (gap: agents/ walk+set), V-002 (gap: shared references/ closure), V-003 (inconsistency: 5-vs-4 agent set). PRD findings were APPLIED (REQ-GEN-01 now walks agents/, REQ-GEN-04 names full references/ set, REQ-GEN-03 makes 5 agents explicit).

## TECH-SPEC verify pass (2026-06-16) — additional verified ground truth

- **GOTCHA: agent frontmatter schema is NON-UNIFORM and tech-spec §3.1/§4 gets it wrong.** Actual keys: forge-researcher = {name,description,tools,model,maxTurns,**effort**}; forge-spec-writer = {name,description,tools,model,maxTurns}; forge-verifier = {name,description,tools,model,maxTurns,**memory**,**skills**}. Tech-spec §3.1 and the §4 AgentRecord both say Claude-only keys are `{tools, model, maxTurns, memory, skills}` — **omits `effort`** and presents memory/skills as universal when they are per-agent-only. (V-001 tech.)
- check-spec-purity.py allowed frontmatter keys (verified): REQUIRED={name,description}; OPTIONAL={license,compatibility,metadata,allowed-tools}. Tech-spec §4 data-model line "{name,description,license,compatibility,metadata,allowed-tools}" is CORRECT. RESIDUAL_VAR_EXEMPT exists (the pattern §3.7 mirrors for ADAPTERS_EXCLUDE).
- validate.sh = 171 lines, set -euo pipefail. "6a. Spec-purity gate" is a top-level HARD gate (runs check-spec-purity.py, NEVER soft-skipped). Step 7 = epic-manifest helper inside `if [ -f "$HELPER" ]`; pytest runs whole `tests/` dir but is **soft-skipped/non-fatal** when pytest absent. So §8 test suite (test_build_adapters.py) is non-fatal in the gate; §3.8 correctly makes the DRIFT GUARD a hard top-level "6b" step instead. Spec §3.8 wiring claim is accurate.
- `.gitignore` has NO venv / .tmp / adapters.tmp entry. Spec §2 lists `.venv-adapters/` + `adapters.tmp-<pid>/` as gitignored but never says to AMEND `.gitignore`. (V tech gap.) No `scripts/requirements*.txt` exists yet (NEW per spec).
- conftest.py helpers confirmed: fixtures_dir, fixture_copy, run_cli, helper_module (importlib loader). tests/fixtures/ already has many bad-* canon fixtures.
- Epic manifest contracts verified: exposes build-adapters/AGENTS.md/adapters-output; consumers cross-agent-installer (member 4) + packaging-docs-ci (member 6). All match spec §2/§6.
- TQ deferrals well-captured: TQ-1 (per-agent native schemas) in §10 + §6 WARNING box + per-row §5 flags. TQ-2 (YAML lib) §10 names PyYAML default vs ruamel.yaml, pin intent stated, requirements-adapters.txt placeholder `PyYAML==X.Y.Z`. Both satisfy the "explicit deferral, not silent assumption" bar.
- forge-init confirmed as the ONLY skill without argument-hint (tech-spec §3.3 "10 of 11... forge-init has none" is CORRECT — earlier I noted the same).
- Tech-verify result: 14 pass / 3 fail / 0 n-a of 17. Findings: agent-schema omits effort+per-agent keys (gap/error), .gitignore amendment missing for venv+tmp (gap), GENERATION-REPORT.md provenance-header self-reference edge (minor).
