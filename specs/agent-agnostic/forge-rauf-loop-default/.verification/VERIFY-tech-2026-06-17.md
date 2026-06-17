# Verification Report: forge-rauf-loop-default (tech)

- **Date:** 2026-06-17
- **Mode:** tech
- **Pipeline Stage:** forge-3-specs (forge-2-tech complete)
- **Artifacts Reviewed:** PRD.md, tech-spec.md, .pipeline-state.json; cross-checked rauf source
  (`packages/loop/src/providers/registry.ts`, `constants.ts`, `agent-selection.ts`, `runner.ts`;
  `packages/cli/src/commands.ts`, `loop-commands.ts`; `packages/core/src/version.ts`, `schemas.ts`;
  `docs/SPEC-BACKLOG-TOOL-CONTRACT.md`; `CHANGELOG.md`) and feature-forge tree
  (`references/forge-config-schema.json`; `skills/forge-4-backlog`, `forge-5-loop`, `forge-verify`;
  `scripts/`; `tests/`)
- **Checks Executed:** 15 of 15 (CHECK-T01..T15) — 13 pass, 2 fail, 0 n/a.

## Summary

- **Total findings:** 3
- **Gaps:** 1
- **Inconsistencies:** 0
- **Improvements:** 1
- **Errors:** 1

Integration accuracy — the #1 risk for a cross-repo spec — was checked exhaustively and is
**clean**: every rauf signature, type, line-cite, and the "always exit 0" / "unknown id absent
from `agents[]`" reasoning the spec depends on was verified true against live source (see
**Integration claims confirmed accurate** below).

## Findings

### V-001: Dangling cross-reference to a non-existent §3.8 ("alternatives")
- **Severity:** error
- **Location:** tech-spec.md, §3.1 (line 59)
- **Issue:** §3.1 justifies flat fields "rather than a nested sub-object — **alternatives in
  §3.8**", but the document has no §3.8 — §3 ends at §3.7 (Testing mechanism), then jumps to §4
  Data Model. The promised dedicated alternatives-considered discussion (flat tokenized fields
  vs. a nested `agent` sub-object) is absent; only a one-clause parenthetical exists inline. This
  is both a broken internal pointer and a missing CHECK-T09 "alternatives considered" treatment
  for the spec's one genuinely structural choice (config shape).
- **Suggested fix:** Either (a) add a `### 3.8 Alternatives considered` section laying out the
  nested-sub-object alternative and why flat-`*Command`-convention won (explicit/human-readable/
  per-run-overridable, parallels existing flat fields), and keep the §3.1 pointer; or (b) if no
  separate section is wanted, change the §3.1 text to "(rationale below)" and inline 1–2 sentences
  on the rejected nested alternative. Option (a) is preferred since T09 wants alternatives
  surfaced for major decisions.
- **References:** tech-spec.md §3.1; CHECK-T09
- **Checklist:** CHECK-T09

### V-002: REQ-COMPAT-02 (concurrent isolated loop runs) has no coverage
- **Severity:** gap
- **Location:** tech-spec.md (whole document — no occurrence)
- **Issue:** PRD REQ-COMPAT-02 (P1) requires concurrent loop runs for different features (isolated
  per `--backlog` state dir) to be unaffected, with agent selection carrying no shared state. The
  tech-spec never addresses it — not by ID and not via the `/NN` shorthand (REQ-COMPAT-01 is cited
  at §3.1/§3.2 but -02 is absent everywhere). It is the only PRD requirement with zero coverage.
  (Note: REQ-PLUG-02 *is* covered, via the `REQ-PLUG-01/02` shorthand at §3.1/§7/§8 — that one is
  fine and not a finding.)
- **Suggested fix:** Add a one-line note (e.g. in §3.2 or §4 Data Model "no new persisted state")
  stating: "Agent selection is resolved per-run into a single value passed at launch; it persists
  no shared state, so concurrent runs over distinct `--backlog` dirs are unaffected
  (REQ-COMPAT-02)." Trivially true given the stateless per-run resolution already specified; just
  needs the explicit trace.
- **References:** PRD.md REQ-COMPAT-02; tech-spec.md §3.2, §4; CHECK-T01, CHECK-T03
- **Checklist:** CHECK-T01, CHECK-T03

### V-003: OQ-01 resolution leans on a CHANGELOG-absence argument that proves nothing
- **Severity:** improvement
- **Location:** tech-spec.md, §3.5 (lines 156–159)
- **Issue:** The OQ-01 resolution conclusion (floor = 0.6.0, source-verified) is correct, but its
  supporting clause — "the `--agent` flag, `rauf agents` probe... are present at 0.6.0 (**not
  called out as added in any earlier CHANGELOG entry**)" — is misleading. The rauf CHANGELOG never
  logs the `--agent`/`rauf agents` *code* landing at any version; the only 0.6.0 agent mention is
  "Agent-contract **documentation** finalized" and 0.6.0 is explicitly described as "Additive minor
  bump (no `minRunnerVersion` change)". So "not called out as added earlier" is equally true of
  0.6.0 itself — the changelog can't establish *when* the surface shipped. The conclusion is
  nonetheless sound because it independently rests on source-presence (verified: VERSION=0.6.0 and
  the full surface exists in source).
- **Suggested fix:** Re-anchor the justification on source-presence, which is authoritative and
  verified: replace the changelog-absence clause with "verified present in rauf source at 0.6.0
  (`packages/loop/src/providers/registry.ts`, `constants.ts`, `agent-selection.ts`,
  `packages/cli/src/{commands,loop-commands}.ts`; `version.ts` = 0.6.0). The CHANGELOG documents
  only the agent-contract *documentation* finalization at 0.6.0, so the floor is pinned to
  source-presence, not changelog text." Optionally note that flooring at 0.6.0 is
  safe-and-sufficient even if the surface technically landed earlier on the branch.
- **References:** tech-spec.md §3.5; rauf CHANGELOG.md (0.6.0 entry); rauf packages/core/src/version.ts;
  CHECK-T01, CHECK-T16
- **Checklist:** CHECK-T01, CHECK-T16

## Integration claims confirmed accurate (no findings — recorded for confidence)

- `AgentAvailability { id, displayName, binaryName?, available, detail? }` — exact match at
  `packages/loop/src/providers/registry.ts:14-25`.
- `rauf agents --json` → `{ agents: AgentAvailability[] }`, **always exit 0** — `handleAgents`
  (`loop-commands.ts:1190-1218`) returns SUCCESS for both JSON and table paths; ERROR only on a
  defensive internal catch (and `listAgents` "never rejects"). The spec's "unknown id never appears
  in `agents[]`; split is decidable only by set membership" reasoning is correct.
- `DEFAULT_AGENT_ID = "claude-cli"` (`constants.ts:2`) — not `"claude"`, as the spec stresses.
- `VERSION = "0.6.0"` (`version.ts:4`).
- `BacklogItem.provider: z.string().optional()` (`schemas.ts:72`) — cite accurate.
- `--agent <id>` flag (`commands.ts:197-200`) folds to `LoopStartOptions.provider`
  (`loop-commands.ts:399` detached, `:835` inline); ids enumerated from `SUPPORTED_AGENT_IDS =
  getAgentDescriptors()` (`commands.ts:127`).
- `resolveAgentId` (`agent-selection.ts:24`): precedence `item → run → project → global →
  claude-cli`, **wired into runtime** at `runner.ts:494/536/544` (not dead code). The spec's §6
  statement "rauf resolves item-vs-run above the run layer; forge feeds only the run layer" is
  correct, and the forge-side collapse of run+project into one `--agent` is consistent with
  REQ-PREC-01/02 and REQ-AGENT-05.
- **DRAFT warning is accurate:** `SPEC-BACKLOG-TOOL-CONTRACT.md` frontmatter declares "Part B —
  DRAFT (provider refactor)"; Part B precedence (line 708) is the 4-layer `--provider` chain
  omitting the run layer (FR-12, line 379, references `--provider`). Live source is 5-layer with
  run-level `--agent`. Treating source as authoritative is sound, and reconciling the rauf doc is
  correctly scoped out (CON-01).
- **REQ-SEAM-01/02 classification is accurate:** `forge-4-backlog/SKILL.md:32,99` invokes only
  `validateCommand`/`versionCommand` (agent-agnostic); `forge-verify/SKILL.md:212` invokes only
  `backlog validate`. Neither passes `--agent`.
- feature-forge `forge-config-schema.json:143-146` currently defaults `minRunnerVersion` to
  `0.5.0` (the spec's 0.6.0 bump is real and needed). All files the spec edits/creates exist as
  claimed except the correctly-new `references/loop-agent-selection.py`; gate is
  `bash scripts/validate.sh` with `build-adapters.py`/`check-spec-purity.py`/`tests/` present (CON-05).
- SC-07 testing approach (executable-spec `loop-agent-selection.py` + mock-rauf pytest, given
  skills are markdown prose) is realistic and correctly maps each sub-claim
  (precedence/probe-split/render/gating/schema) to an assertion.

## Fix Execution Plan

### User Decisions Required
None — all three fixes can be applied directly.

### Execution Steps

#### Step 1: Resolve the §3.8 dangling reference and add alternatives-considered
- **Files:** `specs/agent-agnostic/forge-rauf-loop-default/tech-spec.md`
- **Addresses:** V-001
- **Checklist:** CHECK-T09
- **Action:** Add a new `### 3.8 Alternatives considered` after §3.7 documenting the rejected
  nested-`agent`-sub-object config shape vs. the chosen flat
  `agentArgument`/`agentsProbeCommand`/`defaultAgent` fields (rationale: matches existing flat
  `*Command` convention, human-readable, per-run-overridable, no resolver re-implementation). Keep
  the §3.1 line-59 pointer "alternatives in §3.8". (Alternative: if no new section is desired,
  change §3.1 to "(rationale inline above)" and add one sentence on the nested alternative — but
  adding §3.8 is preferred for T09.)
- **Depends on:** none
- **Rationale:** Fixes a broken internal pointer and supplies the alternatives treatment T09
  expects for the spec's one structural choice.

#### Step 2: Add REQ-COMPAT-02 coverage note
- **Files:** `specs/agent-agnostic/forge-rauf-loop-default/tech-spec.md`
- **Addresses:** V-002
- **Checklist:** CHECK-T01, CHECK-T03
- **Action:** In §3.2 (or §4 Data Model's "no new persisted state" line), add: "Agent selection
  resolves per-run to a single launch-time value and persists no shared state, so concurrent loops
  over distinct `--backlog` state dirs are unaffected (REQ-COMPAT-02)."
- **Depends on:** none
- **Rationale:** Closes the only uncovered PRD requirement; the property is already true, just
  untraced.

#### Step 3: Re-anchor the OQ-01 version-floor justification on source-presence
- **Files:** `specs/agent-agnostic/forge-rauf-loop-default/tech-spec.md`
- **Addresses:** V-003
- **Checklist:** CHECK-T01, CHECK-T16
- **Action:** In §3.5, replace "(not called out as added in any earlier CHANGELOG entry)" with a
  source-presence justification (the surface is verified present in rauf source at VERSION 0.6.0
  across registry.ts/constants.ts/agent-selection.ts/commands.ts/loop-commands.ts; the CHANGELOG
  0.6.0 entry documents only agent-contract *documentation* finalization). Keep the floor=0.6.0
  conclusion unchanged.
- **Depends on:** none
- **Rationale:** Keeps the correct conclusion but removes a justification that doesn't actually
  support it, so forge-3-specs inherits a defensible rationale.

All three are localized edits to a single file (`tech-spec.md`) with no inter-step ordering
constraints.

## Fix Progress

- Step 1: [APPLIED] 2026-06-17 — Added `### 3.8 Alternatives considered` (nested sub-object,
  single-token-only, and forge-reimplements-resolver alternatives, each with rejection rationale);
  §3.1 pointer to §3.8 now resolves. (V-001)
- Step 2: [APPLIED] 2026-06-17 — Added REQ-COMPAT-02 coverage to §4 Data Model (per-run
  stateless resolution ⇒ concurrent distinct-`--backlog` loops unaffected). (V-002)
- Step 3: [APPLIED] 2026-06-17 — Re-anchored §3.5 OQ-01 justification on verified source-presence
  at VERSION 0.6.0; removed the CHANGELOG-absence clause; floor=0.6.0 conclusion unchanged. (V-003)
