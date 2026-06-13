---
name: ux-overhaul-grammar-facts
description: Verified ground-truth for ux-overhaul-grammar (Phase 2+3, v0.5.0) PRD — exit-code table, feature-forge contract facts, priority-convention gap
metadata:
  type: project
---

Ground truth verified 2026-06-13 for `specs/ux-overhaul-grammar/` (Phase 2+3 of CANON.md, bundled as one breaking v0.5.0 release). CANON.md is source of truth.

**Why:** the grammar PRD makes concrete cross-repo (feature-forge) claims + an exit-code contract; checked so re-verification doesn't re-walk both repos.
**How to apply:** trust these when verifying ux-overhaul-grammar tech/specs/backlog; re-check if either repo changed. See also [[ux-overhaul-phase1-facts]].

- **Unified exit-code table (CANON §4.4 = PRD REQ-EXIT-01, verbatim match):** 0 success(clean terminal idle/complete) · 1 error(generic) · 2 usage(bad args/IO) · 3 needs-human(PAUSED_HUMAN) · 4 limit/usage-paused/sleeping · 5 blocked(terminal w/ blocked items) · 6 running(query-time only, `status`). `backlog validate` keeps its OWN 0 valid/1 findings/2 usage (REQ-EXIT-03) — leave untouched.
- **feature-forge IS in scope** (revised 2026-06-13 from declare-contract-only). REQ-CONTRACT-04/05. FF is a SEPARATE repo (`/home/gary/workspace/feature-forge`, main, epic support merged PR #2), OUTSIDE the rauf loop sandbox → FF edits are an explicit out-of-loop step at cutover.
- **FF facts verified (2026-06-13):** `minRunnerVersion` default = `0.2.0` in BOTH `references/forge-config-schema.json` (line ~138) and `skills/forge-5-loop/SKILL.md:83` (bump → 0.5.0). FF has ZERO `loop start`/`--watch` refs. FF default `runCommand` = `{bin} loop run . --backlog … --iterations …`; `ndjsonRunCommand` adds `--ndjson` (schema lines 65/70). `COMPATIBILITY.md`, `CHANGELOG.md`, `references/ralph-loop-contract.md` all exist. FF's only exit-code dependency is `backlog validate` 0/1/2 (ralph-loop-contract.md:31) — preserved by REQ-EXIT-03.
- **STALE in FF (REQ-CONTRACT-04 must fix but PRD under-specifies):** `references/ralph-loop-contract.md:51` enumerates rauf surface as "status (+ --json) / list / **watch** / follow / log / version" — `watch` is removed in this feature. (V-006 finding.)
- **PRIORITY CONVENTION GAP:** the grammar PRD has NO `Priority:` on any req (V-001 FAIL CHECK-P07). The Phase 1 PRD (`specs/ux-overhaul/PRD.md`) tags every REQ+NFR `Priority: P0/P1/P2`. This project DOES expect priorities — flag their absence as a gap, don't treat as n/a. (No prd-template.md ships in the skill; CHECK-P01 judged vs standard structure.)
- **`--detached --follow` lifecycle (REQ-EXEC-04) under-specified:** detach + follow compose; interrupting the follow must NOT stop the detached loop (only `loop stop` does). PRD §7 says "None outstanding" but this behavioral resolution is implicit (V-003).
