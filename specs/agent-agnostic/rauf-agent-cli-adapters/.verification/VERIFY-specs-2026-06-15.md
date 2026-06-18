# Verification Report: rauf-agent-cli-adapters (specs)
Date: 2026-06-15
Pipeline Stage: forge-3-specs complete; forge-verify-specs pending
Artifacts Reviewed: PRD.md (v2), tech-spec.md (v2), 00–07 implementation specs, TRACEABILITY.md; verified against source in `packages/loop/src/**`, `packages/core/src/{schemas,errors,config}.ts`, `packages/cli/src/**`, and `test-sandbox/`.

Checks Executed: **38 of 38** (CHECK-S01..S38), via 5 parallel dimensioned verifiers (types/contracts S09-13+S18-21; architecture/layout S05-08+S27-32; cross-ref & traceability S01-04+S14-17+S38; testing S33-37; integration S22-26). Deterministic supplement: `validate-traceability.py` → **29 requirements, 8 spec files, 0 uncovered, 0 orphaned references**. Aggregate result: 31 pass, 7 fail/with-findings, 0 n/a.

## Summary
- Total findings: 17
- Errors: 1
- Gaps: 3
- Inconsistencies: 4
- Improvements: 9

The suite is implementation-ready in substance: every PRD requirement is covered with detailed
guidance, every P0 has a real approach, the integration mapping is rigorous, and ~99% of the many
`file:line` citations match source exactly. The findings are concentrated in (a) **export-surface /
type-location consistency** across `01 §4` ↔ `02 §5.x` ↔ `00`/`03` (would cause import failures if
implemented verbatim), (b) **two undefined helper references** in `05`, (c) a **REQ-SEC-01
spawn-cwd** confinement gap, and (d) a tail of cosmetic citation/anchor polish.

## Findings

### V-001: Self-import of `DEFAULT_AGENT_ID` from `./agent-selection.js` inside `agent-selection.ts`
- **Severity:** error
- **Location:** `04-agent-selection.md` §3.1 reference implementation (lines ~84 and ~122)
- **Issue:** The `resolveAgentId` reference code — which lives **in** `packages/loop/src/agent-selection.ts` — contains `import { DEFAULT_AGENT_ID } from "./agent-selection.js";`, i.e. the module imports from itself. §4 (≈line 300) clarifies the constant is actually re-exported by `agent-selection.ts` from the 00-constants source, so within the file it is already in scope — the self-import is a factual error.
- **Suggested fix:** Change both import lines to the real 00-constants source consistent with §4's `<00-constants-module>` resolution (e.g. `import { DEFAULT_AGENT_ID } from "./constants.js";`), or drop the import and add a comment that the constant is in scope via this module's own re-export. Keep `01 §4` (which re-exports `DEFAULT_AGENT_ID`/`GENERIC_AGENT_ID` from `./agent-selection.js`) consistent with whichever physical source is chosen.
- **References:** `04-agent-selection.md` §3.1/§4; `00-core-definitions.md` §6; `01-architecture-layout.md` §4
- **Checklist:** CHECK-S17

### V-002: `resolveRunLevelProvider()` and `failRunSetup()` referenced in 05 but never defined
- **Severity:** gap
- **Location:** `05-runner-wiring.md` §4.3 (≈lines 484-488)
- **Issue:** The usage-gating algorithm calls `this.resolveRunLevelProvider()` (run-level provider, no item context) and `this.failRunSetup(runProviderResult.error)` (early-return-before-state-write), but neither is defined anywhere in the suite. §4.1 defines `resolveProviderForItem(item)` and §4.5 defines `detectAllCandidateAgents`, yet the run-level sibling and its error-surfacing path have no signature, return type, or error contract. Confirmed via grep that neither exists in `runner.ts` today, so both are net-new and must be specified. This is a fallible operation (wraps the throwing `createProvider`) whose Result type and propagation are referenced but undefined.
- **Suggested fix:** In `05` §4.1 (or a new §4.1.1) define `private resolveRunLevelProvider(): Result<LLMProvider>` as the item-less sibling of `resolveProviderForItem` (same `createProvider`-throw→`Result` wrapping, `getAgentDescriptors()` id list, `ErrorCodes.VALIDATION_ERROR`), and specify `failRunSetup(error)` as the early-return path that emits `loop_error`, returns the zero-iteration run result, and writes no state (mirroring §4.5's pre-`writeState` return). Cross-reference from §4.3.
- **References:** `05-runner-wiring.md` §4.1/§4.3/§4.5; `registry.ts:11-19`
- **Checklist:** CHECK-S18, CHECK-S19

### V-003: REQ-SEC-01 spawn `cwd` confinement is left implicit (no `cwd` on the spawn helper)
- **Severity:** gap
- **Location:** `03-cli-agent-engine-and-presets.md` §4.2 and §5.1 (`SpawnProcessGroupOptions` has `timeoutMs`/`signal`/`env`/`stdin`/`onStdout` but **no `cwd`**); PRD REQ-SEC-01
- **Issue:** REQ-SEC-01 requires the auto-approve (elevated-permission) agent execution to be confined to the loop's working directory and not broaden rauf's path-sandboxing. §4.3 nails this for the temp prompt *file* (created in `ROOT_DIRECTORY`), but the spawn helper signature takes no `cwd`, and §4.2/§5.2 say it reproduces `claude-process.ts` behavior "exactly" — where `spawnClaude` inherits the parent process `cwd` implicitly (`spawn("claude", args, {…})` at `claude-process.ts:87` passes no `cwd`). The spec never explicitly asserts the agent subprocess runs with `cwd === ROOT_DIRECTORY` — the core of the REQ-SEC-01 trust boundary for `--full-auto`/`--yolo` agents — leaving it implicit.
- **Suggested fix:** In `03` §4.2/§5.1 state explicitly that the agent is spawned with the same `cwd` the runner uses for the iteration (the project `ROOT_DIRECTORY`), matching `spawnClaude`'s inherited-cwd behavior — either document the inherited cwd invariant or add an explicit `cwd?: string` to `SpawnProcessGroupOptions` defaulted to `ROOT_DIRECTORY`. Add a REQ-SEC-01 verification line to `03` §9.
- **References:** PRD REQ-SEC-01; `03` §4.2/§4.3/§5.1; `claude-process.ts:87`
- **Checklist:** CHECK-S30

### V-004: REQ-SEC-01 absent from every "Requirement Coverage" table (covered only in prose)
- **Severity:** gap
- **Location:** `03-cli-agent-engine-and-presets.md` Requirement Coverage table (lines ~12-24); `TRACEABILITY.md` REQ-SEC-01 row
- **Issue:** REQ-SEC-01 is the only requirement that appears in **no** doc's Requirement Coverage table. TRACEABILITY names `03` as its primary and the body does cover it (03 §4.3 temp-file-in-sandbox, §8 error row; 07 §3.2b file-delivery test), so the deterministic script reports it covered — but a reader scanning `03`'s coverage table for REQ-SEC-01 finds nothing, making the table→section map incomplete relative to the TRACEABILITY "Primary = 03" claim.
- **Suggested fix:** Add a row to `03`'s Requirement Coverage table: `| REQ-SEC-01 | Sandbox-confined spawn; prompt temp-file inside ROOT_DIRECTORY | 4.2, 4.3, 8 |` (cite §4.2 too once V-003 adds the cwd statement).
- **References:** `03` §4.3/§8; `07` §3.2b; `TRACEABILITY.md`; PRD §4.2 REQ-SEC-01
- **Checklist:** CHECK-S04, CHECK-S38, CHECK-S01

### V-005: Type-location contradiction — `PromptDelivery`/`BuildArgsContext` placed in `types.ts` by 01 but `cli-agent.ts` by 00/03
- **Severity:** inconsistency
- **Location:** `01-architecture-layout.md` §2 directory tree (`types.ts EDIT` line) vs `00-core-definitions.md` §1/§3.2 and `03-cli-agent-engine-and-presets.md` §3.1
- **Issue:** `01 §2` lists `PromptDelivery` and `BuildArgsContext` as living in `providers/types.ts`. But `00 §3.2` defines `PromptDelivery`/`BuildArgsContext`/`CliAgentConfig` as "Defined in `providers/cli-agent.ts`", and `03 §3.1` imports them `from "./cli-agent.js"`. A fresh implementer following `01`'s tree would put them in `types.ts`, and `03`'s import would then fail to resolve.
- **Suggested fix:** Edit `01 §2` so the `types.ts` line lists only `AgentAdapter`, `AgentDescriptor`, `DetectionResult`; move `PromptDelivery`/`BuildArgsContext` (and note `CliAgentConfig`) onto the `cli-agent.ts NEW` line, matching `00 §3.2`/`03 §3.1`.
- **References:** `01` §2/§4; `00` §1/§3.2; `03` §3.1
- **Checklist:** CHECK-S12, CHECK-S10

### V-006: Barrel export surface is internally inconsistent across `01 §4` ↔ `02 §5.x` ↔ `cli-agent.ts`
- **Severity:** inconsistency
- **Location:** `01-architecture-layout.md` §4 (lines ~113-124) and `02-agent-registry-and-detection.md` §5.x (`providers/index.ts` listing, lines ~514-540)
- **Issue:** Three reconciliation problems on the same export chain (`index.ts` → `providers/index.js` → `{registry,cli-agent}.js`):
  1. **`getAgentDescriptors` signature mismatch.** `01 §4` comments it as `// () => AgentDescriptor[] enriched with live available` — the *rejected* design. `02 §2/§4` deliberately splits: `getAgentDescriptors(): AgentDescriptor[]` is **synchronous, static, no I/O**, and a separate async `listAgents(): Promise<AgentAvailability[]>` carries live `available`.
  2. **Missing `listAgents`/`AgentAvailability` in the barrel.** `01 §4` omits both, yet `02 §5.x` defines them and `06 §4.2` imports `listAgents`/`AgentAvailability` from `@rauf/loop` — so the top-level barrel can't resolve them.
  3. **Broken `CliAgent`/`CliAgentConfig`/`PromptDelivery`/`BuildArgsContext` chain.** `01 §4` re-exports these four `from "./providers/index.js"`, but `02 §5.x`'s `providers/index.ts` listing never re-exports them from `./cli-agent.js` — the middle link is missing, so the top-level barrel cannot resolve them and the `01 §4` Verification checkbox ("exports … CliAgent, CliAgentConfig") fails.
- **Suggested fix:** (a) In `01 §4` change the `getAgentDescriptors` comment to `// () => AgentDescriptor[] — static, synchronous, no I/O (02 §4)` and add `listAgents` + `export type { AgentAvailability }`. (b) In `02 §5.x`'s `providers/index.ts` listing add `export { CliAgent } from "./cli-agent.js";` and `export type { CliAgentConfig, PromptDelivery, BuildArgsContext } from "./cli-agent.js";`. After the fix, the chain `index.ts → providers/index.js → {registry,cli-agent}.js` resolves every charter-contract symbol.
- **References:** `01` §4; `02` §2/§4/§5.x; `06` §4.2; `00` §3.2; `03` §3.1
- **Checklist:** CHECK-S10, CHECK-S12, CHECK-S17

### V-007: tech-spec v2 is stale vs the impl specs' three additive refinements (ExecuteOptions.env / process-group.ts / normalizeAgentAlias)
- **Severity:** inconsistency
- **Location:** `tech-spec.md` §1/§2/§6/§10 vs `00-core-definitions.md` §3.4, `01-architecture-layout.md` §2, `04-agent-selection.md` §3.2
- **Issue:** Three artifacts the impl specs (correctly) introduce are absent from / contradicted by the tech-spec: (1) `ExecuteOptions.env?` — `00 §3.4` and `05` add it as required for SC-2 childEnv, but tech-spec §1 says "all committed schema fields unchanged" and §6 lists `ExecuteOptions` "verbatim `types.ts:35-45`"; (2) `process-group.ts` extraction — shipped by `01`/`03 §5` but tech-spec §2 omits it (only §10 mentions it as open); (3) `normalizeAgentAlias` — a second `agent-selection.ts` export in `04`, absent from tech-spec §2. The impl specs are the correct/current party; the tech-spec wording is now the stale one.
- **Suggested fix:** Add a short "Resolved in specs (post-tech)" note to `tech-spec.md` recording the three additive refinements, explicitly superseding the "ExecuteOptions verbatim/unchanged" wording in §1/§6 **for the one `env` field**. (Low urgency — does not block the impl specs, but prevents a future reader from treating the tech-spec as contradicting them.)
- **References:** `tech-spec.md` §1/§2/§6/§10; `00` §3.4; `01` §2; `04` §3.2; `05` "Resolved during cross-reference validation"
- **Checklist:** CHECK-S05, CHECK-S08

### V-008: Section misnumbering in `02-agent-registry-and-detection.md` (§4.4 and §5.x appear after §5.3)
- **Severity:** inconsistency
- **Location:** `02-agent-registry-and-detection.md` headings — `## 4` → `## 5` → `### 5.1/5.2/5.3` → `## 4.4` (≈line 475) → `## 5.x` (≈line 514) → `## 6`
- **Issue:** The heading sequence is out of order: a top-level `## 4.4` appears several sections after §4, and `## 5.x` is a placeholder number. Both resolve textually (so cross-refs like `02 §4.4`/`02 §5.x` hit text) but the numbering is internally inconsistent and confusing.
- **Suggested fix:** Renumber "The reserved generic-cli descriptor" → `### 5.4` (detector behavior, belongs under §5) and "providers/index.ts — register all built-ins" → `## 6`, shifting Configuration→§7, Error handling→§8, Example→§9. Then grep the suite for `§4.4`/`§5.x` citing `02` (e.g. `03` line ~26, `06` §4 lines ~405-406, `02` self-ref ~277) and update each. (Coordinate with V-006, which also edits `02 §5.x`.)
- **References:** `02` §4.4/§5.x and its citers in `00`/`03`/`06`
- **Checklist:** CHECK-S15, CHECK-S04

### V-009: Stale `// see Warnings` ErrorCodes hedges in 05 superseded by the doc's own resolution
- **Severity:** improvement
- **Location:** `05-runner-wiring.md` §4.1 (≈line 376) and §4.5 (≈line 724)
- **Issue:** The two new fallible ops carry inline hedges (`ErrorCodes.VALIDATION_ERROR, // or the project's validation member; see Warnings` and `ErrorCodes.FILE_NOT_FOUND, // … see Warnings re: exact member`), but the doc's "Resolved during cross-reference validation" block already settles these definitively (confirmed against `errors.ts:21-32`; no `INVALID_INPUT`). The cited members are correct — only the hedging comments are stale.
- **Suggested fix:** Replace with definitive comments: §4.1 → `// VALIDATION_ERROR for unknown/mistyped id (resolved, errors.ts:21-32)`; §4.5 → `// FILE_NOT_FOUND for absent binary (resolved, errors.ts:21-32)`.
- **References:** `05` §4.1/§4.5 + Resolved block; `00` §5; `errors.ts:21-32`
- **Checklist:** CHECK-S11, CHECK-S13

### V-010: `01` hedges `process-group.ts` as "may be omitted" while its tree marks it a definite NEW file
- **Severity:** improvement
- **Location:** `01-architecture-layout.md` §2 tree (`process-group.ts NEW`) and the note at ≈lines 85-88
- **Issue:** The tree lists `process-group.ts NEW` (definite), but the following note says "if kept inline, `process-group.ts` is omitted" — leaving `01` internally hedged about a file its own tree marks definite. `03 §5` actually resolves this as extraction.
- **Suggested fix:** Change the `01 §2` note to state the decision is **resolved in `03 §5` as extraction**, so the tree's `NEW` marking is unconditional.
- **References:** `01` §2; `03` §5; `tech-spec.md` §10
- **Checklist:** CHECK-S06, CHECK-S08

### V-011: Prose-anchor cross-references to doc 05 don't resolve to numbered headings
- **Severity:** improvement
- **Location:** `00` §5 (`05 §per-iteration resolve`, `§usage gating`, `§neutralization`); `02` (`05 §usage`); `03` (`05 §childEnv`, `§usage`); `07` (`05 §childEnv`, `§error handling`); `TRACEABILITY.md` (lines ~50-54)
- **Issue:** These citations use descriptive prose anchors that don't correspond to any literal heading in `05` (whose headings are numbered §3.1/§4.1/§4.3/§4.4/§4.5/§5). Inferable but not resolvable `§N.N` anchors, inconsistent with the suite's otherwise-numeric citation style. No *numeric* `§N.N` citation in the suite is dangling.
- **Suggested fix:** Replace each prose anchor with the numbered section: `§usage`/`§usage gating` → `05 §4.3`; `§neutralization` → `05 §4.4`; `§childEnv` → `05 §3.1`; `§per-iteration resolve` → `05 §4.1`; `§pre-loop detection` → `05 §4.5`; `§error handling` → `05 §5`. Apply across `00`, `02`, `03`, `07`, `TRACEABILITY.md`.
- **References:** target headings in `05` §3.1/§4.1/§4.3/§4.4/§4.5/§5
- **Checklist:** CHECK-S15

### V-012: SC-2 coverage-table row omits the net-new child-env (`ExecuteOptions.env`) regression test
- **Severity:** improvement
- **Location:** `07-testing-strategy.md` SC coverage table (≈line 23) vs §5 (≈lines 488-495)
- **Issue:** The SC-2 row lists only **unchanged** surfaces (`claude-cli.test.ts (UNCHANGED)`, existing claude scenarios), but §5 introduces a genuinely **new** SC-2 case asserting `ExecuteOptions.env` (childEnv / `REVIEW_HOOK_SUPPRESSION_ENV`) is forwarded to `SpawnClaudeOptions.env` after routing through `provider.execute`. A reader scanning the table would miss the one net-new assertion guarding a silent review-hook-suppression regression.
- **Suggested fix:** Append to the SC-2 row's test-surface cell: `+ new child-env forwarding case (ExecuteOptions.env → SpawnClaudeOptions.env) in claude-cli.test.ts / runner.test.ts (§5)`.
- **References:** `07` §5; `00` §3.4; `runner.ts:615/973`
- **Checklist:** CHECK-S34, CHECK-S37

### V-013: Placeholder usage-marker / log path in 07 where the concrete values exist
- **Severity:** improvement
- **Location:** `07-testing-strategy.md` §4.3 item 3 (≈line 443) and §5 (≈lines 506-507)
- **Issue:** The "Anthropic preflight skipped" assertion is written as `! grep -q "<usage-limit detection marker>" "$LOG"`, leaving marker and log file as placeholders. The real harness greps the literal `"Usage limit detected"` against `$SANDBOX_DIR/.rauf/rauf.log` (`verify.sh:380`); there is no `$LOG` var in `verify.sh`.
- **Suggested fix:** Use the concrete values: `! grep -q "Usage limit detected" "$SANDBOX_DIR/.rauf/rauf.log"`, citing `verify.sh:380` as the marker source.
- **References:** `test-sandbox/verify.sh:380`; `test-sandbox/setup.sh:7`
- **Checklist:** CHECK-S35

### V-014: `runner.ts` signalText fallback cited at `:644`; actual ternary is `:645` (and condition paraphrased)
- **Severity:** improvement
- **Location:** `07-testing-strategy.md` §3.4 (≈line 322)
- **Issue:** 07 cites `runner.ts:644` and quotes `signalText = reconstructedText?.length ? reconstructedText : stdout`. Source: `:629` destructures `reconstructedText`; the ternary is at **`:645`** and reads `reconstructedText && reconstructedText.length > 0 ? reconstructedText : stdout`. Semantically equivalent, line/form slightly off. (Note: `05`/`00` cite `:644` for the same fallback — the off-by-one is shared; align all to `:645`.)
- **Suggested fix:** Change `:644`→`:645` and the quoted expression to the exact source form, in `07` §3.4 (and align the `:644` cites in `05 §3.4`/`00 §3.4` if present).
- **References:** `runner.ts:629/645`; `00 §3.4`; `05 §3.4`
- **Checklist:** CHECK-S37

### V-015: `createProvider` throw cited at `registry.ts:14`; the `throw` statement is `:15`
- **Severity:** improvement
- **Location:** `02` (lines ~169/170/572/582), `05` §4.1 + §2 dependency note, `tech-spec.md` §6/§7 (`00 §7` correctly cites `:11`)
- **Issue:** The unknown-id throw is anchored to `registry.ts:14`, but `:13` is `if (!factory) {`, `:14` is `const available = …`, and the `throw new Error(...)` is at `:15`. The function declaration is at `:11` (correctly cited elsewhere).
- **Suggested fix:** Where the *throw site* is referenced, change `registry.ts:14` → `registry.ts:15` (or cite the guard span `:13-17`); leave `createProvider` declaration cites at `:11`.
- **References:** `registry.ts:11-20`
- **Checklist:** CHECK-S25

### V-016: `LlmSpawned`/`LlmExited` schema cited as `schemas.ts:449-463` in 05 §3.3; block opens at `:448`
- **Severity:** improvement
- **Location:** `05-runner-wiring.md` §3.3 (≈line 257)
- **Issue:** The event-schema block is `LlmSpawnedSchema` `:448-454` + `LlmExitedSchema` `:456-463` (union span `:448-463`); `tech-spec.md §6` and `00 §7` correctly cite `:448-463`, but `05 §3.3` starts at `:449`. The `provider: z.string()` fields (`:451`/`:459`) are cited correctly.
- **Suggested fix:** Change `core/schemas.ts:449-463` → `:448-463` in `05 §3.3`.
- **References:** `schemas.ts:448-463`
- **Checklist:** CHECK-S25, CHECK-S23

### V-017: `test-sandbox/claude` described as a "4-line dispatcher"; file is 5 lines
- **Severity:** improvement
- **Location:** `07-testing-strategy.md` §4 (≈line 369)
- **Issue:** 07 calls the mock "a 4-line dispatcher"; the actual `test-sandbox/claude` is 5 lines (shebang + 4 logic lines). Trivial.
- **Suggested fix:** Change "a 4-line dispatcher" to "a tiny dispatcher" to avoid a brittle exact count.
- **References:** `test-sandbox/claude`
- **Checklist:** CHECK-S35

## Fix Execution Plan

### User Decisions Required
None — all 17 fixes are deterministic doc edits applicable directly. (V-003 has a minor choice —
document inherited `cwd` vs add an explicit `cwd?` option — either satisfies REQ-SEC-01; default to
adding `cwd?: string` to `SpawnProcessGroupOptions` for explicitness.)

### Execution Steps

#### Step 1: Reconcile the export surface and type locations (highest value — prevents import failures)
- **Files:** `01-architecture-layout.md` (§2 tree, §4 barrel), `02-agent-registry-and-detection.md` (§5.x `providers/index.ts` listing)
- **Addresses:** V-005, V-006
- **Checklist:** CHECK-S10, CHECK-S12, CHECK-S17
- **Action:** (a) `01 §2`: move `PromptDelivery`/`BuildArgsContext` (and note `CliAgentConfig`) from the `types.ts` line to the `cli-agent.ts NEW` line. (b) `01 §4`: fix the `getAgentDescriptors` comment to "static, synchronous, no I/O"; add `listAgents` and `export type { AgentAvailability }`. (c) `02 §5.x`: add `export { CliAgent } from "./cli-agent.js";` and `export type { CliAgentConfig, PromptDelivery, BuildArgsContext } from "./cli-agent.js";`. Verify the full chain `index.ts → providers/index.js → {registry,cli-agent}.js` resolves every §2-listed charter symbol.
- **Depends on:** none

#### Step 2: Define the two missing runner helpers
- **Files:** `05-runner-wiring.md` (§4.1 or new §4.1.1; cross-ref §4.3)
- **Addresses:** V-002
- **Checklist:** CHECK-S18, CHECK-S19
- **Action:** Specify `private resolveRunLevelProvider(): Result<LLMProvider>` (item-less sibling of `resolveProviderForItem`, same throw→Result wrapping + `VALIDATION_ERROR` + id list) and `failRunSetup(error)` (emit `loop_error`, return zero-iteration result, write no state). Reference both from §4.3.
- **Depends on:** none

#### Step 3: Close the REQ-SEC-01 spawn-cwd gap and surface it in coverage tables
- **Files:** `03-cli-agent-engine-and-presets.md` (§4.2, §5.1 `SpawnProcessGroupOptions`, §9, Requirement Coverage table); `TRACEABILITY.md` (optional supporting note)
- **Addresses:** V-003, V-004
- **Checklist:** CHECK-S30, CHECK-S04, CHECK-S38
- **Action:** Add `cwd?: string` (default `ROOT_DIRECTORY`) to `SpawnProcessGroupOptions` and state the agent spawns with `cwd === ROOT_DIRECTORY` as the REQ-SEC-01 confinement boundary; add a §9 verification line; add a `REQ-SEC-01` row to `03`'s Requirement Coverage table (§4.2/§4.3/§8).
- **Depends on:** none

#### Step 4: Fix the self-import error
- **Files:** `04-agent-selection.md` (§3.1 code blocks)
- **Addresses:** V-001
- **Checklist:** CHECK-S17
- **Action:** Replace `import { DEFAULT_AGENT_ID } from "./agent-selection.js";` with the real 00-constants source consistent with §4's resolution (e.g. `./constants.js`), or drop the import with an in-scope-via-re-export comment.
- **Depends on:** none (coordinate the chosen constants module with Step 1's `01 §4` re-export)

#### Step 5: Reconcile the stale tech-spec and `02` section numbering
- **Files:** `tech-spec.md` (post-tech "Resolved in specs" note); `02-agent-registry-and-detection.md` (§4.4→§5.4, §5.x→§6, shift §6/§7/§8) and its citers
- **Addresses:** V-007, V-008
- **Checklist:** CHECK-S05, CHECK-S08, CHECK-S15
- **Action:** Add the tech-spec resolution note (ExecuteOptions.env / process-group.ts / normalizeAgentAlias). Renumber `02`'s out-of-sequence headings and update every `§4.4`/`§5.x` citation across the suite. (Do `02`'s renumber in the same pass as Step 1's `02 §5.x` edit.)
- **Depends on:** Step 1 (both touch `02 §5.x`)

#### Step 6: Citation, anchor, and clarity polish
- **Files:** `00` (§3.4 cite), `05` (§3.3, §3.4, §4.1, §4.5), `07` (§3.4, §4, §4.3, §5, SC table), `02`/`tech-spec`/`TRACEABILITY.md` (prose anchors + `registry.ts:14`→`:15`)
- **Addresses:** V-009, V-010, V-011, V-012, V-013, V-014, V-015, V-016, V-017
- **Checklist:** CHECK-S11, CHECK-S13, CHECK-S15, CHECK-S25, CHECK-S34, CHECK-S35, CHECK-S37
- **Action:** Replace prose `§`-anchors with numbered sections (V-011); fix `:644`→`:645` (V-014), `registry.ts:14`→`:15` (V-015), `schemas.ts:449`→`:448` (V-016); de-hedge the ErrorCodes comments (V-009); make `01`'s `process-group.ts` marking unconditional (V-010); add the child-env case to the SC-2 row (V-012); concretize the usage-marker grep (V-013); soften "4-line dispatcher" (V-017).
- **Depends on:** Step 5 (V-011 prose-anchor and V-008 renumber both touch citations; do after renumber to avoid double-editing)

## Verdict

No blocking gaps. The substantive findings (V-001, V-002, V-005, V-006, V-003) are well-specified
doc edits that prevent real implementation friction (import resolution, undefined references,
security boundary). Recommend applying all via `forge-fix` before generating the backlog.

## Fix Progress
- Step 1: [APPLIED] 2026-06-15 — V-005/V-006: `01 §2` moves PromptDelivery/BuildArgsContext to the `cli-agent.ts` line; `01 §4` fixes the `getAgentDescriptors` comment (static/sync) + adds `listAgents`/`AgentAvailability`; `02 §6` (`providers/index.ts`) re-exports `CliAgent`/`CliAgentConfig`/`PromptDelivery`/`BuildArgsContext` from `./cli-agent.js`. Export chain now resolves.
- Step 2: [APPLIED] 2026-06-15 — V-002: `05 §4.1.1` defines `resolveRunLevelProvider(): Result<LLMProvider>` and `failRunSetup(error): LoopResult` (no state write before iteration 1).
- Step 3: [APPLIED] 2026-06-15 — V-003/V-004: `03 §5.1` adds `cwd?` to `SpawnProcessGroupOptions` (default ROOT_DIRECTORY, REQ-SEC-01 boundary) + §9 verification line; REQ-SEC-01 row added to `03` Requirement Coverage table.
- Step 4: [APPLIED] 2026-06-15 — V-001: `04 §3.1` self-import fixed to `./constants.js`; `<00-constants-module>` resolved to `constants.ts`; `01 §2` tree adds `constants.ts`.
- Step 5: [APPLIED] 2026-06-15 — V-007: tech-spec gains §11 "Resolved in specs" note (ExecuteOptions.env / process-group.ts / normalizeAgentAlias / rauf agents). V-008: `02` headings renumbered (§4.4→§5.4, §5.x→§6, §6→§7, §7→§8, §8→§9); all `§4.4`/`§5.x` citers updated (02 self-ref, 06).
- Step 6: [APPLIED] 2026-06-15 — V-009..V-017: de-hedged ErrorCodes comments (05); `01` process-group note unconditional; prose `§`-anchors → numbered (00/02/03/07/TRACEABILITY); SC-2 row adds child-env test (07); concretized usage-marker grep (07); fixed paraphrased signalText quotes → `:644-645` (03/07); `registry.ts:14`→`:15`; `schemas.ts:449`→`:448` (00/05); "4-line"→"tiny" dispatcher (07).
