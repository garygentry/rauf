---
name: forge-skill-spec-purity-facts
description: Verified ground truth for the forge-skill-spec-purity PRD (agent-agnostic epic) — feature-forge tree counts and the speculative-vendor-directive gotcha
metadata:
  type: project
---

Verified facts about the feature-forge working tree (`/home/gary/workspace/feature-forge`) as of 2026-06-15, cross-checked while verifying the `forge-skill-spec-purity` PRD.

**Why:** PRD makes load-bearing factual claims about another repo; recording the ground truth so future verify passes (tech/specs) don't re-derive it.

**How to apply:** Trust these unless the tree changed; re-verify counts before asserting in a fix.

- 11 SKILL.md files (correct): forge-0-epic, forge-1-prd, forge-2-tech, forge-3-specs, forge-4-backlog, forge-5-loop, forge-6-docs, forge-fix, forge-init, forge-verify, forge.
- Oversized bodies match PRD exactly: forge-0-epic 522, forge-5-loop 423, forge-verify 342. Next is forge-2-tech at 197 (within budget).
- `${CLAUDE_PLUGIN_ROOT}` occurrences in the skill tree = **22 canonical + 1 hooks = 23** (PRD says "~20"/"~21"; the `~` makes it fine). Skill-tree loci: forge-0-epic(12), forge(3), forge-5-loop(1), forge-6-docs(1), forge-init(1), forge-verify SKILL(1), **forge-verify/references/verification-checklists.md(1)**, **references/shared-conventions.md(2)**, plus hooks/hooks.json(1, exempt). The v1+fixes PRD REQ-RES-03 Notes now lists ALL of these correctly.
- **LOCATION GOTCHA**: `references/shared-conventions.md` is at the **repo ROOT** (`/home/gary/workspace/feature-forge/references/shared-conventions.md`), NOT under `skills/`. A grep scoped to `skills/` MISSES it — always grep the whole tree.
- **NEW GAP (v1+fixes, not yet fixed)**: `agents/forge-verifier.md` contains 1 `${CLAUDE_PLUGIN_ROOT}` (line ~104, "run validation scripts via ${CLAUDE_PLUGIN_ROOT}/scripts/"). This is the forge-verifier SUBAGENT def dispatched by the forge-verify SKILL — a load-bearing Claude-coupling. PRD canonical-surface def is ONLY "SKILL.md bodies and references/", so `agents/` falls through: not enumerated, not exempted (unlike hooks.json). Genuine coverage gap. Other CLAUDE_PLUGIN_ROOT hits (docs/, plans/, specs/) are clearly non-canonical.
- Frontmatter keys present across ALL skills: ONLY `name`(11), `description`(11), `argument-hint`(10). forge-init has NO argument-hint. So the ONLY vendor key to relocate is argument-hint, in 10 skills.
- **GOTCHA**: ZERO Codex/Copilot/Cursor/Gemini invocation directives exist in any SKILL.md today, and Claude hook wiring lives only in `hooks/hooks.json` (not in bodies). So REQ-VND-02's "remove Codex/Copilot/Cursor invocation policy from body" clause is speculative — the audit will find nothing there. Only real vendor constructs: argument-hint (frontmatter) + hooks.json + CLAUDE_PLUGIN_ROOT.
- Bundled scripts (REQ-COMPAT-03) all exist in `scripts/`: epic-manifest.py, session-check.sh, forge-init.sh, validate-traceability.py, validate.sh.
- hooks/hooks.json: SessionStart -> `bash ${CLAUDE_PLUGIN_ROOT}/scripts/session-check.sh`.
- Plugin manifest exists: `.claude-plugin/plugin.json` (+ marketplace.json) — REQ-COMPAT-02 verifiable.
- name == directory holds for all 11 skills.
- Epic manifest: spec-pure-skills is consumed by BOTH forge-agent-adapters-build AND packaging-docs-ci; portable-skill-root-resolver is consumed ONLY by forge-agent-adapters-build. The v1+fixes PRD header "Consumed by" now states both consumers AND which artifact each takes — matches manifest exactly.
- **Re-verify 2026-06-15 (post-fix)**: 6 of 7 prior findings (V-001,002 core,004,005,006,007) genuinely RESOLVED. Residual: (a) REQ-RES-03 locus inventory still omits `agents/forge-verifier.md`; (b) OQ-1 still reads as fully-open while REQ-SIZE-03 commits 500/5000 provisionally — OQ-1 not reworded to "provisional-pending-confirmation". Both minor.

## TECH-SPEC stage facts (verified 2026-06-15)

- **BODY line counts** (below closing frontmatter `---` at line 5; frontmatter is 4 content lines): forge-0-epic body=**517** (total 522), forge-5-loop body=**418** (total 423), forge-verify body=**337** (total 342). Tech-spec §3.3 table says forge-0-epic body=**511** — WRONG by 6 (the other two, 418/337, are correct). The PRD REQ-SIZE-01 Notes cite the TOTALs (522/423/342); tech-spec D1 cites bodies.
- Tech-spec tightens budget to **≤300 lines AND ≤5,000 words** (D1). 517/418/337 all over the 300 gate; next skill forge-2-tech body well under.
- **agents/ IS now in scope in the tech-spec**: §3.2 replacement table includes `agents/forge-verifier.md` (1, prose line ~104: "running validation scripts via ${CLAUDE_PLUGIN_ROOT}/scripts/"), and §3.4 checker rule 3 scans `agents/*.md`. So the prior PRD-stage agents/ gap is CLOSED at tech stage.
- forge-root.sh + check-spec-purity.py do NOT exist yet (both ABSENT in scripts/). validate.sh has a **script-permissions check (~line 108)** that FAILs non-executable scripts — tech-spec never says to chmod +x forge-root.sh, and the prelude gates on `-x`, so a non-exec resolver silently fails twice.
- validate.sh step order: marketplace JSON → plugin.json → marketplace-entry resolve → skill frontmatter → agent frontmatter → script perms → epic-manifest py_compile → pytest (SKIP-non-fatal if pytest absent). Tech-spec §6 hedges "non-fatal-skip available" vs "hard gate" — ambiguous.
- conftest.py fixtures confirmed: `fixture_copy` (line 48), `run_cli` (66), importlib loader for hyphenated filenames (96). agents/ dir has forge-researcher.md, forge-spec-writer.md, forge-verifier.md.
- **PRELUDE `exec` GOTCHA**: §3.2 prelude `R="$(for d in …; do [ -x …forge-root.sh ] && exec …forge-root.sh; done)"` — `exec` replaces the subshell on the FIRST glob match, so the loop can NEVER try a second candidate root. It finds *a* resolver, doesn't iterate roots. Correct-by-design per D2 (resolver is the authority) but spec reads as if it iterates. Flag to document.
- Tech-spec findings issued (VERIFY-tech): V-001 511→517 error; V-002 exec-bit gap; V-003 resolver test gap; V-004 candidate-root config; V-005 validate.sh ordering; V-006 hand-rolled YAML reader; V-007 prelude exec semantics. 11 pass / 5 fail / 1 n-a (T17 scalability n/a).
