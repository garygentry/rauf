# Verification Report: rauf-agent-cli-adapters (tech)
Date: 2026-06-15
Pipeline Stage: forge-2-tech complete; forge-verify-tech pending
Artifacts Reviewed: PRD.md (v2), tech-spec.md (v1), EPIC.md, epic-manifest.json, and rauf source (providers/{types,registry,claude-cli,index}.ts, runner.ts, claude-process.ts, signal-parser.ts, signal-redactor.ts, exit-classifier.ts, usage-checker.ts, core/schemas.ts, cli/loop-commands.ts)

Checks Executed: 17 of 17 (CHECK-T01..T17). Results: 16 pass, 0 fail, 1 not-applicable (CHECK-T15 migration/deployment — n/a, additive non-breaking, no migration). No `error`-severity finding — every cited file:line and signature in the spec was verified accurate against source.

## Summary
- Total findings: 5
- Gaps: 2
- Inconsistencies: 1
- Improvements: 2
- Errors: 0

Integration accuracy is excellent — every exact source claim in the spec was verified (runner.ts lines 47/252/494/512/609/633/644/651/680/969/1393/1471/1577; claude-process spawn:87 detached:true / kill:162-173 / stdin:217 / GRACE 30s; schemas.ts field lines 69/72/148/149/222/223/377 and LlmSpawned/LlmExited 448-463 both `provider: z.string()`; exit-classifier ExitClass :22-29; loop-commands handleLoopRun:688 / options:813 / body.model:385 / event.provider:1184). All matched. The spec's central thesis is correct and stronger than stated: the provider seam exists, is exported via `index.ts`, and is **never called by the runner today** (no runtime callers of `createProvider`/`validateCredentials`/`checkUsage` — the runner calls `spawnClaude` directly). Traceability is strong: all 24 REQ-IDs (SEL-01..04, ADP-01..06, EXEC-01..03, SIG-01..02, DET-01..02, DISC-01..02, MODEL-01..02, USAGE-01..02, PERF-01, SEC-01..02, OBS-01..02, SCALE-01) trace to a technical approach. All three charter contracts (AgentAdapter, agent-cli-registry, loop-agent-selection) are delivered at the §2 export surface.

## Findings

### V-001: Review-pass neutralization site is under-specified — review path parses raw `stdout`, not `signalText`
- **Severity:** gap
- **Location:** tech-spec.md §3.7 (Signal contract & neutralization), and §3.2 (review-pass wiring)
- **Issue:** §3.7 says `neutralizeForDetection` is applied "uniformly to **every** adapter's output immediately before `parseSignal`, in **both** execution paths." The work iteration computes `signalText` (runner.ts:644) and the spec describes that path. But the **review pass** (runner.ts:969) does not use `signalText` — it parses the signal directly from raw `stdout` at runner.ts:986 (`const parsed = parseSignal(stdout)`), with no `reconstructedText` fallback. A fresh agent following only the work-iteration description could miss that the review path needs its own neutralization insertion at a different variable (`stdout`, not `signalText`) and a different line (:986, not :670). REQ-SEC-02 ("uniformly across all adapters") and REQ-ADP-06 ("both runner execution paths") both require the review path to be covered.
- **Suggested fix:** In §3.7 add an explicit sentence: "In the review pass the signal is parsed from raw `stdout` at `runner.ts:986`, so apply `neutralizeForDetection(stdout)` there before `parseSignal`; the work iteration applies it to `signalText` before `parseSignal` at `runner.ts:670`." Reference both line sites in the §6 Integration table `signal-redactor.ts` row.
- **References:** runner.ts:644/:670/:969/:986; PRD REQ-SEC-02, REQ-ADP-06, SC-6
- **Checklist:** CHECK-T05, CHECK-T07, CHECK-T16

### V-002: Public re-export of `spawnClaude` (`index.ts:12`) not addressed by the "only importer" assertion
- **Severity:** gap
- **Location:** tech-spec.md §3.2 (final blockquote: "the only `spawnClaude` importer is `providers/claude-cli.ts`; `runner.ts:47` drops the `spawnClaude` import. A lint/grep assertion in tests guards against re-introducing a direct spawn in the runner.")
- **Issue:** `spawnClaude` is also publicly re-exported at `packages/loop/src/index.ts:12` (`export { spawnClaude } from "./claude-process.js";`). The spec's grep/lint guard described against "re-introducing a direct spawn in the runner" is fine, but a naive grep for `spawnClaude` will match this public re-export and `claude-process.ts` itself. The spec should state whether the public re-export is retained (it's part of the package's exported surface) and scope the guard to `runner.ts` specifically so the assertion doesn't false-positive on `index.ts:12`.
- **Suggested fix:** Add a clause to §3.2: "The public re-export at `index.ts:12` is retained (external surface unchanged); the guard greps `runner.ts` only for a direct `spawnClaude(` call site, not the whole package." Optionally note in §6 that `index.ts` continues to re-export `spawnClaude`.
- **References:** packages/loop/src/index.ts:12; runner.ts:47
- **Checklist:** CHECK-T05, CHECK-T08, CHECK-T13

### V-003: Per-iteration provider caching + `dispose` lifecycle has no error-path / partial-resolution specification
- **Severity:** improvement
- **Location:** tech-spec.md §3.2 (per-iteration resolve/construct, "caching one instance per distinct agent id ... `provider.dispose?.()` is called for each cached instance on loop end") and §7 (Error Handling)
- **Issue:** The design constructs providers lazily per distinct agent id and caches them, disposing each on loop end. §7 does not cover: (a) what happens to the cache and to `dispose` when the loop exits via an early fail-fast (detection failure, REQ-DET-02) or a thrown/abort path — are partially-constructed providers disposed? (b) whether `createProvider` throwing mid-run (unknown id surfaced from a per-item `provider`) is caught and converted to a `Result` per the CLAUDE.md "no throw for expected errors" rule. The fail-fast detection in §3.5 collects all candidate agent ids up front, which mitigates (b) for detection, but a per-item id that is registered-but-mistyped vs unregistered isn't disambiguated.
- **Suggested fix:** Add to §7 a "Provider lifecycle on early exit" bullet: dispose all cached provider instances in a `finally` on every loop-exit path (normal end, fail-fast, abort, error), and wrap `createProvider` in the per-iteration resolve in a try/catch that returns a `Result` error (listing `getAgentDescriptors()` ids) rather than throwing. Cross-reference REQ-DET-02 and the existing per-item resolution in §3.2.
- **References:** PRD REQ-DET-02, REQ-PERF-01; CLAUDE.md error-handling rule; runner.ts loop-exit paths
- **Checklist:** CHECK-T10, CHECK-T16

### V-004: Generic-cli adapter id/registration vs the reserved `generic-cli` registry key is ambiguous
- **Severity:** inconsistency
- **Location:** tech-spec.md §3.4 (generic-cli), §2 module structure (`generic-cli.ts`), §4 data model (`ToolConfig.providers[id]`, `MarkerOptions.providerConfig`)
- **Issue:** §3.4 says `generic-cli.ts` builds its `CliAgentConfig` from `MarkerOptions.providerConfig` / `ToolConfig.providers[id]`, and §3.5 says the descriptor for an adapter "with no single binary" omits `binaryName` (default PATH detect can't probe). But the spec never states the registered **id** under which generic-cli appears in the registry, nor how a user selects "the generic adapter for arbitrary agent X": is the user-facing `--agent X` matched against `ToolConfig.providers[X]` (so X is an arbitrary id, and generic-cli is the fallback engine), or is `generic-cli` itself a selectable id whose binary comes from `providerConfig`? §3.5's note that generic-cli "probes its configured binary" implies the configured binary is known at detect time, which conflicts with §3.5's "omitted `binaryName` for adapters with no single binary." These two statements need reconciling.
- **Suggested fix:** Clarify in §3.4/§3.5 the resolution rule: e.g. "`--agent <id>` where `<id>` matches a key in `ToolConfig.providers`/`providerConfig` constructs a `CliAgent` from that config (binaryName taken from the config, so detect CAN PATH-probe it); the literal id `generic-cli` is reserved for the marker-`providerConfig`-driven single instance." State the registered id(s) and how `detectAgent` resolves a binary for config-driven agents.
- **References:** PRD REQ-ADP-04, REQ-ADP-05, REQ-SCALE-01, REQ-DET-01; schemas.ts ToolConfig.providers:223, MarkerOptions.providerConfig:149
- **Checklist:** CHECK-T06, CHECK-T07, CHECK-T16

### V-005: REQ-EXEC-03 outcome vocabulary maps onto `ExitClass`, but the mapping/equivalence is asserted without being shown
- **Severity:** improvement
- **Location:** tech-spec.md §6 Integration table (`exit-classifier.ts` row: "outcome vocabulary unchanged (REQ-EXEC-03)") and §7 ("mapped into `ExitClass` ... uniformly regardless of agent")
- **Issue:** PRD REQ-EXEC-03 names the loop outcome vocabulary as "done / blocked / needs-human / error / limit." The actual `ExitClass` (verified at exit-classifier.ts:22-29) is `done / blocked / needs_human / usage_limited / timeout / infra_error / genuine_retry` — a richer set that is NOT a 1:1 match with the PRD's five terms (PRD's "error" ≈ {timeout, infra_error, genuine_retry}; "limit" ≈ usage_limited). The spec asserts "outcome vocabulary unchanged" without showing this mapping, and the design relies on `classifyExit`/`hasUsageLimitInText` being agent-agnostic. For plain-text agents, `hasUsageLimitInText` will substring-match phrases like "rate limit" / "usage limit" in arbitrary agent output (exit-classifier.ts:4-10) — which for non-claude agents could spuriously classify a normal exit as `usage_limited`, partially in tension with REQ-USAGE-02 ("no spurious limit detection").
- **Suggested fix:** Add a short mapping note in §6 or §3.6 showing PRD vocabulary → ExitClass, and address the substring-match risk: state whether `hasUsageLimitInText` should be gated to claude-only (consistent with §3.6's `checkUsage`-gating) so a non-claude agent that merely prints "rate limit" in normal output is not misclassified. Tie this to SC-1's "no error raised" for plain-text agents.
- **References:** PRD REQ-EXEC-03, REQ-USAGE-02, SC-1; exit-classifier.ts:4-10/:22-29; tech-spec §3.6
- **Checklist:** CHECK-T02, CHECK-T16

**Intentionally NOT flagged** (deferred per PRD §7 / tech-spec §10, confirmed deliberate): OQ-2 exact per-agent non-interactive/model flags; `rauf agents` vs `rauf loop agents` command name; shared `spawnProcessGroup` helper extraction. Also not flagged: the manifest/EPIC.md charter prose says AgentAdapter does "stream parse," while the PRD scopes rich non-claude stream parsing as out-of-scope — this is acceptable prose-vs-PRD altitude (the abstraction *can* stream for claude; non-claude is plain-text by PRD design), not a contradiction.

## Fix Execution Plan

### User Decisions Required
- **V-004** [RESOLVED 2026-06-15 — user accepted recommended default]: arbitrary `--agent <id>`
  matches a key in `ToolConfig.providers[<id>]` (binary taken from config, so detect CAN PATH-probe
  it); the literal id `generic-cli` is reserved for the marker-`providerConfig`-driven single
  instance (its descriptor omits `binaryName` and uses a custom config-resolving detect).
- **V-005** [RESOLVED 2026-06-15 — user accepted recommended default]: gate `hasUsageLimitInText` to
  claude-only (the mid-iteration banner scan sits inside the `checkUsage`-gated block), preventing
  spurious `usage_limited` classification of plain-text agent output.

### Execution Steps

#### Step 1: Specify neutralization in the review pass
- **Files:** specs/agent-agnostic/rauf-agent-cli-adapters/tech-spec.md (§3.7, §6 signal-redactor row)
- **Addresses:** V-001
- **Checklist:** CHECK-T05, CHECK-T07
- **Action:** Add explicit text that `neutralizeForDetection` is applied at runner.ts:670 (work path, on `signalText`) and at runner.ts:986 (review path, on `stdout` before `parseSignal`). Update the §6 `signal-redactor.ts` Notes to cite both line sites.
- **Depends on:** none
- **Rationale:** Closes the highest-value gap; pins down both REQ-ADP-06 paths to concrete lines a fresh agent can wire.

#### Step 2: Scope the spawnClaude guard and acknowledge the public re-export
- **Files:** tech-spec.md (§3.2 final blockquote; §6 events/index note)
- **Addresses:** V-002
- **Checklist:** CHECK-T08, CHECK-T13
- **Action:** Add a clause that `index.ts:12` retains the public `spawnClaude` re-export and the test guard greps `runner.ts` specifically for a `spawnClaude(` call site.
- **Depends on:** none

#### Step 3: Add provider lifecycle error/dispose specification
- **Files:** tech-spec.md (§7 Error Handling; cross-ref §3.2)
- **Addresses:** V-003
- **Checklist:** CHECK-T10
- **Action:** Add a bullet specifying `finally`-dispose of all cached providers on every exit path, and try/catch around per-iteration `createProvider` returning a `Result` error.
- **Depends on:** none

#### Step 4: Disambiguate generic-cli id/registration and detect-binary resolution
- **Files:** tech-spec.md (§3.4 and §3.5)
- **Addresses:** V-004
- **Checklist:** CHECK-T06, CHECK-T07
- **Action:** After the user decision above, state the registered id(s) for config-driven agents, how `--agent <id>` resolves to a `CliAgentConfig`, and how `detectAgent` obtains a binary to probe for config-driven agents (reconcile with the "omitted binaryName" note).
- **Depends on:** User decision (V-004)

#### Step 5: Add ExitClass mapping note and address usage-substring risk for non-claude agents
- **Files:** tech-spec.md (§3.6 and/or §6 exit-classifier row)
- **Addresses:** V-005
- **Checklist:** CHECK-T02
- **Action:** Add PRD-vocabulary → ExitClass mapping; after the V-005 user decision, state whether `hasUsageLimitInText` is gated claude-only to prevent spurious `usage_limited` classification of plain-text agent output (REQ-USAGE-02 / SC-1).
- **Depends on:** User decision (V-005)

## Fix Progress
- Step 1: [APPLIED] 2026-06-15 — V-001: §3.7 now names both neutralization sites (work `runner.ts:670` on `signalText`; review `runner.ts:986` on `stdout`); §6 signal-redactor row cites both.
- Step 2: [APPLIED] 2026-06-15 — V-002: §3.2 blockquote retains public `spawnClaude` re-export (`index.ts:12`) and scopes the test guard to `runner.ts` only.
- Step 3: [APPLIED] 2026-06-15 — V-003: §7 adds "Provider lifecycle on early exit" (try/catch→Result on per-iteration createProvider; finally-dispose of all cached providers on every exit path).
- Step 4: [APPLIED] 2026-06-15 — V-004: §3.4/§3.5 disambiguate config-driven selection (named id via ToolConfig.providers keeps binaryName + default probe; reserved `generic-cli` omits binaryName + custom detect).
- Step 5: [APPLIED] 2026-06-15 — V-005: §3.6 gates `hasUsageLimitInText` claude-only; §6 adds PRD→ExitClass mapping table.
