# Traceability Matrix — ux-overhaul-grammar

Maps every PRD requirement to the implementation spec document(s) that cover it. Primary owner first;
shared-contract / supporting docs in parentheses. Verified by coverage grep over `00..06-*.md` (every REQ
and NFR resolves to at least one doc).

## Functional requirements

| REQ | Primary doc → section | Supporting |
|-----|------------------------|-----------|
| REQ-EXEC-01 (one verb, `--detached`/`-d`) | 02-execution-grammar | 01-architecture-layout |
| REQ-EXEC-02 (remove `loop start`) | 02-execution-grammar | 01, 05 |
| REQ-EXEC-03 (detached auto-provisions server) | 02-execution-grammar | 01 |
| REQ-EXEC-04 (`--detached --follow` + lifecycle) | 02-execution-grammar | 06-testing-strategy |
| REQ-EXEC-05 (`loop stop`) | 02-execution-grammar | — |
| REQ-EXEC-06 (observation parity) | 02-execution-grammar | 06 (parity test), NFR-PARITY-01 |
| REQ-FLAG-01 (`--follow`/`-f`, kill `--watch`) | 02-execution-grammar | 01, 05, 06 |
| REQ-FLAG-02 (`--json` everywhere incl. streaming) | 02-execution-grammar | 06 |
| REQ-FLAG-03 (`--backlog` sole spelling) | 02-execution-grammar | — |
| REQ-FLAG-04 (`--interval` sole cadence flag) | 02-execution-grammar | 06 |
| REQ-EXIT-01 (unified scheme, status + loop run) | 03-exit-codes | 00 §1/§2, 01, 06 |
| REQ-EXIT-02 (collision/disagreement removed) | 03-exit-codes | 00 §1 remap, 06 (audit grep) |
| REQ-EXIT-03 (`backlog validate` untouched) | 03-exit-codes | 00 §1, 06 |
| REQ-EXIT-04 (documented machine contract) | 03-exit-codes | 00 §1, 05 |
| REQ-SIG-01 (explicit `review`, no collapse) | 04-signals-and-events | 00 §3, 01, 06 |
| REQ-SIG-02 (signal-placement docs ↔ parser) | 04-signals-and-events | 01, 05 |
| REQ-EVT-01 (events.ndjson versioned, additive-only) | 04-signals-and-events | 00 §4, 01, 05 |
| REQ-EVT-02 (same shapes as `--ndjson`) | 04-signals-and-events | 00 §4 |
| REQ-RMV-01 (removed-command remediation) | 02-execution-grammar | 00 §5 table, 01, 06 |
| REQ-CONTRACT-01 (single v0.5.0 flip) | 05-cutover-and-feature-forge | 01 |
| REQ-CONTRACT-02 (runner version ≥ 0.5.0) | 05-cutover-and-feature-forge | 00 §6, 01 |
| REQ-CONTRACT-03 (document the contract) | 05-cutover-and-feature-forge | — |
| REQ-CONTRACT-04 (feature-forge lockstep edits) | 05-cutover-and-feature-forge | 03 (exit-code reads) |
| REQ-CONTRACT-05 (out-of-loop cross-repo execution) | 05-cutover-and-feature-forge | 01 §3 step 7 |
| REQ-DOC-01 (6 project SPEC docs updated) | 05-cutover-and-feature-forge | 01, 02, 03 |
| REQ-DOC-02 (CLI `--help`/usage updated) | 05-cutover-and-feature-forge | 02, 01 |

## Non-functional requirements

| NFR | Doc(s) |
|-----|--------|
| NFR-COMPAT-01 (clean break, no aliases) | 04 (+ enforced across 02/03 via removal) |
| NFR-CUTOVER-01 (coordinated flip coherence) | 05-cutover-and-feature-forge |
| NFR-PARITY-01 (observation parity preserved) | 02-execution-grammar, 06-testing-strategy |
| NFR-SAFETY-01 (dogfood rauf-stable) | 05, 06 |
| NFR-PERF-01 (no perf regression) | 06-testing-strategy §8 |
| NFR-QUALITY-01 (full gate green) | 06-testing-strategy |

## Spec documents

| Doc | Scope |
|-----|-------|
| 00-core-definitions.md | Unified ExitCode contract, signal enum, terminal→code mappings, events versioning rules, remediation table, version constant |
| 01-architecture-layout.md | Per-package change map, surface deltas, change ordering/dep graph |
| 02-execution-grammar.md | `loop run --detached`, remove `loop start`, `--detached --follow`, `loop stop`, flag canon, remediation |
| 03-exit-codes.md | ExitCode redefine + call-site audit, `loop run` + `status` mappings, validate carve-out |
| 04-signals-and-events.md | Explicit `review` signal + collapse removal, signal-placement doc fix, events versioning discipline |
| 05-cutover-and-feature-forge.md | v0.5.0 flip, version bump, feature-forge out-of-loop edits, project-doc updates |
| 06-testing-strategy.md | Exit-code/delegation/parity/remediation/signal/flag tests, perf note, full gate |
