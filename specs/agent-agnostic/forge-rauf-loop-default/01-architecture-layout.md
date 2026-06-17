# 01 — Architecture & Layout

> Feature: `forge-rauf-loop-default` (epic `agent-agnostic`). **Target repo: feature-forge**
> (`/home/gary/workspace/feature-forge`). rauf is **consumed, not modified** (CON-01).
> Source of truth: `tech-spec.md` (v1, §2, §6) + `PRD.md` (v1). Shared types/constants are in
> `00-core-definitions.md`. Cross-references use exact filenames.

This document maps **where the feature lives in feature-forge**, the canonical-skill → adapters
build/verify flow, the gate (`bash scripts/validate.sh`, CON-05), the `forge-loop-runner-contract`
**expose** surface, and the dependency graph **among the spec documents** (which to implement
first). There is **no compiled module** — feature-forge is a Claude-plugin repo of skill prose,
JSON references, and Python/Node helpers.

## Requirement Coverage

| REQ ID | Requirement | Section |
|--------|-------------|---------|
| CON-01 | All edits land in feature-forge; rauf unmodified | §1, §2 |
| CON-04 | Pluggability via tokenized `loopRunner`, no hardcoded commands | §2 (schema), §6 |
| CON-05 | Gate is `bash scripts/validate.sh`, not rauf's `pnpm gate` | §4 |
| REQ-DEF-03 | Single authoritative contract doc the capstone consumes | §3 (expose), §6 |
| REQ-COMPAT-01 | Default path byte-identical to today | §5 (degradation) |
| (build integrity) | Adapters regenerated, never hand-edited | §4, §5 |

## 1. Repository context (feature-forge)

feature-forge is a Claude-plugin repository. The canonical authored surface is `skills/` +
`references/`; everything under `adapters/` is **generated** from it. Relevant top-level layout:

```
feature-forge/
├── references/                      # shared JSON schemas + contract docs (canonical)
│   ├── forge-config-schema.json     # ← EDIT: 3 new loopRunner fields + minRunnerVersion floor
│   ├── ralph-loop-contract.md       # ← EDIT: the authoritative forge↔rauf contract (the EXPOSE)
│   ├── loop-agent-selection.py      # ← NEW:  executable spec (resolve/classify/render_launch)
│   ├── shared-conventions.md        # (unchanged) referenced by every skill
│   └── stacks/ …                    # (unchanged)
├── skills/
│   └── forge-5-loop/
│       ├── SKILL.md                 # ← EDIT: Step 1c (version floor), Step 2d (selector), Step 3c (show agent)
│       └── references/
│           └── runner-contract.md   # ← EDIT: new `## Agent selection` section + `--agent` in flags catalog
├── adapters/                        # ← REGENERATE (never hand-edit): claude/codex/gemini/copilot/cursor
├── tests/
│   ├── fixtures/mock-rauf/rauf       # ← NEW:  fake runner (canned version/agents --json, records argv)
│   └── test_loop_agent_selection.py # ← NEW:  pytest exercising resolver + schema defaults
└── scripts/
    ├── validate.sh                  # the gate (CON-05): spec-purity + adapters drift + pytest + installer build
    ├── build-adapters.py            # regenerates adapters/ from canonical skills/ (+ `--check` drift guard)
    └── check-spec-purity.py         # frontmatter/body-size purity guard
```

## 2. File-change map (canonical surface)

The exhaustive set of canonical edits/additions (adapters are downstream of these — §4):

| Path | Change | Specified in | Why |
|------|--------|-------------|-----|
| `references/forge-config-schema.json` | **edit** | `02-config-schema-and-gating.md`, `05-runner-discovery-version-gate.md` | Add `agentArgument`, `agentsProbeCommand`, `defaultAgent` to `loopRunner`; bump `minRunnerVersion` default `0.5.0`→`0.6.0` |
| `skills/forge-5-loop/SKILL.md` | **edit** | `03-selection-resolution-observability.md`, `05-runner-discovery-version-gate.md` | Step 2d run-level selector + inline flag mention; Step 1c version-floor wording; Step 3c show resolved agent + source layer |
| `skills/forge-5-loop/references/runner-contract.md` | **edit** | `03`, `04`, `05` | New `## Agent selection` operational section (precedence, probe, disambiguation, gating) parallel to `## Model selection precedence`; add `--agent` to the optional-flags catalog; agent line in the Step 3c template |
| `references/ralph-loop-contract.md` | **edit** | `06-loop-runner-contract-doc.md` | The **authoritative** contract doc: agent-selection terms + per-stage applicability table (the EXPOSE) |
| `references/loop-agent-selection.py` | **new** | `07-testing-strategy.md` | Executable spec of `resolve`/`classify`/`render_launch`; imported by the test |
| `tests/fixtures/mock-rauf/rauf` | **new** | `07-testing-strategy.md` | Fake runner emitting canned `version --json` / `agents --json`, recording argv |
| `tests/test_loop_agent_selection.py` | **new** | `07-testing-strategy.md` | pytest exercising resolver + classifier + schema defaults |
| `adapters/**` | **regenerate** | §4 below | `python3 scripts/build-adapters.py` after canonical edits; never hand-edit |

**No hardcoded `rauf …` commands** are introduced anywhere (REQ-DEF-02, CON-04): every runner
invocation remains a `loopRunner` template with token substitution, including the new
`agentArgument` / `agentsProbeCommand`.

## 3. The `forge-loop-runner-contract` expose surface (REQ-DEF-03)

The feature's **public API** (its epic-charter `exposes`) is **documentation + schema**, consumed
by the downstream `packaging-docs-ci` capstone:

1. The augmented **`loopRunner` schema block** in `references/forge-config-schema.json` — the
   three new fields + the bumped `minRunnerVersion` (`02`, `05`).
2. The **agent-selection section + per-stage applicability table** in
   `references/ralph-loop-contract.md` (`06`).

There is no programmatic/HTTP API. `packaging-docs-ci` consumes these as *documentation input*,
with no code coupling (tech-spec §6.C confirms no file conflict — the capstone is still at
forge-1-prd and touches none of these paths).

## 4. Build & verification flow (CON-05)

The gate is **`bash scripts/validate.sh`** — *not* rauf's `pnpm gate`. Order of operations when
implementing any item:

```
1. Edit canonical surface only:  references/*.json|*.md|*.py , skills/forge-5-loop/**
2. Regenerate adapters:           python3 scripts/build-adapters.py
3. Run the gate:                  bash scripts/validate.sh
                                    ├─ check-spec-purity.py        (frontmatter/body-size purity)
                                    ├─ build-adapters.py --check   (DRIFT GUARD — fails on stale/hand-edited adapters)
                                    ├─ pytest tests/               (incl. test_loop_agent_selection.py)
                                    └─ installer build             (unaffected by this feature)
```

**Drift guard:** editing `adapters/**` by hand fails `build-adapters.py --check`. Always edit the
canonical `skills/` + `references/`, then regenerate. The executable spec
`references/loop-agent-selection.py` is a canonical reference (not generated), imported by the
pytest; see `07-testing-strategy.md` for whether it is also wired into any adapter (OQ-T1 —
resolved test-only + doc in `07`).

## 5. Capability-gated degradation (REQ-PLUG-01/02, REQ-COMPAT-01)

The whole feature is **additive and presence-gated** on `loopRunner.agentArgument` (`00 §3`,
`02 §2`). Two layout-level consequences:

- **Default / claude path:** when no agent is resolved or the resolved id is `RUNNER_DEFAULT_ID`,
  the rendered launch command and the runtime cost are **byte-identical to today** — no probe, no
  `{agent}`, no selector option shown. The default path touches none of the new code paths.
- **Alternate (non-rauf) runner with no `agentArgument`:** the selector, probe, and substitution
  vanish entirely. No agent argument is ever sent. Pluggability is preserved with zero
  special-casing — the gate is a single config-presence check.

## 6. Inter-document dependency graph

Implement in this order (foundation → fan-out → testing). Edges mean "depends on the types/edits of":

```
00-core-definitions ──┬─▶ 02-config-schema-and-gating ──┐
                      │                                  │
                      ├─▶ 03-selection-resolution-obs ───┤
                      │        ▲                          │
                      ├─▶ 04-availability-precheck ───────┤ (04 depends on 02's gate + 00's types;
                      │                                    │  03 references 04's verdicts for Step 2d)
                      ├─▶ 05-runner-discovery-version-gate┤
                      │                                    │
                      └─▶ 06-loop-runner-contract-doc ─────┤ (06 restates 02/03/04/05 as the EXPOSE)
                                                           │
01-architecture-layout (this doc) ─────────────────────────┤
                                                           ▼
                                              07-testing-strategy
                                   (executable spec + mock-rauf + pytest;
                                    asserts schema defaults from 02, resolution
                                    from 03, classification from 04, floor from 05)
```

- **`00` + `01`** are the foundation — every domain doc builds on the shared types and this layout.
- **`02`** (schema + capability gate) is the first domain doc; **`04`** (probe/classify) and
  **`03`** (selection/resolution) both depend on it; **`03`** references **`04`**'s verdicts for the
  Step 2d UX, and **`04`**'s allow-list comes from **`00 §4`**.
- **`05`** (version gate/discovery) is independent of 03/04 but shares the schema file with **`02`**.
- **`06`** is the synthesis/expose — it restates the operational behavior from 02–05 as the
  authoritative contract; it adds no new mechanism.
- **`07`** verifies all of the above against the executable spec + mock runner.

## Dependencies

- `00-core-definitions.md` — all shared types, constants, the `{agent}` token, result shapes.

## Verification

- [ ] Every path in §2 exists in feature-forge (or is created by the feature) and no other files change.
- [ ] No hardcoded `rauf …` string is introduced in any skill or reference (grep clean).
- [ ] `bash scripts/validate.sh` runs the four stages in §4 and passes after regeneration.
- [ ] `python3 scripts/build-adapters.py --check` passes (no hand-edited/stale adapters).
- [ ] The expose surface (§3) is exactly the schema block + the `ralph-loop-contract.md` additions — nothing else.
- [ ] The default path renders a launch command byte-identical to the pre-feature command (§5).
