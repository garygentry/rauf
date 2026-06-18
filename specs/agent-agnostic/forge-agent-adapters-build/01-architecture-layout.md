# 01 — Architecture & Layout

> Feature: `forge-agent-adapters-build` (epic `agent-agnostic`, member 3 of 6, target repo
> **feature-forge** at `/home/gary/workspace/feature-forge`). Source of truth: `PRD.md` (v1) +
> `tech-spec.md` (v1). This document defines where every change lands in `feature-forge`: the full
> file tree with per-file disposition (NEW / EDIT / UNCHANGED), the generated `adapters/` output
> layout, the three exposed public contracts + the `build-adapters.py` CLI, the venv-provisioning &
> `.gitignore` deliverables, the `validate.sh` integration map, the exact read-only integration
> surfaces in feature-forge, and the intra-suite dependency graph. Shared types/constants come from
> `00-core-definitions.md`.

## Requirement Coverage

| REQ ID | Requirement | Section |
|--------|-------------|---------|
| REQ-GEN-02 | Single-command, non-interactive generator | §4 (CLI) |
| REQ-GEN-03 | Five target agents | §3 (`adapters/<agent>/`) |
| REQ-GEN-04 | Self-contained per-agent bundle | §3 (bundle layout) |
| REQ-OUT-02 | `adapters/` committed | §2, §3 |
| REQ-DOC-01 | Hand-authored `AGENTS.md` at repo root | §2, §5 (`AGENTS.md`) |
| REQ-PUR-01/02 | Purity exemption is additive | §2 (`check-spec-purity.py ✎`), §6 |
| REQ-CI-02/04 | Drift guard wired into `validate.sh`; single verify cmd | §6 |
| REQ-SEC-01 | Generator writes only under `adapters/` | §4, §7 |
| REQ-SCALE-01 | New skill → no generator change | §3, §8 |
| C-3 | Canon consumed read-only | §7 (integration points) |
| C-4 | New dep auto-provisioned by verify cmd | §2 (venv), §6 |

## 1. Scope & guiding rules

- **All implementation lands in `feature-forge`** (constraint **C-1**) — even though this spec, the
  backlog, and the loop run from `rauf` (`specs/agent-agnostic/forge-agent-adapters-build/`). The
  loop iteration operates against the `feature-forge` working tree (branch `forge/skill-spec-purity`,
  which holds the spec-pure canon this feature consumes; **PR #5 unmerged** — no in-progress
  conflict, tech-spec §6).
- This feature is **purely additive**: it creates a generator + generated tree + a hand-authored
  doc, and makes **two additive edits** to existing tooling (`check-spec-purity.py`, `validate.sh`)
  plus one **`.gitignore`** amendment. It **never modifies canon** (`skills/`, `agents/`,
  `references/`, `scripts/forge-root.sh`) — C-3, read-only.
- **Verify command is `bash scripts/validate.sh`** (C-2). There is no TypeScript/`pnpm` gate.
- New deliverables: **1 generator** (`scripts/build-adapters.py`), **1 dep manifest**
  (`scripts/requirements-adapters.txt`), **1 test** (`tests/test_build_adapters.py` + fixtures),
  **1 hand-authored doc** (`AGENTS.md`), and the generated, committed **`adapters/`** tree.

## 2. Directory tree (full)

Paths relative to the `feature-forge` repo root. `★ NEW`, `✎ EDIT`, `· UNCHANGED (read-only canon)`.

```
feature-forge/
├── AGENTS.md                          ★  HAND-AUTHORED cross-agent instructions (REQ-DOC-01..03);
│                                          NO generated header; excluded from drift guard
├── .gitignore                         ✎  add `.venv-adapters/` and `adapters.tmp-*/` (§2.1)
├── .claude-plugin/
│   ├── plugin.json                    ·  UNCHANGED (D1: Claude still loads skills/ canon; metadata-
│   │                                      only manifest, no skills/source key — researcher §9)
│   └── marketplace.json               ·  UNCHANGED
├── skills/                            ·  READ-ONLY canon (11 SKILL.md + 7 references/ subdirs) — C-3
├── agents/                            ·  READ-ONLY canon (forge-researcher, forge-spec-writer,
│                                          forge-verifier) — C-3
├── references/                        ·  READ-ONLY canon (9 root files + stacks/ ×5) — C-3, §7
├── scripts/
│   ├── build-adapters.py             ★  the generator (exposed `build-adapters`); mode 0755
│   ├── requirements-adapters.txt     ★  the single pinned YAML dep (e.g. `PyYAML==X.Y.Z`)
│   ├── check-spec-purity.py          ✎  additive `adapters/**` exemption (§6, REQ-PUR-01/02)
│   ├── validate.sh                   ✎  insert top-level step "6b. Adapters regen-and-diff" after 6a
│   ├── forge-root.sh                 ·  UNCHANGED; copied BYTE-IDENTICAL into each bundle (REQ-GEN-05)
│   ├── epic-manifest.py              ·  UNCHANGED
│   └── …                             ·  UNCHANGED
├── adapters/                          ★  NEW, GENERATED, COMMITTED (exposed `adapters-output`)
│   ├── claude/                            (§3 — per-agent bundle layout)
│   ├── codex/
│   ├── copilot/
│   ├── cursor/
│   ├── gemini/
│   └── GENERATION-REPORT.md           ★  committed drop-with-record report (REQ-OBS-01)
├── tests/
│   ├── conftest.py                   ·  UNCHANGED — reuse `fixtures_dir`, `fixture_copy`,
│   │                                      `run_cli`, the importlib loader (researcher §6)
│   ├── test_check_spec_purity.py     ✎  +1 test: impure file under adapters/ does NOT trip checker
│   ├── test_build_adapters.py        ★  the generator's pytest suite (`06-testing-strategy.md`)
│   └── fixtures/                     ★  add minimal clean + malformed canon fixture trees
└── .venv-adapters/                    ★  GITIGNORED — isolated venv holding the pinned YAML dep
```

### 2.1 `.gitignore` amendment (REQ-DET-02 / REQ-SEC-01 hygiene — verifier V-002)

`feature-forge/.gitignore` today (researcher §8) has **no** venv/tmp entry. Add:

```gitignore
# Adapter build artefacts (forge-agent-adapters-build)
.venv-adapters/
adapters.tmp-*/
```

`.venv-adapters/` is the provision venv (§below); `adapters.tmp-*/` covers the sibling temp build
dirs the atomic publish uses (`02-generator-engine.md §4`) so an aborted fail-fast build leaves no
untracked noise. **Note (scope):** `adapters/` itself is **NOT** ignored — it is committed
(REQ-OUT-02). This `.gitignore` edit is a one-time repo-config deliverable performed during
implementation, **not** a generator write, so it does not violate REQ-SEC-01 (§7).

## 3. Generated output layout (`adapters/`, REQ-GEN-04)

`adapters/` is built from scratch each run (full regenerate, REQ-DET-02) and committed
(REQ-OUT-02). One self-contained bundle per target — runnable for that agent **without reaching back
into canon**:

```
adapters/<agent>/                         # <agent> ∈ AGENT_TARGETS (00 §1)
├── skills/<name>/<native-skill-file>     # translated frontmatter + body per agent (03)
│   └── references/                        # that skill's own references/ subdir, verbatim (if any)
├── agents/<native-agent-form>            # translated sub-agents where representable (REQ-GEN-06)
├── references/                            # whole repo-root references/ tree, verbatim (D5, §7)
├── scripts/forge-root.sh                 # byte-identical copy of canon resolver (REQ-GEN-05), 0755
└── <agent-manifest>                      # e.g. gemini-extension.json (gemini); none for plain mirrors
```

- The exact native skill-file name + manifest per agent is in `03-per-agent-emitters.md`
  (e.g. claude `SKILL.md`, cursor `.mdc`, gemini body + `gemini-extension.json`).
- The references closure (each skill's own `references/` + the whole shared `references/` tree) and
  the verbatim `forge-root.sh` copy are added by the engine's self-containment pass
  (`04-provenance-selfcontainment-report.md §2`), not by the per-agent emitter.
- **Discovery-driven (REQ-SCALE-01):** the bundle's skill set comes from globbing `skills/`, so a
  new canonical skill appears in every bundle on the next regenerate with no generator change.

## 4. Public API surface & CLI

The three exposed contracts (epic-manifest `exposes` for this feature):

- **`build-adapters`** (function) — `scripts/build-adapters.py`. Single non-interactive command
  (REQ-GEN-02), writes only under `adapters/` + its own `adapters.tmp-<pid>/` (REQ-SEC-01). CLI:

  | Invocation | Behavior | Exit (per `00 §9`) |
  |---|---|---|
  | `python3 scripts/build-adapters.py` | Full regenerate → temp dir → atomic-swap over `adapters/`. | 0 ok / 1 canon error / 2 usage |
  | `python3 scripts/build-adapters.py --check` | Build to temp, `diff -r` vs committed `adapters/`, print diff + remediation on mismatch; never mutate `adapters/`. | 0 identical / 1 drift / 2 usage |
  | `--root DIR` | Repo root (default: parent of script dir), mirroring `check-spec-purity.py`. | — |

- **`AGENTS.md`** (module) — hand-authored repo-root file; content contract in
  `05-purity-exemption-and-drift-guard.md §3`. Not parsed or emitted by the generator (REQ-DOC-03).
- **`adapters-output`** (module) — the committed `adapters/` tree consumed by `cross-agent-installer`
  and gated by `packaging-docs-ci`'s CI diff. **Stability contract for consumers:** one per-agent
  dir per target; each skill self-contained (its `references/` + `forge-root.sh`); every generated
  file provenance-stamped; layout deterministic and byte-stable (REQ-DET-01).

### Venv provisioning (C-4)

The generator needs a pinned YAML lib (`00 §3`, `02-generator-engine.md §3`). `validate.sh` step 6b
auto-provisions it into an isolated, gitignored venv so the verify command needs **no** manual
setup: create/reuse `feature-forge/.venv-adapters`, `pip install -q -r
scripts/requirements-adapters.txt` into it, then invoke the generator from that interpreter.
Isolation avoids PEP-668 "externally-managed" failures and never mutates system Python; first run
pays a one-time install, later runs are cached. Full step text in
`05-purity-exemption-and-drift-guard.md §2`.

## 5. `AGENTS.md` placement

Hand-authored at the **feature-forge repo root** (REQ-DOC-01). It documents build/test commands,
repo conventions, and install-path priority (REQ-DOC-02); carries **no** DO-NOT-EDIT header and is
**excluded** from the drift guard (REQ-DOC-03). Content contract:
`05-purity-exemption-and-drift-guard.md §3`.

## 6. `validate.sh` integration map (REQ-CI-02, REQ-CI-04)

`scripts/validate.sh` (171 lines, `set -euo pipefail`, researcher §5) gains **one new top-level
step** inserted **between** the existing step 6a (line 132) and the step-7 comment (line 134):

```
… step 6  — Script permissions check
   step 6a — Spec-purity gate            (HARD gate; python3 stdlib; never soft-skipped)
   step 6b — Adapters regen-and-diff     ★ NEW: provision venv → `build-adapters.py --check`
                                            (HARD gate; OUTSIDE the `if [ -f "$HELPER" ]` guard)
   step 7  — epic-manifest helper + pytest (pytest soft-skipped if absent — inside the guard)
```

Step 6b is a **top-level, unconditional** step (sibling of 6a), so under `set -euo pipefail` a
non-zero `--check` exit fails the gate immediately — never soft-skipped, unlike step 7's pytest. It
increments the existing `ERRORS` counter on failure (same pattern as 6a). Because `bash
scripts/validate.sh` is the single verify command (REQ-CI-04, C-2), the generator + guard are fully
reachable through it. Exact step text + the purity-exemption edit are in
`05-purity-exemption-and-drift-guard.md §1–§2`.

> **"in CI" (REQ-CI-02):** feature-forge has **no `.github/workflows/` yet** — `validate.sh` is the
> gate. Standing up the GH Actions workflow that runs `validate.sh` is `packaging-docs-ci`'s scope;
> this feature delivers the guard *inside* `validate.sh`, and "in CI" follows once that workflow
> exists.

## 7. Integration points (exact feature-forge surfaces)

All consumed canon is **read-only** (C-3). Signatures/shapes below are verified against the actual
source on branch `forge/skill-spec-purity` (forge-researcher report).

**Consumed read-only (the `spec-pure-skills` + `portable-skill-root-resolver` contracts):**

- **`skills/*/SKILL.md`** (11) — frontmatter `{name, description[, metadata.argument-hint]}`;
  `name == <dir>` (all 11). 10 carry `metadata.argument-hint`; `forge-init` has none. 7 have a
  `references/` subdir: `forge-0-epic`, `forge-1-prd`, `forge-2-tech`, `forge-3-specs`,
  `forge-5-loop`, `forge-6-docs`, `forge-verify`. No skill has a `hooks/` dir or `hooks.json`.
- **`agents/*.md`** (3) — per-file Claude-only key sets (NOT uniform): `forge-researcher`
  `{tools, model, maxTurns, effort}`; `forge-spec-writer` `{tools, model, maxTurns}`;
  `forge-verifier` `{tools, model, maxTurns, memory, skills}` (`00 §2`).
- **`references/`** (repo-root, 14 files): `epic-manifest-schema.json`, `forge-config-schema.json`,
  `pipeline-state-schema.json`, `portable-root.md`, `process-overview.md`, `ralph-loop-contract.md`,
  `shared-conventions.md`, `stack-resolution.md`, `vendor-construct-inventory.md`, and
  `stacks/{_generic,go,python,rust,typescript}.md` — all copied verbatim into each bundle (D5).
- **`scripts/forge-root.sh`** (50 lines, mode 0755) — the `portable-skill-root-resolver`; copied
  **byte-identical** (REQ-GEN-05). Its root predicate requires sibling `scripts/epic-manifest.py` +
  `.claude-plugin/plugin.json` sentinels; the bundle copy will not self-resolve to the bundle root
  (no sentinels there) — that is **expected and out of scope** (foreign-agent discovery is owned by
  `cross-agent-installer`, PRD §6). The generator copies it verbatim and asserts byte-identity, no
  more.

**Edited additively (the only two tooling edits):**

- **`scripts/check-spec-purity.py`** — `CANONICAL_SURFACES = ("skills/**/SKILL.md",
  "skills/**/references/**/*", "references/**/*", "agents/*.md")` and `RESIDUAL_VAR_EXEMPT = (...)`
  (researcher §4). `adapters/**` matches **none** of `CANONICAL_SURFACES`, so generated output is
  outside the scan by construction; the edit adds a named `adapters/**` exemption + test as
  belt-and-suspenders (REQ-PUR-01/02). Detail: `05-purity-exemption-and-drift-guard.md §1`.
  **Note:** a generated `forge-root.sh` copy under `adapters/` contains the sanctioned residual
  env-var fallback, and the verbatim references copies contain the canonical prelude — the
  `adapters/**` exemption keeps rule-3/rule-5 from re-scanning them.
- **`scripts/validate.sh`** (§6).

**Tests** — `tests/conftest.py` provides `fixtures_dir`, `fixture_copy(tmp_path)`, `run_cli`, and an
importlib loader for hyphenated script names (researcher §6). `tests/test_build_adapters.py`
subprocess-drives the generator over fixture canon following these patterns
(`06-testing-strategy.md`).

**Writes (REQ-SEC-01):** the generator writes ONLY under `adapters/` and its own sibling
`adapters.tmp-<pid>/` staging dir; it asserts every output path is within the resolved repo root
before writing and touches nothing else (`AGENTS.md` is hand-authored — the generator never writes
it).

## 8. Intra-suite dependency graph

```
00-core-definitions ──┬─→ 02-generator-engine ──┬─→ 03-per-agent-emitters ──┐
                      │                          │                            ├─→ 06-testing-strategy
01-architecture-layout┘                          └─→ 04-provenance-selfcontainment-report ─┤
                                                                                            │
                       05-purity-exemption-and-drift-guard ─────────────────────────────────┘
```

- `00` + `01` are the foundation; every other doc depends on both.
- `02` (engine) depends on `00`; `03` (emitters) + `04` (provenance/closure/report) depend on `00`
  + `02`; `05` (exemption/guard/AGENTS.md) depends on `00` + `01`; `06` (tests) depends on all.
- Implementation/backlog order: scaffold (`02`) → emitters (`03`) → provenance+closure+report (`04`)
  → exemption+guard+AGENTS.md (`05`), with tests (`06`) growing alongside. `05`'s `validate.sh`
  wiring is the completion gate.

## Dependencies

Depends on `00-core-definitions.md`. Consumed by every feature-specific document (`02`–`05`) and the
testing strategy (`06`).

## Verification

- [ ] Every `★ NEW` / `✎ EDIT` path in §2 is created/edited exactly once; no canon (`·`) file is
      modified (C-3).
- [ ] `.gitignore` gains `.venv-adapters/` + `adapters.tmp-*/` but NOT `adapters/` (which is
      committed, REQ-OUT-02).
- [ ] `build-adapters.py` exposes exactly the §4 CLI; `--check` never mutates `adapters/`.
- [ ] Each `adapters/<agent>/` bundle is self-contained (skill's own + shared `references/` +
      `forge-root.sh`) per §3 (asserted in `06-testing-strategy.md`).
- [ ] `validate.sh` step 6b is top-level, after 6a, outside the `if [ -f "$HELPER" ]` guard, and a
      `--check` failure fails the gate (REQ-CI-02/04).
- [ ] The §7 signatures match the live source on branch `forge/skill-spec-purity`.
