---
name: agent-cli-adapters-facts
description: Verified ground truth for rauf-agent-cli-adapters tech-spec — provider seam exists but unwired, all cited file:line claims accurate
metadata:
  type: project
---

Verified source facts for feature `rauf-agent-cli-adapters` (epic agent-agnostic), tech-spec v1.

**Why:** tech-mode verification needs to confirm the spec's many exact file:line/signature claims against real code.

**How to apply:** trust these for re-verifies; re-check if files changed.

- Provider seam EXISTS and is tested but is **never called by the runner** today. `createProvider`/`validateCredentials`/`checkUsage`/`getAvailableProviders` have NO runtime callers in runner.ts or loop-commands.ts (only re-exported via index.ts). Runner calls `spawnClaude` directly. Spec's central thesis ("seam exists, not wired") is accurate.
- All cited runner.ts lines accurate: import :47, model precedence :494 (`item.model ?? this.options.model ?? projectModel`), llm_spawned provider:"claude-cli" :512, work spawnClaude :609, llm_exited :633, signalText fallback :644, mid-iter usage banner :651, redaction :680, review spawnClaude :969, preflight :252, runUsagePreflight :1393, handleStderrUsageLimit :1471, checkBetweenIterations :1577.
- Review pass (:969) omits outputFormat AND parses signal from raw `stdout` (:986), NOT `signalText`. Spec says neutralize "both paths" — fresh agent must add neutralization to the review stdout path explicitly.
- signal-redactor.ts SIGNAL_TOKENS = [RAUF_DONE, RAUF_BLOCKED, RAUF_NEEDS_HUMAN] — RAUF_REVIEW absent (spec accurate). `.replace("_", "·")` replaces only first underscore (still neutralizes via broken RAUF_ prefix).
- redactSignalTokens used ONLY at runner.ts:680 (log preview), not pre-detection. Confirmed.
- claude-process: spawn("claude") :87 detached:true, GRACE_PERIOD 30s :9, kill :162-173, stdin write :217. claude uses STDIN prompt delivery.
- schemas.ts exact lines all accurate: BacklogItem.model :69 / .provider :72; MarkerOptions.provider :148 / .providerConfig :149; ToolConfig.defaultProvider :222 / .providers :223; LoopStartOptions.provider :377; LlmSpawned :448-454, LlmExited :456-463 both `provider: z.string()`.
- exit-classifier ExitClass :22-29 = done/blocked/needs_human/usage_limited/timeout/infra_error/genuine_retry. NOTE: these are NOT the PRD outcome vocab (done/blocked/needs-human/error/limit) verbatim — REQ-EXEC-03 maps onto these.
- CLI loop-commands: handleLoopRun :688, options assembly :813, detached body.model :385, event.provider render :1184/:1186. extractStringFlag exists.
- `spawnClaude` is ALSO publicly re-exported at packages/loop/src/index.ts:12 — spec §3.2 says "only importer will be claude-cli.ts" but doesn't address this public re-export.
- EPIC.md contracts (lines 69-71) match manifest exposes exactly. Charter prose says AgentAdapter does "stream parse" but PRD defers rich non-claude stream parsing (out-of-scope) — prose/PRD tension, acceptable.
- Downstream: cross-agent-installer consumes agent-cli-registry; forge-rauf-loop-default consumes loop-agent-selection (EPIC.md :140/:160).
- tech-spec v2 (2026-06-15): all 5 prior findings (V-001..V-005) applied correctly. v2-added citations re-verified exact: review parseSignal(stdout) :986, work parseSignal(signalText) :670, signal-parser parseSignal :27, index.ts spawnClaude re-export :12, runner import :47, signalText :644, mid-iter scan :651. registry.createProvider throws at :11 (throw body :15), types.ts LLMProvider :12-33 verbatim.
- CITATION IMPRECISION (carried from v1, low-sev): spec cites `hasUsageLimitInText` at `exit-classifier.ts:4-10` (§3.6 + §6 table) but the FUNCTION is declared at :16; lines 4-10 are the `USAGE_LIMIT_PATTERNS` array it matches against. Points at the right logic, wrong line for the named fn. Pre-existing, accepted by v1 pass.
- BACKLOG (13 items, IDs 001–013) re-verify 2026-06-15: 3 fixes (commit 8ac3082) all landed correctly + ZERO new/residual findings. V-001 item 011 now has step 4 EDIT commands.test.ts (distinct from step 3's loop-commands.test.ts) + 7th AC bullet → 7 AC. V-002 runDetached reads non-coalesced `extractStringFlag(...,"agent")` string|null (distinct from in-process `?? undefined`). V-003 item 006 deps=["001","003","004"], item 009=["001","003","004","007"]. Graph acyclic 13/13, 001 still foundation (empty deps). Convention now consistent: every DIRECT importer of an 001 symbol (003/006/007/009) lists 001; items 005/011 only reference AgentDescriptor via item-003's registerAgent/getAgentDescriptors (not the type itself) so correctly depend on 003/transitively — NOT a CHECK-B18 miss. V-004 (009/010 estimatedIterations:2) + V-005 (TRACEABILITY 29 reqs) intentionally unchanged & confirmed correct. schema enums: type∈{bug,bugfix,refactor,feature,chore,test}, priority int 1–4, status pending. validate-traceability.py = 29 reqs/0 uncovered/0 orphaned. rauf-stable backlog validate = valid:true,findings:[].
