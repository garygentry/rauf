---
name: packaging-docs-ci-facts
description: Verified ground truth for the agent-agnostic capstone (feature 6/6) packaging-docs-ci PRD — repo state, version-mismatch precise locations, charter-coverage gaps
metadata:
  type: project
---

Capstone (6 of 6) of the `agent-agnostic` epic. Specs in rauf, edits land in BOTH rauf and ../feature-forge. Exposes `release-and-ci-gates`.

**Why:** PRD makes many cross-repo factual claims (version mismatch, missing LICENSE, no CI) — all need verification against live trees.

**How to apply:** when verifying later stages (tech/specs/impl) of this feature, reuse these verified facts instead of re-probing.

Verified repo state (2026-06-17):
- feature-forge: NO LICENSE, NO .github/workflows, NO .gitattributes, NO docs/agents/; HAS CHANGELOG.md, AGENTS.md.
- rauf: HAS MIT LICENSE + README MIT badge, CHANGELOG.md, .github/workflows (ci/docs/release); NO .gitattributes.
- Version mismatch GOTCHA: PRD (problem statement + REQ-VER-02/CI-05) describes it as "`.claude-plugin` manifest 0.9.0 vs `plugin.json` 0.10.0". ACTUAL: there is NO root plugin.json. `0.10.0` lives in `.claude-plugin/plugin.json`; `0.9.0` lives in `.claude-plugin/marketplace.json` (both under .claude-plugin/). The PRD's phrasing inverts/mislabels which file holds which value.
- THIRD desync the PRD never flags: `adapters/gemini/gemini-extension.json` version is `0.0.0`. REQ-CI-05 names gemini-extension.json as part of the synced set, so the gate must reconcile 0.0.0 too — but problem statement + REQ-VER-02 only mention the two-way 0.9/0.10 mismatch.
- shellcheck targets exist (scripts/*.sh + adapters/*/scripts/forge-root.sh); ruff targets exist (scripts/*.py + tests/*.py).

Charter-coverage gap: charter `consumes` `forge-loop-runner-contract` = "Documented as the default forge<->rauf loop path in the per-agent docs." PRD REQ-DOCS-03 only requires install + first-use; NO REQ requires per-agent docs to document the forge<->rauf default loop path. Genuine gap (not a deliberate deviation — not in Charter Deviations REQ-CONS-01/02/03).

Deliberate deviations (do NOT flag, recorded REQ-CONS-01/02/03): MIT not Apache-2.0; version-sync manifests-only not SKILL.md; rauf README keeps loop-runner shape + cross-link.

TECH-STAGE facts (verified 2026-06-17, tech-spec verify pass):
- The PRD-pass REQ-DOCS-04 gap is RESOLVED — PRD now has REQ-DOCS-04 (default forge<->rauf loop path documented, P1) and tech-spec §3.7/§6.2 cite it. Don't re-flag.
- tech-spec on-disk claims ALL verified correct: GEMINI_EXTENSION_VERSION="0.0.0" at build-adapters.py:298 (tech says "~298"); plugin.json 0.10.0; marketplace.json plugins[0].version 0.9.0; gemini-extension.json 0.0.0 (carries `_generated` header, JSON has no comments so that IS the DO-NOT-EDIT marker); --check flag at build-adapters.py:1400; RAUF_PIN="rauf@0.6.0" at installer/src/rauf.ts:30; --skip-rauf flag present; installer cmds install|add/update/uninstall|remove/list|ls, flags -a/-g/--symlink/--force/--dry-run/-y/--json/--skip-rauf/-h/--version, exit 0/1/2 — all match §6.1; 6-key allowed frontmatter set matches check-spec-purity.py (REQUIRED name+description, OPTIONAL license/compatibility/metadata/allowed-tools); 11 SKILL.md; ralph-loop-contract.md floors minRunnerVersion 0.6.0.
- validate.sh: NO `claude plugin validate` call (tech §3.1 correctly says it must be ADDED); has steps 1-7 incl `# 6a.` spec-purity and `# 6b.` adapters regen-diff; does NOT call validate-traceability.py (tech §3.1 correctly says "wire it in"). Step labels confirmed.
- rauf gate = 8 cmds (build, schema:check, version:check, typecheck, lint, format:check, test, check:docs); quality-gate action.yml just runs `pnpm gate`. check-versions.ts covers 6 package.jsons (root + core/cli/loop/web/docs), source packages/core/src/version.ts. tech §6.5 "8 steps incl version:check + check:docs" + "6 package.jsons" both accurate. check-docs.ts triggers: removed grammar/ralph branding/stale version pins/SPEC-CLI drift — matches tech §3.6.
- feature-forge scripts/*.py = 4 (build-adapters, check-spec-purity, epic-manifest, validate-traceability) — last two are sibling-feature scripts ruff will also lint (V-003). scripts/*.sh = 4 (validate, forge-init, forge-root, session-check). eval/ does NOT exist yet (created by this feature). installer config map: cursor→rules, gemini→extensions, all confidence "best-known" (TQ-1).
- TECH traceability gaps found: REQ-CONST-04 (P0, regen-diff substance covered but ID never cited) and REQ-CONS-02 (deviation record, substance covered by REQ-VER-03 cite). Every other REQ traces. validate-traceability.py is useless at tech stage (only scans ##-*.md specs, none exist yet — all 39 reqs show "uncovered", expected, NOT a finding).
