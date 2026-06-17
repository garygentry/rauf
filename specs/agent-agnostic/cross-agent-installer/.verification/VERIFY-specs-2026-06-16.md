# Verification Report: cross-agent-installer (specs)

- **Date:** 2026-06-16
- **Feature:** cross-agent-installer (member of epic `agent-agnostic`)
- **Mode:** specs (parallel dimensioned fan-out — 5 `forge-verifier` instances: types/contracts, architecture, cross-reference/traceability, testing, integration)
- **Artifacts Reviewed:** PRD.md, tech-spec.md, 00–08 (nine spec docs), TRACEABILITY.md; cross-checked against feature-forge (`adapters/`, `scripts/validate.sh`, `.gitignore`) and rauf (`packages/cli`, `packages/core/src/version.ts`)
- **Checks Executed:** ~38 across 5 clusters. Cluster tallies — types/contracts 9 (4 pass), architecture 8 (5 pass), cross-ref/traceability 9 (6 pass), testing 5 (1 pass), integration 5 (5 pass).

## Summary

- **Total findings (deduped):** 13
- **Gaps:** 2 · **Inconsistencies:** 9 · **Improvements:** 2 · **Errors:** 0

**Verdict:** Traceability and integration are clean — all 40 PRD REQs map to real spec sections, TRACEABILITY.md is accurate, and the consumed/extended surfaces (adapters-output read-only, published rauf bin via npx, validate.sh step 8, .gitignore) are source-accurate and C-3-clean (integration cluster: **0 findings**). The defects are concentrated in **cross-module symbol/signature drift from parallel authoring**: the orchestrator `07-cli-and-reporting.md` calls several sibling functions with names/signatures the defining docs (`04`, `05`, `06`) don't export, one type (`RegistryQuery`) is modeled three incompatible ways across `06`/`07`/`08`, the public barrel surface disagrees across three docs, and the testing doc names four nonexistent symbols plus omits five behavioral REQs. None is an `error` (factually wrong about the codebase); all are internal-consistency defects a fresh implementer would hit. Findings were deduped across the 5 instances (the `07`↔`04`/`05`/`06` signature mismatches were independently caught by the types, cross-reference, and testing dimensions; their Checklist IDs are unioned below).

## Findings

### V-001: `04` cites `manifestPathFor`, but `05` exports `manifestPath` (name + signature mismatch)
- **Severity:** inconsistency
- **Location:** `04-plan-and-apply.md` §2 import, §5 `ApplyContext.manifestPath` JSDoc, §9 example, Dependencies; target `05-manifest-and-uninstall.md` §4
- **Issue:** `04` imports/calls `manifestPathFor(destination, scope)` from `./manifest.js` in 4 places. `05` exports `manifestPath(agent, scope, opts?)` — different **name** and different **first parameter** (agent, not destination; it derives the destination internally via `destinationFor`). A fresh agent following `04` would import a nonexistent symbol with the wrong args.
- **Suggested fix:** In `04`, rename every `manifestPathFor` → `manifestPath` and change calls to `manifestPath(agent, scope, { home, cwd })`. `05`'s `manifestPath` is the single canonical name.
- **References:** `05` §4 / Verification / Dependencies; `04` §2/§5/§9
- **Checklist:** CHECK-S10, CHECK-S14, CHECK-S17, CHECK-S26

### V-002: `07`'s `apply()` call site mismatches `04`'s `apply(planned, ApplyContext): Promise<AgentReport>`
- **Severity:** inconsistency
- **Location:** `07-cli-and-reporting.md` §3.2 `finishAgent`; target `04-plan-and-apply.md` §5 (`apply` + `ApplyContext`)
- **Issue:** `07` calls `await apply(planned, { raufPin })` then reads `applied.ok` / `applied.value.actions` — treating the return as `Result<{actions}>` and supplying only `raufPin`. `04` defines `apply(planned, ctx: ApplyContext): Promise<AgentReport>` where `ApplyContext` requires **10 fields** (agent, scope, mode, **agentRoot** [the REQ-SEC-02 containment boundary], destination, manifestPath, source, raufPin, now, priorManifest) and the return is an `AgentReport` (fields top-level: `.ok`, `.actions`, `.error?` — no `.value`). `07` would not type-check and omits the security boundary `agentRoot`.
- **Suggested fix:** In `07` §3.2, build the full `ApplyContext` (resolve `agentRoot` = `<scopeRoot>/<configDirName>`, `manifestPath` via `05`, thread `source`/`priorManifest`/`now`) and consume the return as an `AgentReport` directly: `const report = await apply(planned, ctx); if (!report.ok) …; report.actions`. Fix the `// 04 → Result<{ actions }>` comment to `AgentReport`. Use `04` §9's worked example as the call shape.
- **References:** `04` §5/§9, `00` §5 (AgentReport); `07` §3.2
- **Checklist:** CHECK-S10, CHECK-S14, CHECK-S17, CHECK-S26, CHECK-S32

### V-003: `07`'s `plan()` call site mismatches `04`'s `plan(subcommand, PlanContext)`
- **Severity:** inconsistency
- **Location:** `07-cli-and-reporting.md` §3.2 `runOneAgent`; target `04-plan-and-apply.md` §4 (`plan` + `PlanContext`)
- **Issue:** `07` calls `plan({ subcommand, agent, scope, mode, bundleDir, destination, force })` — one flat object embedding `subcommand`, with a `bundleDir: string` field. `04` defines `plan(subcommand, ctx: PlanContext)` (two positional args); `PlanContext` has **no `bundleDir`** — it carries `source: LocatedSource | null` (the resolve+integrity+hash aggregate from `03`'s `locateSource`) plus `priorManifest`. `07` also does `locateBundle`+`checkIntegrity` separately rather than `03`'s combined `locateSource` that `04` expects.
- **Suggested fix:** In `07` §3.2/§3.3, call `locateSource(agent, { source: flags.source })` (03 §3.7) → `LocatedSource`, read the prior manifest, then `plan(subcommand, { agent, scope, mode, destination, source, priorManifest, force, raufPin })`. Drop the `bundleDir` field and the separate `locateBundle`/`checkIntegrity` two-step.
- **References:** `04` §4/§9, `03` §3.7 (`locateSource`/`LocatedSource`); `07` §3.2
- **Checklist:** CHECK-S10, CHECK-S14, CHECK-S17, CHECK-S26

### V-004: `07` calls `readManifest(agent, {scope})`, but `05` exports `readManifest(p: string)`
- **Severity:** inconsistency
- **Location:** `07-cli-and-reporting.md` §3.2 and §3.3; target `05-manifest-and-uninstall.md` §5
- **Issue:** `07` calls `readManifest(agent, { scope })` twice. `05` defines `readManifest(p: string): Result<InstallManifest | null>` — it takes a resolved manifest **path**, computed via `manifestPath(agent, scope, opts)`. `07` never computes the path; the arg types don't match. `04` §9 shows the correct `readManifest(manifestPath(...))` shape.
- **Suggested fix:** In `07` §3.2/§3.3: `const m = readManifest(manifestPath(agent, scope, { home: env.home, cwd: env.cwd }));`. Add `manifestPath` to `07`'s `./manifest.js` import.
- **References:** `05` §4/§5, `04` §9; `07` §3.2/§3.3
- **Checklist:** CHECK-S10, CHECK-S14, CHECK-S17, CHECK-S26

### V-005: `RegistryQuery` / `preflightRauf` modeled three incompatible ways across `06`, `07`, `08`
- **Severity:** inconsistency
- **Location:** `06-rauf-provisioning.md` §4.1/§4.2; `07-cli-and-reporting.md` §3.2; `08-testing-strategy.md` §3.3/§3.4
- **Issue:** Three docs disagree on one injectable contract. (a) `06` (owner): `type RegistryQuery = (coordinate: string) => Result<string>` (**synchronous**, project `Result` shape) and `preflightRauf(opts?: { skip?; query? }): Result<{ raufPin }>` (sync, options object; reads `RAUF_PIN` from module scope). (b) `07` calls `await preflightRauf(RAUF_PIN)` — positional pin string, `await`-ed as a Promise; neither matches `06`. (c) `08` §3.3 redeclares `RegistryQuery` as `async` returning `Promise<{ ok; version } | { ok: false }>` (not `Result`), with async mocks that won't satisfy `06`'s type; and `08` §3.4 imports the real `RegistryQuery` from `dist/rauf.js` while §3.3 redeclares it locally (self-contradiction). The integration cluster confirmed `06`'s preflight uses `spawnSync` (`npm view`), i.e. genuinely synchronous.
- **Suggested fix:** Adopt `06` as the single owner. **Recommended: keep it synchronous** (matches `spawnSync`): `06` stays `(coordinate) => Result<string>` / `preflightRauf(opts?): Result<…>`; `07` → `const pf = preflightRauf({ skip: flags.skipRauf, query: env.registry });` (drop `await`, drop positional pin, wire `--skip-rauf`); `08` → delete the local `RegistryQuery` redeclaration, `import type { RegistryQuery } from "../../dist/rauf.js"`, and rewrite mocks to `() => ok("0.6.0")` / `() => err({ code: "RAUF_UNRESOLVABLE", … })`. (If async is chosen instead, change `06`'s canonical type to `Promise<Result<string>>` and keep `07`'s `await` — but all three must move in lockstep.) **See User Decision.**
- **References:** `06` §4.1/§4.2/§4.3, `07` §3.1a/§3.2, `08` §3.3/§3.4
- **Checklist:** CHECK-S10, CHECK-S12, CHECK-S14, CHECK-S17, CHECK-S35, CHECK-S37

### V-006: `05` imports `ResolveOpts` from `./agent-targets.js`, but `00` is its authoritative source
- **Severity:** inconsistency
- **Location:** `05-manifest-and-uninstall.md` §4 import; `00-core-definitions.md` §2 (defines `ResolveOpts`); `02-agent-detection-map.md` §2 (imports it from `./types.js`)
- **Issue:** `05` does `import { destinationFor, type ResolveOpts } from "./agent-targets.js";`. `agent-targets.ts` does not re-export `ResolveOpts` (it imports it as a type from `./types.js`), so the import won't resolve. `02` correctly imports `ResolveOpts` from `./types.js`.
- **Suggested fix:** Split the `05` import: `import { destinationFor } from "./agent-targets.js";` and `import { type ResolveOpts } from "./types.js";`.
- **References:** `00` §2, `02` §2, `05` §4
- **Checklist:** CHECK-S10, CHECK-S17

### V-007: `04`'s referenced `LocatedSource` uses `readonly`; `03`'s authoritative definition does not
- **Severity:** improvement
- **Location:** `03-source-and-hashing.md` §3.7 (authoritative `LocatedSource`); `04-plan-and-apply.md` §4 (restated "referenced, NOT defined here")
- **Issue:** `03`'s `LocatedSource` fields are mutable (`root: string`, `files: Array<…>`); `04`'s restatement tightens all to `readonly` / `ReadonlyArray`. Not a compile error (04 imports the real type) but the divergence misleads. The project convention is pervasive `readonly`.
- **Suggested fix:** Add `readonly` to all `LocatedSource` fields in `03` §3.7 (`root`, `sourceHash`, `skills`, `files` as `ReadonlyArray<{ readonly relpath; readonly sha256 }>`) so the single authoritative definition matches `04` and the immutable-data convention.
- **References:** `03` §3.7, `04` §4
- **Checklist:** CHECK-S12, CHECK-S13

### V-008: The `agent-detection-map` barrel surface disagrees across tech-spec §5.2, `01` §4, and `02` §4
- **Severity:** inconsistency
- **Location:** `01-architecture-layout.md` §4 (barrel); `tech-spec.md` §5.2; `02-agent-detection-map.md` §4 + Verification
- **Issue:** Three surfaces differ. tech-spec §5.2 lists `AGENT_TARGETS`, `detectAgent`, `detectAgents`, `RAUF_PIN` (no `resolveRoots`). `01` §4 barrel adds `resolveRoots` (+ type re-exports). `02` §4 says `agent-targets.ts` exports **six** functions incl. `destinationFor` and `formatZeroDetection`, and asserts "`index.ts` re-exports the surface named in `01` §4" — but `01`'s barrel omits `destinationFor`/`formatZeroDetection` (which `05`/`07` import directly from `./agent-targets.js`, so nothing breaks at build, but the barrel is then not "exactly the surface"). Downstream consumers read tech-spec §5.2 as the contract.
- **Suggested fix:** Treat `01` §4 as the authoritative external barrel. Decide whether `destinationFor`/`formatZeroDetection` are part of the external surface: if yes, add them to the `01` §4 barrel; if internal-only, reword `01` §4 to "re-exports the externally-importable subset" and adjust `02`'s Verification line. Update tech-spec §5.2 to match (add `resolveRoots` + a note pointing to `01` §4 as the full barrel).
- **References:** `01` §4, tech-spec §5.2, `02` §4
- **Checklist:** CHECK-S05, CHECK-S17, CHECK-S26, CHECK-S32

### V-009: `result.ts` ambiguity — `00` §7 allows a module the `01` module map doesn't list
- **Severity:** inconsistency
- **Location:** `00-core-definitions.md` §7 ("Constructors … live in `src/types.ts` or a `result.ts` helper"); `01-architecture-layout.md` §1 tree / §3 module table (13 modules, no `result.ts`)
- **Issue:** `00` §7 leaves `ok`/`err`/`Result`'s home ambiguous, but `01` (which fixes the on-disk map) lists exactly 13 modules with no `result.ts`, and its barrel imports types only from `./types.js`. Following `00`'s alternative would create an unsanctioned 14th module and falsify `01`'s "13 modules" claim.
- **Suggested fix:** Drop the "`or a result.ts helper`" alternative in `00` §7 — state the constructors live in `src/types.ts` (matching the 13-module map). (Or add `result.ts` to `01` §3 and bump the count; the simpler fix is to drop the alternative.)
- **References:** `00` §7, `01` §1/§3/Verification
- **Checklist:** CHECK-S06, CHECK-S08

### V-010: `08` coverage-target names four symbols that don't exist in `04`/`05`/`07`
- **Severity:** inconsistency
- **Location:** `08-testing-strategy.md` §6 ("Concretely:" list) and §5.11
- **Issue:** §6 mandates "every public function exported by 02–07 has ≥1 test" and then names: `resolveDest`/`assertContained` (04 actually exports **`resolveWithin`**), `buildInventory`/`compareInventory` (05 has no such exports — inventory diffing lives in `plan`/`planUpdate`/`planUninstall` + `buildManifest`), and `renderJson` (07 exports `renderReport(report, { json })`, no separate `renderJson`). The proposed `coverage.test.ts` that asserts each named export exists would itself fail to compile.
- **Suggested fix:** In `08` §6/§5.11 replace `resolveDest`/`assertContained` → `resolveWithin`; drop `buildInventory`/`compareInventory` and name the real exports (`plan`/`planUpdate`/`planUninstall`, `buildManifest`/`validateManifest`); replace `renderJson` → `renderReport(report, { json: true })`. Re-derive the list from the actual `02`–`07` export sections.
- **References:** `04` §7.1 (`resolveWithin`), `05` §3/§4/§5/§6, `07` §3.5 (`renderReport`); `08` §6/§5.11
- **Checklist:** CHECK-S34, CHECK-S36, CHECK-S37

### V-011: Five behavioral REQs have no named test area despite `08`'s "every behavioral REQ" claim
- **Severity:** gap
- **Location:** `08-testing-strategy.md` Requirement Coverage table / §5 matrix
- **Issue:** REQ-SCALE-01 (add agent = one `AGENT_TARGETS` row, no logic change), REQ-SCALE-02 (add skill = no installer change), REQ-SEC-01 (positive containment: writes only within agent dirs + manifest loc; no elevation — distinct from SEC-02's path-escape in §5.11), REQ-RAUF-04 (rauf bundling idempotent/reversible — re-run no duplicate; uninstall clears `raufPin`), and REQ-SAFE-03 (manifest sufficient for list/update drift) have no named test area, though all are behavioral and testable in the sandbox. (REQ-DET-05/REQ-DIST-01 are surface/invocation contracts reasonably out of a unit suite; REQ-FLAG-05 == REQ-DIST-02, covered §5.12 — those are acceptable.)
- **Suggested fix:** Add/assign areas: SAFE-03 → cite §5.13 + §5.4 explicitly; SCALE-02 → assert a multi-skill bundle installs all skills with no per-skill branch (extend §5.4); SCALE-01 → a unit driving a synthetic `AGENT_TARGETS` row through `detectAgents`/`plan`; SEC-01 → assert after a run that nothing exists outside `sb.home`/`sb.cwd`/manifest path (extend §5.2/§5.8); RAUF-04 → extend §5.10 to re-run install (no duplicate rauf state) + assert uninstall clears recorded `raufPin`. If any is intentionally deferred (e.g. to packaging-docs-ci), state that in §1 Non-goals rather than silently omitting.
- **References:** PRD REQ-SCALE-01/02, REQ-SEC-01, REQ-RAUF-04, REQ-SAFE-03; `08` §5
- **Checklist:** CHECK-S34, CHECK-S37

### V-012: `WRITE_DENIED` coverage is conditionally skippable, weakening the "every ErrorCode tested" floor
- **Severity:** gap
- **Location:** `08-testing-strategy.md` §6 (`WRITE_DENIED` bullet)
- **Issue:** §6 declares an absolute floor "every `ErrorCode` produced by ≥1 test," but `WRITE_DENIED`'s only producer is a `chmod`-based read-only-dir test "skipped with a logged reason" where read-only enforcement is unavailable — contradicting `08`'s own "never soft skip" stance (§2/§9). No deterministic fallback (unlike `UNEXPECTED`, which injects a throwing seam).
- **Suggested fix:** Make `WRITE_DENIED` deterministic by injecting a write primitive that throws `EACCES`/`EPERM` (mirror the `UNEXPECTED` throwing-seam), so the code is produced on every platform; keep the real read-only-dir test as an additional platform-gated case. Update §6 to state the floor is met unconditionally.
- **References:** `00` §7 (`WRITE_DENIED`), `04` §7 error table; `08` §2/§6/§9
- **Checklist:** CHECK-S36, CHECK-S37

### V-013: tech-spec decisions D2 / D4 / D5 are not cited by tag in any spec doc
- **Severity:** improvement
- **Location:** tech-spec.md §1 (decision map note expects specs to cite D1–D9); D2/D4/D5 reflected by content but uncited
- **Issue:** D1/D3/D6/D7/D8/D9 are tagged where implemented; D2 (TS/zero-dep/`node:test`/`parseArgs`), D4 (validate.sh hard gate step), D5 (namespaced `feature-forge/` dir) are implemented in content but never cited by tag, weakening the decision→spec audit trail the tech-spec §1 note expects.
- **Suggested fix:** Add the literal tags: D2 → `01` §2 / `00` Stack header; D4 → `01` §6 heading + `08` §9; D5 → `00` §1 (`FEATURE_FORGE_NS` doc comment) + `04` §5.1.
- **References:** tech-spec §1; `01` §2/§6, `08` §9, `00` §1, `04` §5.1
- **Checklist:** CHECK-S04, CHECK-S38

## Fix Execution Plan

### User Decisions Required

- **V-005 — `RegistryQuery`/`preflightRauf`: synchronous or asynchronous?** The integration cluster confirmed `06`'s preflight uses `spawnSync` (`npm view`), so **synchronous** (`(coordinate) => Result<string>`, `preflightRauf(opts?): Result<…>`) is the recommended canonical shape — it requires fixing `07` (drop `await`, options object) and `08` (sync mocks). Choosing **async** instead requires changing `06`'s canonical type to `Promise<Result<string>>` and keeping `07`'s `await`. Pick one before applying Step 3. All other steps are mechanical and need no decision.

### Execution Steps

#### Step 1: Reconcile `07`'s orchestration call sites with `04`/`05`/`06`
- **Files:** `07-cli-and-reporting.md` (§3.2 `runOneAgent`/`finishAgent`, §3.3 `listOneAgent`)
- **Addresses:** V-002, V-003, V-004 (and V-005's `07` call site — coordinate with Step 3)
- **Checklist:** CHECK-S10, CHECK-S14, CHECK-S17, CHECK-S26, CHECK-S32
- **Action:** (a) Replace `locateBundle`+`checkIntegrity`+`plan({…bundleDir…})` with `locateSource(agent,{source})` then `plan(subcommand, PlanContext)` (V-003). (b) Replace `readManifest(agent,{scope})` with `readManifest(manifestPath(agent, scope, {home,cwd}))`, adding `manifestPath` to the `./manifest.js` import (V-004). (c) Build the full `ApplyContext` (incl. `agentRoot`) and consume `apply`'s `AgentReport` return directly — no `.value`/Result unwrap; fix the `// 04 → …` comment (V-002). Use `04` §9 as the reference call shape.
- **Depends on:** Step 2 (agree the `manifestPath` name first) and the V-005 decision (for the `preflightRauf` call in this same function).

#### Step 2: Canonicalize `manifestPath` in `04`
- **Files:** `04-plan-and-apply.md` (§2 import, §5 JSDoc, §9 example, Dependencies)
- **Addresses:** V-001
- **Checklist:** CHECK-S10, CHECK-S14, CHECK-S17, CHECK-S26
- **Action:** Rename every `manifestPathFor` → `manifestPath`; change the call to `05`'s signature `manifestPath(agent, scope, { home, cwd })`.
- **Depends on:** none (do before Step 1).

#### Step 3: Unify `RegistryQuery`/`preflightRauf` across `06`/`07`/`08`
- **Files:** `06-rauf-provisioning.md` (§4.1/§4.2 if async chosen), `07-cli-and-reporting.md` §3.2, `08-testing-strategy.md` §3.3/§3.4
- **Addresses:** V-005
- **Checklist:** CHECK-S10, CHECK-S12, CHECK-S14, CHECK-S17, CHECK-S35, CHECK-S37
- **Action:** Per the user decision, make all three docs use ONE shape. Recommended (sync): `07` → `preflightRauf({ skip: flags.skipRauf, query: env.registry })` (no `await`, no positional pin); `08` → delete the local `RegistryQuery` redeclaration, import it from `dist/rauf.js`, rewrite the 3 mocks to `() => ok("0.6.0")` / `() => err({ code:"RAUF_UNRESOLVABLE", … })`; `06` unchanged. (Async path: change `06`'s type to `Promise<Result<string>>`, keep `07`'s `await`, async mocks in `08`.)
- **Depends on:** User decision.

#### Step 4: Fix `05`'s `ResolveOpts` import source
- **Files:** `05-manifest-and-uninstall.md` §4 import
- **Addresses:** V-006
- **Checklist:** CHECK-S10, CHECK-S17
- **Action:** Import `ResolveOpts` from `./types.js`, keep `destinationFor` from `./agent-targets.js`.
- **Depends on:** none.

#### Step 5: Align authoritative `LocatedSource` modifiers
- **Files:** `03-source-and-hashing.md` §3.7
- **Addresses:** V-007
- **Checklist:** CHECK-S12, CHECK-S13
- **Action:** Add `readonly` to all `LocatedSource` fields + `ReadonlyArray` for `files`, matching `04`'s restatement and the project convention.
- **Depends on:** none.

#### Step 6: Reconcile the barrel/public surface across tech-spec §5.2, `01` §4, `02` §4
- **Files:** `01-architecture-layout.md` §4, `tech-spec.md` §5.2, `02-agent-detection-map.md` §4/Verification
- **Addresses:** V-008
- **Checklist:** CHECK-S05, CHECK-S17, CHECK-S26, CHECK-S32
- **Action:** Make `01` §4 authoritative; decide barrel membership of `destinationFor`/`formatZeroDetection` (add to barrel, or reword to "externally-importable subset"); update tech-spec §5.2 (add `resolveRoots` + pointer to `01` §4) and `02`'s Verification line to match.
- **Depends on:** none.

#### Step 7: Resolve the `result.ts` ambiguity
- **Files:** `00-core-definitions.md` §7
- **Addresses:** V-009
- **Checklist:** CHECK-S06, CHECK-S08
- **Action:** State the `Result` constructors live in `src/types.ts` (drop the "or a `result.ts` helper" alternative), matching `01`'s 13-module map.
- **Depends on:** none.

#### Step 8: Fix `08`'s coverage-target symbol names
- **Files:** `08-testing-strategy.md` §6, §5.11
- **Addresses:** V-010
- **Checklist:** CHECK-S34, CHECK-S36, CHECK-S37
- **Action:** `resolveDest`/`assertContained` → `resolveWithin`; drop `buildInventory`/`compareInventory` → name `plan`/`planUpdate`/`planUninstall` + `buildManifest`/`validateManifest`; `renderJson` → `renderReport(report,{json:true})`. Re-derive the list from real exports.
- **Depends on:** Steps 1–5 (so the names referenced are final).

#### Step 9: Add the five missing behavioral-REQ test areas
- **Files:** `08-testing-strategy.md` §5 matrix / Requirement Coverage table
- **Addresses:** V-011
- **Checklist:** CHECK-S34, CHECK-S37
- **Action:** Add/assign areas for REQ-SCALE-01, REQ-SCALE-02, REQ-SEC-01, REQ-RAUF-04, REQ-SAFE-03 per the finding; or explicitly mark any as deferred in §1 Non-goals.
- **Depends on:** none.

#### Step 10: Make `WRITE_DENIED` deterministic
- **Files:** `08-testing-strategy.md` §6
- **Addresses:** V-012
- **Checklist:** CHECK-S36, CHECK-S37
- **Action:** Add a throwing-write-seam producer for `WRITE_DENIED` (mirror `UNEXPECTED`); keep the `chmod` test as an extra platform-gated case; state the floor is unconditional.
- **Depends on:** none.

#### Step 11: Add the D2/D4/D5 decision tags
- **Files:** `00` §1, `01` §2/§6, `04` §5.1, `08` §9
- **Addresses:** V-013
- **Checklist:** CHECK-S04, CHECK-S38
- **Action:** Insert literal `[D2]`/`[D4]`/`[D5]` tags at the loci in V-013.
- **Depends on:** none.

> **Note:** Most fixes (V-001..V-005, V-010) re-converge the parallel-authored docs on the owner-defined contracts; the owners (`03`/`04`/`05`/`06`) are largely correct, and `07` (orchestrator) + `08` (tests) are the docs to bring into line, plus small surface/ambiguity fixes in `00`/`01`/`02`/tech-spec. The deterministic `validate-traceability.py` supplement was **skipped** (not installed); traceability was verified by reading (cross-reference cluster: REQ coverage clean).
