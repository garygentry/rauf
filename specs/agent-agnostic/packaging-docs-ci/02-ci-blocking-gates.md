# 02 — CI Blocking Gates (the per-PR deterministic gate)

> **Feature:** `packaging-docs-ci` (epic `agent-agnostic`, capstone 6 of 6).
> **Status:** domain document. Depends on `00-core-definitions.md` (shared contracts) and
> `01-architecture-layout.md` (file inventory + workflow topology). Do **not** redefine the shared
> contracts fixed in 00 (the SKILL.md schema, the version-sync contract, the installer-CLI surface,
> the gate-diagnostic shape) — this document specifies the **gate behavior** that consumes them.

This document specifies feature-forge's **net-new per-PR blocking gate**: the `ci.yml` workflow, the
`.github/actions/quality-gate` composite action it delegates to, and each individual gate that
composite runs. Every gate here runs on every pull request and `push` and MUST fail the PR when it
does not pass. The OS-matrix installer gate (its own workflow) is specified in
`03-os-matrix-installer-gate.md`; the advisory eval (never blocking) in `04-trigger-accuracy-eval.md`.

## Requirement Coverage

| REQ ID | Requirement | Section |
|--------|-------------|---------|
| REQ-CI-01 | `claude plugin validate --strict` (or documented equivalent) gate | 3, 4.1 |
| REQ-CI-02 | SKILL.md schema validation via schema-driven `check-spec-purity.py` | 4.2 |
| REQ-CI-03 | shellcheck + ruff lint gates (severity floor) | 4.3 |
| REQ-CI-04 | Adapters regenerate-and-diff gate (delegated to `build-adapters.py --check`) | 4.4 |
| REQ-CI-05 | Version-sync gate over the three feature-forge fields | 4.5 |
| REQ-CI-06 | feature-forge's existing validators wired into CI as blocking | 4.6 |
| REQ-CIINFRA-01 | All gates on GitHub Actions | 3 |
| REQ-CIINFRA-02 | Shared gates factored as composite actions (pattern-reuse) | 3, 6 |
| REQ-CONST-03 | Spec-purity: schema `additionalProperties:false` blocks vendor/version keys | 4.2 |
| REQ-CONST-04 | Generated adapters are derived, never hand-edited (regen-diff enforces) | 4.4 |
| REQ-OBS-01 | Each gate emits an actionable failure diagnostic | 5 |
| REQ-SEC-01 | Third-party actions version-pinned | 3.1 |
| REQ-SEC-02 | No secrets in the deterministic gate | 3.1 |
| REQ-PERF-01 | Fast per-PR gate (matrix/eval off this path) | 3 |

> **Reconciliation note (cross-doc):** the version-sync gate (4.5) is authored here and MUST
> **currently fail** on the live feature-forge desync. The *execution* of the reconciliation
> (editing `marketplace.json`, bumping `GEMINI_EXTENSION_VERSION` and regenerating) is owned by
> `06-packaging-versioning-hygiene.md`. This document specifies the gate's algorithm + diagnostics;
> 06 makes the gate go green.

---

## 1. Purpose & Scope

feature-forge has **no `.github/` today** (verified — `/home/gary/workspace/feature-forge` has no
`.github` directory). This feature stands up its first CI. The substantive validators already exist
and are exercised locally by `feature-forge/scripts/validate.sh`
(`/home/gary/workspace/feature-forge/scripts/validate.sh`); the capstone's job for the per-PR gate is
to (a) add the few genuinely-missing gate steps to `validate.sh`, (b) author the two genuinely-new
gates (lint configs + the version-sync script), and (c) wrap everything in a single composite action
a `ci.yml` workflow invokes — mirroring rauf's `pnpm gate` → composite-action pattern (01 §3.2).

**In scope (this document):**

| Gate | REQ | Where it lives | New / edit |
|---|---|---|---|
| `claude plugin validate --strict` (+ documented fallback) | REQ-CI-01 | `validate.sh` step | EDIT validate.sh |
| SKILL.md schema validation (schema-driven purity checker) | REQ-CI-02, REQ-CONST-03 | `check-spec-purity.py` | EDIT script + NEW schema (00 §3) |
| shellcheck + ruff | REQ-CI-03 | composite action steps | NEW `.shellcheckrc`, `ruff.toml` |
| Adapters regenerate-and-diff | REQ-CI-04, REQ-CONST-04 | `validate.sh` step 6b (already wired) | UNCHANGED gate; this doc stands up the runner |
| Version-sync (3 fields) | REQ-CI-05 | `scripts/check-version-sync.py` | NEW |
| Existing validators (incl. `validate-traceability.py`) | REQ-CI-06 | `validate.sh` | EDIT validate.sh |
| `ci.yml` + composite `action.yml` | REQ-CIINFRA-01/-02 | `.github/` | NEW |

**Out of scope (other documents):** OS-matrix installer gate → `03-os-matrix-installer-gate.md`;
advisory eval → `04-trigger-accuracy-eval.md`; READMEs/docs → `05-readme-and-agent-docs.md`;
version reconciliation execution, licensing, `.gitattributes`, CHANGELOG → `06-packaging-versioning-hygiene.md`.

**Scope boundary — feature-forge only.** Every gate in this document targets the **feature-forge**
working tree (`../feature-forge`, see 00 §1 `REPO_ROOT`). rauf's existing CI (`pnpm gate`, including
`version:check` and `check:docs`) is **unchanged** and already satisfies rauf's half of REQ-CI-05
(00 §5). rauf's 18 shell scripts are explicitly out of REQ-CI-03 scope (tech-spec §3.4).

---

## 2. Gate Inventory & Order of Execution

The composite action runs the gates in this order (cheapest / most-foundational first):

```
provision  →  bash scripts/validate.sh  →  shellcheck  →  ruff  →  check-version-sync.py
              (REQ-CI-01,-02,-04,-06)      (REQ-CI-03)            (REQ-CI-05)
```

`validate.sh` is the single aggregate already run locally by contributors; routing CI through it
(rather than re-listing its steps in YAML) prevents CI/local drift (tech-spec §3.1, "the workflow is
a thin runner"). The three steps *outside* `validate.sh` (shellcheck, ruff, version-sync) are run as
explicit composite steps so a local `shellcheck` / `ruff` / `python3 scripts/check-version-sync.py`
reproduces CI exactly.

`validate.sh` already aggregates (verified, lines cited against
`/home/gary/workspace/feature-forge/scripts/validate.sh`):

| validate.sh step | Lines | Gate it delivers |
|---|---|---|
| 1–3 marketplace/plugin JSON validation + entry resolution | 19–62 | part of REQ-CI-01 documented-equivalent |
| 4 skill frontmatter (name+description grep) | 64–83 | superseded/augmented by REQ-CI-02 (step 6a) |
| 5 agent frontmatter | 85–104 | REQ-CI-06 |
| 6 script permissions | 106–118 | REQ-CI-06 / REQ-OS-02 |
| 6a spec-purity (`check-spec-purity.py`) — HARD gate | 120–132 | **REQ-CI-02** (schema-driven after the 4.2 edit) |
| 6b adapters regen-diff (`build-adapters.py --check`) — HARD gate | 134–165 | **REQ-CI-04 / REQ-CONST-04** |
| 7 epic-manifest py_compile + pytest | 167–192 | REQ-CI-06 (pytest soft-skips if absent) |
| installer `npm ci && build && test` | 194–206 | REQ-CI-06 |

This document adds two new `validate.sh` steps: the **claude-plugin-validate** step (4.1) and the
**traceability** step (4.6). Steps 6a / 6b are edited only in *what they load* (4.2) or run *as-is*
(4.4).

---

## 3. The `ci.yml` workflow + `quality-gate` composite action (REQ-CIINFRA-01, -02, REQ-CONST-01)

`ci.yml` triggers on `pull_request` + `push`, declares least-privilege `permissions: contents: read`,
and delegates to a local composite action — structurally parallel to rauf's `ci.yml` →
`.github/actions/quality-gate` pattern (verified at
`/home/gary/workspace/rauf/.github/workflows/ci.yml` and
`/home/gary/workspace/rauf/.github/actions/quality-gate/action.yml`). This **pattern-reuse** is the
practical form of "factored, not duplicated" required by REQ-CIINFRA-02 (01 §3.3); true cross-repo
`uses:` is rejected because rauf's gate is `pnpm gate` (TS-specific), not transferable.

### 3.1 `feature-forge/.github/workflows/ci.yml` (NEW — full content)

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

# Least-privilege (REQ-SEC-01/-02): the deterministic gate only reads the repo
# tree and needs no secrets. Mirrors rauf's ci.yml permissions block.
permissions:
  contents: read

jobs:
  gate:
    name: Quality Gate
    runs-on: ubuntu-latest
    steps:
      # Third-party actions pinned to a major tag (REQ-SEC-01), matching rauf's
      # pinning convention (actions/checkout@v5, etc.).
      - uses: actions/checkout@v5

      # Single source of truth for the per-PR gate. All gate steps live in the
      # composite so a green local run (`bash scripts/validate.sh` + lint +
      # version-sync) reproduces CI and the two can never drift (tech-spec §3.1).
      - uses: ./.github/actions/quality-gate
```

**Design notes (traced):**
- `pull_request` + `push` triggers — 01 §2 topology table (ci.yml is the blocking fast path).
- `permissions: contents: read` — 01 §4 (least privilege); REQ-SEC-02 (no secrets in the
  deterministic gate; this workflow requests none).
- `branches: [main]` on `push` mirrors rauf's `ci.yml` (push only on the default branch; PRs cover
  feature branches). REQ-CONST-01 mandates GitHub Actions.
- Pinned `actions/checkout@v5` — REQ-SEC-01 (01 §4: pin to tag/SHA consistently with rauf).
- The job lives off the OS-matrix and eval paths (those are separate workflows) so it completes in
  minutes (REQ-PERF-01, 01 §3.1).

### 3.2 `feature-forge/.github/actions/quality-gate/action.yml` (NEW — full content)

This composite provisions the toolchain `validate.sh` and the lint/version gates expect, then runs
the four gate steps in the §2 order. It mirrors rauf's composite (one canonical entry point) but, in
feature-forge's Python/shell/Node world, must provision more than rauf's single `pnpm gate` line.

```yaml
name: Quality Gate
description: >-
  The canonical feature-forge gate — `bash scripts/validate.sh` (claude-plugin
  validate, SKILL.md schema purity, adapters regen-diff, traceability, installer
  build+test) + shellcheck + ruff + version-sync. Single source of truth shared
  by ci.yml and local dev so they can never drift (mirrors rauf's pnpm-gate
  composite-action pattern).
runs:
  using: composite
  steps:
    # 1a. Provision Node >=18 for the installer build+test that validate.sh runs.
    - uses: actions/setup-node@v4
      with:
        node-version: "20"

    # 1b. Provision Python >=3.10 for the stdlib gates (check-spec-purity,
    #     check-version-sync, traceability) and pip-install ruff (NOT added to
    #     requirements-adapters.txt — that venv is PyYAML-only, tech-spec §3.4).
    - uses: actions/setup-python@v5
      with:
        python-version: "3.11"

    - name: Install lint + (optional) claude CLI tooling
      shell: bash
      run: |
        python3 -m pip install --upgrade pip
        python3 -m pip install ruff
        # claude CLI is best-effort (REQ-CI-01 §4.1): install if a published
        # path exists on the runner; validate.sh falls back to the documented
        # equivalent when it is absent (never a no-op, never a silent skip).
        npm install -g @anthropic-ai/claude-code || \
          echo "::notice::claude CLI unavailable on runner; validate.sh uses the documented-equivalent JSON+schema validation (REQ-CI-01 fallback)"

    # 1c. Pre-create the isolated adapter venv the way validate.sh step 6b
    #     expects (PyYAML pin). validate.sh creates-or-reuses .venv-adapters; we
    #     warm it here so a provisioning fault surfaces as its own clear step.
    - name: Provision adapter venv (.venv-adapters)
      shell: bash
      run: |
        python3 -m venv .venv-adapters
        .venv-adapters/bin/python3 -m pip install -q -r scripts/requirements-adapters.txt

    # 1d. shellcheck for REQ-CI-03 (the runner image ships it; install if absent).
    - name: Ensure shellcheck
      shell: bash
      run: command -v shellcheck >/dev/null 2>&1 || sudo apt-get update && sudo apt-get install -y shellcheck

    # 2. The aggregate gate: claude-plugin-validate, SKILL.md schema purity (6a),
    #    adapters regen-diff (6b), agent frontmatter, script perms, traceability,
    #    epic-manifest, installer build+test (REQ-CI-01,-02,-04,-06).
    - name: validate.sh (aggregate gate)
      shell: bash
      run: bash scripts/validate.sh

    # 3. shellcheck over the 4 bundled shell scripts (REQ-CI-03). Config:
    #    .shellcheckrc (error+warning floor). feature-forge scope only.
    - name: shellcheck
      shell: bash
      run: shellcheck scripts/*.sh

    # 4. ruff over the bundled Python (REQ-CI-03). Config: ruff.toml (E/F/W floor,
    #    line-length 100). eval/ may not exist yet — the absent-dir carve-out
    #    keeps the glob clean (tech-spec §3.4).
    - name: ruff
      shell: bash
      run: |
        if [ -d eval ]; then
          ruff check scripts/ eval/
        else
          ruff check scripts/
        fi

    # 5. Version-sync over the three feature-forge fields (REQ-CI-05). Prints the
    #    conflicting files+values on mismatch (REQ-OBS-01). Currently FAILS on the
    #    live desync until 06 reconciles it.
    - name: version-sync
      shell: bash
      run: python3 scripts/check-version-sync.py
```

**Provisioning rationale (traced):**
- `actions/setup-node@v4` (Node 20 ≥18) — `validate.sh` lines 194–206 run `npm ci && npm run build
  && npm test` for the installer (REQ-CI-06). Tech-spec §9: Node ≥18.
- `actions/setup-python@v5` (3.11 ≥3.10) — the stdlib gates run on Python; tech-spec §9: Python ≥3.10.
- `pip install ruff` in the composite, **not** in `requirements-adapters.txt` — tech-spec §3.4
  (that file is the PyYAML-only adapter venv).
- `.venv-adapters` pre-creation — `validate.sh` step 6b (lines 144–165) creates-or-reuses it;
  warming it makes a provisioning fault surface as its own step rather than buried inside step 6b.
- All third-party actions pinned to a major tag — REQ-SEC-01 (01 §4).
- No `secrets:` referenced anywhere — REQ-SEC-02 (the deterministic gate operates on the repo tree
  only; only `eval.yml` reads a secret, 04).

---

## 4. Individual Gate Designs

### 4.1 `claude plugin validate --strict` gate (REQ-CI-01)

`claude plugin validate --strict` is **not in `validate.sh` today**; this feature adds it as a new
`validate.sh` step. The `claude` CLI may be absent on a stock runner, so the gate attempts the CLI
first and falls back to the **documented equivalent** — the marketplace/plugin JSON validation
already in `validate.sh` (steps 1–3, lines 19–62) **plus** the SKILL.md schema gate (4.2). This keeps
REQ-CI-01 a **real gate, not a no-op**: when the CLI is present it is authoritative; when absent the
fallback still validates the same artifacts, and the choice is **logged, never silently skipped**
(REQ-OBS-01; tech-spec §3.1.1).

**New `validate.sh` step (insert after step 3, before step 4) — exact addition:**

```bash
# 3a. claude plugin validate --strict (REQ-CI-01).
#     The claude CLI may not be present on a stock runner. When available it is
#     authoritative; when absent we fall back to the documented equivalent — the
#     marketplace/plugin JSON validation above (steps 1-3) plus the SKILL.md
#     schema gate (step 6a). Either way this is logged, never a silent skip
#     (REQ-OBS-01) and never a no-op (REQ-CI-01).
echo ""
echo "Checking claude plugin manifest (claude plugin validate --strict)..."
if command -v claude >/dev/null 2>&1; then
  if claude plugin validate --strict "$REPO_ROOT"; then
    echo "PASS: claude plugin validate --strict"
  else
    echo "FAIL: claude plugin validate --strict reported errors (see above)"
    ERRORS=$((ERRORS + 1))
  fi
else
  echo "INFO: claude CLI not available — using documented-equivalent validation"
  echo "      (marketplace/plugin JSON checks above + SKILL.md schema gate below)."
  echo "PASS: claude plugin validate (documented equivalent; REQ-CI-01 fallback)"
fi
```

**Error handling:**
- CLI present + validation error → `claude` exits non-zero → step increments `ERRORS` → `validate.sh`
  exits 1 under `set -euo pipefail` (the `if` guards the non-zero so the script reaches the tally).
- CLI present + clean → `PASS`.
- CLI absent → fall back, log the substitution at INFO, count as PASS because the equivalent checks
  (steps 1–3 + 6a) have already run / will run as their own hard gates. The fallback is **documented
  in the step comment** and surfaced in the log (REQ-OBS-01). Resolves PRD OQ-03/tech-spec OQ-C
  ("confirm CLI can run on a hosted runner vs. fall back").

> The composite action (§3.2) best-effort-installs the CLI so the authoritative path runs when
> possible; the fallback exists purely for runners where the install path is unavailable.

### 4.2 SKILL.md schema validation — schema-driven `check-spec-purity.py` (REQ-CI-02, REQ-CONST-03)

REQ-CI-02 requires validating every `SKILL.md` against a schema requiring `name` + `description` and
asserting `name == directory`. The **schema artifact itself is defined in `00-core-definitions.md`
§3** (`references/skill-frontmatter.schema.json`, JSON Schema draft 2020-12) — this document does
**not** redefine it; it specifies the **edit to `check-spec-purity.py`** that makes the schema the
authoritative source for the allowed/required key sets, keeping one executable gate (tech-spec §3.3).

`check-spec-purity.py` already validates SKILL.md frontmatter (it is `validate.sh` step 6a, lines
120–132, a HARD gate) and already encodes `name==dir` (`check_name_matches_dir`), residual
`${CLAUDE_PLUGIN_ROOT}`, prelude-identity, and body-size rules. The **only** change is to load the
allowed/required key sets from the schema instead of hard-coding them.

**Verified current state** — `/home/gary/workspace/feature-forge/scripts/check-spec-purity.py:35-41`
(quoted byte-for-byte). **Note:** the `REQ-FM-01` / `REQ-VND-01` in the quoted comment are
**`forge-skill-spec-purity`'s** requirement IDs, carried in the real `check-spec-purity.py` source —
they are **not** packaging-docs-ci requirements (the traceability validator flags them as "orphaned"
because it pattern-matches REQ IDs inside fenced code). This block implements **REQ-CI-02**; the
quoted code is left unchanged on purpose so "verified current state" stays accurate.

```python
# §1 — frontmatter schema (REQ-FM-01, REQ-VND-01).
REQUIRED_FRONTMATTER_KEYS: frozenset[str] = frozenset({"name", "description"})
OPTIONAL_FRONTMATTER_KEYS: frozenset[str] = frozenset(
    {"license", "compatibility", "metadata", "allowed-tools"}
)
ALLOWED_FRONTMATTER_KEYS: frozenset[str] = (
    REQUIRED_FRONTMATTER_KEYS | OPTIONAL_FRONTMATTER_KEYS
)
```

**The EDIT (after) — load the sets from the schema (stdlib `json` only):**

The schema lives at `references/skill-frontmatter.schema.json`; the script lives at `scripts/`, so it
resolves to `<root>/references/skill-frontmatter.schema.json` via the same `--root` the script already
computes (`Path(__file__).resolve().parent.parent`, line 561). Add `import json` to the stdlib
imports (the script currently imports `argparse, enum, fnmatch, re` — line 21–24) and replace the
hard-coded block:

```python
import json  # add to the stdlib import block (REQ-CI-02: schema-driven keys)

# §1 — frontmatter schema (REQ-FM-01, REQ-VND-01).
#
# The allowed/required key sets are LOADED from the single declarative source of
# truth, references/skill-frontmatter.schema.json (00 §3 / tech-spec §3.3), so the
# schema and this checker can never drift. The schema fixes WHICH keys are allowed;
# the two checks JSON Schema cannot express (name == directory, residual
# ${CLAUDE_PLUGIN_ROOT} / prelude / body-size) stay in Python below.
#: Path to the canonical SKILL.md frontmatter schema, relative to the repo root.
SCHEMA_REL_PATH: str = "references/skill-frontmatter.schema.json"


def _load_frontmatter_key_sets(root: Path) -> tuple[frozenset[str], frozenset[str]]:
    """Load (REQUIRED, ALLOWED) frontmatter key sets from the JSON Schema (00 §3).

    REQUIRED = the schema's ``required`` array; ALLOWED = the schema's
    ``properties`` keys. additionalProperties:false in the schema means ALLOWED is
    the exact closed set (REQ-CONST-03). Stdlib json only — no jsonschema dep.

    Args:
        root: The repo root (the schema sits at SCHEMA_REL_PATH beneath it).

    Returns:
        (REQUIRED_FRONTMATTER_KEYS, ALLOWED_FRONTMATTER_KEYS) as frozensets.

    Raises:
        SystemExit: if the schema is missing or unparseable — a hard config error
            (a SKILL.md gate with no schema is meaningless; fail loudly, REQ-OBS-01).
    """
    schema_path = root / SCHEMA_REL_PATH
    try:
        schema = json.loads(schema_path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise SystemExit(
            f"check-spec-purity: FATAL — schema not found at {schema_path} "
            f"(REQ-CI-02 requires references/skill-frontmatter.schema.json; see 00 §3)."
        )
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit(
            f"check-spec-purity: FATAL — schema at {schema_path} is unreadable/"
            f"invalid JSON: {exc}"
        )
    required = frozenset(schema.get("required", []))
    allowed = frozenset(schema.get("properties", {}).keys())
    return required, allowed
```

The module-level constants then become a one-time load at the top of `main()` (or module load),
threaded into `check_frontmatter_keys`. Minimal-diff approach — resolve at module import using the
script's default root, keeping the existing `--root` override working by re-loading inside `main()`:

```python
def main(argv: list[str] | None = None) -> int:
    ...
    args = parser.parse_args(argv)
    root: Path = args.root.resolve()

    # Load the schema-driven key sets for this root (REQ-CI-02 / tech-spec §3.3).
    global REQUIRED_FRONTMATTER_KEYS, ALLOWED_FRONTMATTER_KEYS
    REQUIRED_FRONTMATTER_KEYS, ALLOWED_FRONTMATTER_KEYS = _load_frontmatter_key_sets(root)

    violations = collect_violations(root)
    return report(violations)
```

(`OPTIONAL_FRONTMATTER_KEYS` is dropped; `ALLOWED` now derives directly from `properties`. The
existing `check_frontmatter_keys` body — lines 306–348 — is unchanged: it reads the two module
globals, which are now schema-sourced.)

**What stays in Python (the schema cannot express these — REQ-CI-02):**
- `name == <directory name>` — `check_name_matches_dir` (lines 351–386), per-file context.
- residual `${CLAUDE_PLUGIN_ROOT}`, prelude identity, body size — `check_no_residual_var`,
  `check_prelude_identity`, `check_body_size` (unchanged).

**Spec-purity enforcement (REQ-CONST-03):** because the schema declares `additionalProperties: false`
(00 §3), `ALLOWED` is the exact closed 6-key set; any vendor key (Claude hook wiring, Codex policy,
Copilot flags) or a `version` key (REQ-VER-03) appears in `keys - ALLOWED_FRONTMATTER_KEYS` and is
emitted as `VR_DISALLOWED_KEY`. The schema is the **mechanical** guard; the checker is the executable
one.

**Anti-drift pytest assertion (REQ-CI-02, tech-spec §3.3):** extend the existing suite at
`/home/gary/workspace/feature-forge/tests/test_check_spec_purity.py` (verified present) with an
assertion that the checker's loaded set equals the schema's `properties` keys:

```python
# tests/test_check_spec_purity.py — anti-drift (REQ-CI-02 / 00 §3 / tech-spec §3.3)
import json
from pathlib import Path

import check_spec_purity  # the module under test (conftest puts scripts/ on sys.path)

REPO_ROOT = Path(__file__).resolve().parent.parent


def test_loaded_keysets_match_schema():
    """check-spec-purity's loaded ALLOWED/REQUIRED == the schema's properties/required.

    Guards against the checker's key sets drifting from the single declarative
    source of truth (references/skill-frontmatter.schema.json). 00 §3 fixes the
    6 allowed / 2 required keys; this asserts the loader reproduces them exactly.
    """
    schema = json.loads(
        (REPO_ROOT / "references" / "skill-frontmatter.schema.json").read_text("utf-8")
    )
    required, allowed = check_spec_purity._load_frontmatter_key_sets(REPO_ROOT)
    assert allowed == frozenset(schema["properties"].keys())
    assert required == frozenset(schema["required"])
    # Belt-and-suspenders: the exact 00 §3 sets.
    assert allowed == frozenset(
        {"name", "description", "license", "compatibility", "metadata", "allowed-tools"}
    )
    assert required == frozenset({"name", "description"})
```

This test runs inside `validate.sh` step 7 (`pytest tests`, lines 178–184), so the anti-drift check
is part of the per-PR gate (REQ-CI-06).

> The shell-level frontmatter grep in `validate.sh` step 4 (lines 64–83) remains as a coarse early
> check; the authoritative SKILL.md gate is the schema-driven `check-spec-purity.py` (step 6a).

### 4.3 Shell + Python lint — shellcheck + ruff (REQ-CI-03, OQ-04)

**Scope:** feature-forge only (tech-spec §3.4 decision). shellcheck over `scripts/*.sh` (4 files,
verified: `validate.sh`, `forge-init.sh`, `forge-root.sh`, `session-check.sh`); ruff over
`scripts/*.py` and `eval/*.py` (verified `scripts/*.py`: `build-adapters.py`, `check-spec-purity.py`,
`epic-manifest.py`, `validate-traceability.py`). rauf's shell corpus is out of scope.

**Severity floor (settles PRD OQ-04 / tech-spec §3.4):**
- **shellcheck:** `error` **and** `warning` severities **fail**; per-line `# shellcheck disable=SCxxxx`
  directives are permitted for justified exceptions. Configured via `.shellcheckrc`.
- **ruff:** the default rule set — `E` (pycodestyle errors), `F` (pyflakes), `W` (pycodestyle
  warnings) — is the floor; line-length 100; per-line `# noqa: <rule>` permitted. Configured via
  `ruff.toml`. The floor MUST NOT be weakened below `E`/`F`/`W` even though `scripts/*.py` also
  matches sibling-owned `epic-manifest.py` / `validate-traceability.py`; pre-existing violations are
  fixed minimally or scoped with `# noqa: <rule>` (mirrors the shellcheck per-line-disable carve-out).

**`feature-forge/.shellcheckrc` (NEW — full content):**

```sh
# feature-forge shellcheck config (REQ-CI-03, OQ-04).
# Severity floor: error AND warning fail the gate. Per-line `# shellcheck
# disable=SCxxxx` is permitted for justified, documented exceptions; do NOT
# globally disable a rule here to dodge a real finding.
severity=warning

# Bundled scripts target bash explicitly (#!/usr/bin/env bash).
shell=bash

# Allow `source`/`.` of files shellcheck cannot follow at lint time (the
# portable resolver is sourced at runtime, not lint time). This does NOT lower
# the severity floor — it only stops a false "can't follow non-constant source".
external-sources=true
```

**`feature-forge/ruff.toml` (NEW — full content):**

```toml
# feature-forge ruff config (REQ-CI-03, OQ-04).
# Floor: E (pycodestyle errors), F (pyflakes), W (pycodestyle warnings).
# line-length 100. Per-line `# noqa: <rule>` is permitted for justified
# exceptions; do NOT weaken the floor below E/F/W (tech-spec §3.4).
line-length = 100
target-version = "py310"   # repo Python baseline (tech-spec §9)

[lint]
select = ["E", "F", "W"]

# scripts/*.py and eval/*.py are the lint targets; tests/ and the generated
# adapters/ tree are excluded (adapters/ is DO-NOT-EDIT generated output).
[lint.per-file-ignores]
# (none by default — add scoped, justified entries here only if needed)
```

**The `eval/` ordering carve-out (tech-spec §3.4):** `eval/` is created by a later backlog item
(`04-trigger-accuracy-eval.md`); before that lands the directory does not exist. The composite-action
ruff step (§3.2) guards on `[ -d eval ]` so a missing `eval/` is not an error — preferred resolution
per tech-spec §3.4 ("a glob that matches zero files cleanly … or — preferred — sequence the lint
backlog item AFTER the eval item"). The guard makes the gate order-independent regardless of backlog
sequencing.

**Local reproduction:** `shellcheck scripts/*.sh` and `ruff check scripts/ eval/` (or `ruff check
scripts/` before `eval/` exists), run from the feature-forge root, reproduce CI byte-for-byte (both
read the committed config files).

**Error handling / diagnostics (REQ-OBS-01):** shellcheck prints `file:line:col: SCxxxx (level):
message`; ruff prints `path:line:col: CODE message`. Both exit non-zero on any in-floor finding,
failing the composite step.

### 4.4 Adapters regenerate-and-diff (REQ-CI-04, REQ-CONST-04)

**This gate already exists** and is **not rebuilt** by this feature. It is `validate.sh` step 6b
(verified, lines 134–165), a HARD gate that provisions `.venv-adapters` and runs
`scripts/build-adapters.py --check` (verified `--check` flag at
`/home/gary/workspace/feature-forge/scripts/build-adapters.py:1400`): regenerate to a temp dir and
`diff -r` against the committed `adapters/`. Non-zero exit on drift fails `validate.sh` under
`set -euo pipefail`.

This document's only responsibility for REQ-CI-04 is to **stand up the workflow that runs
`validate.sh`** (§3) — the composite calls `bash scripts/validate.sh`, which runs step 6b. The
capstone does **not** author a new diff gate (tech-spec §6.3: "the regen-and-diff mechanism is
delivered by `forge-agent-adapters-build`, not this capstone").

**REQ-CONST-04 (generated adapters never hand-edited):** step 6b is precisely the enforcement —
`adapters/` must equal a fresh generation. The gemini-extension version reconciliation (00 §5) flows
through the **generator** (`GEMINI_EXTENSION_VERSION` constant, `build-adapters.py:298`), so after the
bump-and-regenerate (owned by `06-packaging-versioning-hygiene.md`) this gate passes with no diff
(SC-04). Editing `gemini-extension.json` by hand would fail step 6b — which is the point.

**Diagnostic (REQ-OBS-01):** on drift, step 6b prints `FAIL: adapters/ is out of date — run
'python3 scripts/build-adapters.py' and commit the result` plus the unified diff from `--check`
(verified, line 157; 00 §8 obligation "adapters regen-diff prints the unified diff").

### 4.5 Version-sync gate — `scripts/check-version-sync.py` (REQ-CI-05, REQ-OBS-01)

The version-sync **contract** is fixed in `00-core-definitions.md` §5 (`VersionSyncContract`:
`plugin.json` / `marketplace.json` plugins[0] / `gemini-extension.json`, all → `0.10.0`;
`installer/package.json` excluded; `RECONCILED_VERSION = "0.10.0"`). This document specifies the
**gate** that enforces it.

**Verified live values (the desync the gate must currently catch):**
- `.claude-plugin/plugin.json` → `"version": "0.10.0"` (line 3).
- `.claude-plugin/marketplace.json` → `plugins[0].version: "0.9.0"` (line 11).
- `adapters/gemini/gemini-extension.json` → `"version": "0.0.0"` (line 7).
- `installer/package.json` → `"version": "0.1.0"` — **excluded** (independent sub-package line).

**`feature-forge/scripts/check-version-sync.py` (NEW — full content, stdlib only):**

```python
#!/usr/bin/env python3
"""Assert the three feature-forge version fields agree (REQ-CI-05, REQ-OBS-01).

Within-repo version-sync gate. The three fields are the version-sync contract from
00-core-definitions.md §5; installer/package.json is EXCLUDED (independent line).
The gate prints every field and its value, flags conflicts, and exits non-zero on
any mismatch (REQ-OBS-01 — no silent failure). It MUST currently FAIL on the live
desync (plugin 0.10.0 / marketplace 0.9.0 / gemini 0.0.0) until reconciliation
lands (06-packaging-versioning-hygiene.md), then PASS (SC-03).

Stdlib only (json) — no third-party deps, matching the repo's other gate scripts.

Usage:
    python3 check-version-sync.py [--root DIR]

Exit codes:
    0 = all three fields byte-equal
    1 = mismatch (conflicting files+values printed)
    2 = a field is missing/unreadable (config error)
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

#: The three synced fields (00 §5). Each: (repo-relative file, accessor label,
#: a function extracting the version string from the parsed JSON).
FIELDS: tuple[tuple[str, str, "object"], ...] = (
    (".claude-plugin/plugin.json", "version", lambda d: d["version"]),
    (
        ".claude-plugin/marketplace.json",
        "plugins[0].version",
        lambda d: d["plugins"][0]["version"],
    ),
    ("adapters/gemini/gemini-extension.json", "version", lambda d: d["version"]),
)

#: EXCLUDED from the gate — installer/ is a separately published sub-package (00 §5).
EXCLUDED = ("installer/package.json",)


def _read_version(root: Path, rel: str, label: str, accessor) -> tuple[str | None, str | None]:
    """Return (version, error). version is None when an error string is set."""
    path = root / rel
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None, f"{rel}: file not found"
    except (OSError, json.JSONDecodeError) as exc:
        return None, f"{rel}: unreadable/invalid JSON ({exc})"
    try:
        value = accessor(data)
    except (KeyError, IndexError, TypeError):
        return None, f"{rel}: missing field '{label}'"
    if not isinstance(value, str):
        return None, f"{rel}: field '{label}' is not a string ({value!r})"
    return value, None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="check-version-sync.py",
        description="Assert feature-forge's three version fields agree (REQ-CI-05).",
    )
    parser.add_argument(
        "--root",
        type=Path,
        default=Path(__file__).resolve().parent.parent,
        help="Repo root to scan (default: parent of this script's dir).",
    )
    args = parser.parse_args(argv)
    root: Path = args.root.resolve()

    print("version-sync: checking the three synced feature-forge fields (REQ-CI-05)...")
    print(f"version-sync: excluded (independent line): {', '.join(EXCLUDED)}")

    versions: dict[str, str] = {}
    config_error = False
    for rel, label, accessor in FIELDS:
        value, error = _read_version(root, rel, label, accessor)
        if error is not None:
            print(f"  ERROR  {error}")
            config_error = True
            continue
        print(f"  {rel} ({label}) = {value}")
        versions[f"{rel} ({label})"] = value  # type: ignore[assignment]

    if config_error:
        print("version-sync: FATAL — a synced field is missing/unreadable (config error).")
        return 2

    distinct = set(versions.values())
    if len(distinct) == 1:
        only = next(iter(distinct))
        print(f"version-sync: PASS — all three fields agree at {only}.")
        return 0

    # Mismatch — print the conflict explicitly (REQ-OBS-01: conflicting files+values).
    print(f"version-sync: FAIL — fields disagree: {sorted(distinct)}")
    for label, value in versions.items():
        print(f"  CONFLICT  {label} = {value}")
    print(
        "version-sync: reconcile to a single version (00 §5: 0.10.0). marketplace.json "
        "is hand-edited; gemini-extension.json is REGENERATED via "
        "scripts/build-adapters.py (bump GEMINI_EXTENSION_VERSION). See "
        "06-packaging-versioning-hygiene.md."
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
```

**Algorithm:**
1. Read each of the three fields (`plugin.json.version`, `marketplace.json.plugins[0].version`,
   `gemini-extension.json.version`) via stdlib `json`.
2. A missing file / missing field / non-string value → exit **2** (config error — distinct from a
   genuine mismatch).
3. If the three values are byte-equal → print PASS, exit **0**.
4. Otherwise → print each conflicting `file (field) = value`, the remedy (reconcile to `0.10.0`,
   noting the generator path for the gemini field), exit **1**.

**Current behavior (SC-03):** with live values `0.10.0` / `0.9.0` / `0.0.0`, `distinct` has 3
elements → exit 1, printing all three conflicts. After `06-packaging-versioning-hygiene.md` reconciles
to `0.10.0` (hand-edit marketplace, bump `GEMINI_EXTENSION_VERSION` + regenerate), `distinct` is `{
"0.10.0" }` → exit 0. The gate is **fails-then-passes** by design.

**rauf half (REQ-CI-05, REQ-VER-01):** unchanged — rauf's existing `pnpm version:check`
(`scripts/check-versions.ts`, source `packages/core/src/version.ts`) already covers its 6
package.jsons (00 §5; tech-spec §3.5). The two repos keep independent semver lines (REQ-VER-01); this
new script is feature-forge only.

> **Wiring choice:** the gate runs as its own composite step (§3.2 step 5) for a clear standalone
> diagnostic, and may *also* be invoked from `validate.sh` for local parity. Either placement
> satisfies REQ-CI-05; the composite step is authoritative in CI.

### 4.6 Wire existing validators into CI as blocking (REQ-CI-06)

`validate.sh` already runs, as **blocking** steps, the existing validators that satisfy REQ-CI-06:
agent-frontmatter checks (lines 85–104), script-permission checks (lines 106–118), spec-purity
(step 6a), adapters regen-diff (step 6b), epic-manifest py_compile + pytest (step 7, lines 167–192),
and installer `npm ci && build && test` (lines 194–206). Routing CI through `validate.sh` (§3) makes
all of these blocking on every PR.

**The one not yet wired:** `scripts/validate-traceability.py` is **standalone today** (verified — it
is a separate CLI; `validate.sh` never calls it). This feature wires it into `validate.sh` as a
blocking step. Its verified signature (`/home/gary/workspace/feature-forge/scripts/validate-traceability.py`):

```
python validate-traceability.py <prd-path> <specs-dir> [--json]
# exit 0 = all requirements covered, no orphans; 1 = gaps/orphans; 2 = file not found
```

**New `validate.sh` step (insert before the final tally, after the installer step) — exact addition:**

```bash
# 8. Requirement traceability (REQ-CI-06). validate-traceability.py is standalone
#    today; wire it as a BLOCKING gate. The validator's CLI takes exactly TWO
#    positionals — a single PRD.md file and ITS specs dir — so it is invoked once
#    PER SPEC SUITE (each `<root>/specs/<suite>/PRD.md`), with that suite's own
#    directory as the specs dir. If no PRD/specs tree is present (the canon repo may
#    not carry one), it is a non-fatal SKIP — never a silent pass over a real gap.
echo ""
echo "Checking requirement traceability..."
TRACE="$REPO_ROOT/scripts/validate-traceability.py"
# Adjust the PRD/specs path to the repo's shipped spec layout; SKIP if absent.
TRACE_PRD="$REPO_ROOT/specs"   # repo-specific; set to the canonical PRD/specs root
if [ -f "$TRACE" ] && [ -d "$TRACE_PRD" ]; then
  TRACE_RAN=0
  for prd in "$TRACE_PRD"/*/PRD.md; do
    [ -e "$prd" ] || continue                    # no suite present -> SKIP, not a bogus glob-string failure
    TRACE_RAN=1
    specs_dir="$(dirname "$prd")"
    python3 "$TRACE" "$prd" "$specs_dir"; rc=$?   # NO 2>/dev/null — surface the validator's diagnostic (REQ-OBS-01)
    case "$rc" in
      0) echo "PASS: requirement traceability ($specs_dir)" ;;
      1) echo "FAIL: requirement traceability gaps/orphans in $specs_dir (see above)"; ERRORS=$((ERRORS + 1)) ;;
      *) echo "FAIL: requirement traceability config error in $specs_dir (rc=$rc — bad PRD/specs path?)"; ERRORS=$((ERRORS + 1)) ;;
    esac
  done
  if [ "$TRACE_RAN" -eq 0 ]; then
    echo "SKIP: no spec suite (specs/*/PRD.md) present; traceability check not applicable here"
    WARNINGS=$((WARNINGS + 1))
  fi
else
  echo "SKIP: no specs tree present; traceability check not applicable here"
  WARNINGS=$((WARNINGS + 1))
fi
```

> **Note:** feature-forge's canon repo may not carry a PRD/specs tree (specs live in the consumer's
> repo, e.g. `rauf/specs/`). The SKIP guard keeps the step honest (a missing specs tree is not a gap)
> while making the validator blocking wherever a specs tree *is* present (REQ-CI-06). The exact
> PRD/specs path is a one-line repo-local adjustment when the step lands.

---

## 5. Error Handling & Diagnostics (REQ-OBS-01)

Every gate fails **loudly and actionably** — no silent failures — per the `GateDiagnostic` shape in
00 §8 (`gate`, `what`, `evidence`, `remedy`).

| Gate | `what` (failure summary) | `evidence` | `remedy` |
|---|---|---|---|
| claude-plugin-validate (4.1) | manifest invalid, or CLI absent → fallback used | `claude` stderr, or the INFO fallback log line | fix the flagged manifest field; CLI fallback is logged, never silent |
| SKILL.md schema (4.2) | disallowed/missing key, name≠dir | `<path>: <reason>` (`VR_DISALLOWED_KEY` / `VR_MISSING_REQUIRED` / `VR_NAME_MISMATCH`) + per-rule tally | remove the vendor/version key, or rename so `name`==dir |
| shellcheck (4.3) | shell lint finding (error/warning) | `file:line:col: SCxxxx (level): message` | fix, or per-line `# shellcheck disable=SCxxxx` with justification |
| ruff (4.3) | Python lint finding (E/F/W) | `path:line:col: CODE message` | fix, or per-line `# noqa: <rule>` |
| adapters regen-diff (4.4) | `adapters/` drifted from canon | unified `diff` (from `build-adapters.py --check`) | `python3 scripts/build-adapters.py` and commit |
| version-sync (4.5) | three fields disagree | each `CONFLICT <file> (<field>) = <value>` | reconcile to `0.10.0` (06); regen for the gemini field |
| traceability (4.6) | REQ-ID gaps/orphans | the validator's gap/orphan listing | add the missing coverage, or remove the orphan |

**Tooling-availability handling (tech-spec §7):**
- `claude` CLI absent → documented-equivalent JSON+schema validation, **logged** (4.1), never a no-op.
- `.venv-adapters` provisioning fault → step 6b prints an explicit "environment/setup fault, NOT a
  canon error or drift" message (verified, `validate.sh` lines 161–164).
- The deterministic gate requires **zero secrets** (REQ-SEC-02); no gate echoes anything sensitive.

---

## 6. Configuration Summary

| File | Repo | Disposition | Purpose | REQ |
|---|---|---|---|---|
| `.github/workflows/ci.yml` | feature-forge | NEW | per-PR blocking workflow | REQ-CIINFRA-01 |
| `.github/actions/quality-gate/action.yml` | feature-forge | NEW | composite gate runner | REQ-CIINFRA-02 |
| `.shellcheckrc` | feature-forge | NEW | shellcheck floor (error+warning) | REQ-CI-03 |
| `ruff.toml` | feature-forge | NEW | ruff floor (E/F/W, len 100) | REQ-CI-03 |
| `scripts/check-version-sync.py` | feature-forge | NEW | 3-field version gate | REQ-CI-05 |
| `references/skill-frontmatter.schema.json` | feature-forge | NEW (defined in 00 §3) | SKILL.md schema source of truth | REQ-CI-02 |
| `scripts/check-spec-purity.py` | feature-forge | EDIT | load key sets from schema | REQ-CI-02 |
| `scripts/validate.sh` | feature-forge | EDIT | add claude-validate (3a) + traceability (8) steps | REQ-CI-01, REQ-CI-06 |
| `tests/test_check_spec_purity.py` | feature-forge | EDIT | anti-drift assertion | REQ-CI-02 |

Configurable knobs and their defaults: shellcheck `severity=warning` (floor; do not raise to `error`
to dodge warnings); ruff `select = ["E","F","W"]`, `line-length = 100` (floor; do not weaken);
version-sync `RECONCILED_VERSION` = `0.10.0` (00 §5, fixed); claude-validate falls back when the CLI
is absent (documented, not configurable).

---

## Dependencies

Implement **after**:
- **`00-core-definitions.md`** — the SKILL.md frontmatter schema artifact (§3, consumed by 4.2), the
  version-sync contract (§5, consumed by 4.5), the installer-CLI surface (§7), and the
  `GateDiagnostic` convention (§8) all originate there. The schema file itself
  (`references/skill-frontmatter.schema.json`) MUST exist before the 4.2 `check-spec-purity.py` edit
  is meaningful.
- **`01-architecture-layout.md`** — the cross-repo file inventory (§1), workflow topology (§2), and
  composite-action pattern (§3) this document instantiates.

Coordinates with:
- **`06-packaging-versioning-hygiene.md`** — owns the **execution** of the version reconciliation
  (hand-edit `marketplace.json` 0.9.0→0.10.0; bump `GEMINI_EXTENSION_VERSION` 0.0.0→0.10.0 and
  regenerate). The version-sync gate (4.5) authored here **fails until 06 lands**, then passes (SC-03).
- **`03-os-matrix-installer-gate.md`** (`os-matrix.yml`) and **`04-trigger-accuracy-eval.md`**
  (`eval.yml`) are sibling workflows in the same `.github/` tree but are not part of this per-PR gate.

Consumed (unchanged) source: `validate.sh`, `build-adapters.py` (`--check`), `validate-traceability.py`
(all in feature-forge); rauf's `pnpm gate` / `check-versions.ts` (unchanged).

---

## Verification

Confirm an implementation matches this spec by running, from the **feature-forge** root:

- [ ] **Aggregate gate passes (post-reconciliation):** `bash scripts/validate.sh` exits 0 — exercises
      claude-plugin-validate (or its logged fallback), SKILL.md schema purity (6a), adapters
      regen-diff (6b), agent-frontmatter, script perms, traceability (8), epic-manifest pytest,
      installer build+test (SC-03, REQ-CI-01/-02/-04/-06).
- [ ] **shellcheck passes:** `shellcheck scripts/*.sh` exits 0 over the 4 bundled scripts with the
      `.shellcheckrc` floor (REQ-CI-03).
- [ ] **ruff passes:** `ruff check scripts/` (and `ruff check scripts/ eval/` once `eval/` exists)
      exits 0 with `ruff.toml` (E/F/W, len 100) (REQ-CI-03).
- [ ] **version-sync fails-then-passes (SC-03):** `python3 scripts/check-version-sync.py` exits **1**
      against the current tree (printing `0.10.0` / `0.9.0` / `0.0.0` conflicts) **before**
      reconciliation, and exits **0** after 06 reconciles all three to `0.10.0` (REQ-CI-05).
- [ ] **Adapters in sync (SC-04):** `python3 scripts/build-adapters.py --check` (via step 6b)
      produces no diff after the gemini bump+regenerate (REQ-CI-04).
- [ ] **Schema anti-drift:** `python3 -m pytest tests -q` includes `test_loaded_keysets_match_schema`
      and it passes — checker's loaded ALLOWED/REQUIRED == schema `properties`/`required` (REQ-CI-02).
- [ ] **Spec-purity holds (REQ-CONST-03):** adding a `version:` or any vendor key to a `skills/*/SKILL.md`
      makes `check-spec-purity.py` (step 6a) fail with `VR_DISALLOWED_KEY`.
- [ ] **Workflow shape:** `.github/workflows/ci.yml` triggers on `pull_request`+`push`, declares
      `permissions: contents: read`, pins `actions/checkout@v5`, and `uses:
      ./.github/actions/quality-gate` (REQ-CIINFRA-01, REQ-SEC-01/-02).
- [ ] **Composite runs all four gate groups:** `action.yml` provisions Python+Node, creates
      `.venv-adapters`, then runs `bash scripts/validate.sh` → shellcheck → ruff → version-sync in
      that order (REQ-CIINFRA-02).

**Success-criteria mapping:** SC-03 → 4.1/4.2/4.5/4.6 + the fails-then-passes version-sync;
SC-04 → 4.4 (adapters regen-diff). The done bar is "authored + locally validated," not "green on
real GitHub" (PRD §8; 01 §4).
