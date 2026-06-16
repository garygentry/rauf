# 05 — Purity Exemption, Drift Guard & Canonical AGENTS.md

> Feature: `forge-agent-adapters-build` (epic `agent-agnostic`, member 3 of 6, target repo
> **feature-forge** at `/home/gary/workspace/feature-forge`). Source of truth: `PRD.md` (v1) §3.4,
> §3.7, §3.8 + `tech-spec.md` (v1) §3.4, §3.7, §3.8 + decision **D4**. This document specifies the
> three deliverables that **gate and document** the generator without containing any of its emit
> logic: (1) the additive `adapters/**` exemption to `scripts/check-spec-purity.py`, (2) the new
> `scripts/validate.sh` step **"6b. Adapters regen-and-diff"** drift guard, and (3) the hand-authored
> repo-root `AGENTS.md` content contract. The generator engine, the five emitters, and the
> provenance/self-containment/report logic are specified in `02-generator-engine.md`,
> `03-per-agent-emitters.md`, and `04-provenance-selfcontainment-report.md` — this document
> **cross-references** them, never duplicates them.
>
> **Stack note:** the configured `stack` is `typescript`, but this feature ships **Python 3 + Bash +
> Markdown** in feature-forge — there is **no** TypeScript and **no** `pnpm` gate (constraint
> **C-2**, **C-1**). All code below is exact Python 3 / Bash matching the live source style of
> `check-spec-purity.py` (stdlib-only, `from __future__ import annotations`, full type annotations,
> Google-style docstrings) and `validate.sh` (`set -euo pipefail`, `ERRORS=$((ERRORS + 1))`
> increment pattern). The TypeScript stack profile does not apply.
>
> **This document does NOT re-define shared types.** `REGENERATE_CMD`, `REMEDIATION_MESSAGE`, the CLI
> exit-code contract, and the `--check` mode semantics all live in `00-core-definitions.md` (§7, §9)
> and the CLI table in `01-architecture-layout.md §4`. The purity checker's own `CANONICAL_SURFACES`
> / `RESIDUAL_VAR_EXEMPT` constants are the **upstream** feature's contracts (defined in source, not
> in this suite's foundation); this document specifies an **additive edit** to them. All
> cross-references use exact filenames.

## Requirement Coverage

| REQ ID | Requirement | Section |
|--------|-------------|---------|
| REQ-PUR-01 | `check-spec-purity.py` excludes `adapters/` from its scan | §1.1, §1.2 |
| REQ-PUR-02 | Exemption does NOT weaken `skills/`/`references/`/`agents/` enforcement | §1.3, §1.4 |
| REQ-CI-01 | Regenerate-and-diff guard fails non-zero on drift | §2.1, §2.2 |
| REQ-CI-02 | Guard runs in `validate.sh` (and follows into CI) | §2.2, §2.4 |
| REQ-CI-03 | Drift prints a clear regenerate-and-commit remediation message | §2.2, §2.3 |
| REQ-CI-04 | `bash scripts/validate.sh` stays the single verify command | §2.2, §2.4 |
| REQ-DOC-01 | Hand-authored `AGENTS.md` at the repo root | §3.1 |
| REQ-DOC-02 | `AGENTS.md` documents build/test, conventions, install priority | §3.2, §3.3 |
| REQ-DOC-03 | `AGENTS.md` carries no DO-NOT-EDIT header; excluded from drift guard | §3.1, §3.4 |
| REQ-SEC-01 | venv/tmp hygiene relates to the `.gitignore` + isolated-venv provision | §2.2 (provision), Dependencies |
| REQ-CI-02 ("in CI") | feature-forge has no `.github/workflows/` yet; `validate.sh` is the gate | §2.4 |

---

## 1. Spec-purity exemption (REQ-PUR-01, REQ-PUR-02 · tech-spec §3.7, D3)

### 1.1 Why `adapters/` is already outside the scan — and why we add an explicit guard anyway

`scripts/check-spec-purity.py` scans only the **canonical surfaces** (verified verbatim in source,
`scripts/check-spec-purity.py:50-55`):

```python
CANONICAL_SURFACES: tuple[str, ...] = (
    "skills/**/SKILL.md",
    "skills/**/references/**/*",
    "references/**/*",
    "agents/*.md",
)
```

`adapters/**` matches **none** of these four globs (`adapters/...` is neither under `skills/`, under
the repo-root `references/`, nor an `agents/*.md` file), so generated copies carrying intentional
vendor frontmatter — restored Claude `argument-hint`, Cursor `.mdc` `globs`/`alwaysApply`, Copilot
keys, etc. (`03-per-agent-emitters.md`) — are **already** outside the scan by construction. REQ-PUR-01
is therefore satisfied without any code change (tech-spec §3.7, decision **D3**).

We nonetheless add an **explicit, named exemption** as belt-and-suspenders + regression-proofing,
because two things under `adapters/` *would* trip rules 3 and 5 if a future refactor ever widened
`CANONICAL_SURFACES` to include `adapters/**` (e.g. someone globbing `references/**/*` from the bundle
root, or adding an `adapters/**` surface by mistake):

- **Rule 3 (`check_no_residual_var`, `check-spec-purity.py:378-403`)** scans for the forbidden literal
  `${CLAUDE_PLUGIN_ROOT}`. Every bundle's verbatim `scripts/forge-root.sh` copy (REQ-GEN-05,
  `04-provenance-selfcontainment-report.md §2`) carries the **sanctioned** `${CLAUDE_PLUGIN_ROOT}`
  env-var fallback. Under canon this is exempted by the named `scripts/forge-root.sh` entry; under
  `adapters/<agent>/scripts/forge-root.sh` that name no longer matches, so the bundle copy would trip
  rule 3 if ever scanned.
- **Rule 5 (`check_prelude_identity`, `check-spec-purity.py:455-480`)** scans every canonical file for
  the bootstrap-prelude sentinel. The verbatim `references/` copies in each bundle (D5,
  `01-architecture-layout.md §3`) carry the canonical prelude; they would be re-scanned if
  `adapters/**` were ever inside the surfaces.

Adding the named exemption now means the guarantee holds **regardless** of future surface changes,
and a test pins it.

This is a **minimal, additive change — NOT a scan rewrite** (tech-spec §3.7, D3). The existing four
`CANONICAL_SURFACES` globs, the five rules, and the exit-code contract are untouched.

### 1.2 The exact edit to `RESIDUAL_VAR_EXEMPT`

The existing exemption tuple is (`scripts/check-spec-purity.py:64-71`):

```python
RESIDUAL_VAR_EXEMPT: tuple[str, ...] = (
    "scripts/forge-root.sh",
    "hooks/hooks.json",
    "specs/**",
    "plans/**",
    "docs/**",
    "references/vendor-construct-inventory.md",
)
```

This tuple is consumed by rule 3 via `fnmatch.fnmatch(rel, pattern)` over the repo-relative POSIX path
(`check-spec-purity.py:396`). Add a **single named `adapters/**` entry** plus a clarifying comment,
mirroring the existing pattern. The new tuple value (replacing lines 64–71):

```python
RESIDUAL_VAR_EXEMPT: tuple[str, ...] = (
    "scripts/forge-root.sh",
    "hooks/hooks.json",
    "specs/**",
    "plans/**",
    "docs/**",
    "references/vendor-construct-inventory.md",
    # adapters/** is the GENERATED per-agent tree (forge-agent-adapters-build).
    # It is outside CANONICAL_SURFACES by construction (it is not under skills/,
    # the repo-root references/, or agents/*.md), so generated vendor frontmatter
    # never reaches the scan. This NAMED entry is belt-and-suspenders +
    # regression-proofing: each bundle carries a VERBATIM scripts/forge-root.sh
    # copy (the sanctioned ${CLAUDE_PLUGIN_ROOT} fallback, REQ-GEN-05) and verbatim
    # references/ copies (the canonical bootstrap prelude, D5); this entry keeps
    # rule 3 (and the prelude scan that shares iter_canonical_files) from ever
    # re-flagging them if CANONICAL_SURFACES is later widened. Additive only — it
    # does NOT relax enforcement over skills/, references/, or agents/ (REQ-PUR-02).
    "adapters/**",
)
```

The pattern `adapters/**` is the same recursive-glob shape `fnmatch` already handles for `specs/**`,
`plans/**`, and `docs/**` — `fnmatch` treats `**` as "match across path separators" here (the existing
exempt globs rely on identical semantics, so no new matching behavior is introduced). Because rule 5's
`check_prelude_identity` iterates the same `iter_canonical_files(root)` set as rule 3 and only fires on
files **inside** `CANONICAL_SURFACES`, the `adapters/**` tree is never in that set today; the named
exemption documents and pins that fact for rule 3 (the residual-var rule, the one a bundle's
`forge-root.sh` would otherwise trip).

> **No other edit.** `CANONICAL_SURFACES` is **not** modified — widening it to include `adapters/**`
> and then exempting it would be a scan rewrite, which D3 explicitly rejects. The exemption rides on
> the existing `RESIDUAL_VAR_EXEMPT` mechanism only.

### 1.3 The accompanying test (added to `tests/test_check_spec_purity.py`)

Add one regression test to the **existing** `tests/test_check_spec_purity.py` (it already
subprocess-drives the checker over fixture trees via `run_checker(root)` and `fixture_copy`, verified
at `tests/test_check_spec_purity.py:20-33`). The test asserts the **belt-and-suspenders contract
directly**: identical impure content trips the checker under `skills/` but **not** under `adapters/`.

The cleanest fixture-free formulation writes both files into a `tmp_path` repo root and runs the
checker against it (matching the subprocess style already used; `run_checker` takes any root):

```python
# ── adapters/ exemption (REQ-PUR-01/02) — same impure content, two locations ──
#
# A residual ${CLAUDE_PLUGIN_ROOT} placed under a canonical surface (skills/)
# MUST trip rule 3; the IDENTICAL content placed under the generated adapters/
# tree MUST NOT. This pins both REQ-PUR-01 (adapters/ exempt) and REQ-PUR-02
# (canon enforcement untouched) in a single back-to-back assertion.

_IMPURE_SKILL = (
    "---\n"
    "name: forge-x\n"
    "description: fixture\n"
    "---\n"
    "Body referencing ${CLAUDE_PLUGIN_ROOT} directly.\n"
)


def test_residual_var_under_skills_trips(tmp_path: Path) -> None:
    skill = tmp_path / "skills" / "forge-x" / "SKILL.md"
    skill.parent.mkdir(parents=True)
    skill.write_text(_IMPURE_SKILL, encoding="utf-8")
    result = run_checker(tmp_path)
    assert result.returncode != 0
    assert "residual ${CLAUDE_PLUGIN_ROOT}" in result.stdout


def test_residual_var_under_adapters_is_exempt(tmp_path: Path) -> None:
    # Same impure content, but under the generated adapters/ tree.
    generated = (
        tmp_path / "adapters" / "claude" / "skills" / "forge-x" / "SKILL.md"
    )
    generated.parent.mkdir(parents=True)
    generated.write_text(_IMPURE_SKILL, encoding="utf-8")
    # Also drop the bundle's verbatim forge-root.sh (carries the sanctioned
    # fallback) to prove rule 3 does not flag the bundle copy either.
    resolver = tmp_path / "adapters" / "claude" / "scripts" / "forge-root.sh"
    resolver.parent.mkdir(parents=True)
    resolver.write_text('echo "${CLAUDE_PLUGIN_ROOT}"\n', encoding="utf-8")
    result = run_checker(tmp_path)
    assert result.returncode == 0, result.stdout
    assert "0 violation" in result.stdout.lower()
```

`run_checker` and the `Path` import already exist in the file (`tests/test_check_spec_purity.py:11-33`);
the `tmp_path` fixture is the pytest builtin. No new conftest helper is needed.

> **Note on the no-edit case.** Even *without* the `adapters/**` entry, `test_residual_var_under_adapters_is_exempt`
> already passes today because `adapters/**` is outside `CANONICAL_SURFACES`. That is the point: the
> test pins the **observable contract** (exemption holds), and the named `RESIDUAL_VAR_EXEMPT` entry
> guarantees the test stays green even if a future refactor widens the surfaces. The test is the
> regression lock; the tuple entry is the belt.

### 1.4 REQ-PUR-02 confirmation — canon enforcement is untouched

The edit adds **one element** to `RESIDUAL_VAR_EXEMPT` and **zero** changes to:

- `CANONICAL_SURFACES` — `skills/`, `references/`, `agents/*.md` are scanned exactly as before.
- The five rule functions (`check_frontmatter_keys`, `check_name_matches_dir`, `check_no_residual_var`,
  `check_body_size`, `check_prelude_identity`) — all logic, all reason strings (`VR_*`), and the
  `collect_violations` ordering are unchanged.
- The CLI, exit codes (0 clean / 1 violations / 2 usage), and `--root` default.

The existing per-rule fixture tests (`test_impure_fixture_fails`, `tests/test_check_spec_purity.py:49-64`)
continue to assert that an impure file **under `skills/`** trips its rule — `test_residual_var_under_skills_trips`
(§1.3) is the explicit half-of-the-pair restatement. Therefore the exemption narrows the scan by
exactly one (already-outside) tree and **cannot** weaken enforcement over canonical surfaces
(REQ-PUR-02). ✓

---

## 2. CI regenerate-and-diff drift guard (REQ-CI-01..04 · tech-spec §3.8, D4)

### 2.1 Mechanism — what `--check` does

The guard re-uses the generator's `--check` mode (defined in `00-core-definitions.md §9` and the CLI
table in `01-architecture-layout.md §4`; **implemented** in `02-generator-engine.md`): build the full
tree into a temp dir, `diff -r` it against the committed `adapters/`, and on any difference print the
diff plus the single-sourced `REMEDIATION_MESSAGE` (`00-core-definitions.md §9`) and exit non-zero.
`--check` **never** mutates the committed `adapters/` tree (works outside git, on read-only checkouts,
and in CI). Exit verdict per `00-core-definitions.md §9`: `0` = identical (no drift), `1` = drift.

This document specifies only the **`validate.sh` wiring** of that mode; the `--check` implementation
(temp build, `diff -r`, cleanup) is `02-generator-engine.md`'s scope (REQ-CI-01, D4).

### 2.2 The exact `validate.sh` step 6b (the new bash)

Insert a new **top-level** step **after** step 6a (which ends at `scripts/validate.sh:132`) and
**before** the step-7 comment (which begins at `scripts/validate.sh:134`), **outside** the
`if [ -f "$HELPER" ]` epic-manifest guard. This placement makes it run **unconditionally** under
`set -euo pipefail` (line 12) — it is a **HARD gate**, never soft-skipped, unlike step 7's pytest. It
mirrors step 6a's echo / PASS / FAIL structure and increments the existing `ERRORS` counter with the
identical `ERRORS=$((ERRORS + 1))` idiom (verified at `scripts/validate.sh:131`).

The block to insert between line 132 and line 134:

```bash
# 6b. Adapters regen-and-diff drift guard (REQ-CI-01..04, tech-spec §3.8, D4) —
#     a TOP-LEVEL step, OUTSIDE the `if [ -f "$HELPER" ]` epic-manifest guard, so
#     it runs UNCONDITIONALLY. It provisions an isolated, gitignored venv with the
#     pinned YAML dep (C-4; never mutates system Python, avoids PEP-668), then runs
#     `build-adapters.py --check`: regenerate to a temp dir, diff -r vs the
#     committed adapters/. Under `set -euo pipefail` a non-zero --check exit fails
#     validate.sh immediately. This is a HARD gate — NEVER soft-skipped (unlike the
#     pytest step), because generated artifacts must never silently drift from canon.
echo ""
echo "Checking adapters/ is in sync with canon..."
ADAPTERS_VENV="$REPO_ROOT/.venv-adapters"
ADAPTERS_REQS="$REPO_ROOT/scripts/requirements-adapters.txt"
ADAPTERS_PY="$ADAPTERS_VENV/bin/python3"
# Provision (create-or-reuse) the isolated venv and install the pinned dep. -q
# keeps output quiet; the install is cached after the first run. A provisioning
# failure is a real error (the verify command must run with no manual setup, C-4).
if [ ! -x "$ADAPTERS_PY" ]; then
  python3 -m venv "$ADAPTERS_VENV"
fi
if "$ADAPTERS_PY" -m pip install -q -r "$ADAPTERS_REQS"; then
  if "$ADAPTERS_PY" "$REPO_ROOT/scripts/build-adapters.py" --check; then
    echo "PASS: adapters/ matches a fresh generation (no drift)"
  else
    echo "FAIL: adapters/ is out of date — run 'python3 scripts/build-adapters.py' and commit the result"
    ERRORS=$((ERRORS + 1))
  fi
else
  echo "FAIL: could not provision .venv-adapters from scripts/requirements-adapters.txt"
  ERRORS=$((ERRORS + 1))
fi
```

Notes on the bash, each traced:

- **`REPO_ROOT`** is already defined at `scripts/validate.sh:12` (`REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"`)
  and `ERRORS` at line 13 — the step reuses both, introducing no new top-level state beyond the three
  local `ADAPTERS_*` path vars.
- **`echo ""` + `echo "Checking …"`** mirrors the section-header pattern used by step 6a
  (`scripts/validate.sh:125-126`) and every numbered section.
- **PASS / FAIL + `ERRORS=$((ERRORS + 1))`** mirrors 6a exactly (`scripts/validate.sh:127-132`): a green
  `--check` prints `PASS:` and leaves `ERRORS` alone; a failure prints `FAIL:` and bumps `ERRORS`, which
  the final tally (`scripts/validate.sh:163-171`) turns into `exit 1`.
- **The FAIL message embeds the remediation** (REQ-CI-03): "run `python3 scripts/build-adapters.py` and
  commit the result" — this is the same text as `REMEDIATION_MESSAGE` (`00-core-definitions.md §9`,
  which `--check` itself also prints after the diff). The guard surfaces it twice (from `--check`'s own
  stderr and from this echo) so a CI log truncation can't hide it.
- **`set -euo pipefail` interplay:** the `if "$ADAPTERS_PY" … --check; then … else … fi` construction is
  required — a bare `"$ADAPTERS_PY" … --check` would abort the whole script via `set -e` on a non-zero
  exit *before* the `ERRORS` increment and remediation echo could run. Wrapping the command in an `if`
  condition suspends `set -e` for that command (standard bash semantics), exactly as step 6a wraps
  `python3 … check-spec-purity.py` (`scripts/validate.sh:127`). This is why the guard counts the error
  and continues to the final tally rather than dying mid-script — matching 6a's behavior so all errors
  in one run are reported together.
- **Venv provisioning** (REQ-SEC-01 hygiene, C-4): the `.venv-adapters` dir and the
  `scripts/requirements-adapters.txt` manifest are deliverables of `01-architecture-layout.md §4`
  (venv provisioning) and `02-generator-engine.md` (the pinned dep). `.venv-adapters/` is gitignored
  (`01-architecture-layout.md §2.1`). First run pays a one-time `pip install`; later runs reuse the venv
  (the `[ ! -x "$ADAPTERS_PY" ]` guard skips re-creation, and `pip install -q` is a fast no-op when the
  pinned version is already satisfied).

### 2.3 Remediation message (REQ-CI-03)

On drift, two layers surface the fix:

1. `build-adapters.py --check` itself prints the diff followed by `REMEDIATION_MESSAGE`
   (`00-core-definitions.md §9`: *"adapters/ is out of date — run `python3 scripts/build-adapters.py`
   and commit the result."*). This is `02-generator-engine.md`'s responsibility.
2. step 6b's `FAIL:` echo (§2.2) repeats the actionable instruction so it appears in `validate.sh`'s own
   output stream adjacent to the `ERRORS` bump.

Both name the exact command (`python3 scripts/build-adapters.py`) and the exact follow-up (commit the
result), satisfying REQ-CI-03's "re-run the generator and commit" requirement.

### 2.4 "in CI" and the single verify command (REQ-CI-02, REQ-CI-04)

- **REQ-CI-04 — single verify command:** `bash scripts/validate.sh` remains the one and only verify
  command for this feature (C-2). Step 6b is *inside* `validate.sh`, so the generator, its pinned dep,
  the venv provisioning, and the drift guard are **all reachable through that single command** with no
  manual setup. No new top-level command is introduced.
- **REQ-CI-02 — "runs in CI":** feature-forge has **no `.github/workflows/` directory yet** (verified;
  the repo's gate is `validate.sh`). Standing up the GH Actions workflow that invokes `validate.sh` is
  **`packaging-docs-ci`'s scope** (PRD §6 / epic), *not* this feature's. By placing the guard inside
  `validate.sh`, "in CI" follows **automatically** the moment that workflow exists — this feature
  delivers the guard at the gate, and CI inherits it for free. The guard is therefore "in CI" by
  construction once the (out-of-scope) workflow runs the verify command.

> **Contrast with step 7 (REQ-CI-01 hard-gate rationale):** step 7's pytest is *soft-skipped* when
> `pytest`/the helper is absent (`scripts/validate.sh:145-158`, `WARNINGS=$((WARNINGS + 1))`). Step 6b is
> deliberately **not** soft-skipped: the venv + pinned dep are auto-provisioned (no "absent dep" escape
> hatch), and a provisioning failure or a drift is a `FAIL:`/`ERRORS` bump, never a `SKIP:`/`WARNINGS`.
> Generated artifacts that silently drift from canon is the exact failure mode this feature exists to
> prevent (PRD §1), so the guard must be unconditional.

---

## 3. Canonical AGENTS.md content contract (REQ-DOC-01..03 · tech-spec §3.4)

### 3.1 Placement, authorship, and exclusions (REQ-DOC-01, REQ-DOC-03)

`AGENTS.md` is a **hand-authored** Markdown file at the **feature-forge repo root** (`AGENTS.md`),
created once by a maintainer (`01-architecture-layout.md §2`, §5). It is **not** generated:

- It carries **no** `GENERATED — DO NOT EDIT` provenance header in any of the three forms from
  `00-core-definitions.md §7` (REQ-DOC-03). It is human-owned.
- It is **not** parsed, walked, or emitted by `build-adapters.py` (the generator discovers only
  `skills/*/SKILL.md`, `agents/*.md`, and the `references/` trees — `02-generator-engine.md`).
- It is **excluded from the drift guard** (§2): it lives at the repo root, **not** under `adapters/`,
  and is not produced by any generation, so `--check`'s `diff -r` of `adapters/` never touches it
  (REQ-DOC-03). It is likewise outside `check-spec-purity.py`'s canonical surfaces (§1), so the purity
  gate does not scan it.

### 3.2 Required section outline

A concrete outline that satisfies REQ-DOC-02 (build/test commands, repository conventions, install-path
priority). Section titles are guidance; the **must-include content checklist in §3.3 is binding**.

```markdown
# AGENTS.md — feature-forge

<one-paragraph orientation: feature-forge is a vendor-neutral, spec-pure skill
 canon that builds per-agent adapters; this file is the cross-agent entry point.>

## Build & Test

- Verify command (the single gate): `bash scripts/validate.sh`
- Regenerate per-agent adapters: `python3 scripts/build-adapters.py`
- Check adapters are in sync (no commit): `python3 scripts/build-adapters.py --check`
- Spec-purity check (canon only): `python3 scripts/check-spec-purity.py`

## Repository Conventions

- Spec-pure canon: skills/, agents/, references/ are the single source of truth;
  vendor-specific output is GENERATED into adapters/, never hand-edited.
- Tooling: Python 3 stdlib + Bash; the one runtime dependency (pinned YAML in
  scripts/requirements-adapters.txt) is auto-provisioned into a gitignored
  .venv-adapters by validate.sh. No pnpm/TypeScript gate.
- The resolver/prelude pattern: scripts/forge-root.sh resolves the plugin root;
  the canonical bootstrap prelude is byte-identical everywhere it appears.
- Generated files under adapters/ carry a "GENERATED — DO NOT EDIT" provenance
  header naming their canonical source and the regenerate command.

## Determinism & Dependency Upgrades

- adapters/ is committed and must equal a clean generation (the drift guard
  enforces this). A YAML-dependency version bump is a behavior change: regenerate
  adapters/, review the diff, and commit it in the same change.

## Installation

- Preferred: Claude Code marketplace / plugin install (the canonical authority).
- Universal: the cross-agent install path (copies the relevant adapters/<agent>/
  bundle into that agent's config dir) — owned by the installer.
```

### 3.3 Must-include content checklist (REQ-DOC-02 — binding)

`AGENTS.md` **MUST** contain, in prose or lists, every item below. Each traces to a requirement or a
tech-spec decision:

- [ ] **Build/test commands** (REQ-DOC-02, tech-spec §3.4):
  - `bash scripts/validate.sh` — the single verify/gate command (C-2, REQ-CI-04).
  - `python3 scripts/build-adapters.py` — regenerate all adapters (REQ-GEN-02).
  - (Recommended, not strictly required) `python3 scripts/build-adapters.py --check` and
    `python3 scripts/check-spec-purity.py` for completeness.
- [ ] **Repository conventions** (REQ-DOC-02, tech-spec §3.4):
  - **Spec-pure canon:** `skills/`, `agents/`, `references/` are the single source of truth; per-agent
    output is generated into `adapters/` and **never hand-edited** (PRD §1; C-5).
  - **Stdlib + pinned-dep tooling:** Python 3 stdlib + Bash, plus the **single pinned YAML dependency**
    (`scripts/requirements-adapters.txt`) auto-provisioned into the gitignored `.venv-adapters` by
    `validate.sh` (D2, C-4); no `pnpm`/TypeScript gate (C-2).
  - **The resolver/prelude pattern:** `scripts/forge-root.sh` is the portable root resolver, copied
    byte-identical into each bundle (REQ-GEN-05); the canonical bootstrap prelude is byte-identical
    everywhere it appears (the upstream purity contract).
  - **Generated-output provenance:** every file under `adapters/` carries a "GENERATED — DO NOT EDIT"
    header naming its canonical source and the regenerate command (REQ-OUT-01,
    `04-provenance-selfcontainment-report.md §1`).
- [ ] **Install-path priority** (REQ-DOC-02, C-5):
  - **Claude marketplace / plugin install is preferred / first-class** (C-5: Claude Code's plugin +
    marketplace path stays canonical authority).
  - **Then the universal install path** (the cross-agent installer copies/symlinks `adapters/<agent>/`
    into the agent's config dir; owned by `cross-agent-installer`, PRD §6 — `AGENTS.md` names it as the
    fallback path, it does not document the installer's mechanics).
- [ ] **Dependency-upgrade trade-off** (D2, tech-spec §3.6 — "documented … in AGENTS.md"):
  - State that a YAML-dependency version bump is a **behavior change**: it requires regenerating
    `adapters/`, reviewing the diff, and committing the regenerated tree (the drift guard, §2, will fail
    the gate otherwise). This is the cost of choosing a pinned YAML dep over stdlib hand-emit (D2).

### 3.4 What `AGENTS.md` MUST NOT contain (REQ-DOC-03)

- [ ] **No** `GENERATED — DO NOT EDIT` header (or any provenance form from `00-core-definitions.md §7`).
- [ ] **No** generator-emitted content — it is authored, not derived from canon.
- [ ] It is **not** placed under `adapters/` (so the drift guard's `diff -r` never sees it) and is **not**
  a canonical surface (so `check-spec-purity.py` never scans it). Out-of-scope: user-facing READMEs and
  per-agent setup docs are owned by `packaging-docs-ci` (PRD §6) — `AGENTS.md` is the only doc this
  feature authors.

---

## Dependencies

- **`00-core-definitions.md`** — for the `--check` exit-code contract (§9), `REGENERATE_CMD` /
  `REMEDIATION_MESSAGE` (§9, single-sourced and referenced by step 6b's remediation text), and the
  provenance-header forms (§7) that `AGENTS.md` MUST NOT carry.
- **`01-architecture-layout.md`** — for the file-tree dispositions (the `✎` edits to
  `check-spec-purity.py` and `validate.sh`, the `★` `AGENTS.md`), the `validate.sh` integration map
  (§6), the venv-provisioning + `.gitignore` deliverables (§2.1, §4), and the integration surfaces (§7).
- **Relates to `02-generator-engine.md`** — this document **wires** the generator's `--check` mode into
  `validate.sh` but does **not** implement it. The `--check` build-to-temp + `diff -r` + remediation
  logic, the pinned YAML dep, the `requirements-adapters.txt` manifest, and the `.venv-adapters`
  provisioning behavior are `02`'s scope. This step 6b is the *caller* of that mode.
- **Upstream source (read-only, C-3):** `scripts/check-spec-purity.py` and `scripts/validate.sh` in
  feature-forge (branch `forge/skill-spec-purity`) — both extended **additively** here (the only edits
  this document specifies).

This document is **not** a prerequisite for `02`/`03`/`04` and does not block them; its `validate.sh`
step 6b is the **completion gate** that becomes green once the generator (`02`–`04`) produces a
committed, in-sync `adapters/` tree (`01-architecture-layout.md §8`).

## Verification

How to confirm an implementation matches this spec:

- [ ] **(§1.1–§1.2, REQ-PUR-01)** `scripts/check-spec-purity.py`'s `RESIDUAL_VAR_EXEMPT` has exactly one
      new element, `"adapters/**"`, plus the clarifying comment; `CANONICAL_SURFACES` and all five rule
      functions are **byte-unchanged** from the source at `check-spec-purity.py:50-55, 295-499`.
- [ ] **(§1.3, REQ-PUR-01/02)** `tests/test_check_spec_purity.py` gains the back-to-back pair:
      identical impure `${CLAUDE_PLUGIN_ROOT}` content trips the checker under `skills/` (exit ≠ 0) and
      does **not** trip it under `adapters/` (exit 0, "0 violation"). Both tests pass under
      `python3 -m pytest tests/test_check_spec_purity.py`.
- [ ] **(§1.4, REQ-PUR-02)** The existing per-rule fixture tests still pass — enforcement over
      `skills/`/`references/`/`agents/` is unchanged.
- [ ] **(§2.2, REQ-CI-01/02/04)** `scripts/validate.sh` contains step 6b **between** old line 132 and old
      line 134, **outside** the `if [ -f "$HELPER" ]` guard; it provisions `.venv-adapters`, runs
      `build-adapters.py --check`, prints `PASS:`/`FAIL:`, and increments `ERRORS` via
      `ERRORS=$((ERRORS + 1))` on failure — structurally identical to step 6a.
- [ ] **(§2.2, set -e)** The `--check` invocation is wrapped in an `if … then … else … fi` (not bare), so
      a drift increments `ERRORS` and reaches the final tally instead of aborting mid-script.
- [ ] **(§2.3, REQ-CI-03)** On an intentionally drifted `adapters/` (mutate one committed file), `bash
      scripts/validate.sh` exits 1 and prints a remediation naming `python3 scripts/build-adapters.py`
      and "commit the result".
- [ ] **(§2, hard gate)** Step 6b is never `SKIP:`'d / `WARNINGS`-only; with a fresh, in-sync committed
      tree `bash scripts/validate.sh` prints `PASS: adapters/ matches a fresh generation` and the gate is
      green.
- [ ] **(§3.1/§3.4, REQ-DOC-01/03)** `AGENTS.md` exists at the repo root, carries **no** DO-NOT-EDIT
      header, is **not** under `adapters/`, and is untouched by `build-adapters.py --check`.
- [ ] **(§3.3, REQ-DOC-02)** `AGENTS.md` covers every checklist item: build/test commands, the four
      repository conventions, the two-tier install priority (Claude marketplace preferred, then universal),
      and the dependency-upgrade trade-off (D2).
