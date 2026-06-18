# 06 — Testing Strategy

> Feature: `forge-agent-adapters-build` (epic `agent-agnostic`, member 3 of 6, target repo
> **feature-forge** at `/home/gary/workspace/feature-forge`). Source of truth: `PRD.md` (v1) +
> `tech-spec.md` (v1, §8). This document defines how the generator is tested: the pytest suite
> `tests/test_build_adapters.py`, the new fixture canon trees under `tests/fixtures/`, the
> purity-exemption test added to `tests/test_check_spec_purity.py`, the drift-guard test, and the
> completion gate (`bash scripts/validate.sh`). It is the last numbered document; it depends on
> every prior doc (`00`–`05`). Shared contracts (record types, error hierarchy, provenance forms,
> exit codes) come from `00-core-definitions.md`; the behaviors under test are specified by
> `02-generator-engine.md`, `03-per-agent-emitters.md`, `04-provenance-selfcontainment-report.md`,
> and `05-purity-exemption-and-drift-guard.md`.
>
> **Stack note:** the configured `stack` is `typescript`, but this feature ships **Python 3 + Bash +
> Markdown** in feature-forge — there is **no** TypeScript and **no** `pnpm` gate (constraint
> **C-2**). Tests are **pytest** (Python 3, 3.10 baseline), subprocess-driving the generator over
> fixture canon, following the existing `tests/conftest.py` conventions (`fixtures_dir`,
> `fixture_copy`, `run_cli`, and the `importlib` `helper_module` loader for hyphenated script names)
> reused verbatim. The TypeScript stack profile does not apply.

## Requirement Coverage

This is the **testing archetype** document: the table maps each REQ to the concrete test(s) that
**verify** it (the implementing detail lives in the doc named in parentheses).

| REQ ID | Requirement (verified here) | Section |
|--------|------------------------------|---------|
| REQ-DET-01 | Determinism: identical canon → byte-identical output | §3.1 (`test_build_is_deterministic`, `test_matches_committed_snapshot`) |
| REQ-DET-01 | No-timestamp rule: no header/report carries a timestamp/host/PID (04 §1) | §3.1 (`test_no_timestamp_in_generated_headers`) |
| REQ-DET-02 | Full regenerate: stale/orphan files removed | §3.2 (`test_orphan_file_is_purged`) |
| REQ-DET-03 | Idempotency: re-run → no diff | §3.1 (`test_build_is_deterministic`), §3.10 (`--check` exit 0) |
| REQ-GEN-04 / D5 | Self-contained bundle (own + shared `references/`, resolver) | §3.3 (`test_bundle_is_self_contained`) |
| REQ-GEN-05 | `forge-root.sh` copied byte-identical | §3.4 (`test_forge_root_is_verbatim`) |
| REQ-OUT-01 | Provenance header on every generated file (Forms A/B/C, script exempt) | §3.5 (`test_provenance_*`) |
| REQ-VND-01 | Claude `argument-hint` round-trip; `forge-init` has none | §3.6 (`test_claude_argument_hint_roundtrip`) |
| REQ-FMT-04 | `description` byte-fidelity per target | §3.7 (`test_description_byte_fidelity`) |
| REQ-FMT-03 / REQ-OBS-01 | Drop-with-record: keys absent from output AND in report (`effort`, `memory`, `skills`) | §3.8 (`test_drop_with_record_enumerates_per_file`) |
| REQ-ROB-01 / REQ-OBS-02 | Fail-fast on malformed canon; names file; no partial tree | §3.9 (`test_malformed_canon_fails_fast`) |
| REQ-PUR-01 / REQ-PUR-02 | `adapters/` exempt from purity scan; `skills/` still enforced | §3.11 (`test_adapters_exempt_from_purity`, in `test_check_spec_purity.py`) |
| REQ-CI-01 / REQ-CI-03 | Drift guard: clean → exit 0; mutated → non-zero + remediation | §3.10 (`test_drift_guard_*`) |
| REQ-CI-04 / REQ-SEC-01 | `bash scripts/validate.sh` passes end-to-end on committed tree | §4 (completion gate) |
| REQ-SCALE-01 | New canonical skill/agent needs no generator change | §3.8 (per-file enumeration), §3.1 (discovery-driven snapshot) |
| REQ-PERF-01 | Full regen completes in seconds inside the gate | §4 (gate runs the build unconditionally) |

> Forward references (artifacts under test — this doc tests them, it does not block them):
> `02-generator-engine.md` (discovery/parse/atomic-publish), `03-per-agent-emitters.md` (the five
> emitters + sub-agent translation), `04-provenance-selfcontainment-report.md` (provenance forms,
> references closure, `GENERATION-REPORT.md` contract), `05-purity-exemption-and-drift-guard.md`
> (the `adapters/**` exemption + the `validate.sh` step-6b wiring).

## 1. Framework, tooling & how to run

- **pytest** is already the suite framework (`tests/conftest.py`, `tests/test_epic_manifest.py`,
  `tests/test_check_spec_purity.py`). The new file is `tests/test_build_adapters.py`. Entry point:
  `python3 -m pytest tests -q` from the feature-forge repo root.
- **`validate.sh` runs pytest in step 7 only when `pytest` is importable** (verified in source: the
  step is guarded by `python3 -c "import pytest"` and a `SKIP: pytest not installed … (non-fatal)`
  branch — `01-architecture-layout.md §6`). So the generator's pytest suite is a **dev-time + CI**
  signal that is *soft-skipped* in `validate.sh` step 7 when pytest is absent. The **hard** gate for
  this feature is the unconditional **step 6b drift guard** (`build-adapters.py --check`,
  `05-purity-exemption-and-drift-guard.md §2`), which fails the gate under `set -euo pipefail`
  regardless of pytest. The two are complementary: the suite proves emitter *correctness* in dev/CI;
  6b proves the *committed tree equals a fresh generation* on every gate run.
- **conftest fixtures reused verbatim** (read from the real file — do not redefine):
  - `fixtures_dir -> Path` — absolute path to `tests/fixtures/`.
  - `fixture_copy(name) -> Path` — copies a named fixture tree into `tmp_path` and returns the copied
    root; required for every test that **runs the generator** (the build mutates / writes a tree, and
    `--root` needs a real on-disk directory).
  - `run_cli(*args, cwd=None) -> CliResult` — subprocess-runs `scripts/epic-manifest.py`. **It is
    hard-wired to `HELPER = scripts/epic-manifest.py`** (conftest line 18/81), so it does **not**
    target `build-adapters.py`. This suite therefore adds its own thin subprocess runner
    (`run_build`, §2) over `scripts/build-adapters.py` — mirroring exactly how
    `test_check_spec_purity.py` defines its own `run_checker` rather than reusing `run_cli`. The
    `CliResult` frozen dataclass (`returncode`, `stdout`, `stderr`, `.json()`) is reused for the
    return shape.
  - the session-scoped `helper_module` importlib pattern — available if an in-process unit test of a
    pure generator function (e.g. the parse split) is wanted; the headline suite stays at the
    subprocess boundary to pin the exit-code contract (`00-core-definitions.md §9`).
- **Fixtures live under `tests/fixtures/`** alongside the existing `clean-skills`, `bad-multi`,
  `reader-*` trees. The new canon-fixture trees are added here (§2.2).

### 1.1 Coverage target

Coverage is defined **behaviorally**, not by a line/branch percentage. "Enough" means all of:

- Every REQ in the §0 coverage table has ≥1 asserting test.
- Determinism is proven **two ways** — build-twice byte-equality (machine-independent) **and** a
  committed expected snapshot for the minimal fixture (catches accidental output changes a single
  run cannot, e.g. a YAML-dumper option change, §3.1).
- Drop-with-record is proven to be **per-file enumeration** (verifier V-001), not a hard-coded list:
  the test asserts `effort` (only on `forge-researcher`) **and** `memory`/`skills` (only on
  `forge-verifier`) are *each* recorded (§3.8). A test that only asserted `tools`/`model` (present on
  all three agents) would pass against a hard-coded list and is insufficient.
- Fail-fast is proven to leave **no partial tree** (the atomic-publish contract,
  `02-generator-engine.md §4`), not merely to exit non-zero (§3.9).

Adding a new emitter, provenance form, or canon record type **without** its matching test is a
spec/CI regression, not an optional follow-up.

## 2. `tests/test_build_adapters.py` (NEW) — module preamble & subprocess runner

The suite subprocess-drives `scripts/build-adapters.py --root <fixture-tree>` (and `… --check`) and
asserts the exit code (`00-core-definitions.md §9`: 0 ok / 1 canon-error or drift / 2 usage) plus the
on-disk output under `<fixture-tree>/adapters/`. Following `test_check_spec_purity.py`, it defines a
local runner rather than reusing `run_cli`.

```python
"""Tests for scripts/build-adapters.py — the canonical→per-agent generator.

Drives the generator as a subprocess over small canon fixture trees (clean +
malformed), following tests/conftest.py conventions (fixture_copy + a local
subprocess runner, mirroring tests/test_check_spec_purity.py). Verifies
determinism/idempotency (REQ-DET-01/03), full regenerate (REQ-DET-02),
self-containment (REQ-GEN-04), the verbatim resolver (REQ-GEN-05), the three
provenance forms (REQ-OUT-01), the Claude argument-hint round-trip (REQ-VND-01),
description byte-fidelity (REQ-FMT-04), per-file drop-with-record
(REQ-FMT-03/REQ-OBS-01), fail-fast (REQ-ROB-01/REQ-OBS-02), and the drift guard
(REQ-CI-01/03). The purity exemption (REQ-PUR-01/02) is tested in
tests/test_check_spec_purity.py. Shared contracts: 00-core-definitions.md.
"""

from __future__ import annotations

import hashlib
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
GENERATOR = REPO_ROOT / "scripts" / "build-adapters.py"
AGENT_TARGETS = ("claude", "codex", "copilot", "cursor", "gemini")  # 00 §1


def run_build(root: Path, *extra: str) -> subprocess.CompletedProcess[str]:
    """Run build-adapters.py against a fixture tree.

    Args:
        root: A copied canon fixture tree (its `adapters/` is written/checked in place).
        *extra: Additional CLI flags, e.g. ``"--check"``.

    Returns:
        The completed process (returncode + captured stdout/stderr). Exit codes
        follow 00-core-definitions.md §9 (0 ok / 1 canon-error|drift / 2 usage).
    """
    return subprocess.run(
        [sys.executable, str(GENERATOR), "--root", str(root), *extra],
        capture_output=True,
        text=True,
    )


def hash_tree(root: Path) -> dict[str, str]:
    """Return {posix-relpath: sha256-hex} for every file under ``root``.

    Path-keyed and content-hashed so two trees compare byte-for-byte AND
    structurally (a missing/extra file shows as a key diff). Used to assert
    determinism (REQ-DET-01) and idempotency (REQ-DET-03).
    """
    out: dict[str, str] = {}
    for path in sorted(root.rglob("*")):
        if path.is_file():
            rel = path.relative_to(root).as_posix()
            out[rel] = hashlib.sha256(path.read_bytes()).hexdigest()
    return out
```

> **Why a YAML dependency does not leak into the test imports:** the suite reads the *generated*
> output as text/bytes (frontmatter is asserted with string `in` / line checks, JSON with
> `json.loads`); it does **not** import PyYAML. This keeps `test_build_adapters.py` importable even
> when the pinned dep is only present in the gitignored `.venv-adapters` (`01-architecture-layout.md
> §4`). When a test must *parse* emitted YAML to decode a scalar (§3.6, §3.7), it uses stdlib
> `json` for the JSON manifest and a minimal line-scan for frontmatter values — never a YAML import
> — so the suite runs under bare `python3 -m pytest` without provisioning the venv. (If a future
> test genuinely needs `yaml`, it must `pytest.importorskip("yaml")`.)

## 3. Test catalog

Each subsection names the headline test(s) and the REQ it verifies. Skeletons below are **exact
pytest** (Google-style docstrings), not pseudocode.

### 3.1 Determinism & idempotency (REQ-DET-01, REQ-DET-03)

Two complementary assertions. **(a) build-twice byte-equality** — machine-independent, catches any
nondeterministic ordering / timestamp / RNG (`02-generator-engine.md §3`,
`00-core-definitions.md §4` fixed key order). This build-twice equality is **the guard for the
no-timestamp rule (REQ-DET-01)** of `04-provenance-selfcontainment-report.md §1`: no provenance form
(A/B/C) and not the `GENERATION-REPORT.md` body (Form B, the highest-risk place for an accidental
timestamp/host/PID) may carry a non-deterministic value. **(b) committed snapshot** — a small
expected tree checked in under the fixture, catching an *intended-output* change (e.g. a YAML-dumper
option flip, an emitter field rename) that build-twice alone cannot see.

```python
import re

# A header carrying any of these would be non-deterministic across runs/hosts.
_TIMESTAMP_RE = re.compile(
    r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}|\b\d{10,}\b|generated (on|at)\b",
    re.IGNORECASE,
)


def test_build_is_deterministic(fixture_copy):
    """Building the same canon twice yields byte-identical adapters/ trees (REQ-DET-01/03).

    Builds into two independent copies of `minimal-canon` and compares a
    path-keyed sha256 map of each `adapters/` tree. Any timestamp, RNG, or
    unsorted walk would surface as a hash or key difference.
    """
    root_a = fixture_copy("minimal-canon")
    root_b = fixture_copy("minimal-canon")
    assert run_build(root_a).returncode == 0
    assert run_build(root_b).returncode == 0
    assert hash_tree(root_a / "adapters") == hash_tree(root_b / "adapters")


def test_no_timestamp_in_generated_headers(fixture_copy):
    """No generated file carries a timestamp/host/PID (REQ-DET-01, 04 §1 no-timestamp rule).

    Fails fast with a clear message naming the offending file, rather than only as
    an opaque hash diff. Covers the GENERATION-REPORT.md Form B body-top line and
    every Form A/C provenance header.
    """
    root = fixture_copy("minimal-canon")
    assert run_build(root).returncode == 0
    for path in sorted((root / "adapters").rglob("*")):
        if not path.is_file():
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        assert not _TIMESTAMP_RE.search(text), f"non-deterministic value in {path}"


def test_matches_committed_snapshot(fixture_copy):
    """A fresh build of `minimal-canon` equals its committed expected snapshot (REQ-DET-01).

    The fixture ships `expected-adapters/` — a byte-for-byte committed copy of a
    known-good generation. This pins exact emitter output (frontmatter shape,
    key order, provenance text) so an unintended change (e.g. a dumper option or
    a YAML-lib upgrade, tech-spec §3.6) fails loudly rather than silently
    altering every committed adapter in the real repo.
    """
    root = fixture_copy("minimal-canon")
    assert run_build(root).returncode == 0
    assert hash_tree(root / "adapters") == hash_tree(root / "expected-adapters")
```

> **Snapshot maintenance note (for implementers):** `expected-adapters/` is regenerated by running
> the generator against `minimal-canon/` and copying its `adapters/` into `expected-adapters/`. Like
> the real `adapters/` tree, it is a *committed* artifact; an intentional emitter change updates both
> in the same commit. This mirrors the repo-level drift guard at fixture scale.

### 3.2 Full regenerate / orphan purge (REQ-DET-02)

The atomic-publish contract (`02-generator-engine.md §4`) builds the complete tree to a temp dir and
`os.replace`-swaps it over `adapters/`, so a stale file from a prior run cannot survive.

```python
def test_orphan_file_is_purged(fixture_copy):
    """A stale file under adapters/ does not survive a regenerate (REQ-DET-02).

    Seeds a bogus orphan in a pre-existing adapters/ tree, regenerates, and
    asserts the orphan is gone while a legitimately-generated file is present —
    proving the publish replaces the whole tree (atomic swap), not a merge.
    """
    root = fixture_copy("minimal-canon")
    assert run_build(root).returncode == 0  # establish a committed-style tree
    orphan = root / "adapters" / "claude" / "STALE-ORPHAN.md"
    orphan.write_text("stale\n", encoding="utf-8")
    assert run_build(root).returncode == 0
    assert not orphan.exists(), "orphan survived regenerate — publish was not atomic"
    assert (root / "adapters" / "GENERATION-REPORT.md").is_file()
```

### 3.3 Self-containment (REQ-GEN-04, D5)

Every bundle must carry the skill's own `references/`, the **whole** shared `references/` tree, and
`scripts/forge-root.sh` — runnable without reaching back into canon
(`04-provenance-selfcontainment-report.md §2`). The `minimal-canon` fixture seeds a skill that *has*
its own `references/` subdir and a shared `references/` tree with a `stacks/` subtree, so the
whole-tree copy (D5) is exercised including a nested dir.

```python
@pytest.mark.parametrize("agent", AGENT_TARGETS)
def test_bundle_is_self_contained(fixture_copy, agent):
    """Each agent bundle ships its own + shared references/ and the resolver (REQ-GEN-04, D5).

    For every target, asserts: (1) the shared repo-root references/ tree is
    copied whole — a top-level file AND a nested stacks/ file both land under
    adapters/<agent>/references/; (2) the resolver mirror exists at
    adapters/<agent>/scripts/forge-root.sh; (3) the with-own-references skill
    carries its own references/ subdir inside its skill dir; (4) NEGATIVE — a
    skill with no own references/ (own_refs is None) gets NO own references/ dir,
    proving the copy is discovery-driven (04 §2.2 / REQ-SCALE-01), not hard-coded.
    """
    root = fixture_copy("minimal-canon")
    assert run_build(root).returncode == 0
    bundle = root / "adapters" / agent
    assert (bundle / "references" / "shared-conventions.md").is_file()
    assert (bundle / "references" / "stacks" / "python.md").is_file()  # nested → whole-tree copy
    assert (bundle / "scripts" / "forge-root.sh").is_file()
    # the fixture's `with-refs` skill has an own references/ subdir
    assert (bundle / "skills" / "with-refs" / "references" / "detail.md").is_file()
    # NEGATIVE (V-017): the `noarg` skill has no own references/ — none must be
    # copied. A generator that hard-codes or blanket-copies own-refs would fail here.
    assert not (bundle / "skills" / "noarg" / "references").exists()
```

### 3.4 Verbatim resolver (REQ-GEN-05)

The copied `forge-root.sh` MUST be byte-identical to canon — no injected provenance header
(`00-core-definitions.md §7` "Exempt"), no reflow, mode `0755` (`EmittedFile.mode`,
`00-core-definitions.md §5`).

```python
@pytest.mark.parametrize("agent", AGENT_TARGETS)
def test_forge_root_is_verbatim(fixture_copy, agent):
    """The copied forge-root.sh is byte-identical to canon, no header (REQ-GEN-05).

    Hash-compares the bundle copy against the fixture's canonical
    scripts/forge-root.sh and asserts no provenance line was injected — proving
    the script-exempt provenance case (00 §7) and the verbatim-copy contract.
    """
    root = fixture_copy("minimal-canon")
    assert run_build(root).returncode == 0
    canon = (root / "scripts" / "forge-root.sh").read_bytes()
    copy = (root / "adapters" / agent / "scripts" / "forge-root.sh").read_bytes()
    assert hashlib.sha256(copy).hexdigest() == hashlib.sha256(canon).hexdigest()
    assert b"GENERATED" not in copy  # no header injected (REQ-GEN-05)
```

### 3.5 Provenance (REQ-OUT-01) — three forms + exempt

Per `04-provenance-selfcontainment-report.md §1` / `00-core-definitions.md §7`:

- **Form A** — files **with** a frontmatter block (SKILL.md mirrors, `.mdc`, agent files): a YAML
  comment as the **first line inside** the block (`---` stays byte 0). Assert the file starts with
  `---\n# GENERATED — DO NOT EDIT. Source: …`.
- **Form B** — the frontmatter-**less** `GENERATION-REPORT.md`: an HTML comment as the **first
  line** (`<!-- GENERATED — DO NOT EDIT. … -->`).
- **Form C** — strict JSON `gemini-extension.json`: a top-level `"_generated"` object with `source` +
  `regenerate` keys.
- **Exempt** — `forge-root.sh`: none (covered in §3.4).

```python
def test_provenance_form_a_in_frontmatter(fixture_copy):
    """Generated files with frontmatter carry the in-block provenance comment (REQ-OUT-01, Form A).

    The Claude SKILL.md mirror must open `---` then a `# GENERATED — DO NOT EDIT.
    Source: skills/<name>/SKILL.md. Regenerate: python3 scripts/build-adapters.py`
    comment as the first line inside the block (`---` remains byte 0 for strict
    parsers).
    """
    root = fixture_copy("minimal-canon")
    assert run_build(root).returncode == 0
    text = (root / "adapters" / "claude" / "skills" / "with-refs" / "SKILL.md").read_text("utf-8")
    lines = text.splitlines()
    assert lines[0] == "---"
    assert lines[1].startswith("# GENERATED — DO NOT EDIT. Source: skills/with-refs/SKILL.md")
    assert "Regenerate: python3 scripts/build-adapters.py" in lines[1]


def test_provenance_form_b_in_report(fixture_copy):
    """GENERATION-REPORT.md (no frontmatter) carries a body-top HTML provenance line (REQ-OUT-01, Form B)."""
    root = fixture_copy("minimal-canon")
    assert run_build(root).returncode == 0
    report = (root / "adapters" / "GENERATION-REPORT.md").read_text("utf-8")
    first = report.splitlines()[0]
    assert first.startswith("<!-- GENERATED — DO NOT EDIT.")
    assert "python3 scripts/build-adapters.py" in first
    assert first.endswith("-->")


def test_provenance_form_c_in_gemini_manifest(fixture_copy):
    """gemini-extension.json carries a `_generated` provenance object (REQ-OUT-01, Form C)."""
    import json

    root = fixture_copy("minimal-canon")
    assert run_build(root).returncode == 0
    manifest = json.loads(
        (root / "adapters" / "gemini" / "gemini-extension.json").read_text("utf-8")
    )
    gen = manifest["_generated"]
    assert gen["regenerate"] == "python3 scripts/build-adapters.py"
    assert gen["source"]  # non-empty canonical source path
```

### 3.6 Claude round-trip (REQ-VND-01)

The Claude emitter reconstructs top-level `argument-hint` from `metadata.argument-hint`; a skill with
no hint (the fixture's `forge-init` analog) emits none. The `minimal-canon` fixture supplies one
skill **with** `metadata.argument-hint` (`with-refs`) and one **without** (`noarg`, modeling
`forge-init`).

```python
def _frontmatter_value(skill_md: Path, key: str) -> str | None:
    """Return the scalar value of a top-level frontmatter `key`, or None if absent.

    A minimal line-scan of the first `---`…`---` block (no YAML import needed —
    see §2 preamble note); sufficient for the single-line scalar keys these
    assertions check.
    """
    lines = skill_md.read_text("utf-8").splitlines()
    assert lines[0] == "---"
    for line in lines[1:]:
        if line == "---":
            return None
        if line.startswith(f"{key}:"):
            return line[len(key) + 1 :].strip()
    return None


def test_claude_argument_hint_roundtrip(fixture_copy):
    """Claude restores top-level argument-hint; a hintless skill emits none (REQ-VND-01).

    The fixture's `with-refs` skill carries metadata.argument-hint; the Claude
    mirror must expose it as a top-level `argument-hint`. The `noarg` skill
    (forge-init analog) has no metadata.argument-hint and the mirror must NOT
    invent one.
    """
    root = fixture_copy("minimal-canon")
    assert run_build(root).returncode == 0
    with_hint = root / "adapters" / "claude" / "skills" / "with-refs" / "SKILL.md"
    no_hint = root / "adapters" / "claude" / "skills" / "noarg" / "SKILL.md"
    assert _frontmatter_value(with_hint, "argument-hint") == "[target]"
    assert _frontmatter_value(no_hint, "argument-hint") is None
```

### 3.7 Description byte-fidelity (REQ-FMT-04)

Every target that has a description field must carry the canon description **byte-for-byte** — never
reflowed, re-quoted lossily, or trimmed. Asserted for each emitter that exposes a description (Claude
frontmatter, the Gemini manifest's `description`, etc.). The fixture's description deliberately
contains a colon and trailing punctuation to catch lossy re-quoting.

```python
def _decode_scalar(raw: str | None) -> str | None:
    """Decode a raw frontmatter scalar to its VALUE, discarding on-disk quoting.

    REQ-FMT-04's contract is that the *decoded* scalar round-trips byte-for-byte,
    NOT the quoting style (00 §2, 03 §2.1) — the shared `safe_dump` may legally
    re-quote (canon `"x"` → emitted `x` or `'x'`) while preserving the value. So we
    must compare decoded values, never the raw lines `_frontmatter_value` returns.
    Uses the pinned YAML lib (skip if absent, matching the §2 preamble rule).
    """
    if raw is None:
        return None
    yaml = pytest.importorskip("yaml")
    return yaml.safe_load(raw)


def test_description_byte_fidelity(fixture_copy):
    """Decoded `description` equals canon for every target with a description field (REQ-FMT-04).

    Canon description is read from the fixture SKILL.md; each target's DECODED
    description (frontmatter scalar for claude/codex/copilot/cursor, manifest
    string for gemini) must equal it. The fixture description contains a colon and
    trailing period to expose lossy re-quoting/trimming. The comparison is on the
    decoded value (per 00 §2 / 03 §2.1), not the raw on-disk quoting.
    """
    import json

    root = fixture_copy("minimal-canon")
    assert run_build(root).returncode == 0
    canon_desc = _decode_scalar(
        _frontmatter_value(root / "skills" / "with-refs" / "SKILL.md", "description")
    )
    assert canon_desc is not None

    # Frontmatter-bearing targets. Native skill filename differs per emitter
    # (03 §3.1/§4.1/§5.1): claude → SKILL.md; codex/copilot → <name>.md.
    for agent, fname in [
        ("claude", "SKILL.md"),
        ("codex", "with-refs.md"),
        ("copilot", "with-refs.md"),
    ]:
        md = root / "adapters" / agent / "skills" / "with-refs" / fname
        assert _decode_scalar(_frontmatter_value(md, "description")) == canon_desc, agent

    # gemini manifest description (already a decoded JSON string)
    manifest = json.loads(
        (root / "adapters" / "gemini" / "gemini-extension.json").read_text("utf-8")
    )
    assert any(
        s.get("description") == canon_desc for s in manifest.get("skills", [])
    ), "gemini manifest description not byte-identical to canon"
```

> **Note for implementers:** the per-agent native skill filename is resolved from each emitter's
> `EmittedFile.relpath` (`03-per-agent-emitters.md §3.1/§4.1/§5.1/§6.1), and they differ:
> **claude → `SKILL.md`**, **codex/copilot → `<name>.md`**, **cursor → `<name>.mdc`**. The
> parametrization above uses each emitter's actual filename (not a blanket `SKILL.md`); a cursor row
> would read its `.mdc` via the same `_frontmatter_value` scan. The **assertion** — decoded scalar ==
> canon decoded scalar, never raw quoting (00 §2 / 03 §2.1) — is invariant across targets.

### 3.8 Drop-with-record — per-file enumeration (REQ-FMT-03, REQ-OBS-01)

The headline observability test. Sub-agent Claude-only keys must be **absent** from non-Claude output
**and present** in `GENERATION-REPORT.md`. To prove the generator enumerates *per file* (verifier
V-001) rather than dropping a hard-coded list, the assertion targets keys that exist on **exactly
one** agent: `effort` (only `forge-researcher`) and `memory`/`skills` (only `forge-verifier`). The
`minimal-canon` fixture seeds two sub-agents matching that distribution.

```python
@pytest.mark.parametrize("agent", ["codex", "copilot", "cursor", "gemini"])
def test_drop_with_record_enumerates_per_file(fixture_copy, agent):
    """Sub-agent Claude-only keys are dropped from non-Claude output AND recorded per-file.

    Verifies REQ-FMT-03 (omit, never emit invalid) + REQ-OBS-01 (record). The
    assertions target single-agent keys — `effort` (only on the researcher
    analog) and `memory`/`skills` (only on the verifier analog) — so a generator
    that dropped a hard-coded {tools, model, maxTurns} list would FAIL: it would
    not record `effort`/`memory`/`skills`, proving per-file frontmatter
    enumeration (verifier V-001), not a fixed list.
    """
    root = fixture_copy("minimal-canon")
    assert run_build(root).returncode == 0
    report = (root / "adapters" / "GENERATION-REPORT.md").read_text("utf-8")
    # each single-agent key is recorded as dropped for this non-Claude target
    for key in ("effort", "memory", "skills"):
        assert key in report, f"{key} missing from GENERATION-REPORT.md"
        assert agent in report  # the report names the target that dropped it
    # and the keys do NOT leak into the non-Claude agent's emitted agent artifact
    agent_files = list((root / "adapters" / agent).rglob("*"))
    bodies = "".join(
        p.read_text("utf-8", errors="ignore") for p in agent_files if p.is_file()
    )
    # a dropped Claude-only key must not appear as emitted frontmatter for this target
    for token in ("effort:", "memory:", "skills:"):
        assert token not in bodies, f"{token!r} leaked into {agent} output"


def test_claude_retains_subagent_keys(fixture_copy):
    """The Claude target RETAINS sub-agent Claude-only keys (REQ-VND-02), unlike non-Claude.

    Complement to the drop test: keys dropped+recorded for other agents are
    representable for Claude and must survive in adapters/claude/agents/.
    """
    root = fixture_copy("minimal-canon")
    assert run_build(root).returncode == 0
    researcher = root / "adapters" / "claude" / "agents" / "researcher.md"
    text = researcher.read_text("utf-8")
    assert "effort:" in text  # retained for the Claude target
```

> The `bodies` scan asserts the *token form a YAML emitter would produce* (`effort:`) is absent — a
> deliberately conservative check. The construct identifier in `DropRecord.construct`
> (`00-core-definitions.md §6`, e.g. `sub-agent key 'effort'`) is what surfaces in the report; the
> two assertions together pin "omitted **and** recorded."

### 3.9 Fail-fast on malformed canon (REQ-ROB-01, REQ-OBS-02)

A malformed-frontmatter canon must abort the **entire** build with a non-zero exit, name the
offending file on stderr, and leave **no partial `adapters/`** (atomic publish,
`02-generator-engine.md §4`; error hierarchy `00-core-definitions.md §8`).

```python
def test_malformed_canon_fails_fast(fixture_copy):
    """Malformed canon aborts with non-zero exit, names the file, writes no partial tree.

    Verifies REQ-ROB-01 + REQ-OBS-02 + the atomic-publish guarantee. The
    `malformed-canon` fixture has one skill with an unbalanced frontmatter block.
    The build must exit 1 (00 §9), print `<source_path>: <reason>` to stderr
    (MalformedFrontmatterError, 00 §8), and leave NO adapters/ directory behind
    (no partial publish).
    """
    root = fixture_copy("malformed-canon")
    result = run_build(root)
    assert result.returncode == 1, result.stderr
    assert "skills/broken/SKILL.md" in result.stderr  # names the offending file (REQ-OBS-02)
    assert not (root / "adapters").exists(), "partial adapters/ tree was written"
    # the sibling temp staging dir must also be cleaned up (no adapters.tmp-* leak)
    assert not list(root.glob("adapters.tmp-*")), "staging temp dir leaked after failure"


def test_missing_name_fails_fast(fixture_copy):
    """Canon missing required `name` aborts with MissingNameError, no partial tree (REQ-ROB-01)."""
    root = fixture_copy("malformed-canon-noname")
    result = run_build(root)
    assert result.returncode == 1
    assert "skills/anon/SKILL.md" in result.stderr
    assert not (root / "adapters").exists()
```

### 3.10 Drift guard (REQ-CI-01, REQ-CI-03)

`--check` regenerates into a temp dir and diffs against the committed `adapters/`: identical → exit
0; any difference → exit 1 with the diff + the single-sourced remediation message
(`00-core-definitions.md §9` `REMEDIATION_MESSAGE`). `--check` MUST NOT mutate `adapters/`.

```python
def test_drift_guard_clean_passes(fixture_copy):
    """`--check` on a freshly-built tree exits 0 (no drift) (REQ-CI-01, REQ-DET-03)."""
    root = fixture_copy("minimal-canon")
    assert run_build(root).returncode == 0
    before = hash_tree(root / "adapters")
    result = run_build(root, "--check")
    assert result.returncode == 0, result.stdout + result.stderr
    assert hash_tree(root / "adapters") == before  # --check never mutates adapters/


def test_drift_guard_detects_mutation(fixture_copy):
    """Mutating one committed adapter file makes `--check` fail with remediation (REQ-CI-01/03).

    Builds, then edits a single generated file, then runs --check: it must exit
    non-zero and print the regenerate-and-commit remediation message
    (00 §9 REMEDIATION_MESSAGE).
    """
    root = fixture_copy("minimal-canon")
    assert run_build(root).returncode == 0
    target = root / "adapters" / "claude" / "skills" / "with-refs" / "SKILL.md"
    target.write_text(target.read_text("utf-8") + "\n<!-- tampered -->\n", encoding="utf-8")
    result = run_build(root, "--check")
    assert result.returncode == 1
    assert "adapters/ is out of date" in result.stdout + result.stderr
    assert "python3 scripts/build-adapters.py" in result.stdout + result.stderr
```

### 3.11 Purity exemption (REQ-PUR-01, REQ-PUR-02) — added to `test_check_spec_purity.py`

This test belongs in the **existing** `tests/test_check_spec_purity.py` (it drives
`check-spec-purity.py`, not the generator) and uses that file's `run_checker` helper. It asserts the
**positive** (impurity under `adapters/` is ignored) and **negative** (the *same* impurity under
`skills/` is still caught) directions — guarding against an exemption that accidentally widened to
disable enforcement (REQ-PUR-02). Fixtures: `adapters-impure-exempt` and `adapters-impure-under-skills`
(§2.2). Detail of the exemption mechanism: `05-purity-exemption-and-drift-guard.md §1`.

```python
def test_adapters_impurity_is_exempt(fixture_copy):
    """Impure content under adapters/ does NOT trip check-spec-purity.py (REQ-PUR-01).

    A SKILL.md placed under adapters/<agent>/skills/ carrying intentional vendor
    frontmatter (e.g. a top-level argument-hint) and a ${CLAUDE_PLUGIN_ROOT}
    residual must be ignored by the checker — adapters/** is exempt.
    """
    root = fixture_copy("adapters-impure-exempt")
    result = run_checker(root)
    assert result.returncode == 0, result.stdout


def test_same_impurity_under_skills_still_fails(fixture_copy):
    """The SAME impurity under skills/ is still caught — exemption did not weaken enforcement (REQ-PUR-02)."""
    root = fixture_copy("adapters-impure-under-skills")
    result = run_checker(root)
    assert result.returncode != 0
    assert "argument-hint" in result.stdout  # canonical surface still enforced
```

## 2. (cont.) Fixture trees to add under `tests/fixtures/`  {#fixtures}

> Numbered §2.2 conceptually; kept here next to the catalog that consumes them. Existing fixtures
> (`clean-skills`, `bad-multi`, `reader-*`) are **not** reused for the generator — they model the
> purity checker's canon, not the generator's input set (which also needs `agents/`, a shared
> `references/` tree, and a resolver). New trees are additive.

### 2.2.1 `minimal-canon/` — the clean fixture (drives §3.1–§3.8, §3.10)

A minimal but **complete** canon the generator can fully process. Structure (each `SKILL.md` /
`agents/*.md` carries the real `{name, description[, metadata]}` shape so discovery + parse succeed):

```
minimal-canon/
├── skills/
│   ├── with-refs/
│   │   ├── SKILL.md          # metadata.argument-hint: "[target]"; description has a colon + period
│   │   └── references/
│   │       └── detail.md     # the skill's OWN references/ (self-containment, §3.3)
│   └── noarg/
│       └── SKILL.md          # NO metadata.argument-hint (forge-init analog, §3.6)
├── agents/
│   ├── researcher.md         # claude_keys: {tools, model, maxTurns, effort}  ← `effort` ONLY here
│   └── verifier.md           # claude_keys: {tools, model, maxTurns, memory, skills} ← memory/skills ONLY here
├── references/               # the SHARED tree (whole-tree copy, D5, §3.3)
│   ├── shared-conventions.md
│   └── stacks/
│       └── python.md         # nested → proves whole-tree (not flat) copy
├── scripts/
│   └── forge-root.sh         # the resolver to copy verbatim (REQ-GEN-05, §3.4); mode 0755
└── expected-adapters/        # COMMITTED snapshot of a known-good build (§3.1 test_matches_committed_snapshot)
```

- **Two sub-agents, not three** is deliberate and sufficient: `researcher` carries `effort`,
  `verifier` carries `memory`+`skills` — exactly the single-agent-key distribution §3.8 asserts to
  prove per-file enumeration. A `spec-writer` analog (no unique key) adds no coverage and is omitted
  to keep the snapshot small.
- `forge-root.sh` is copied from the **real** canonical `scripts/forge-root.sh` so the verbatim test
  (§3.4) hashes against a true resolver, mode `0755`.
- `with-refs/SKILL.md` `description` deliberately contains a colon and trailing period (e.g.
  `description: "Build the thing: do it precisely."`) to make §3.7 catch lossy re-quoting.
- `expected-adapters/` is generated once from this fixture and committed; it is the fixture-scale
  analog of the repo's committed `adapters/` (§3.1 maintenance note).

### 2.2.2 `malformed-canon/` & `malformed-canon-noname/` — fail-fast fixtures (§3.9)

- `malformed-canon/` — identical to `minimal-canon/` except `skills/broken/SKILL.md` has an
  **unbalanced** frontmatter block (open `---`, no close) → `MalformedFrontmatterError`
  (`00-core-definitions.md §8`). Asserts non-zero exit, `skills/broken/SKILL.md` on stderr, **no**
  `adapters/` written.
- `malformed-canon-noname/` — a `skills/anon/SKILL.md` whose frontmatter omits `name` →
  `MissingNameError`. (Two fixtures, not one, so each error subclass has a fixture; a single combined
  fixture would mask which check fired.)

### 2.2.3 `adapters-impure-exempt/` & `adapters-impure-under-skills/` — exemption fixtures (§3.11)

These drive `check-spec-purity.py` (not the generator), so they model that checker's `--root` input:

- `adapters-impure-exempt/` — a tree with `adapters/claude/skills/x/SKILL.md` carrying a top-level
  `argument-hint:` (a rule-1 disallowed key) **and** a `${CLAUDE_PLUGIN_ROOT}` residual (rule-3),
  plus a clean canonical `skills/` so the checker has a surface to scan. The `adapters/**` exemption
  (`05-purity-exemption-and-drift-guard.md §1`) must keep both out of the scan → exit 0.
- `adapters-impure-under-skills/` — the **same** impure `SKILL.md`, placed under `skills/` instead of
  `adapters/`. The checker must still catch it → non-zero, `argument-hint` token in stdout. This is
  the negative control proving REQ-PUR-02 (enforcement over canonical surfaces is unchanged).

## 4. Completion gate (REQ-CI-04, REQ-SEC-01, REQ-PERF-01)

The feature is done only when **all** hold, run from the `feature-forge` repo root:

1. **`python3 scripts/build-adapters.py` exits 0** against the real canon and produces the committed
   `adapters/` tree (full regenerate, REQ-DET-02).
2. **`python3 scripts/build-adapters.py --check` exits 0** against the freshly committed tree (no
   drift, REQ-CI-01/REQ-DET-03).
3. **`bash scripts/validate.sh` passes end-to-end** — exercising the new unconditional **step 6b**
   (provision `.venv-adapters` → `build-adapters.py --check`,
   `05-purity-exemption-and-drift-guard.md §2`) plus the existing structure / permission / spec-
   purity (6a) / py_compile / pytest steps, with the new `tests/test_build_adapters.py` and the added
   purity-exemption test green **when pytest is present** (step 7 soft-skips pytest when absent —
   §1). Step 6b is the **hard** gate; the pytest suite is the dev/CI correctness signal. This is the
   single verify command (REQ-CI-04, C-2); `pnpm gate` does not apply.
4. **Performance (REQ-PERF-01):** the full regenerate + `--check` inside `validate.sh` completes in
   seconds, not minutes (≈14 canon records × 5 agents of small markdown/YAML/JSON emits) — verified
   simply by `validate.sh` not being a perceptible bottleneck.

> A green `validate.sh` on a freshly committed tree, plus a deliberate canon edit *without*
> regenerating causing 6b (and CI) to fail with the regenerate-and-commit remediation, is the
> success-criterion demonstration (PRD §8). The remediation-on-drift path is unit-proven by §3.10.

## Dependencies

**Hard upstream dependencies (must land first — this doc tests their behaviors):**

- `00-core-definitions.md` — record types (`SkillRecord`, `AgentRecord.claude_keys`), the
  `DropRecord` model, the three provenance forms + script-exempt case (§7), the `CanonError`
  hierarchy (§8), `AGENT_TARGETS` + `FRONTMATTER_KEY_ORDER`, and the exit-code / `REMEDIATION_MESSAGE`
  contract (§9) — every assertion in §3 is written against these.
- `01-architecture-layout.md` — the generator CLI (§4), the `adapters/<agent>/` output layout (§3)
  the tests glob, the venv-provisioning + `validate.sh` step map (§6) the gate exercises, and the
  `conftest.py` fixtures (§7) reused.

**Forward references (artifacts under test — tested here, not blocked here):**

- `02-generator-engine.md` — discovery / parse / atomic-publish (drives §3.1, §3.2, §3.9).
- `03-per-agent-emitters.md` — the five emitters + sub-agent translation (drives §3.5–§3.8); the
  exact native skill-file names / TQ-1 fields it fixes are what the per-target assertions resolve
  against.
- `04-provenance-selfcontainment-report.md` — provenance Forms A/B/C, the references-closure pass,
  and the `GENERATION-REPORT.md` content contract (drives §3.3, §3.5, §3.8).
- `05-purity-exemption-and-drift-guard.md` — the `adapters/**` exemption (drives §3.11) and the
  `validate.sh` step-6b wiring + remediation (drives §3.10, §4).

## Verification

- [ ] `tests/test_build_adapters.py` exists, follows `conftest.py` conventions (`fixture_copy`; a
      local `run_build` subprocess runner mirroring `test_check_spec_purity.py`'s `run_checker`), and
      is collected by `python3 -m pytest tests`.
- [ ] Determinism is asserted **two ways**: build-twice byte-equality (§3.1
      `test_build_is_deterministic`) **and** a committed `expected-adapters/` snapshot
      (`test_matches_committed_snapshot`).
- [ ] `test_orphan_file_is_purged` proves the atomic full-regenerate (REQ-DET-02).
- [ ] Self-containment is asserted per target including a **nested** shared-`references/` file
      (whole-tree copy, D5) and the verbatim resolver hash + no-header check (REQ-GEN-04/05).
- [ ] All three provenance forms (A in-frontmatter, B body-top HTML, C `_generated` JSON) plus the
      script-exempt case are asserted (REQ-OUT-01).
- [ ] The Claude `argument-hint` round-trip asserts **both** a hint-bearing skill (restored) and a
      hintless skill (none) (REQ-VND-01).
- [ ] `description` byte-fidelity is asserted for every target with a description field, using a
      colon-and-period-bearing fixture description (REQ-FMT-04).
- [ ] Drop-with-record asserts the **single-agent** keys `effort`, `memory`, `skills` are each
      recorded **and** absent from non-Claude output (per-file enumeration, verifier V-001), and that
      Claude retains them (REQ-FMT-03/REQ-OBS-01/REQ-VND-02).
- [ ] Fail-fast asserts non-zero exit, the offending file on stderr, **no** `adapters/` and **no**
      `adapters.tmp-*` left behind — for both `MalformedFrontmatterError` and `MissingNameError`
      (REQ-ROB-01/REQ-OBS-02).
- [ ] The purity-exemption test (in `test_check_spec_purity.py`) asserts both the exempt-under-
      `adapters/` and still-caught-under-`skills/` directions (REQ-PUR-01/02).
- [ ] The drift guard asserts clean → exit 0 (no mutation) **and** mutated → exit 1 with the
      `REMEDIATION_MESSAGE` text (REQ-CI-01/03).
- [ ] The new fixture trees (`minimal-canon` + `expected-adapters/`, `malformed-canon`,
      `malformed-canon-noname`, `adapters-impure-exempt`, `adapters-impure-under-skills`) exist under
      `tests/fixtures/` per §2.2.
- [ ] The completion gate (§4) — `build-adapters.py` exit 0, `--check` exit 0, `validate.sh`
      end-to-end green — passes; the suite imports no YAML library at module load (§2 preamble).
