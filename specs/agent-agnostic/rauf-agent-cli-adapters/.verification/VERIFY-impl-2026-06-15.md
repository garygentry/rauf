# Verification Report: rauf-agent-cli-adapters (impl)
Date: 2026-06-15
Pipeline Stage: forge-5-loop (complete) → impl verification
Method: 4 parallel forge-verifier instances over disjoint dimensions (req-coverage, integration, testing, code-quality), synthesized by parent.
Artifacts Reviewed: PRD.md, tech-spec.md, 00–07 implementation specs, TRACEABILITY.md, backlog.json; packages/loop/src (providers/*, runner.ts, agent-selection.ts, constants.ts, signal-redactor.ts, process-group.ts), packages/cli/src (commands.ts, loop-commands.ts), packages/core/src (agent-alias.ts, config.ts, errors.ts), test-sandbox/ + verify.sh, docs/SPEC-CLI.md.

## Summary
- Total findings: 2
- Gaps: 0
- Inconsistencies: 0
- Improvements: 2
- Errors: 0

**Verdict: PASS with 2 low-severity improvements.** All 20 impl checks executed across 4 dimensions: 18 pass, 0 fail, 0 n/a, 2 improvement notes. `pnpm gate` is green (build + schema:check + version:check + typecheck + lint + format:check + test + check:docs; 2087 tests passed, 0 failed). All 13 backlog items are `done` with acceptance criteria met in code. SC-2 env threading, REQ-SEC-02 signal neutralization (both pre-detection sites), usage-gating, and pre-loop fail-fast detection are all implemented and tested.

## Findings

### V-001: `CliAgent.execute` omits explicit `cwd` on `spawnProcessGroup` (REQ-SEC-01 confinement is incidental, not self-documenting)
- **Severity:** improvement
- **Location:** `packages/loop/src/providers/cli-agent.ts:127-134` (the `spawnProcessGroup(this.config.binary, argv, {...})` call — `cwd` omitted)
- **Issue:** Spec `03-cli-agent-engine-and-presets.md §8` acceptance checklist (line 715) states the agent subprocess "is spawned with `cwd === ROOT_DIRECTORY` (via `SpawnProcessGroupOptions.cwd`…) — the REQ-SEC-01 confinement boundary." `process-group.ts` exposes the `cwd?` option for exactly this, but `CliAgent.execute` never passes it, so confinement relies on the child *inheriting* the parent cwd. This is functionally equivalent to `spawnClaude`'s behavior (the same spec acknowledges inherited-cwd as acceptable at 03 §lines 386-393), so it is **not** a security hole — but the §8 checklist literally demands the explicit option, and the explicit boundary is the documented intent. A reader cannot tell from the code that confinement is intentional.
- **Suggested fix:** Either (a) pass `cwd: process.cwd()` (resolved ROOT_DIRECTORY) explicitly in the `spawnProcessGroup` options at `cli-agent.ts:127` with a comment citing REQ-SEC-01 (matches the §8 checklist and self-documents the boundary); or (b) keep inheritance but add a one-line comment "cwd intentionally inherited (=== ROOT_DIRECTORY), per 03 §386-393." Option (a) better matches the spec's acceptance checklist. The spec's own internal tension (§-note allows inheritance; §8 checklist demands the explicit option) may also be reconciled in the same edit.
- **References:** `03-cli-agent-engine-and-presets.md` §5.1, §8 (line 715), §386-393; `packages/loop/src/process-group.ts:16-20`; PRD REQ-SEC-01
- **Checklist:** CHECK-I15, CHECK-I14

### V-002: Spec labels `probeBinaryOnPath` "internal — not exported" but it is exported (and re-used by generic-cli)
- **Severity:** improvement
- **Location:** spec `02-agent-registry-and-detection.md §5.1` (line ~361, comment `// providers/registry.ts (internal helper — not exported)`) vs impl `packages/loop/src/providers/registry.ts:91` (`export`ed) consumed by `packages/loop/src/providers/generic-cli.ts:7`.
- **Issue:** `probeBinaryOnPath` is exported from `registry.ts` so `generic-cli.ts`'s custom `detect` can reuse it, but the spec annotates it as a non-exported internal helper. This is a benign module-internal widening — it is **not** re-exported through `providers/index.ts` or the package barrel, so the public surface still matches the spec and no import is broken. It is spec-vs-impl annotation drift, not a defect.
- **Suggested fix:** Update spec `02-agent-registry-and-detection.md §5.1` to annotate `probeBinaryOnPath` as "exported within the package for reuse by `generic-cli.ts`'s custom `detect` (not re-exported on the public barrel)." Alternatively, if keeping it strictly internal is preferred, inline a private copy in `generic-cli.ts` — but updating the spec annotation is the lower-risk, accurate resolution.
- **References:** `02-agent-registry-and-detection.md` §5.1; `packages/loop/src/providers/registry.ts:91`; `packages/loop/src/providers/generic-cli.ts:7`
- **Checklist:** CHECK-I09 (routed from integration dimension), CHECK-I13

## Fix Execution Plan

### User Decisions Required
None — both fixes are deterministic and can be applied directly. Both are `improvement` severity; the implementation is shippable as-is.

### Execution Steps

#### Step 1: Make REQ-SEC-01 confinement explicit in CliAgent.execute
- **Files:** `packages/loop/src/providers/cli-agent.ts`
- **Addresses:** V-001
- **Checklist:** CHECK-I15, CHECK-I14
- **Action:** In the `spawnProcessGroup(this.config.binary, argv, {...})` options object (~line 127), add `cwd: process.cwd()` with a trailing comment `// REQ-SEC-01 confinement boundary (=== ROOT_DIRECTORY)`. If the project prefers not to change runtime behavior, instead add only the comment documenting that cwd is intentionally inherited per 03 §386-393. Re-run `pnpm gate` to confirm green (claude-cli/claude-process regression tests anchor SC-2).
- **Depends on:** none
- **Rationale:** Self-documents the security boundary and aligns with the §8 acceptance checklist.

#### Step 2: Correct the `probeBinaryOnPath` annotation in spec 02
- **Files:** `specs/agent-agnostic/rauf-agent-cli-adapters/02-agent-registry-and-detection.md`
- **Addresses:** V-002
- **Checklist:** CHECK-I09, CHECK-I13
- **Action:** In §5.1, change the `probeBinaryOnPath` comment from "internal helper — not exported" to "exported within the package for reuse by generic-cli's custom `detect`; not re-exported on the public barrel."
- **Depends on:** none
- **Rationale:** Removes spec-vs-impl drift so the spec accurately documents the (already-correct, surface-preserving) export.

## Notes (non-findings, recorded for traceability)
- **item 007 alias-fold architecture (non-finding):** item 007's AC references `normalizeAgentAlias` "applied at the load sites," but the actual load-boundary fold uses a core-local `foldAlias` family in `packages/core/src/agent-alias.ts` (because `@rauf/core` must not import `@rauf/loop`, CLAUDE.md rule 1). The loop's `normalizeAgentAlias` remains exported as a charter surface. The AC's substantive requirements (pre-validation `agent`→`provider` fold, `provider` wins on conflict, no schema rename, no core→cli/web import) are all satisfied. No action.
- **verify.sh not in `pnpm gate` (spec-acknowledged):** `test-sandbox/verify.sh` cross-agent end-to-end rows are a documented manual integration check (07 §4.4 WARNING / §2), intentionally outside the gate (it mutates a throwaway git repo). The gate's SC-7 obligation is the Vitest tiers, which all pass. The `assert_event_provider`/fail-fast sandbox assertions were verified by inspection to exist and match the spec, not executed in this pass.

## Fix Progress
- Step 1: [APPLIED] 2026-06-15 — Added explicit `cwd: process.cwd()` + REQ-SEC-01 comment to the `spawnProcessGroup` call in `cli-agent.ts:127` (V-001).
- Step 2: [APPLIED] 2026-06-15 — Updated spec `02-agent-registry-and-detection.md` §5.1 annotation: `probeBinaryOnPath` is exported within the package for generic-cli reuse, not re-exported on the public barrel (V-002).
