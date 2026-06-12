# Traceability Matrix — UX/DX Overhaul, Phase 1 (Observation Substrate)

Maps every PRD requirement (`REQ-*`, [`PRD.md`](./PRD.md) §3–§4) to the implementation spec
document(s) and section(s) that specify it, plus the Success Criterion (`SC-*`, PRD §8) it serves.
"Primary" is the document that owns the implementation; "Also" lists supporting docs (shared types in
`00`, layout/build in `01`, tests in `07`).

Generated and verified by `forge-3-specs` (Step 5). All 38 PRD requirements have coverage; all
cross-references resolve to existing files.

## 3.1 Event Persistence — the keystone

| REQ | Requirement (abbrev) | Primary doc → section | Also | SC |
| --- | --- | --- | --- | --- |
| REQ-EVT-01 | Persist every `LoopEvent` to `events.ndjson` in state dir | `02-event-log.md` §3, §5 | `00` §1.1/§1.3, `01` §5 | SC-6 |
| REQ-EVT-02 | Coalesce `llm_token_update` to ≤~1/sec; others as-they-occur | `02-event-log.md` §5.1–5.2 | `00` §2.2 (`TOKEN_COALESCE_MS`) | SC-6 |
| REQ-EVT-03 | Self-describing record: `type`+timestamp+dense `seq` | `00-core-definitions.md` §1.1 | `02` §5.2 | SC-6 |
| REQ-EVT-04 | Schema/version envelope from first release | `00-core-definitions.md` §1.1, §2.1 | `02` §3.4 ref | SC-6 |
| REQ-EVT-05 | Reset per run; prior run archived | `02-event-log.md` §3.3, §5.3 | `01` §5 | SC-3 |
| REQ-EVT-06 | Whole-line append; single writer per root | `02-event-log.md` §4.1, §7.2 | `01` §4 | SC-6 |
| REQ-EVT-07 | Written only inside the state-dir sandbox | `02-event-log.md` §3.1, §6 | `00` §3.2 | SC-6 |

## 3.2 Unified File-Based Observation

| REQ | Requirement (abbrev) | Primary doc → section | Also | SC |
| --- | --- | --- | --- | --- |
| REQ-OBS-01 | All reads reconstruct entirely from files | `04-cli-monitoring-surface.md` §2, §3, §5 | `05` §3 | SC-1 |
| REQ-OBS-02 | `state.json` authoritative; log = stream; never contradict | `03-active-loop-registry.md` §3.4, §5.3 | `02` §7.1, `00` §1.2 | SC-6 |
| REQ-OBS-03 | In-process ≡ detached across every observer | `04-cli-monitoring-surface.md` §2, §5 / `05-web-observation-parity.md` §1, §3 | `02` | SC-1 |
| REQ-OBS-04 | Attach = replay current run then tail | `04-cli-monitoring-surface.md` §5 | `02` §3.2/§3.4 | SC-1 |

## 3.3 Monitoring Command Surface — clean break

| REQ | Requirement (abbrev) | Primary doc → section | Also | SC |
| --- | --- | --- | --- | --- |
| REQ-MON-01 | Canonical surface: `status`/`log`/`follow`/`progress` | `04-cli-monitoring-surface.md` §2, §3 | `01` §7 | SC-4 |
| REQ-MON-02 | Remove `loop watch`/`loop follow`/`--watch`, no aliases | `04-cli-monitoring-surface.md` §4 | `07` §3.1 | SC-4 |
| REQ-MON-03 | `--json`/NDJSON on every read incl. `--follow`; one flag | `04-cli-monitoring-surface.md` §6 | `07` §3.2 | SC-4 |
| REQ-MON-04 | `--backlog` the single targeting spelling | `04-cli-monitoring-surface.md` §7 | — | SC-4 |

## 3.4 Empty-Is-Never-Silent & Cross-Root Discovery

| REQ | Requirement (abbrev) | Primary doc → section | Also | SC |
| --- | --- | --- | --- | --- |
| REQ-DISC-01 | Name the inspected directory | `04-cli-monitoring-surface.md` §8 | `03` §3.1–3.5 | SC-2 |
| REQ-DISC-02 | Surface a loop live in another root | `04-cli-monitoring-surface.md` §8 | `03` §3.5 | SC-2 |
| REQ-DISC-03 | Central active-loop registry, ~O(1), keyed by state dir | `03-active-loop-registry.md` §2, §3.1–3.2 | `00` §1.2, `01` §5 | SC-2 |
| REQ-DISC-04 | Registry concurrency-safe (structural) | `03-active-loop-registry.md` §2.1, §8 | — | SC-2 |
| REQ-DISC-05 | Self-heal stale entries vs lock/process liveness | `03-active-loop-registry.md` §3.5, §4, §7 | `07` §2.2 | SC-3 |
| REQ-DISC-06 | List every live loop machine-wide (`status --all`) | `03-active-loop-registry.md` §3.5 (data) / `04-cli-monitoring-surface.md` §9 (command) | `07` §3.2 | SC-2 |

## 3.5 Web Observation Parity (read-path only)

| REQ | Requirement (abbrev) | Primary doc → section | Also | SC |
| --- | --- | --- | --- | --- |
| REQ-WEB-01 | Web reconstructs from same files; shows in-process runs | `05-web-observation-parity.md` §3, §4.1, §4.4 | `07` §5 | SC-1 |
| REQ-WEB-02 | In-memory buffer = latency cache, not sole truth | `05-web-observation-parity.md` §4.1, §4.3 | — | SC-1 |
| REQ-WEB-03 | Projects view reflects all live loops (registry) | `05-web-observation-parity.md` §4.2, §4.5 | `03` §3.5 | SC-1 |

## 3.6 Agent Commit-Rule — single source

| REQ | Requirement (abbrev) | Primary doc → section | Also | SC |
| --- | --- | --- | --- | --- |
| REQ-COMMIT-01 | One commit rule, identical everywhere | `06-agent-commit-rule.md` §1–3 | `07` §7 | SC-5 |
| REQ-COMMIT-02 | Reconcile 3 templates + embedded-artifacts + prompt-builder | `06-agent-commit-rule.md` §3–5 | `01` §6, `07` §7 | SC-5 |
| REQ-COMMIT-03 | Scope guard: no rename / provider-neutral / signal-placement | `06-agent-commit-rule.md` §6 | — | SC-5 |

## 4.1 Performance & Liveness

| REQ | Requirement (abbrev) | Primary doc → section | Also | SC |
| --- | --- | --- | --- | --- |
| REQ-PERF-01 | Persistence best-effort, no per-event fsync | `02-event-log.md` §4.1, §5.1, §7.1 | `07` §4 | SC-7 |
| REQ-PERF-02 | Observers reflect new events within ≈1s (qualitative) | `02-event-log.md` §3.4, §4.2 / `04-cli-monitoring-surface.md` §5–6 | — | SC-1 |

## 4.2 Reliability & Durability

| REQ | Requirement (abbrev) | Primary doc → section | Also | SC |
| --- | --- | --- | --- | --- |
| REQ-REL-01 | Tolerate torn/partial trailing line | `02-event-log.md` §4.2, §7.2 | `05` §5, `07` §2.4 | SC-3 |
| REQ-REL-02 | Status never requires replaying the log | `02-event-log.md` §7.1, §8 | `03` §3.4 | SC-3 |
| REQ-REL-03 | Absence of log degrades gracefully | `02-event-log.md` §4.2, §6, §7.3 | `04` §5, `01` §5 | SC-7 |

## 4.3 Security & Sandboxing

| REQ | Requirement (abbrev) | Primary doc → section | Also | SC |
| --- | --- | --- | --- | --- |
| REQ-SEC-01 | Event log + registry written only in sandbox | `02-event-log.md` §3.1, §6 / `03-active-loop-registry.md` §3.2–3.4, §6 | `00` §3.2 | SC-3 |
| REQ-SEC-02 | 127.0.0.1 bind + `X-Rauf-Request`; no new mutations | `05-web-observation-parity.md` §6 | — | SC-1 |

## 4.4 Compatibility & Migration

| REQ | Requirement (abbrev) | Primary doc → section | Also | SC |
| --- | --- | --- | --- | --- |
| REQ-COMPAT-01 | Additive; existing installs unchanged | `01-architecture-layout.md` §5 | `07` §8 | SC-7 |
| REQ-COMPAT-02 | No historical migration; old archived runs accepted | `01-architecture-layout.md` §5 | — | SC-7 |
| REQ-COMPAT-03 | `core` retains zero `cli`/`web` imports | `01-architecture-layout.md` §4 | `00` §4, `07` §8 | SC-7 |

## 4.5 Observability of the substrate

| REQ | Requirement (abbrev) | Primary doc → section | Also | SC |
| --- | --- | --- | --- | --- |
| REQ-OBSV-01 | Reconciliation outcomes discoverable (e.g. pruned stale) | `03-active-loop-registry.md` §3.5, §7 | `04` §9 | SC-2 |

---

## Success-Criteria → verification map (PRD §8)

| SC | Claim | Verified in |
| --- | --- | --- |
| SC-1 | In-process `loop run` ≡ detached across CLI + web | `07-testing-strategy.md` §5 (API boundary) + §6 (manual web check); `05` §8 |
| SC-2 | Reads never silently "idle"; name dir + cross-root liveness; `status --all` | `07` §3.2; `03` §8; `04` §8–9 |
| SC-3 | Crash → registry not-live + `state.json` correct; torn line no crash | `07` §2.1/§2.2/§4 |
| SC-4 | One `follow` verb + one `--follow` flag; old names gone; `--json` everywhere | `07` §3.1–3.2; `04` §4, §6 |
| SC-5 | Canonical commit rule identical across loci; dogfood = 1 commit/item | `07` §4.1, §7; `06` §7 |
| SC-6 | Agent reads `state.json` + tails `events.ndjson` (seq, versioned), no contradiction | `07` §2.1/§4; `00` §1.1 |
| SC-7 | `typecheck`/`test`/`lint` pass; no-`events.ndjson` installs work | `07` §8 |

## Open-Question resolution (PRD §7 → tech-spec decisions, carried into specs)

| OQ | Resolution | Spec locus |
| --- | --- | --- |
| OQ-1 | Per-loop entry files + reconcile-on-read (D5) | `03` §2, §3.5 |
| OQ-2 | Time-based last-write-wins ≈1/sec (D3) | `00` §2.2; `02` §5.2 |
| OQ-3 | Machine-wide scope, no scoping flag (D6) | `03` §3.5; `04` §9 |
| OQ-4 | `archive/{ts}-events.ndjson` at start (D4) | `02` §3.3, §5.3 |
| OQ-5 | `status --all` (D7) | `04` §9 |
| OQ-6 | `follow` replays current run only (D9) | `04` §5; `02` §3.2 |

> Section numbers for `02`–`06` reflect each writer's manifest; if a section was renumbered during
> authoring, the requirement is still covered within the cited document — confirm against the doc's own
> `## Requirement Coverage` table, which is authoritative per-document.
