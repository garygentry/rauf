# Verification Findings — cross-agent-installer (backlog)

- **Feature:** cross-agent-installer (epic agent-agnostic, member 4 of 6)
- **Mode:** backlog
- **Date:** 2026-06-16
- **Artifacts:** specs/agent-agnostic/cross-agent-installer/backlog.json (13 items), PRD.md, tech-spec.md, 00–08 numbered specs, TRACEABILITY.md
- **Dispatch:** 4 parallel forge-verifier instances (scoping/criteria, dependency/ordering, spec-coverage/traceability, schema/enum) + deterministic `rauf-stable backlog validate` (exit 0, 0 findings).
- **Checks executed:** 25 of 25 (B01–B25). Results: 22 pass, 1 fail (CHECK-B18), 2 partial (raised as improvements).

## Summary

| Severity | Count |
|----------|-------|
| error | 0 |
| gap | 1 |
| inconsistency | 1 |
| improvement | 4 |
| **total** | **6** |

No blockers. The backlog is schema-clean, every numbered spec and P0 requirement is covered, the dependency graph is acyclic with no missing import edges, and item scoping is strong. The six findings are low-severity refinements.

---

## Findings

### V-001 — REQ-RAUF-05 (default-but-alternates-not-precluded) has no explicit acceptance criterion
- **Severity:** gap
- **Location:** backlog.json item `004` (rauf.ts); also item `011` (rauf coverage lists RAUF-01/02/03/04, not 05)
- **What's wrong:** P1 REQ-RAUF-05 ("rauf is the default; the feature MUST NOT preclude alternate loop runners") maps in TRACEABILITY.md to `06 §2/§5`, tested `08 §5.10`, but no backlog acceptance criterion asserts it. It is satisfied vacuously (the installer only *records* a pin and writes no runner-selection lock — alternate-runner wiring is the sibling forge-rauf-loop-default feature's job), but nothing pins that, so it could silently regress.
- **Suggested fix:** Add an acceptance criterion to item 004: "preflightRauf only records RAUF_PIN and performs no filesystem write or runner-selection lock — it does not preclude an alternate loop runner (REQ-RAUF-05); the unresolvable and --skip-rauf paths still install skills."
- **References:** PRD.md REQ-RAUF-05; TRACEABILITY.md (REQ-RAUF-05 → 06 §2/§5); 06-rauf-provisioning.md §5
- **Checklist:** CHECK-B22, CHECK-B24

### V-002 — Build-order-only dependsOn edges (003→002, 005→003) are not labeled as build-order, unlike the analogous 006/009 edges
- **Severity:** inconsistency
- **Location:** backlog.json item `003` (dependsOn ["002"], notes) and item `005` (dependsOn ["003"], notes)
- **What's wrong:** The backlog labels edges that exist only to preserve strict bottom-up build order (items 006 and 009 notes both say "…dependsOn N keeps the strict build order, not an import"). Two analogous edges are unlabeled: hash/source (003) import only `./types.js` (not agent-targets), so 003→002 is build-order-only; manifest (005) imports `destinationFor` from agent-targets (002) + types, nothing from hash/source (003), so its real edge is 002 and the declared 005→003 is build-order-only (002 reached transitively). Correctness is fine (acyclic, no missing edges); only the notes are inconsistent.
- **Suggested fix:** Append to item 003 notes: "hash.ts and source.ts import only types (001); the dependsOn 002 preserves strict bottom-up build order, not an import." Append to item 005 notes: "manifest.ts's only real import is destinationFor (002) + types (001); the dependsOn 003 keeps strict linear build order — 003 exports nothing manifest imports, and the 002 import is reached transitively." Do NOT change any dependsOn arrays — the linearization is deliberate.
- **References:** 03-source-and-hashing.md §2; 05-manifest-and-uninstall.md §4 (imports); backlog.json items 006, 009 (the convention)
- **Checklist:** CHECK-B18

### V-003 — Item 011's coverage-checklist criterion names a broad obligation without pointing at the enumerated function list
- **Severity:** improvement
- **Location:** backlog.json item `011`, acceptanceCriteria[2] ("coverage.test.ts asserts every public fn in 02–07 is reachable …")
- **What's wrong:** Verifiable in principle, but a fresh agent must reconstruct "every public fn in 02–07" from seven docs. Spec 08 §6 already enumerates the exact ~30-function floor.
- **Suggested fix:** Append to item 011 acceptanceCriteria[2]: "(authoritative public-function list: 08-testing-strategy.md §6)."
- **References:** 08-testing-strategy.md §6 (Coverage targets)
- **Checklist:** CHECK-B13, CHECK-B24

### V-004 — DEFAULT_REMEDY in item 009 omits the UNEXPECTED ErrorCode without noting it is intentional
- **Severity:** improvement
- **Location:** backlog.json item `009` (report.ts / formatError DEFAULT_REMEDY: 8 codes, no UNEXPECTED)
- **What's wrong:** The ErrorCode union (item 001) includes UNEXPECTED, but item 009's DEFAULT_REMEDY lists only 8 codes. Per spec 07 §3.6 this is intentional — DEFAULT_REMEDY is `Partial<Record<ErrorCode,string>>` and UNEXPECTED is surfaced via the cli.ts boundary one-line message (item 010), not formatError. The omission is correct but undocumented in the backlog, so a reader might think it a miss.
- **Suggested fix:** Append to item 009 notes: "DEFAULT_REMEDY is intentionally Partial over ErrorCode — UNEXPECTED is surfaced via the cli.ts boundary message (item 010, spec 07 §3.1/§4), not formatError, so it has no DEFAULT_REMEDY entry (spec 07 §3.6)."
- **References:** 07-cli-and-reporting.md §3.6 (Partial DEFAULT_REMEDY) + §3.1/§4 (UNEXPECTED boundary); 00-core-definitions.md §7 (ErrorCode union)
- **Checklist:** CHECK-B13, CHECK-B24

### V-005 — Foundation item 001 has no colocated test; data-shape invariants are only checked transitively (tsc) until item 002/011
- **Severity:** improvement
- **Location:** backlog.json item `001` (build-only final acceptance criterion)
- **What's wrong:** Item 001 defines AGENT_IDS/AgentId, AGENT_TARGETS (5 rows), EXIT, MANIFEST_PREFIX, the ErrorCode union, etc. Its only verification is `npm run build`. Runtime-shaped invariants tsc can't catch (AGENT_IDS canonical order for determinism per 08 §2; AGENT_TARGETS keys === AGENT_IDS; EXIT values) are asserted only downstream (item 011 DET-01).
- **Suggested fix:** Add `installer/test/types.test.ts` to item 001's description + a matching acceptance criterion asserting AGENT_IDS deep-equals ["claude","codex","copilot","cursor","gemini"], Object.keys(AGENT_TARGETS) covers exactly AGENT_IDS, EXIT === {SUCCESS:0,FAILURE:1,USAGE:2}, and MANIFEST_PREFIX === ".feature-forge."; final criterion runs `cd installer && npm run build && node --test test/types.test.ts`.
- **References:** 08-testing-strategy.md §2 (AGENT_IDS determinism), §5.1 DET-01; 00-core-definitions.md §1/§6
- **Checklist:** CHECK-B21, CHECK-B24

### V-006 — Item 011 is the largest item (~14 matrix areas + coverage); confirm the loop honors agentDelegation
- **Severity:** improvement
- **Location:** backlog.json item `011` (agentDelegation, recommendedConcurrency 4)
- **What's wrong:** Item 011 authors the entire spec-08 §5 matrix + coverage.test.ts. Scoping is defensible — the four agentDelegation subtasks write disjoint files and share one `npm test` verify step, and splitting would fragment the single green-gate signal — but it is the one item that could run long without sub-agent delegation.
- **Suggested fix:** No change if the runner honors agentDelegation. Fallback only if the execution environment cannot delegate: split item 011 into 011a–011d per its four subtasks (all dependsOn ["010"]), repoint item 012's dependsOn to all four, and keep coverage.test.ts in the final sub-item.
- **References:** 08-testing-strategy.md §5/§6; backlog.json item 011 agentDelegation
- **Checklist:** CHECK-B11, CHECK-B25

---

## Fix Execution Plan

All fixes are edits to `specs/agent-agnostic/cross-agent-installer/backlog.json`. Validate JSON (`python3 -c "import json; json.load(open(...))"`) and re-run `rauf-stable backlog validate . --backlog specs/agent-agnostic/cross-agent-installer --specs-dir ./specs --json` after editing.

### User decisions required
None. V-001 (REQ-RAUF-05) and V-004 (UNEXPECTED) are resolved by making the already-intended behavior explicit — no design change.

### Step 1 — Pin implicit/clarify intentional REQ coverage (V-001, V-004)
- Item 004: add the REQ-RAUF-05 acceptance criterion.
- Item 009: add the DEFAULT_REMEDY-is-Partial / UNEXPECTED-via-boundary note.

### Step 2 — Tighten item 011 coverage pointer (V-003)
- Item 011 acceptanceCriteria[2]: append the "(authoritative public-function list: 08-testing-strategy.md §6)" pointer.

### Step 3 — Foundation data-shape test (V-005)
- Item 001: add `installer/test/types.test.ts` to the description and a matching acceptance criterion.

### Step 4 — Label build-order-only edges (V-002)
- Items 003 and 005: append the build-order clarification to each `notes` (no dependsOn change).

### Step 5 — Item 011 size (V-006)
- No edit (agentDelegation is honored by the rauf runner). Documented fallback only.
