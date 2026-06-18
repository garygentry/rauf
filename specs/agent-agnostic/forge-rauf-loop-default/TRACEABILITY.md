# Traceability Matrix — forge-rauf-loop-default

> Epic member of **agent-agnostic**. Maps every PRD v1 requirement to the implementation spec
> document(s) and section(s) that cover it. Primary location is **bold**; secondary
> (reinforcing/cross-cutting) locations follow. Foundation docs `00-core-definitions.md` and
> `01-architecture-layout.md` underpin all rows (shared types, layout) and are cited only where
> they carry primary coverage.

## Functional requirements

| REQ ID | Requirement (abbrev.) | Spec coverage (doc § section) |
|--------|-----------------------|-------------------------------|
| REQ-DEF-01 | Default-to-rauf, announced plainly | **06 §3** |
| REQ-DEF-02 | Pluggable seam; no hardcoded commands | **06 §3**; 02 §1, §4 |
| REQ-DEF-03 | Single authoritative contract doc for the capstone | **06 §1, §3–§7**; 01 §3 |
| REQ-AGENT-01 | Per-run agent selector (Step 2d) | **03 §2**; 07 §3.3 |
| REQ-AGENT-02 | Project-default agent (`defaultAgent`) | **02 §1.3, §4**; 03 §3 |
| REQ-AGENT-03 | No agent selected ⇒ identical to today | **03 §3, §5** |
| REQ-AGENT-04 | Confirm lists available agents from probe | **04 §6** |
| REQ-AGENT-05 | Per-item `provider` pass-through, never overridden | **03 §3.3, §4**; 00 §1.4 |
| REQ-PREC-01 | Precedence parallel to model: item>run>project>default | **03 §4**; 00 §5; 07 §3.1 |
| REQ-PREC-02 | Run-level occupies the run layer only | **03 §4**; 07 §3.1 |
| REQ-AVAIL-01 | Non-default agent verified before launch | **04 §1, §2** |
| REQ-AVAIL-02 | Known-but-unavailable ⇒ warn + proceed/choose | **04 §3, §4.2**; 07 §3.2 |
| REQ-AVAIL-03 | No pre-check on the default path | **04 §1**; 03 §5 |
| REQ-AVAIL-04 | Unknown id ⇒ hard-reject before side-effects, list ids | **04 §3, §4.1**; 07 §3.2 |
| REQ-PLUG-01 | Agent selection gated on advertised agent surface | **02 §2**; 07 §3.4 |
| REQ-PLUG-02 | Gated off ⇒ no selector/probe/agent arg | **02 §2**; 03 §6.1; 07 §3.4 |
| REQ-BIN-01 | Reliably locate the installer-provisioned rauf | **05 §3** |
| REQ-BIN-02 | Version floor = agent-capable rauf (0.6.0) | **05 §1, §2**; 02 §5 (schema); 07 §3.5 |
| REQ-BIN-03 | Hints name the cross-agent installer, distinct from CLI hint | **05 §4** |
| REQ-BIN-04 | Missing/too-old rauf fails gate before side-effects | **05 §2** |
| REQ-SEAM-01 | Classify every runner-touching stage | **06 §5** (per-stage table) |
| REQ-SEAM-02 | `validate` stays agent-agnostic — explicit guard | **06 §6** |

## Non-functional requirements

| REQ ID | Requirement (abbrev.) | Spec coverage (doc § section) |
|--------|-----------------------|-------------------------------|
| REQ-PERF-01 | Default path adds no runtime cost | **03 §5**; 05 §5 |
| REQ-PERF-02 | Pre-check = one bounded probe, no retries | **04 §2**; 07 §3.2 |
| REQ-SEC-01 | Agent value constrained to advertised id allow-list | **04 §3, §4.1, §7**; 02 §3; 03 §3.4; 07 §3.3 |
| REQ-OBS-01 | Resolved agent + source layer visible at launch | **03 §6** |
| REQ-OBS-02 | No new event types; NDJSON/status JSON unchanged | **03 §6.3** |
| REQ-COMPAT-01 | Existing claude-default projects unchanged | **02 §2; 03 §5**; 01 §5 |
| REQ-COMPAT-02 | Concurrent per-`--backlog` loops unaffected | **03 §7** |

## Constraints

| CON | Constraint (abbrev.) | Spec coverage |
|-----|----------------------|---------------|
| CON-01 | All edits in feature-forge; rauf consumed not modified | 00 (all), **01 §1–§2** |
| CON-02 | Consumed surfaces fixed, not redesigned | **00 §1** (verified signatures) |
| CON-03 | Align to installer's `rauf@0.6.0` pin | **05 §1, §3, §4** |
| CON-04 | Pluggability via tokenized `loopRunner`, no hardcoded commands | **02 §1**; 01 §2 |
| CON-05 | Gate is `bash scripts/validate.sh`, not `pnpm gate` | **07 §1, §5**; 01 §4 |

## Success criteria (acceptance-level, primarily verified in testing)

| SC | Criterion (abbrev.) | Spec coverage |
|----|---------------------|---------------|
| SC-01 | Default path drives rauf+claude as today | 02 §2; 03 §5; 07 §3.4 |
| SC-02 | Non-default agent per run + project default, precedence + source shown | 03 §2–§4, §6; 07 §3.1 |
| SC-03 | Unavailable agent ⇒ warn + proceed/choose; confirm lists agents | 04 §3, §4.2, §6; 07 §3.2 |
| SC-04 | Alternate runner w/o agent surface ⇒ selection vanishes | 02 §2; 07 §3.4 |
| SC-05 | Version gate floors at agent-capable rauf, fails clearly | 05 §1, §2, §4; 07 §3.5 |
| SC-06 | Contract classifies every runner-touching stage; validate agnostic | 06 §5, §6 |
| SC-07 | `validate.sh` passes + mock-runner test proves plumbing | **07 §1, §3, §4** |
| SC-08 | Unknown id aborts before side-effects, listing valid ids | **07 §3.2**; 04 §4.1 |

## Open-question resolutions

| OQ | Resolution | Where |
|----|------------|-------|
| OQ-01 | Version floor = **0.6.0** (pinned to source-presence) | 05 §1; 00 §2 |
| OQ-02 | Flat `agentArgument`/`agentsProbeCommand`/`defaultAgent`, presence-gated | 02 §1, §3; 00 §3 |
| OQ-T1 | Executable spec is **test-only + doc artifact**, not wired into adapters | 07 §2; 01 §4 |
| OQ-T2 | Cross-agent installer command pinned: `npx feature-forge install` | 05 §4 |

## Coverage assertion

All **29** PRD functional + non-functional requirements (REQ-*) have at least one primary spec
location. All 5 constraints and all 8 success criteria map to spec sections. No orphaned
implementation details: every spec section traces back to a REQ/SC/CON or a tech-spec decision
(verified via each document's `## Requirement Coverage` table).
