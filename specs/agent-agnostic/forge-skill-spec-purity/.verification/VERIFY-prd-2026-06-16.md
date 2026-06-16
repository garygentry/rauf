# Verification Report: forge-skill-spec-purity (prd)
Date: 2026-06-16
Pipeline Stage: forge-2-tech (re-verification after prd fix pass)
Artifacts Reviewed:
- `specs/agent-agnostic/forge-skill-spec-purity/PRD.md` (v1 + applied fixes)
- `specs/agent-agnostic/forge-skill-spec-purity/.verification/VERIFY-prd-2026-06-15.md` (prior pass + Fix Progress)
- `specs/agent-agnostic/epic-manifest.json` (contract cross-check)
- `/home/gary/workspace/feature-forge/` working tree (factual re-grep of `${CLAUDE_PLUGIN_ROOT}` loci)

## Summary
- Total findings: 2
- Gaps: 1
- Inconsistencies: 1
- Improvements: 0
- Errors: 0

Executed 15 of 15 checks. Results: 13 pass, 2 fail, 0 not-applicable.

**Re-verification verdict:** the fix pass landed cleanly — 6 of the 7 prior findings are
genuinely resolved against the live `feature-forge` tree, with **no regressions** and no new
contradictions (the hooks.json / resolver-fallback story now reads consistently across
REQ-RES-03 / REQ-VER-01 / REQ-VND-04 / SC-3; the size-budget chain is internally coherent; the
consumer header matches the manifest exactly). Two **minor residual** issues remain, both
follow-on completeness gaps from the V-002 and V-003 fixes rather than new defects, and both are
tech-spec-tractable: (V-008) the REQ-RES-03 canonical-surface scope still omits
`agents/forge-verifier.md`, a load-bearing `${CLAUDE_PLUGIN_ROOT}` site that is neither a
`SKILL.md` body nor under `references/` and is not exempted; and (V-009) OQ-1 still reads as an
undecided open choice even though REQ-SIZE-03 now commits 500/5,000 as the binding-provisional
budget, so the two passages disagree on whether the decision is made.

### Prior-finding confirmation

| ID | Prior severity | Status | Evidence |
|----|----------------|--------|----------|
| V-001 | error | **RESOLVED** | REQ-VND-02 reworded to a contingency; grep of all 11 SKILL.md bodies finds zero `codex/copilot/cursor/gemini`; phantom mandate gone. |
| V-002 | inconsistency | **RESOLVED (core)** | REQ-RES-03 Notes list all 8 canonical loci incl. `verification-checklists.md(1)` + `shared-conventions.md(2)`, counts verified. Inventory still misses `agents/forge-verifier.md` → V-008. |
| V-003 | gap | **RESOLVED** | REQ-SIZE-03 binds 500 lines / 5,000 words (provisional); REQ-SIZE-01 + SC-4 cite it — testable now. OQ-1 not reframed → V-009. |
| V-004 | improvement | **RESOLVED** | REQ-VER-01 Notes: size assertion parameterized by REQ-SIZE-03 (500/5000), hard failure. |
| V-005 | inconsistency | **RESOLVED** | REQ-SIZE-01 raised to P0 hard requirement for the three overruns; gate matches SC-1/SC-4. |
| V-006 | improvement | **RESOLVED** | Header "Consumed by" lists `forge-agent-adapters-build` (both artifacts) + `packaging-docs-ci` (spec-pure-skills only) — matches manifest exactly. |
| V-007 | improvement | **RESOLVED** | REQ-RES-03 scoped to canonical surfaces, "routed through" defined, single resolver file = sole fallback, hooks.json exempted; REQ-VER-01/VND-04/SC-3 consistent. |

No regressions introduced by the fix pass.

## Findings

### V-008: [residual] REQ-RES-03 canonical-surface scope omits `agents/forge-verifier.md`, which carries a live `${CLAUDE_PLUGIN_ROOT}`
- **Severity:** gap
- **Location:** PRD.md §3.3 REQ-RES-03 (lines 57–59) and §3.6 REQ-VER-01 (line 86)
- **Issue:** REQ-RES-03 defines canonical surfaces as exactly **"`SKILL.md` bodies and `references/`"** and enumerates 8 loci. But a whole-tree grep finds an in-scope-flavored occurrence the PRD never accounts for: `/home/gary/workspace/feature-forge/agents/forge-verifier.md:104` (`run validation scripts via ${CLAUDE_PLUGIN_ROOT}/scripts/`). This file is the `forge-verifier` **subagent definition** that the `forge-verify` SKILL dispatches (`subagent_type="forge-verifier"`) — a load-bearing, skill-coupled Claude artifact that instructs the agent to locate scripts via the Claude-only env var. It falls through the PRD's two named categories: it is neither a `SKILL.md` body nor under a `references/` dir, and unlike `hooks/hooks.json` it is **not** explicitly exempted. So by the PRD's own scoping the spec-purity checker would leave it unconverted, yet it would break script resolution under a non-Claude agent — exactly the coupling this feature exists to remove. (The V-002 fix corrected the `references/` omission but did not widen scope to `agents/`; the prior verify pass also missed this file.) Verified: `grep -rn CLAUDE_PLUGIN_ROOT agents/` → 1 hit (line 104); the file is not under `skills/`.
- **Suggested fix:** In REQ-RES-03, either (a) **broaden** the canonical-surface definition to "`SKILL.md` bodies, `references/`, and the dispatched subagent definitions under `agents/`," add `agents/forge-verifier.md (1)` to the locus list, and let the checker's grep be authoritative — preferred, since the resolver should cover it; or (b) if `agents/` is intentionally out of canon (like hooks.json), add an explicit exemption sentence naming it, mirroring the hooks.json carve-out, and note it in REQ-VER-01. Recommend (a). Since the Notes already direct "derive the authoritative loci by grepping `${CLAUDE_PLUGIN_ROOT}` across the tree," keep the "~" qualifier on the count (the 8 enumerated canonical loci already sum to ~22; adding `agents/` does not change the grep-authoritative framing).
- **References:** `/home/gary/workspace/feature-forge/agents/forge-verifier.md:104`; `skills/forge-verify/SKILL.md` (dispatches the subagent); PRD.md §3.2 REQ-VND-04 (the hooks.json exemption to mirror), §3.6 REQ-VER-01
- **Checklist:** CHECK-P08, CHECK-P14

### V-009: [residual] OQ-1 still framed as undecided while REQ-SIZE-03 commits 500/5,000 as binding-provisional
- **Severity:** inconsistency
- **Location:** PRD.md §7 OQ-1 (line 139) vs §3.4 REQ-SIZE-03 (line 72)
- **Issue:** The V-003 fix made REQ-SIZE-03 read **"Binding (provisional, pending tech-spec confirmation per OQ-1): a SKILL.md body MUST NOT exceed 500 lines or 5,000 words"** — the budget is now committed, and OQ-1's role is reduced to *confirm-or-tighten*. But OQ-1 itself was left untouched: it still reads as an open binary choice — *"adopt the Agent Skills published recommendation verbatim, or a stricter project-local budget? (Default: ~500 lines / ~5k words)"* — presenting the decision as unmade with only a "Default." A reader hitting OQ-1 first concludes the budget is undecided, contradicting REQ-SIZE-03's "binding." The fix pass reconciled the requirement side but not the open-question side, so the two passages disagree on whether the number is settled.
- **Suggested fix:** Reword OQ-1 to reflect the provisional commitment, e.g.: *"OQ-1: The body budget is **provisionally bound** to 500 lines / 5,000 words in REQ-SIZE-03. Tech spec to **confirm against the Agent Skills published recommendation** and MAY tighten it; MUST NOT loosen without revisiting this. → tech spec."* This makes OQ-1 a confirmation/tightening question (matching REQ-SIZE-03's "MAY tighten … MUST NOT loosen") rather than an open adopt-or-not choice.
- **References:** PRD.md §3.4 REQ-SIZE-03 (line 72), §3.6 REQ-VER-01 Notes, §8 SC-4
- **Checklist:** CHECK-P04, CHECK-P15

## Per-Check Execution Log

- **CHECK-P01** (template sections populated): **pass** — §1–§8 all present and non-empty.
- **CHECK-P02** (no TBD/TODO): **pass** — grep for TBD/TODO/FIXME/XXX returns none.
- **CHECK-P03** (out-of-scope specific): **pass** — §6 lists six concrete exclusions, each attributed to a named downstream feature.
- **CHECK-P04** (open questions actionable): **fail** — OQ-1 reads as undecided while REQ-SIZE-03 commits the number (V-009). OQ-2/OQ-3 fine.
- **CHECK-P05** (success criteria measurable): **pass** — SC-4 cites the bound budget; SC-1's checker gate is now parameterized and testable.
- **CHECK-P06** (unique REQ IDs): **pass** — 28 unique REQ-XXX-NN definitions, no duplicate IDs.
- **CHECK-P07** (priority on every req): **pass** — 28 requirements, 28 `Priority:` lines; REQ-SIZE-01 correctly P0 now.
- **CHECK-P08** (testable): **fail** — REQ-RES-03's canonical-surface scope is under-inclusive (`agents/` site uncovered/unexempted), so its checker assertion can't be authored to a complete locus set (V-008).
- **CHECK-P09** (no un-labeled tech decisions): **pass** — impl choices deferred to OQ-2; frontmatter set labeled as constraint C-2; 500/5000 budget labeled provisional.
- **CHECK-P10** (user stories cover actors): **pass** — §2 personas complete; header consumer list matches manifest.
- **CHECK-P11** (NFRs quantified): **pass** — NFRs qualitative-by-nature; size budget is now numeric.
- **CHECK-P12** (security explicit): **pass** — REQ-SEC-01 bounds resolver path resolution, forbids sourcing untrusted paths.
- **CHECK-P13** (constraints distinguish must/should): **pass** — §5 clear MUST/SHOULD; SHOULD-vs-gate contradiction (V-005) resolved.
- **CHECK-P14** (implicit requirements): **fail** — the `agents/forge-verifier.md` Claude-coupling is an implicit, unstated in-scope surface (V-008).
- **CHECK-P15** (conflicts/tensions): **fail** — OQ-1 "undecided" vs REQ-SIZE-03 "binding" (V-009); prior V-006/V-007 tensions resolved.

## Fix Execution Plan

### User Decisions Required
- **V-008:** Choose the disposition of `agents/forge-verifier.md`'s `${CLAUDE_PLUGIN_ROOT}`:
  **(a)** broaden REQ-RES-03's canonical scope to include `agents/` subagent definitions and convert it via the resolver (recommended — it's a load-bearing, skill-dispatched artifact the resolver should cover); or **(b)** exempt `agents/` as non-canonical, mirroring the hooks.json carve-out. Both are one-edit fixes; (a) is the stronger guarantee that no surface stays Claude-coupled.
  - **RESOLVED (2026-06-16):** Option **(a)** — broaden REQ-RES-03 canonical scope to `agents/` and convert `agents/forge-verifier.md` via the resolver.
- **V-009:** None — wording reconciliation only; apply directly.

### Execution Steps

#### Step 1: Reconcile OQ-1 with the now-bound size budget
- **Files:** `specs/agent-agnostic/forge-skill-spec-purity/PRD.md`
- **Addresses:** V-009
- **Checklist:** CHECK-P04, CHECK-P15
- **Action:** Reword §7 OQ-1 from an open adopt-or-not choice to a confirm/tighten question that matches REQ-SIZE-03: state the budget is provisionally bound to 500 lines / 5,000 words, the tech spec confirms against the Agent Skills recommendation and MAY tighten but MUST NOT loosen without revisiting. Keep the "→ tech spec" disposition.
- **Depends on:** none
- **Rationale:** Pure wording reconciliation, no decision needed; independent of Step 2.

#### Step 2: Bring `agents/forge-verifier.md` into REQ-RES-03 scope (or explicitly exempt it)
- **Files:** `specs/agent-agnostic/forge-skill-spec-purity/PRD.md`
- **Addresses:** V-008
- **Checklist:** CHECK-P08, CHECK-P14
- **Action:** Per the user decision: **(a)** broaden REQ-RES-03's canonical-surface phrase to "`SKILL.md` bodies, `references/`, and the dispatched subagent definitions under `agents/`," add `agents/forge-verifier.md (1)` to the locus Notes, and add a matching mention to REQ-VER-01; OR **(b)** add an explicit `agents/` exemption sentence to REQ-RES-03 mirroring the hooks.json carve-out and note it in REQ-VER-01. Keep the grep-authoritative "derive loci by grepping" directive either way.
- **Depends on:** none (independent of Step 1; the V-008 user decision gates only this step)
- **Rationale:** Closes the last uncovered Claude-coupling surface so the spec-purity checker's locus set is complete and REQ-RES-03 is fully testable.

## Fix Progress

- Step 1: [APPLIED] 2026-06-16 — V-009 resolved. §7 OQ-1 reworded from an open adopt-or-not choice to a confirm/tighten question matching REQ-SIZE-03 (budget provisionally bound to 500/5,000; tech spec MUST confirm, MAY tighten, MUST NOT loosen). Addresses V-009.
- Step 2: [APPLIED] 2026-06-16 — V-008 resolved per user decision (option a). REQ-RES-03 canonical-surface definition broadened to "`SKILL.md` bodies, `references/`, and the dispatched subagent definitions under `agents/`"; locus Notes add `agents/forge-verifier.md (1)` (~22 canonical). `hooks/hooks.json` remains the sole exemption (REQ-VND-04). Addresses V-008.
