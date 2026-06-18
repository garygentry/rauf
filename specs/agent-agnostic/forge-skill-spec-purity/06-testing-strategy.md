# 06 — Testing Strategy

> Feature: `forge-skill-spec-purity` (epic `agent-agnostic`, target repo **feature-forge**).
> Source of truth: `PRD.md` (v1) + `tech-spec.md` (v1, §8). This document defines how the feature
> is tested: the pytest suite for the spec-purity checker, the required automated coverage for the
> portable resolver, the completion gate, and the behavioral-preservation smoke test. It is the
> last numbered document; it depends on every prior doc. Shared contracts come from
> `00-core-definitions.md`.
>
> **Stack note:** tests are **pytest (Python 3 stdlib)** + optional **bats/shell** for the Bash
> resolver — no TypeScript. They follow the existing `tests/conftest.py` conventions (the
> `fixture_copy`, `run_cli`, and `importlib` helpers), reused verbatim.

## Requirement / Success-Criterion Coverage

| REQ / SC | Requirement | Section |
|----------|-------------|---------|
| REQ-VER-01 | Runnable checker exists | §2 (subprocess runner) |
| REQ-VER-02 | Non-zero + `file: reason` on impurity; zero when clean | §2.1, §2.2 |
| REQ-VER-03 | Checker green vs all 11 final skills = completion gate | §4 |
| REQ-FM-04 | Frontmatter reader robustness | §2.3 (reader-robustness fixtures) |
| REQ-RES-03 | No residual var detected | §2.2 (rule-3 fixture) |
| REQ-RES-04 | Resolver failure path | §3 (forge-root.sh case b) |
| REQ-RES-05 | Prelude byte-identity; resolver reusable | §2.2 (rule-5, both directions), §3 |
| REQ-SIZE-03 | Over-budget body fails | §2.2 (rule-4 fixture) |
| REQ-OBS-01 | Output human-readable + asserted | §2, §5 |
| REQ-COMPAT-01 | All 11 skills still trigger/behave identically | §5 (behavioral smoke) |
| REQ-COMPAT-02 | Plugin still loads | §5 |
| REQ-COMPAT-03 | Bundled scripts locatable/runnable via resolver | §3, §5 |

## 1. Framework & tooling

- **pytest** (already the suite framework — `tests/conftest.py`, `tests/test_epic_manifest.py`),
  with `python3 -m pytest tests -q` as the entrypoint and `validate.sh` step 7 as the wrapper.
  Non-fatal when pytest is absent (validate.sh soft-skips that step — see `01-architecture-layout.md §5`).
- **conftest fixtures reused verbatim** (read from the real file): `fixture_copy(name) -> Path`
  (copies a fixture tree into `tmp_path` for mutation/abs-path tests), `run_cli(*args, cwd=) ->
  CliResult` (subprocess runner pinning the exit-code + stdout contract), and the `importlib`
  module loader pattern (for importing a hyphenated-filename script in-process). The new checker
  test adds an analogous subprocess runner over `check-spec-purity.py`.
- **Fixtures live under `tests/fixtures/`** (alongside the existing `valid-epic`, `corrupt`,
  `dup-name`, … trees). New skill-tree fixtures are added here (§2).
- **bats or pytest-driving-subprocess** for `scripts/forge-root.sh` (§3). Shell-level because the
  resolver is Bash; a pytest `subprocess.run(["bash", "forge-root.sh"], …)` harness is acceptable
  and keeps everything under one `pytest` invocation.

### 1.1 Coverage target

Coverage is defined **behaviorally**, not by a line/branch percentage (line-% is the wrong metric
for a small stdlib checker). "Enough" means all of:

- Every checker **Rule** (`00-core-definitions.md §5`) has **≥1 clean** and **≥1 impure** fixture
  asserting its leading reason token (§2.1, §2.2).
- Every frontmatter-**reader corner** in `00-core-definitions.md §4` has a fixture (§2.3).
- The **resolver** has a case per resolution step of `03-portable-root-resolver.md §2` — self-
  location, candidate probe, env fallback, total failure — or a documented waiver (§3).

Adding a new rule, reason string, reader corner, or resolution step **without** its matching fixture
is a spec/CI regression, not an optional follow-up.

## 2. `tests/test_check_spec_purity.py` (NEW) — the checker (REQ-VER-01/02, REQ-OBS-01)

A subprocess runner invokes `scripts/check-spec-purity.py --root <fixture-tree>` and asserts
**(a)** the exit code (0 clean / non-zero impure, per `00-core-definitions.md §7`) and **(b)** that
the offending `file: reason` line appears in stdout (using the canonical reason tokens from
`00-core-definitions.md §5`). Optionally, the hyphenated script is imported in-process via
`importlib` (mirroring `helper_module`) to unit-test the frontmatter reader directly.

```python
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

CHECKER = Path(__file__).resolve().parent.parent / "scripts" / "check-spec-purity.py"


def run_checker(root: Path) -> subprocess.CompletedProcess[str]:
    """Run check-spec-purity.py against a fixture tree.

    Args:
        root: A copied skill-tree fixture (clean or impure).

    Returns:
        The completed process (returncode + captured stdout/stderr).
    """
    return subprocess.run(
        [sys.executable, str(CHECKER), "--root", str(root)],
        capture_output=True,
        text=True,
    )
```

### 2.1 Clean canon → exit 0 (REQ-VER-02)

A `clean-skills` fixture: a minimal but spec-pure tree — ≥2 `skills/<name>/SKILL.md` carrying only
`{name, description}` (one also carrying `metadata.argument-hint`), each with `name == <dir>`, one
in-canon body containing a byte-identical bootstrap prelude, and **no** `${CLAUDE_PLUGIN_ROOT}` in
any canonical surface. (The checker takes `--root` directly and globs `CANONICAL_SURFACES`
beneath it — `05-spec-purity-checker.md §3.3` — so it does **not** consult the resolver sentinel
pair; the fixture needs no `scripts/epic-manifest.py` / `.claude-plugin/plugin.json` for the checker
to scan it. The sentinel pair is the resolver's concern, exercised in §3.)

```python
def test_clean_canon_passes(fixture_copy):
    root = fixture_copy("clean-skills")
    result = run_checker(root)
    assert result.returncode == 0, result.stdout
    assert "0 violation" in result.stdout.lower()
```

### 2.2 One impure fixture per rule → non-zero + reported file/reason (REQ-VER-02)

Each fixture violates exactly one rule so the asserted reason is unambiguous. Tokens reference
`00-core-definitions.md §5`.

| Fixture | Mutation | Rule | Asserted reason token |
|---------|----------|------|-----------------------|
| `bad-disallowed-key` | adds `argument-hint:` at top level (un-relocated) | 1 / `FRONTMATTER_KEYS` | `disallowed frontmatter key 'argument-hint'` |
| `bad-missing-desc` | removes `description:` | 1 / `FRONTMATTER_KEYS` | `missing required frontmatter key 'description'` |
| `bad-name-mismatch` | `name:` ≠ directory | 2 / `NAME_MATCHES_DIR` | `name '…' != directory '…'` |
| `bad-residual-var` | leaves a `${CLAUDE_PLUGIN_ROOT}` in a `SKILL.md` body | 3 / `NO_RESIDUAL_VAR` | `residual ${CLAUDE_PLUGIN_ROOT}` |
| `bad-oversized-body` | a body > 300 lines | 4 / `BODY_SIZE` | `body … lines exceeds 300` |
| `bad-prelude-drift` | a prelude occurrence with one byte changed | 5 / `PRELUDE_IDENTITY` | `bootstrap prelude not byte-identical` |

```python
@pytest.mark.parametrize(
    "fixture, token",
    [
        ("bad-disallowed-key", "disallowed frontmatter key 'argument-hint'"),
        ("bad-missing-desc", "missing required frontmatter key 'description'"),
        ("bad-name-mismatch", "!= directory"),
        ("bad-residual-var", "residual ${CLAUDE_PLUGIN_ROOT}"),
        ("bad-oversized-body", "exceeds 300"),
        ("bad-prelude-drift", "byte-identical"),
    ],
)
def test_impure_fixture_fails(fixture_copy, fixture, token):
    root = fixture_copy(fixture)
    result = run_checker(root)
    assert result.returncode != 0
    assert token in result.stdout
```

**Rule 5 — test BOTH directions** (per `tech-spec.md §8`): the `clean-skills` fixture (identical
preludes) passes §2.1, and `bad-prelude-drift` (one drifted occurrence) fails here with the
offending file + reason reported. This guards against a checker that never actually compares.

**Rule 4 — exercise the word limit too:** a `bad-oversized-words` fixture whose body is ≤300 lines
but > 5,000 words asserts the `body … words exceeds 5000` token, confirming both limbs of the
AND-budget (`00-core-definitions.md §2`) are enforced, not just the line limit.

**Rule 4 — both limbs at once:** a `bad-oversized-both` fixture whose body exceeds **both** limits
(> 300 lines AND > 5,000 words) asserts that **two** `BODY_SIZE` violations are emitted (both the
`exceeds 300` and the `exceeds 5000` tokens appear, and the per-rule tally line reports
`body-size=2`). This pins the "independent limbs → two violations" contract from
`05-spec-purity-checker.md §3.4`, which testing each limb in isolation does not cover.

### 2.3 Reader-robustness fixtures (REQ-FM-04 — the frontmatter parser hardening)

The hand-rolled stdlib reader (`05-spec-purity-checker.md §2`) must not raise false positives on
legal YAML nor crash on malformed blocks. Each fixture asserts the reader extracts the **correct**
top-level key set:

> **Fixture placement (required):** each reader fixture is a complete `skills/<name>/SKILL.md` whose
> frontmatter, beyond the corner under test, carries valid `name` (== `<name>`) and `description`
> keys. This matters because the checker reads frontmatter only for files matching
> `skills/*/SKILL.md` (rule 1 / rule 2, `05 §3.1`/`§3.2`): a fixture placed elsewhere is never
> scanned and the test passes **vacuously** (false negative), and an "expect clean" fixture missing
> `name`/`description` (or with `name != <dir>`) would fail rule 1/2 for the wrong reason, masking
> what the reader assertion claims to verify.

| Fixture | Frontmatter shape | Expected |
|---------|-------------------|----------|
| `reader-colon-value` | `description: "foo: bar"` (colon inside the value) | clean — colon in value is **not** a new key |
| `reader-folded-scalar` | `description: >` then indented continuation lines | clean — folded scalar body **not** re-scanned for keys |
| `reader-nested-metadata` | `metadata:` with indented `argument-hint:` | clean — nested key **not** flagged as a disallowed top-level key |
| `reader-blank-lines` | blank lines within the frontmatter block | clean — blanks tolerated |
| `reader-crlf` | CRLF line endings | clean — CRLF tolerated |
| `reader-malformed` | missing closing `---` | **violation** `malformed frontmatter block` (not a crash) |

```python
@pytest.mark.parametrize(
    "fixture, expect_clean",
    [
        ("reader-colon-value", True),
        ("reader-folded-scalar", True),
        ("reader-nested-metadata", True),
        ("reader-blank-lines", True),
        ("reader-crlf", True),
        ("reader-malformed", False),
    ],
)
def test_reader_robustness(fixture_copy, fixture, expect_clean):
    root = fixture_copy(fixture)
    result = run_checker(root)
    if expect_clean:
        assert result.returncode == 0, result.stdout
    else:
        assert result.returncode != 0
        assert "malformed frontmatter block" in result.stdout
```

These assert **no false positive** (a legal value/nested key flagged as a disallowed key) and **no
false negative / crash** (a malformed block must surface as a reported violation, never a traceback)
— the exact failure modes called out in `tech-spec.md §8`.

## 3. `scripts/forge-root.sh` coverage (REQ-RES-03/04/05) — REQUIRED, not optional

Per `tech-spec.md §8`, resolver coverage is **required** (not "optional"). A shell/bats test, or a
pytest harness driving `bash forge-root.sh` as a subprocess, asserts the four cases below — one per
resolution step of `03-portable-root-resolver.md §2`:

| Case | Setup | Assertion |
|------|-------|-----------|
| (a) self-location success (step 1) | invoke from inside a tree containing the sentinel pair (`scripts/epic-manifest.py` + `.claude-plugin/plugin.json`) | exit 0; stdout == that absolute root |
| (d) candidate probe (step 2) | self-location FAILS (script copied **outside** any root), but a candidate root containing the sentinel pair exists under a **`HOME`-redirected** path (`$HOME/.claude/skills/feature-forge`) | exit 0; stdout == that candidate root |
| (b) total failure (step 4) | no discoverable root **and** `CLAUDE_PLUGIN_ROOT` unset | exit 1; stderr == the exact message `feature-forge: cannot locate plugin root. Set CLAUDE_PLUGIN_ROOT or run from an installed skill dir.` (REQ-RES-04) |
| (c) env fallback (step 3) | self/candidate probes fail but `CLAUDE_PLUGIN_ROOT` points at a valid root | exit 0; stdout == `$CLAUDE_PLUGIN_ROOT` (the single sanctioned residual, REQ-RES-03) |

> **Hermetic `$HOME` is mandatory for cases (b), (c), and (d).** `forge-root.sh` step 2 probes
> `$HOME/.claude/skills/feature-forge` and `$HOME/.claude/plugins/*/feature-forge`. On the
> maintainer's machine `$HOME/.claude/skills/feature-forge` is a **live dev symlink** to an installed
> feature-forge (this repo self-hosts), so a harness that leaves the real `$HOME` in place would
> resolve a root and **false-fail** case (b) (exit 0 instead of 1) in CI run from that account or any
> dev box with feature-forge installed. Every failure/fallback/candidate case MUST therefore run with
> a redirected `HOME` — `env={**os.environ, "HOME": str(tmp_path / "empty-home"), "CLAUDE_PLUGIN_ROOT": ""}`
> — so neither the dev symlink nor real plugin installs leak into the probe. Case (d) redirects
> `HOME` to a `tmp_path` that *does* contain a sentinel-bearing candidate, making step 2
> deterministic without touching the real `$HOME`.

```python
def test_forge_root_self_location(tmp_path):
    root = _make_fake_install(tmp_path)        # writes the sentinel pair + copies forge-root.sh
    result = subprocess.run(
        ["bash", str(root / "scripts" / "forge-root.sh")],
        capture_output=True, text=True, env={**os.environ, "CLAUDE_PLUGIN_ROOT": ""},
    )
    assert result.returncode == 0
    assert result.stdout.strip() == str(root)


def test_forge_root_fails_actionably(tmp_path):
    lone = _copy_only_script(tmp_path)         # forge-root.sh with NO sentinel pair around it
    # Redirect HOME so the step-2 candidate probe cannot find the maintainer's live
    # ~/.claude/skills/feature-forge dev symlink (this repo self-hosts) and false-pass.
    result = subprocess.run(
        ["bash", str(lone)],
        capture_output=True, text=True,
        env={**os.environ, "HOME": str(tmp_path / "empty-home"), "CLAUDE_PLUGIN_ROOT": ""},
    )
    assert result.returncode == 1
    assert "cannot locate plugin root" in result.stderr
```

**Fallback clause (honor `tech-spec.md §8`):** if a fully-automated resolver test proves infeasible
in CI (e.g. candidate-root probing of real `$HOME` paths cannot be isolated), the spec MUST state
that explicitly and define the **manual smoke steps** below as the gate instead — coverage is never
left merely "optional." The primary additional signal remains the live checker plus the §5
behavioral smoke under Claude.

## 4. Completion gate (REQ-VER-03)

The feature is done only when **both** hold:

1. **`python3 scripts/check-spec-purity.py` exits 0** against the final state of all 11 real skills
   (not fixtures) — the canonical completion gate (REQ-VER-03).
2. **`bash scripts/validate.sh` passes end-to-end** — exercising the new unconditional checker step
   (`01-architecture-layout.md §5`) plus the existing structure/permission/`py_compile`/pytest
   steps, with the new `tests/test_check_spec_purity.py` green.

Run both from the `feature-forge` repo root. This is the acceptance gate the backlog's per-item
verification asserts.

## 5. Behavioral preservation — manual smoke (REQ-COMPAT-01/02/03)

The refactor must be invisible to the current Claude agent. After implementation, perform a manual
smoke (the automated suite cannot exercise Claude skill-triggering):

- [ ] **Plugin loads (REQ-COMPAT-02):** the `feature-forge` plugin loads under Claude Code with no
      manifest error; all 11 skills are discovered.
- [ ] **All 11 skills still trigger (REQ-COMPAT-01):** each skill's description is byte-unchanged
      (`02-frontmatter-purity-and-inventory.md`), so triggering behavior is preserved; spot-check a
      representative few (`forge-1-prd`, `forge-0-epic`, `forge-verify`).
- [ ] **Resolver-backed flows run (REQ-COMPAT-03):** invoke a flow that shells a bundled script via
      the bootstrap prelude — e.g. `forge-init` (calls `forge-init.sh`) and any
      `epic-manifest.py`-backed step (`forge-0-epic` / the navigator) — and confirm the script is
      located and runs through the resolver, not the raw env var.
- [ ] **Relocated content reachable (REQ-SIZE-02):** for `forge-0-epic`, `forge-5-loop`,
      `forge-verify`, confirm each in-body pointer resolves to the moved `references/` content.

## Dependencies

**Hard upstream dependency (must land first):**

- `00-core-definitions.md` — exit-code contract (§7), violation reason tokens (§5), body budget
  (§2), the canonical prelude (§3), the reader contract (§4).

**Forward references (artifacts under test — this doc tests them, it does not block them):**

- `05-spec-purity-checker.md` — the checker under test (rules, reader, output, validate.sh wiring).
- `03-portable-root-resolver.md` — `forge-root.sh` under test (§3) and the prelude (rule-5 fixtures).
- `02-frontmatter-purity-and-inventory.md` / `04-body-size-discipline.md` — the canon states the
  rule-1/2 and rule-4 fixtures model.

## Verification

- [ ] `tests/test_check_spec_purity.py` exists, follows `conftest.py` conventions, and is collected
      by `python3 -m pytest tests`.
- [ ] One passing clean fixture and one failing fixture **per rule** (1–5), plus the word-limit, the
      both-limbs body-size case (two `BODY_SIZE` violations, `body-size=2`), and both-directions
      prelude cases.
- [ ] All six reader-robustness fixtures assert the correct outcome (5 clean, 1 reported-malformed),
      each a full `skills/<name>/SKILL.md` with valid `name`(==dir)+`description`.
- [ ] `forge-root.sh` has automated cases (a)/(b)/(c)/(d) — self-location, candidate probe, env
      fallback, total failure, each failure/fallback/candidate case run with a redirected `HOME` — or,
      if infeasible, documented manual smoke steps explicitly substituted as the gate.
- [ ] The completion gate (§4) — checker green vs 11 skills AND `validate.sh` end-to-end — passes.
- [ ] The §5 behavioral-smoke checklist is executed and recorded before the feature is marked done.
