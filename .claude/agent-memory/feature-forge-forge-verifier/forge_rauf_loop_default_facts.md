---
name: forge-rauf-loop-default-facts
description: Verified ground truth for forge-rauf-loop-default (agent-agnostic epic member 5) PRD — the forge<->rauf loop seam; contract cross-ref clean, factual premises verified against feature-forge tree
metadata:
  type: project
---

Verified facts for `forge-rauf-loop-default` (epic agent-agnostic, member 5/6). Target repo = **feature-forge** (rauf consumed, not modified). Verification stack per CON-05 = `bash scripts/validate.sh`, NOT rauf's `pnpm gate`.

**Why:** PRD rests on factual premises about the feature-forge forge-5-loop skill + a rauf version pin; record ground truth so tech/specs verify don't re-derive.
**How to apply:** trust unless feature-forge tree changed; re-verify before asserting in a fix.

## PRD source facts (PRD v1, commit e0cf1e5)
- 28 unique REQ IDs, 28 `Priority:` lines (1:1). DEF/AGENT/PREC/AVAIL/PLUG/BIN/SEAM/PERF/SEC/OBS/COMPAT clusters. Only ONE security req (REQ-SEC-01: constrain agent value to known ids).
- All 8 template sections present incl NFR 4.1-4.5. No TBD/TODO. OQ-01 (confirm rauf 0.6.0 first shipped --agent) + OQ-02 (project-default agent: dedicated loopRunner field vs tokenized arg) BOTH intentionally open — do NOT flag.

## Factual premises — VERIFIED accurate against /home/gary/workspace/feature-forge
- forge-5-loop SKILL.md:87 floors `loopRunner.minRunnerVersion` at **default `0.5.0`** today (semver-compare). REQ-BIN-02 wants to floor at 0.6.0 (agent-capable). Premise accurate.
- SKILL.md:165-167 optional-flags catalog = exactly `--review, --model <model>, --timeout <min>, --retry-blocked` — NO `--agent`. Model precedence documented: item.model > --model/options > project default > provider default. PRD's "stops at ..." claim accurate.
- loopRunner block is fully tokenized ({bin} default rauf, versionCommand default `rauf version --json`, etc.); no agent field exists. CON-04 tokenized-mechanism claim accurate.
- rauf version.ts = 0.6.0; cross-agent-installer RAUF_PIN="rauf@0.6.0" (from cross-agent-installer-facts). CON-03 / REQ-BIN-02 0.6.0 coordinate accurate.

## Contract cross-ref vs epic-manifest.json (lines 114-138) — CLEAN, no drift
- dependsOn = ["rauf-agent-cli-adapters","cross-agent-installer"] — matches PRD top-note + CON-02/03.
- exposes = `forge-loop-runner-contract` (module) — matches REQ-DEF-03 expose obligation.
- consumes = `loop-agent-selection` from rauf-agent-cli-adapters (matches §3.2/CON-02) + `cross-agent-installer-cli` from cross-agent-installer (matches §3.6/CON-03). Names match EXACTLY. Rare clean integration-seam cross-ref.

## prd-verify result (2026-06-16): 12 pass / 3 fail / 0 n-a of 15. 4 findings, ZERO errors/inconsistencies.
- V-001 (gap, P14/P08): unknown/typo agent-id behavior unspecified — falls between REQ-SEC-01 (constrain to known ids) and REQ-AVAIL-02 (known-but-unavailable). Suggest REQ-AVAIL-04 reject-up-front w/ valid-id list.
- V-002 (improvement, P05): SC-04 "agent selection vanish" not independently observable; tighten to "selector absent + pre-check not run + rendered cmd has no agent arg".
- V-003 (improvement, P10/P14): operator "swap in alternate runner" story has no req tying it to the loopRunner config action (only implied by CON-04/REQ-DEF-02). Add a Note.
- V-004 (improvement, P11): REQ-PERF-02 "does not materially delay launch" unquantified; prefer delegate-to-rauf wording (probe is consumed per CON-02) over a hard SLA.
- NON-findings (did NOT flag, correct): CHECK-P09 clean — tech specifics (--agent, rauf agents, BacklogItem.provider, rauf@0.6.0) confined to Notes/Constraints, OQ-02 defers mechanism. CHECK-P15 clean — full-surface-vs-pluggable-degradation tension explicitly resolved by REQ-PLUG-01/02 + REQ-SEAM-01/02.

## tech-verify result (2026-06-17): tech-spec v1, commit cebaa27. 13 pass / 2 fail of 15. 3 findings, 0 errors that change the conclusion.
ALL cited rauf signatures VERIFIED ACCURATE against source:
- `AgentAvailability {id, displayName, binaryName?, available, detail?}` at packages/loop/src/providers/registry.ts:14-25 — exact match.
- `rauf agents --json` → `{ agents: rows }`, ALWAYS exit 0 (handleAgents loop-commands.ts:1190-1218; returns SUCCESS, ERROR only on defensive internal catch). Tech-spec "always exit 0" + "unknown id never appears in agents[]" reasoning CORRECT.
- `DEFAULT_AGENT_ID="claude-cli"` constants.ts:2 (NOT "claude"). VERSION="0.6.0" version.ts:4.
- `BacklogItem.provider: z.string().optional()` schemas.ts:72. `--agent` flag commands.ts:197-200 (folds to LoopStartOptions.provider, loop-commands.ts:399 detached / :835 inline). SUPPORTED_AGENT_IDS = getAgentDescriptors().map(id) commands.ts:127.
- `resolveAgentId` agent-selection.ts:24 precedence = itemProvider→runProvider→projectProvider→globalProvider→DEFAULT_AGENT_ID (4 layers + default). WIRED into runner.ts:494/536/544 (real runtime caller, not dead). Tech-spec §6:260 "item>run>project>global>claude-cli, forge feeds only run layer" ACCURATE.
- feature-forge forge-config-schema.json:143-146 minRunnerVersion default STILL "0.5.0" (spec bumps→0.6.0). All edited/new files exist (validate.sh, build-adapters.py, check-spec-purity.py, tests/, ralph-loop-contract.md, forge-5-loop SKILL+runner-contract.md). loop-agent-selection.py correctly absent (new). forge-4-backlog SKILL.md:32,99 invokes ONLY validateCommand/versionCommand (agent-agnostic ✓ REQ-SEAM); forge-verify invokes validate only (SKILL.md:212). REQ-SEAM-01/02 classification ACCURATE.

DRAFT warning VERIFIED: SPEC-BACKLOG-TOOL-CONTRACT.md frontmatter:4 "Part B — DRAFT (provider refactor)"; line 708 precedence = `BacklogItem.provider > .rauf.json options.provider > ~/.rauf/config.json defaultProvider > "claude-cli"` = 4-layer, NO run layer, uses --provider (FR-12 line 379). Live source = 5-layer w/ run-level --agent. Tech-spec's "source authoritative" stance SOUND.

tech-verify findings:
- V-001 (error, T09): §3.1 line 59 "alternatives in §3.8" — §3.8 DOES NOT EXIST (doc ends §3 at §3.7). Dangling xref + the promised flat-vs-nested alternatives discussion is absent (only one-clause inline). Fix: add §3.8 or change to "(see §3.1 rationale)".
- V-002 (gap, T01/T03): REQ-COMPAT-02 (P1, concurrent isolated --backlog runs) has ZERO coverage in tech-spec — not even /02 shorthand. Trivially satisfied (per-run stateless) → one-line note suffices.
- V-003 (improvement, T01): §3.5 OQ-01 justification "not called out as added in any earlier CHANGELOG entry" is weak — CHANGELOG 0.6.0 says agent surface DOC "finalized"/"no minRunnerVersion change", never logs the --agent CODE landing at ALL (any version). Floor=0.6.0 conclusion still SOUND (rests on source-presence, which IS verified). Re-anchor justification on source-presence not changelog-absence.
- REQ-PLUG-02 covered ONLY via "REQ-PLUG-01/02" shorthand (§3.1/§7/§8) — substantively fine, NOT a finding (the /NN shorthand is project convention).

## Pattern note
forge-1-prd output for these epic members is consistently high quality on contract cross-ref (manifest consumes/exposes match PRD verbatim). When verifying epic-member PRDs, the productive findings are GAPS in error/edge behavior (unknown input, partial failure) and unquantified NFR adjectives ("materially", "bounded") — not contract drift. For TECH specs the same authors produce near-perfect integration accuracy (every file:line cite verified true here) — the residual findings are dangling internal xrefs (a promised §N.N that was never written) and a lone P1 NFR that slips coverage. Verify §-headers exist for every "see §X" before declaring clean.
