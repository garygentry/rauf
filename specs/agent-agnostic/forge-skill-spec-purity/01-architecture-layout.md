# 01 — Architecture & Layout

> Feature: `forge-skill-spec-purity` (epic `agent-agnostic`, target repo **feature-forge**).
> Source of truth: `PRD.md` (v1) + `tech-spec.md` (v1). This document defines where every change
> lands in the `feature-forge` repository: the full file tree, the per-file disposition
> (NEW / EDIT / UNCHANGED), the two exposed public contracts, the `validate.sh` integration map,
> and the intra-feature dependency graph between workstreams. Shared constants and contracts come
> from `00-core-definitions.md`.

## Requirement Coverage

| REQ ID | Requirement | Section |
|--------|-------------|---------|
| REQ-SOT-01 | Canon = `skills/*` + `references/` + resolver | §2, §4 (`spec-pure-skills`) |
| REQ-SOT-02 | No per-agent output produced | §2 (no `adapters/` dir), §6 |
| REQ-RES-05 | Resolver is a single reusable file | §2, §4 (`portable-skill-root-resolver`) |
| REQ-VND-03 | Inventory artifact location | §2 (`references/vendor-construct-inventory.md`) |
| REQ-VER-01 | Checker location + standalone runnability | §2, §5 |
| REQ-VER-03 | Completion gate via `validate.sh` | §5 |
| REQ-COMPAT-02 | Plugin remains loadable (manifests untouched) | §3 |
| REQ-COMPAT-03 | Bundled scripts still locatable/runnable | §3, §5 |
| REQ-MAINT-01 | Mechanical, one-concern-per-change diff | §6 (workstream graph) |

## 1. Scope & guiding rules

- **All implementation lands in `feature-forge`** (`/home/gary/workspace/feature-forge`), per
  constraint **C-1** — even though this spec, the backlog, and the loop run from `rauf`
  (`specs/agent-agnostic/`). The loop iteration operates against the `feature-forge` working tree.
- This is a **mechanical, behavior-preserving refactor** (REQ-MAINT-01): one concern per change so
  the diff stays auditable. No new runtime dependencies (`tech-spec.md §9`).
- **No `adapters/` tree, no per-agent file** is created here (REQ-SOT-02 / C-3) — that is
  `forge-agent-adapters-build`.
- New deliverables: **2 scripts** (`forge-root.sh`, `check-spec-purity.py`), **2 reference docs**
  (`portable-root.md`, `vendor-construct-inventory.md`), **1 test** (`test_check_spec_purity.py`).
  Everything else is an **edit** to existing canon or **unchanged**.

## 2. Directory tree (full)

Paths relative to the `feature-forge` repo root. `★ NEW`, `✎ EDIT`, `· UNCHANGED`.

```
feature-forge/
├── .claude-plugin/
│   ├── plugin.json                 ·  must stay valid + loadable (REQ-COMPAT-02); NOT modified
│   └── marketplace.json            ·  NOT modified (pre-existing 0.10.0/0.9.0 mismatch is out of
│                                       scope — flagged for packaging-docs-ci)
├── skills/
│   ├── forge-0-epic/
│   │   ├── SKILL.md                ✎  argument-hint→metadata; 12 ${CLAUDE_PLUGIN_ROOT}→prelude;
│   │   │                              body 517→≤300 lines (relocate overflow)
│   │   └── references/             ✎  receives forge-0-epic overflow (NEW files under here)
│   ├── forge-5-loop/
│   │   ├── SKILL.md                ✎  argument-hint→metadata; 1 var→prelude; body 418→≤300
│   │   └── references/             ★/✎ receives forge-5-loop overflow
│   ├── forge-verify/
│   │   ├── SKILL.md                ✎  argument-hint→metadata; 1 var→prelude; body 337→≤300
│   │   └── references/
│   │       └── verification-checklists.md  ✎  1 var→prelude; receives forge-verify overflow
│   ├── forge/SKILL.md              ✎  argument-hint→metadata; 3 vars→prelude
│   ├── forge-6-docs/SKILL.md       ✎  argument-hint→metadata; 1 var→prelude
│   ├── forge-init/SKILL.md         ✎  1 `bash` var→prelude (NO argument-hint — unchanged frontmatter shape)
│   ├── forge-1-prd/SKILL.md        ✎  argument-hint→metadata (no var)
│   ├── forge-2-tech/SKILL.md       ✎  argument-hint→metadata (no var)
│   ├── forge-3-specs/SKILL.md      ✎  argument-hint→metadata (no var)
│   ├── forge-4-backlog/SKILL.md    ✎  argument-hint→metadata (no var)
│   └── forge-fix/SKILL.md          ✎  argument-hint→metadata (no var)
├── agents/
│   └── forge-verifier.md           ✎  1 prose ${CLAUDE_PLUGIN_ROOT} (≈line 104) rewritten to
│                                       describe the portable resolver
├── references/
│   ├── shared-conventions.md       ✎  2 invocations → prelude
│   ├── portable-root.md            ★  the canonical bootstrap-prelude snippet + usage doc (REQ-RES-05)
│   └── vendor-construct-inventory.md ★ audit output: every vendor construct + disposition (REQ-VND-03)
├── scripts/
│   ├── forge-root.sh               ★  portable resolver = exposed `portable-skill-root-resolver`; mode 0755
│   ├── check-spec-purity.py        ★  runnable spec-purity checker (REQ-VER-01); mode 0755
│   ├── validate.sh                 ✎  insert check-spec-purity.py step after py_compile, before pytest
│   ├── epic-manifest.py            ·  UNCHANGED (does not reference the env var; invoked via resolver)
│   ├── forge-init.sh               ·  UNCHANGED internals (located via resolver from bodies)
│   ├── session-check.sh            ·  UNCHANGED internals (invoked by hooks.json)
│   └── validate-traceability.py    ·  UNCHANGED internals
├── hooks/
│   └── hooks.json                  ·  UNCHANGED — out-of-canon Claude artifact, documented (REQ-VND-04)
└── tests/
    ├── conftest.py                 ·  UNCHANGED — reused fixtures (fixture_copy, run_cli, importlib loader)
    ├── test_epic_manifest.py       ·  UNCHANGED
    ├── fixtures/                    ★  add clean + impure skill-tree fixtures for the checker
    └── test_check_spec_purity.py    ★  pytest for the checker (REQ-VER-01); follows conftest conventions
```

> **11 SKILL.md edited, 10 of which relocate `argument-hint`** (all but `forge-init`). **3 of the 11
> also undergo body reduction** (`forge-0-epic`, `forge-5-loop`, `forge-verify`). **9 files carry
> the 23 canonical `${CLAUDE_PLUGIN_ROOT}` occurrences** (`03-portable-root-resolver.md §5`).

## 3. Untouched-but-load-bearing surfaces (compatibility, REQ-COMPAT-02/03)

| File | Why untouched | What must stay true |
|------|---------------|---------------------|
| `.claude-plugin/plugin.json` | Manifest defines plugin discovery | Plugin still loads as a Claude Code plugin; skills still discovered (REQ-COMPAT-02). |
| `.claude-plugin/marketplace.json` | Catalog entry | Stays valid JSON. Pre-existing `0.10.0` vs `0.9.0` version mismatch is **out of scope** (flag for `packaging-docs-ci`). |
| `hooks/hooks.json` | Claude `SessionStart` wiring | Left in place; its 1 `${CLAUDE_PLUGIN_ROOT}` is exempt (REQ-VND-04). Documented as out-of-canon in the inventory. |
| `scripts/epic-manifest.py` | The helper bodies invoke | Subcommands (`resolve`, `validate`, `render-status`, `check-name`, `add-feature`, `remove-feature`, `reorder`, `set-dep`, `set-status`) and exit-code contract (0/1/2) **unchanged**; only caller path-naming changes. Verified: no env-var reference. |
| `scripts/{session-check.sh, forge-init.sh, validate-traceability.py}` | Bundled scripts | Located via the resolver; internals unchanged; still runnable in Claude (REQ-COMPAT-03). |

## 4. Public API surface — the two exposed contracts

Both are declared in the epic charter and consumed read-only downstream
(`forge-agent-adapters-build`, `packaging-docs-ci`).

### `spec-pure-skills` (module) — REQ-SOT-01

The canonical `skills/*/SKILL.md` set plus their `references/`, reduced to spec-pure frontmatter.
**Contract shape downstream relies on:** each `SKILL.md` has frontmatter drawn **only** from
`{name, description, license, compatibility, metadata, allowed-tools}` (`00-core-definitions.md §1`),
with `name == <dir>`, `description` verbatim, and any Claude `argument-hint` preserved under
`metadata.argument-hint`. No body references `${CLAUDE_PLUGIN_ROOT}` (only the prelude + resolver
path). This is what `forge-agent-adapters-build` parses to reconstruct Claude-native output
losslessly.

### `portable-skill-root-resolver` (function) — REQ-RES-05

`scripts/forge-root.sh` — a self-contained Bash script that prints the absolute plugin root to
stdout (exit 0) or an actionable error to stderr (exit 1), per the contract in
`00-core-definitions.md §7`. **Copied verbatim** into per-agent script mirrors by the downstream
generator, so it must depend on nothing in the repo beyond standard POSIX/Bash + the sentinel
files. Full script in `03-portable-root-resolver.md §3`.

## 5. `validate.sh` integration map (REQ-VER-03, REQ-COMPAT-03)

`scripts/validate.sh` is extended with **one** new step. Current ordered structure (verified from
source):

1. marketplace.json valid JSON
2. plugin.json valid JSON
3. marketplace entries resolve to a plugin.json
4. skill frontmatter has `name` + `description` (loops `skills/*/SKILL.md`)
5. agent frontmatter has `name` + `description`
6. **script permissions** — loops `scripts/*.sh`, asserts each is `-x`
7. epic-manifest helper: `py_compile`, then `pytest tests` (soft-skip when pytest absent)

**New step (inserted between 6 and 7 — i.e. after the existing script-permission check and the
`py_compile`, before `pytest`, per `tech-spec.md §3.4`):** invoke `check-spec-purity.py`
**unconditionally** (python3 stdlib only — always available). Under `set -euo pipefail` any
non-zero exit fails `validate.sh` immediately; it is a **hard gate**, never soft-skipped (unlike the
`pytest` step). Implementation detail in `05-spec-purity-checker.md §5`.

**Executable-bit note (gate subtlety, `tech-spec.md §2`):** validate.sh step 6 globs `scripts/*.sh`,
so it auto-covers `forge-root.sh` (a `.sh`) — that file's `0755` bit **is** enforced by the gate. It
does **not** glob `*.py`, so `check-spec-purity.py`'s executable bit is **not** checked there (just
as `epic-manifest.py` is non-executable and invoked via `python3`). The checker is therefore invoked
as `python3 "$ROOT/scripts/check-spec-purity.py"` in validate.sh, and its `0755` bit is a
convenience for standalone runs, not a gated requirement. Both new scripts are still created `0755`
per the tech spec, but only the `.sh` is gate-enforced.

**Completion gate (REQ-VER-03):** `check-spec-purity.py` green against the final state of all 11
skills **and** `bash scripts/validate.sh` passing end-to-end.

## 6. Intra-feature dependency graph (workstreams → docs)

The four workstreams from `tech-spec.md §1` map onto the domain docs. Ordering reflects what must
land first for a clean, mechanical diff (REQ-MAINT-01):

```
00-core-definitions  ──┬─────────────┬──────────────┬───────────────┐
   (schema, prelude,   │             │              │               │
    constants, types)  ▼             ▼              ▼               ▼
01-architecture     02-frontmatter  03-portable    04-body-size   05-spec-purity
   (this doc)        -purity-and-    -root-          -discipline    -checker
                      inventory       resolver                       (depends on 02/03/04
                         │              │              │              outputs to verify)
                         └──────────────┴──────────────┴──────────────► 06-testing-strategy
```

- **03 (resolver) is the structural prerequisite** for the prelude additions that 02/04 reference:
  the prelude exists only because `forge-root.sh` exists. Authoring order need not equal landing
  order, but the checker's rule 5 (prelude identity) presupposes the canonical prelude string from
  `00 §3`.
- **04 (body size) must account for prelude growth:** swapping `${CLAUDE_PLUGIN_ROOT}` lines for the
  2-line prelude slightly grows the three oversized bodies, so reduction targets must leave headroom
  under the ≤300-line gate (`04-body-size-discipline.md §3`).
- **05 (checker) verifies the outputs of 02/03/04** and is itself the completion gate (REQ-VER-03);
  **06 (testing)** tests 05 and the resolver and defines the behavioral-smoke gate.

## Dependencies

- `00-core-definitions.md` — all constants, schema, prelude, and contracts referenced here.

## Verification

- [ ] Every file marked `★ NEW` exists after implementation; every `✎ EDIT` file is changed exactly
      as its annotation states; every `· UNCHANGED` file has no diff.
- [ ] No `adapters/` directory and no per-agent artifact is created (REQ-SOT-02).
- [ ] `git diff --stat` shows 2 new scripts, 2 new reference docs, 1 new test (+ fixtures), 11
      edited `SKILL.md`, 1 edited agent, 1 edited `references/shared-conventions.md`, 1 edited
      `verification-checklists.md`, 1 edited `validate.sh` — and nothing in `.claude-plugin/`,
      `hooks/`, or the unchanged scripts.
- [ ] `bash scripts/validate.sh` runs the new checker step unconditionally and passes end-to-end.
- [ ] The plugin still loads under Claude Code and all 11 skills still trigger (REQ-COMPAT-02,
      cross-checked by `06-testing-strategy.md` behavioral smoke).
