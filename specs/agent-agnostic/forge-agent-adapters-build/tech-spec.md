# forge-agent-adapters-build — Technical Specification

> **Epic:** `agent-agnostic` · **Feature:** `forge-agent-adapters-build` (member 3 of 6) · **Version:** 1
> **Target repo:** `feature-forge` (`/home/gary/workspace/feature-forge`) — per constraint **C-1**, all implementation lands there; this spec, the backlog, and the loop run from `rauf` (`specs/agent-agnostic/forge-agent-adapters-build/`).
> **Depends on:** `forge-skill-spec-purity` (complete) · **Exposes:** `build-adapters`, `AGENTS.md`, `adapters-output`
> **Verify command:** `bash scripts/validate.sh` (in feature-forge). There is **no** `pnpm`/TypeScript gate (C-2).

## 1. Overview

This feature adds a deterministic **canonical→per-agent build step** to feature-forge. It introduces one generator (`scripts/build-adapters.py`) that walks the spec-pure canon — the **11** `skills/*/SKILL.md`, the **3** `agents/*.md` sub-agent definitions, and the `references/` trees — and emits a self-contained, provenance-stamped `adapters/<agent>/` tree for five targets (**claude, codex, copilot, cursor, gemini**). It also delivers a hand-authored canonical `AGENTS.md` and a regenerate-and-diff drift guard wired into `scripts/validate.sh`.

The generator treats canon strictly **read-only** (C-3) and writes **only** within `adapters/` (REQ-SEC-01). `AGENTS.md` is hand-authored, not generated (REQ-DOC-03).

**Key architectural decisions (resolved in interview):**

- **D1 — Claude load source = `skills/` canon stays authoritative; `adapters/claude/` is a generated parallel packaging copy** (OQ-1). `.claude-plugin/plugin.json` is **not** repointed. The live plugin is untouched mid-epic (lowest risk); `adapters/claude/` exists for the installer/CI and to prove the Claude-native round-trip (REQ-VND-01). The REQ-COMPAT smoke (OQ-4) remains a separate maintainer check and does not block.
- **D2 — Generator = `python3` + a single pinned YAML library** (the user opted into a dep over stdlib-only; C-4). The pinned version is part of the **determinism contract** (§3.6). The lib is auto-provisioned into an isolated, gitignored venv by `validate.sh` so the verify command needs no manual setup.
- **D3 — `adapters/` is committed** (REQ-OUT-02) and **outside `check-spec-purity.py`'s `CANONICAL_SURFACES`** by construction; REQ-PUR-01 is satisfied by an **explicit belt-and-suspenders exemption guard + test**, not a scan rewrite (§3.7).
- **D4 — Drift guard = `build-adapters.py --check`**: regenerate into a temp dir, `diff -r` against committed `adapters/`, non-zero + remediation on drift. Wired as a **top-level** `validate.sh` step (sibling of the existing "6a. Spec-purity gate"), so it runs unconditionally under `set -euo pipefail` (§3.8).
- **D5 — Self-containment = whole-tree copy** of the repo-root `references/` plus each skill's own `references/` subdir into every bundle (REQ-GEN-04), avoiding fragile per-file closure parsing; markdown is tiny so size is a non-issue.

> **Decision map (downstream specs cite against this):** D1 = Claude load source · D2 = generator stack/determinism · D3 = purity exemption · D4 = drift guard · D5 = reference closure.

## 2. Module Structure

All paths relative to the `feature-forge` repo root. **NEW** unless noted.

```
feature-forge/
├── scripts/
│   ├── build-adapters.py            — NEW: the generator (exposed contract: build-adapters)
│   ├── requirements-adapters.txt    — NEW: the single pinned YAML dep (e.g. PyYAML==X.Y.Z)
│   ├── validate.sh                  — EXTENDED: new top-level "6b. Adapters regen-and-diff" step
│   ├── check-spec-purity.py         — EXTENDED: explicit adapters/** exemption guard + comment
│   ├── forge-root.sh                — UNCHANGED (0755; copied VERBATIM into each mirror, REQ-GEN-05)
│   └── epic-manifest.py, …          — UNCHANGED
├── adapters/                        — NEW, GENERATED, COMMITTED (exposed contract: adapters-output)
│   ├── claude/                      — skills + agents w/ native Claude frontmatter (argument-hint restored)
│   ├── codex/                       — skill mirror + optional agents/openai.yaml
│   ├── copilot/                     — skill copy w/ Copilot frontmatter
│   ├── cursor/                      — .mdc rule files
│   ├── gemini/                      — gemini-extension.json manifest + skill bodies
│   └── GENERATION-REPORT.md         — committed drop-with-record report (REQ-OBS-01)
├── AGENTS.md                        — NEW, HAND-AUTHORED (exposed contract: AGENTS.md; REQ-DOC-01..03)
├── tests/
│   ├── test_build_adapters.py       — NEW: determinism, idempotency, provenance, self-containment,
│   │                                  fail-fast, verbatim-resolver, drop-with-record
│   └── fixtures/                    — EXTEND: small canon fixture trees (clean + malformed) for the generator
├── .venv-adapters/                  — NEW, GITIGNORED: isolated venv holding the pinned YAML dep
└── .claude-plugin/plugin.json       — UNCHANGED (D1: still loads skills/)
```

**Per-bundle layout (every `adapters/<agent>/`, REQ-GEN-04 self-containment):**

```
adapters/<agent>/
├── skills/<name>/<native-skill-file>   — translated frontmatter + body per agent (§5)
│   └── references/                      — that skill's own references/ subdir (verbatim)
├── agents/<native-agent-form>           — translated sub-agents where representable (REQ-GEN-06)
├── references/                          — whole repo-root references/ tree (verbatim, D5)
├── scripts/forge-root.sh                — byte-identical copy of canon resolver (REQ-GEN-05)
└── <agent-manifest>                     — e.g. gemini-extension.json (gemini); none for plain mirrors
```

**Public API surface (the three exposed contracts):**

- **`build-adapters`** (function) — `scripts/build-adapters.py`; CLI in §5. Single-command, non-interactive (REQ-GEN-02).
- **`AGENTS.md`** (module) — hand-authored repo-root file; content contract in §3.4.
- **`adapters-output`** (module) — the committed `adapters/` tree consumed by `cross-agent-installer` and gated by `packaging-docs-ci`'s CI diff. **Stability contract for consumers:** a per-agent dir per target; each skill self-contained (its `references/` + `forge-root.sh`); every generated file provenance-stamped; layout deterministic.

## 3. Technical Decisions

### 3.1 Generator architecture & canonical input set (REQ-GEN-01..03, REQ-GEN-06, REQ-SCALE-01)

`build-adapters.py` is structured as **discovery → parse → per-agent emit → atomic publish**:

1. **Discovery (REQ-GEN-01, REQ-SCALE-01):** glob the canon under the repo root in **sorted POSIX order** — `skills/*/SKILL.md`, `agents/*.md`, and the reference trees. The input set is discovered, never hard-coded, so adding a skill or sub-agent needs **no generator change** (REQ-SCALE-01). Confirmed current canon: 11 skills, 3 sub-agents (`forge-researcher`, `forge-spec-writer`, `forge-verifier`).
2. **Parse:** split each markdown file into `(frontmatter_map, body)` via the pinned YAML loader (`safe_load`). The data model the generator owns is small (§4); the canonical frontmatter is `{name, description[, metadata]}` for skills. Sub-agent frontmatter is **not a fixed schema** — each `agents/*.md` carries its own set of Claude-only keys, **discovered per-file from the parsed frontmatter**, not hard-coded. The union actually present across the current 3 sub-agents is `{tools, model, maxTurns, effort, memory, skills}` (verified ground truth: `forge-researcher` has `effort`; only `forge-verifier` has `memory`+`skills`; `forge-spec-writer` has neither). The AgentRecord (§4) therefore carries whatever non-`{name, description}` keys each file actually has, so a future sub-agent adding a new Claude-only key is auto-covered (REQ-SCALE-01).
3. **Per-agent emit:** for each target, an **emitter** (one function/class per agent — a pluggable registry keyed by agent id) maps the canonical record to that agent's native artifact (§5), applies the **drop-with-record** rule for unrepresentable constructs (REQ-FMT-03 / REQ-OBS-01), copies the skill's `references/` + the shared `references/` (D5) + `forge-root.sh` verbatim, and stamps provenance (§3.5).
4. **Atomic publish (REQ-DET-02, REQ-ROB-01):** build the **complete** tree into a sibling temp dir (`adapters.tmp-<pid>/`), then `os.replace`-swap it over `adapters/` only after a fully successful build. A failure leaves the previously-committed `adapters/` intact (no partial tree). This also delivers "full regenerate" — stale/orphaned files cannot survive because the published tree is built from scratch each run.

**Sub-agent translation (REQ-GEN-06):** the 3 `agents/*.md` carry Claude-only keys drawn from the union `{tools, model, maxTurns, effort, memory, skills}` (per-file, not uniform — see step 2). Each emitter translates the sub-agent into the target's native agent construct where one exists (e.g. Codex `agents/openai.yaml`) and, for **every** Claude-only key not representable in the target, applies drop-with-record (REQ-FMT-03 / REQ-OBS-01) — the dropped keys are **enumerated from the parsed frontmatter of each file, not from a hard-coded list**, so keys like `effort` cannot be silently dropped-without-record. The `description` is preserved byte-for-byte everywhere it lands (REQ-FMT-04).

### 3.2 Per-agent format translation (REQ-FMT-01..04)

Each emitter produces the agent's **documented native format** (REQ-FMT-01), not lowest-common-denominator output. The field-level mapping is the table in **§5**. Two cross-cutting rules:

- **REQ-FMT-02 (lossless metadata reconstruction):** where a target has an equivalent field, relocated canonical `metadata.argument-hint` is reconstructed into it — most importantly the Claude adapter's top-level `argument-hint` (§3.3). Targets with no invocation-hint field record it as dropped.
- **REQ-FMT-03 (omit-never-emit-invalid):** a canonical construct with no native equivalent is **omitted** from that agent's output (never written as invalid frontmatter) and **recorded** (§3.5).
- **REQ-FMT-04 (description byte-fidelity):** `description` text is copied verbatim into every target that has a description field; emitters MUST NOT reflow, re-quote in a lossy way, or trim it. (The YAML emitter is configured to preserve the scalar; tests assert byte-equality of the decoded value.)

### 3.3 Claude adapter specifics (REQ-VND-01..02)

- **REQ-VND-01:** the Claude emitter reconstructs top-level `argument-hint` from `metadata.argument-hint`, yielding Claude-native skills with no information loss vs. the pre-purity originals. (10 of 11 skills carry `argument-hint`; `forge-init` has none — emit none.)
- **REQ-VND-02:** Claude-valid artifacts that are representable for the Claude target (e.g. a `hooks/hooks.json`) are **retained** in `adapters/claude/`; the same artifacts are omitted-with-record for non-Claude agents (REQ-FMT-03).
- **D1:** `adapters/claude/` is a parallel copy; `plugin.json` keeps loading `skills/`.

### 3.4 Canonical AGENTS.md (REQ-DOC-01..03)

Hand-authored `AGENTS.md` at the feature-forge repo root. **MUST** document (REQ-DOC-02): build/test commands (`bash scripts/validate.sh`, `python3 scripts/build-adapters.py`), repository conventions (spec-pure canon, stdlib+pinned-dep tooling, the resolver/prelude pattern), and the **install-path priority** — Claude marketplace/plugin install preferred (C-5), then the universal install path. **MUST NOT** carry a DO-NOT-EDIT header and is **excluded** from the drift guard (REQ-DOC-03). It is not parsed or emitted by the generator.

### 3.5 Provenance, generation report & drop-with-record (REQ-OUT-01, REQ-OBS-01)

- **Provenance header (REQ-OUT-01)** on every generated file, naming the canonical source path and the exact regenerate command (`python3 scripts/build-adapters.py`), no timestamp (§3.6):
  - **Markdown / `.mdc` / YAML-frontmatter files:** a YAML **comment** as the first line *inside* the frontmatter block (`---` stays the first byte for parsers that require it):
    ```
    ---
    # GENERATED — DO NOT EDIT. Source: skills/forge-1-prd/SKILL.md. Regenerate: python3 scripts/build-adapters.py
    name: forge-1-prd
    …
    ```
  - **Strict JSON (`gemini-extension.json`), no comments possible (OQ-2):** a documented `"_generated"` object carrying `source` + `regenerate` keys.
  - **Copied scripts (`forge-root.sh`):** **no** header is injected — REQ-GEN-05 requires byte-identity. Its provenance is documented in `GENERATION-REPORT.md` instead.
- **Generation report (REQ-OBS-01):** committed at `adapters/GENERATION-REPORT.md` (OQ-3 → committed). Per agent, it lists every canonical construct **dropped or unrepresentable** (e.g. "cursor: sub-agent `tools`/`model`/`effort`/`memory` keys — no Cursor equivalent — dropped"; "copilot: `hooks.json` — omitted"). Being a committed `adapters/` file, it is itself part of the drift-guarded tree, so the drop-record stays truthful. **Provenance treatment:** the report is generated markdown with **no frontmatter block**, so it does not take the in-frontmatter comment form above. It instead carries a **body-top provenance line as its first line** — `<!-- GENERATED — DO NOT EDIT. Generated by python3 scripts/build-adapters.py -->` — satisfying REQ-OUT-01's "every generated file in `adapters/`" requirement for a frontmatter-less file.

### 3.6 Determinism & the pinned-dependency contract (REQ-DET-01..03, REQ-PERF-01)

- **No nondeterminism in output:** no timestamps, no RNG, no hostnames/paths-of-the-day. All directory walks are **sorted** (POSIX byte order, `LC_ALL=C` semantics); dict iteration over frontmatter uses a fixed key order (§4); newline style is normalized to `\n`.
- **YAML emitter is pinned and configured for byte-stability (D2):** a YAML library's serialization is version-coupled, so the pinned version in `requirements-adapters.txt` is part of the determinism contract. The dumper is invoked with explicit, stable options — `sort_keys=False` (preserve our fixed order), `default_flow_style=False`, `allow_unicode=True`, and a large `width` (e.g. 4096) to suppress nondeterministic line-wrapping. **A dependency upgrade is a behavior change:** it requires regenerating `adapters/` and reviewing the diff; the drift guard (§3.8) will catch any emitter-output change, and the test suite (§8) asserts byte-identity against committed expectations. This trade-off is the cost of D2 (vs. stdlib hand-emit) and is documented here and in `AGENTS.md`.
- **Idempotency (REQ-DET-03):** re-running with no canon change yields no git diff — verified by the drift guard and a dedicated test (build twice → byte-identical trees).
- **Performance (REQ-PERF-01):** ~11 skills × 5 agents of markdown copying + small YAML emits completes in well under a second; acceptable inside every `validate.sh`/CI run.

### 3.7 Spec-purity exemption (REQ-PUR-01..02)

`check-spec-purity.py`'s `CANONICAL_SURFACES` globs are rooted at `skills/**`, `references/**`, `agents/*.md` — `adapters/**` matches **none** of them, so generated copies carrying intentional vendor frontmatter are already outside the scan (REQ-PUR-01 satisfied by construction; REQ-PUR-02 preserved — `skills/`/`references/`/`agents/` enforcement is untouched). To make the guarantee **explicit and regression-proof**, add a named `ADAPTERS_EXCLUDE = ("adapters/**",)` filter applied in the surface-collection step (mirroring the existing `RESIDUAL_VAR_EXEMPT` pattern) plus a clarifying comment, and a test asserting an impure file placed under `adapters/` does **not** trip the checker while the same content under `skills/` does. This is a minimal, additive change — not a scan rewrite.

### 3.8 CI regenerate-and-diff drift guard (REQ-CI-01..04)

- **Mechanism (REQ-CI-01, D4):** `build-adapters.py --check` regenerates the full tree into a temp dir and `diff -r`s it against the committed `adapters/`. Identical → exit 0. Any difference → exit non-zero after printing the diff and a **remediation message** (REQ-CI-03): "adapters/ is out of date — run `python3 scripts/build-adapters.py` and commit the result." The temp dir is removed after the check; the committed tree is never mutated by `--check` (works outside git too).
- **Wiring (REQ-CI-02, REQ-CI-04):** added to `scripts/validate.sh` as a new **top-level** step "6b. Adapters regen-and-diff", placed after "6a. Spec-purity gate" and **outside** the `if [ -f "$HELPER" ]` epic-manifest guard, so it runs **unconditionally** under `set -euo pipefail` and a non-zero exit fails the gate immediately (never soft-skipped, unlike `pytest`). Because `bash scripts/validate.sh` is the single verify command (REQ-CI-04, C-2), the generator + guard are fully reachable through it. The step first ensures the venv/dep are provisioned (§9) before invoking `--check`.
- **"in CI" (REQ-CI-02):** feature-forge has **no `.github/workflows/` yet**; `validate.sh` is the gate. Standing up the GH Actions workflow that runs `validate.sh` is `packaging-docs-ci`'s scope (§6 / epic). This feature delivers the guard *inside* `validate.sh`; "in CI" follows automatically once that workflow exists.

## 4. Data Model

No persistent data store. Two in-memory record types the generator owns. The
**authoritative, fully-annotated definitions live in `00-core-definitions.md §2`**;
the block below is an informal summary — defer to 00 on any discrepancy.

```
SkillRecord:   name: str                   # == skills/<dir>; emitters MUST NOT rename
               description: str             # verbatim (REQ-FMT-04)
               metadata: dict[str,object]|None  # e.g. {argument-hint: str}
               body: str                    # markdown below frontmatter
               own_refs: Path|None          # skills/<name>/references/ if present
               source_path: str             # repo-relative POSIX path (provenance + errors)
AgentRecord:   name, description, body
               claude_keys: dict[str,object]  # per-file: whatever non-{name,description} frontmatter keys
                                            #   the agent file actually has — union across current 3 agents is
                                            #   {tools, model, maxTurns, effort, memory, skills}; NOT a fixed schema
               source_path: str             # repo-relative POSIX path (provenance + errors)
```

Fixed frontmatter key emission order per target (for determinism, §3.6). Note: the
**broader** skill frontmatter schema the upstream purity checker enforces
(`{name, description, license, compatibility, metadata, allowed-tools}`) is what canon
is validated against upstream — but this generator only **reads** `{name, description,
metadata}` into `SkillRecord` (`00 §3`); it neither parses nor widens the other keys.

## 5. API Design

**`scripts/build-adapters.py` CLI:**

| Invocation | Behavior | Exit |
|---|---|---|
| `python3 scripts/build-adapters.py` | Full regenerate: build complete tree to temp, atomic-swap over `adapters/`. | 0 ok; non-zero on canon error (§7) |
| `python3 scripts/build-adapters.py --check` | Drift guard: build to temp, `diff -r` vs committed `adapters/`, print diff+remediation on mismatch. Does not modify `adapters/`. | 0 identical; non-zero on drift |
| `--root DIR` | Repo root (default: parent of script dir), mirroring `check-spec-purity.py`. | — |

Non-interactive, single command (REQ-GEN-02). Writes only under the repo's `adapters/` (REQ-SEC-01).

**Per-agent field mapping (REQ-FMT-01).** The generator architecture is fixed; the exact native field names below are specified from current agent conventions but several **MUST be confirmed against each agent's official docs at impl** (flagged TQ-1) — emitters are isolated so a correction is localized:

| Target | Skill artifact | `name` | `description` (verbatim) | `argument-hint` | Sub-agent | Claude-only artifacts |
|---|---|---|---|---|---|---|
| **claude** | `skills/<n>/SKILL.md` | top-level `name` | top-level `description` | **top-level `argument-hint`** (restored, REQ-VND-01) | `agents/<n>.md` full Claude frontmatter | retained (REQ-VND-02) |
| **codex** | skill mirror (`.md`) | `name` | `description` | record-dropped (TQ-1) | optional `agents/openai.yaml` | dropped+recorded |
| **copilot** | skill copy w/ Copilot frontmatter | `name` | `description` | TQ-1 (no known hint field) | TQ-1 | dropped+recorded |
| **cursor** | `.mdc` rule file (`description`, `globs`, `alwaysApply`) | derived | `description` | dropped-recorded (no Cursor field) | dropped+recorded | dropped+recorded |
| **gemini** | body files + `gemini-extension.json` manifest | manifest `name` | manifest `description` | TQ-1 (command arg hint?) | TQ-1 | dropped+recorded |

Every target also receives: the skill's own `references/` (verbatim), the whole repo-root `references/` tree (verbatim, D5), and `scripts/forge-root.sh` (byte-identical, REQ-GEN-05).

## 6. Integration Points

**Depends on (existing in feature-forge, read-only — C-3):**
- **`skills/*/SKILL.md`** (11) + their `references/` subdirs (7 skills have one) — the `spec-pure-skills` contract. Frontmatter shape verified: `{name, description[, metadata.argument-hint]}`; `name == <dir>`.
- **`agents/*.md`** (3) — Claude sub-agent defs; frontmatter is **per-file, not uniform**: `{name, description}` plus a per-file subset of the Claude-only union `{tools, model, maxTurns, effort, memory, skills}` (verified: `forge-researcher` carries `effort`; only `forge-verifier` carries `memory`+`skills`; `forge-spec-writer` carries neither). The generator discovers these keys from each file rather than assuming a fixed set.
- **`references/`** (repo-root, **14 files: 9 root + `stacks/`×5**): `epic-manifest-schema.json`, `forge-config-schema.json`, `pipeline-state-schema.json`, `portable-root.md`, `process-overview.md`, `ralph-loop-contract.md`, `shared-conventions.md`, `stack-resolution.md`, `vendor-construct-inventory.md`, `stacks/{_generic,go,python,rust,typescript}.md` — all copied verbatim into each bundle. (This count is the same "14 files: 9 root + `stacks/`×5" pinned in `01-architecture-layout.md §7` and `04-provenance-selfcontainment-report.md §2.1/§3.3`.)
- **`scripts/forge-root.sh`** (50 lines, 0755) — the `portable-skill-root-resolver` contract; copied **byte-identical** (REQ-GEN-05).
- **`scripts/check-spec-purity.py`** — extended additively (§3.7): add `adapters/**` exemption. `CANONICAL_SURFACES` and `RESIDUAL_VAR_EXEMPT` shapes verified in source; `--root` default = parent of script dir.
- **`scripts/validate.sh`** (171 lines, `set -euo pipefail`) — extended with the "6b" step after "6a. Spec-purity gate", outside the epic-manifest guard. Verified step structure.
- **`tests/`** — `conftest.py` (`fixtures_dir`, `fixture_copy`, `run_cli`, importlib loader for hyphenated scripts), `test_check_spec_purity.py`, `test_forge_root.py`, `test_epic_manifest.py`. New `test_build_adapters.py` follows these patterns (subprocess-drive the generator over fixture canon).

**Consumed by (downstream, this feature only *exposes*):**
- **`cross-agent-installer`** consumes `adapters-output` (copies/symlinks per-agent dirs into agent config dirs).
- **`packaging-docs-ci`** gates `adapters-output` via the regenerate-and-diff and documents `AGENTS.md`.

**Conflict check:** the only thing touching `feature-forge` canon is upstream `forge-skill-spec-purity` (complete; canon lives on branch `forge/skill-spec-purity`, **PR #5 unmerged**). This feature branches from that canon. **No in-progress conflict.** **No missing exports** — every referenced script/surface was located in source.

> **WARNING (verify at impl):** the per-agent native field names marked **TQ-1** in §5 (Codex/Copilot/Cursor/Gemini frontmatter schemas and any invocation-hint field) were specified from convention, not from a source artifact in this repo — confirm against each agent's official format docs before/at implementation.

## 7. Error Handling

- **Fail-fast on bad canon (REQ-ROB-01, REQ-OBS-02):** malformed frontmatter, missing required `name`, or an unreadable file → abort the **entire** build with a clear `path: reason` message to stderr and a non-zero exit. Because the tree is built to a temp dir and only atomic-swapped on full success, a failure **never** leaves a partial `adapters/`. (Canon is pre-gated pure upstream, so any failure here is a real defect that must block.)
- **Drift (REQ-CI-03):** `--check` prints the `diff` + remediation message, exits non-zero.
- **Path safety (REQ-SEC-01):** all **generator** writes are confined to `adapters/` (plus its own sibling `adapters.tmp-<pid>/` staging dir, atomic-swapped in) under the resolved repo root; the generator resolves and asserts the output path is within the repo root before writing, and never writes elsewhere (`AGENTS.md` is hand-authored — the generator does not touch it). The one-time `.gitignore` amendment (§9) is a setup/repo-config edit performed during implementation, **not** a generator write, so it does not violate the REQ-SEC-01 sandbox.
- **Convention:** Python tooling uses explicit exit codes (0 success / non-zero failure) like `check-spec-purity.py`; Bash uses `set -euo pipefail`. No `Result`-type concern (shell/Python tooling, not the TS core).

## 8. Testing Approach

`tests/test_build_adapters.py` (pytest, subprocess-driving the generator over fixture canon, following `conftest.py`):

- **Determinism / idempotency (REQ-DET-01/03):** build twice from the same fixture canon → byte-identical trees (and stable against a committed expected snapshot for a minimal fixture).
- **Full regenerate (REQ-DET-02):** seed a stale/orphan file under the output, regenerate → orphan is gone.
- **Self-containment (REQ-GEN-04, D5):** each bundle contains the skill's own `references/`, the shared `references/` tree, and `forge-root.sh`.
- **Verbatim resolver (REQ-GEN-05):** copied `forge-root.sh` is byte-identical to canon (hash compare).
- **Provenance (REQ-OUT-01):** every generated `.md`/`.mdc` **that has a frontmatter block** has the in-frontmatter header; the frontmatter-less `GENERATION-REPORT.md` has the body-top provenance line as its first line (§3.5); `gemini-extension.json` has the `_generated` key; `forge-root.sh` has none.
- **Claude round-trip (REQ-VND-01):** `adapters/claude/.../SKILL.md` has top-level `argument-hint` reconstructed from `metadata.argument-hint`; `forge-init` (no hint) has none.
- **Description byte-fidelity (REQ-FMT-04):** decoded `description` equals canon for every target.
- **Drop-with-record (REQ-FMT-03 / REQ-OBS-01):** sub-agent Claude-only keys are absent from non-Claude output **and** appear in `GENERATION-REPORT.md`.
- **Fail-fast (REQ-ROB-01):** malformed-frontmatter fixture → non-zero exit, error names the file, **no** partial output written.
- **Purity exemption (REQ-PUR-01/02):** impure content under `adapters/` does not trip `check-spec-purity.py`; the same under `skills/` does (added to `test_check_spec_purity.py`).
- **Drift guard (REQ-CI-01):** committed tree → `--check` exit 0; mutate one committed adapter file → `--check` exit non-zero with remediation text.
- **Completion gate (REQ-CI-04, REQ-VER analog):** `bash scripts/validate.sh` passes end-to-end on the freshly committed tree.

## 9. Dependencies

- **One new runtime dependency (D2, C-4):** a pinned YAML library (default **PyYAML**, exact version pinned in `scripts/requirements-adapters.txt`; ruamel.yaml considered for finer emit control — see §10). **Auto-provisioned**: the `validate.sh` "6b" step creates/reuses an isolated venv `feature-forge/.venv-adapters` (gitignored) and `pip install -q -r scripts/requirements-adapters.txt` into it, then runs the generator from that interpreter. Isolation avoids PEP-668 "externally-managed" failures and never mutates system Python; first run pays a one-time install, subsequent runs are cached. The verify command requires **no** manual setup (C-4 satisfied).
- **No other new deps.** Existing toolchain: `python3` (stdlib for the rest), Bash, `pytest` (dev; non-fatal if absent per `validate.sh`).
- **`.gitignore` amendment (deliverable):** amend `feature-forge/.gitignore` to add `.venv-adapters/` (the gitignored provision venv, §2) and `adapters.tmp-*/` (the sibling temp build dirs used by atomic publish, §3.1 step 4). The generator names its temp dir to match that glob (`adapters.tmp-<pid>/`) so a single pattern covers it. Without this, the venv shows as a large untracked tree on every `validate.sh` run and an aborted/fail-fast build (§7) can leave an `adapters.tmp-<pid>/` dir as untracked noise that could pollute a `--check` diff or a maintainer commit. This is a one-time repo-config edit, **not** a generator write (see §7).
- **Internal:** canon's `forge-root.sh` (copied), `check-spec-purity.py` (extended), `validate.sh` (extended).

## 10. Open Technical Questions

- **TQ-1 (per-agent native schemas) — confirm at impl:** exact frontmatter field names and invocation-hint fields for **Codex**, **Copilot**, **Cursor** (`.mdc`), and **Gemini** (`gemini-extension.json`), and the precise native sub-agent forms (e.g. `agents/openai.yaml` shape). Specified from convention in §5; verify against each agent's official docs. Emitters are isolated so corrections are localized; any change is caught by the drift guard + tests.
- **TQ-2 (YAML lib choice) — finalize at forge-3-specs/impl:** PyYAML (default, ubiquitous, simplest provision) vs. ruamel.yaml (better key-order/quote control for higher emit fidelity). Either way the version is **pinned** and emit options are fixed for byte-determinism (§3.6); the choice is an emit-fidelity vs. dependency-weight trade, not an architectural one.
- **TQ-3 (provenance-comment tolerance) — confirm at impl:** that a leading `# …` YAML comment **inside** the frontmatter block is tolerated by each agent's frontmatter parser (Cursor/Copilot/Gemini-body). If any target rejects it, fall back to a body-top provenance line for that target (REQ-OUT-01's intent — visible + machine-greppable — is preserved either way).

All PRD open questions are resolved: **OQ-1 → D1** (skills/ canon stays Claude's load source; adapters/claude parallel). **OQ-2 → `_generated` JSON key** (§3.5). **OQ-3 → committed `adapters/GENERATION-REPORT.md`** (§3.5). **OQ-4** (REQ-COMPAT smoke) is upstream/maintainer-run and non-blocking (the Claude adapter restores `argument-hint` regardless).
