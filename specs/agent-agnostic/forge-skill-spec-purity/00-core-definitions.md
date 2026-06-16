# 00 — Core Definitions

> Feature: `forge-skill-spec-purity` (epic `agent-agnostic`, target repo **feature-forge**).
> Source of truth: `PRD.md` (v1) + `tech-spec.md` (v1). This document defines the shared
> contracts — the spec-sanctioned frontmatter schema, the size-budget constants, the canonical
> bootstrap prelude, the sentinel/scan definitions, and the two scripts' exit-code/violation
> contracts — that every other spec document in this suite references. Cross-references use exact
> filenames (e.g. `03-portable-root-resolver.md`).
>
> **Stack note:** the configured `stack` is `typescript`, but this feature ships **Bash + Python 3
> (stdlib only) + Markdown** — there is no TypeScript. All code below is exact Bash / Python, not
> pseudocode, following the existing `scripts/epic-manifest.py` / `tests/conftest.py` conventions
> (Google-style docstrings, full type annotations, `set -euo pipefail` for shell). See the Python
> stack profile for docstring discipline; the TypeScript profile does not apply.

## Requirement Coverage

| REQ ID | Requirement | Section |
|--------|-------------|---------|
| REQ-FM-01 | Allowed frontmatter key set (closed) | §1 (`ALLOWED_FRONTMATTER_KEYS`) |
| REQ-FM-02 | `name` == directory name | §1, §5 (`VR_NAME_MISMATCH`) |
| REQ-FM-04 | Frontmatter is valid/parseable YAML | §4 (frontmatter reader contract), §5 |
| REQ-VND-01 | `argument-hint` relocated under `metadata` | §1 (`metadata.argument-hint`) |
| REQ-VND-03 | Vendor-construct disposition vocabulary | §8 (`Disposition`) |
| REQ-RES-02 | Resolver resolution order + sentinel | §2 (`is_root`), §3 |
| REQ-RES-03 | Canonical-surface scan scope; sanctioned residual | §6 (`CANONICAL_SURFACES`), §3 |
| REQ-RES-04 | Resolver failure contract | §7 (`forge-root.sh` exit codes) |
| REQ-RES-05 | Canonical bootstrap prelude (verbatim unit) | §3 (`BOOTSTRAP_PRELUDE`) |
| REQ-SIZE-03 | Size budget = ≤300 lines AND ≤5000 words | §2 (`MAX_BODY_LINES`, `MAX_BODY_WORDS`) |
| REQ-VER-01/02 | Checker rules + violation/exit contract | §5 (`Violation`), §7 |
| REQ-OBS-01 | Human-readable + machine-consumable output | §5, §7 |

> This is a foundation document: it defines names and constants only. The *procedures* that use
> them live in `02-frontmatter-purity-and-inventory.md`, `03-portable-root-resolver.md`,
> `04-body-size-discipline.md`, and `05-spec-purity-checker.md`. The layout that hosts them is in
> `01-architecture-layout.md`.

## 1. The Spec-Sanctioned Frontmatter Schema (REQ-FM-01, REQ-VND-01)

The Agent Skills specification (constraint **C-2** in `PRD.md`) defines the closed set of
top-level frontmatter keys a `SKILL.md` may declare. This set is the **binding schema** for the
whole canon and the checker's rule 1.

```python
# The two required keys (every SKILL.md MUST declare both).
REQUIRED_FRONTMATTER_KEYS: frozenset[str] = frozenset({"name", "description"})

# The optional keys the spec permits in addition.
OPTIONAL_FRONTMATTER_KEYS: frozenset[str] = frozenset(
    {"license", "compatibility", "metadata", "allowed-tools"}
)

# The full closed allow-list. A frontmatter top-level key NOT in this set is a violation.
ALLOWED_FRONTMATTER_KEYS: frozenset[str] = (
    REQUIRED_FRONTMATTER_KEYS | OPTIONAL_FRONTMATTER_KEYS
)
# == {"name", "description", "license", "compatibility", "metadata", "allowed-tools"}
```

**Field contracts** (the checker treats this as its schema — see `tech-spec.md §4`; no separate
JSON-schema file is added):

| Key | Required | Type | Contract |
|-----|----------|------|----------|
| `name` | yes | string | MUST exactly equal the containing directory name (`skills/<name>/SKILL.md`) — REQ-FM-02. |
| `description` | yes | string | Preserved **verbatim** from the pre-refactor file (REQ-FM-03); reduction work never edits it. May contain a colon and/or be a quoted/folded scalar. |
| `license` | no | string | SPDX-style identifier. Not added by this feature. |
| `compatibility` | no | string \| map | Not added by this feature. |
| `metadata` | no | map | Spec-sanctioned home for vendor data. After this feature it holds the relocated `argument-hint` (REQ-VND-01) for the 10 skills that declared one. |
| `allowed-tools` | no | string \| list | Not added by this feature. |

**The single relocation this feature performs** (REQ-VND-01): the Claude-specific top-level
`argument-hint` key moves, value unchanged, to `metadata.argument-hint`:

```yaml
# canonical post-refactor shape (skill that had argument-hint)
name: forge-1-prd
description: "…"            # verbatim, never altered (REQ-FM-03)
metadata:
  argument-hint: "<feature-name>"
```

**Audit-confirmed starting state** (`tech-spec.md §3.1`): frontmatter today contains only `name`,
`description`, and — in 10 of 11 skills — `argument-hint`. `forge-init` has no `argument-hint`. No
`license` / `compatibility` / `metadata` / `allowed-tools` exists yet, and `name == <dir>` already
holds for all 11. So this feature adds **no** new optional keys beyond the `metadata` map that
hosts the relocated `argument-hint`.

## 2. Constants

```python
# ── Size budget (REQ-SIZE-03, decision D1 — tightens OQ-1's provisional 500). ──
# A SKILL.md *body* (everything below the closing frontmatter `---`) must satisfy BOTH limits;
# whichever is hit first binds. Exceeding either is a HARD checker failure (rule 4).
MAX_BODY_LINES: int = 300
MAX_BODY_WORDS: int = 5000

# ── Resolver sentinel files (REQ-RES-02). A directory is a valid plugin root iff BOTH exist. ──
SENTINEL_FILES: tuple[str, ...] = (
    "scripts/epic-manifest.py",
    ".claude-plugin/plugin.json",
)
```

**Body definition (authoritative, used by rule 4 and `04-body-size-discipline.md`):** the *body*
is the file content **after** the second `---` line that closes the YAML frontmatter block. Line
count = number of newline-terminated lines in the body. Word count = whitespace-split token count
of the body. The checker re-measures at gate time; authorship-time tables (`tech-spec.md §3.3`) are
advisory only — the gate, not any table, is authoritative.

`is_root(dir)` — the sentinel predicate shared by `forge-root.sh` (Bash) and, conceptually, the
prelude's discovery:

```bash
# Bash form used inside scripts/forge-root.sh (§3 of 03-portable-root-resolver.md gives the full script)
is_root() {  # $1 = candidate dir
  [ -f "$1/scripts/epic-manifest.py" ] && [ -f "$1/.claude-plugin/plugin.json" ]
}
```

The sentinel is content-based (not name-based) so it identifies a feature-forge install under
**any** agent's directory layout, never sources or executes the discovered path (REQ-SEC-01), and
only ever yields a directory string.

## 3. The Canonical Bootstrap Prelude (REQ-RES-05, REQ-MAINT-01)

Because each fenced shell block an agent runs is a **separate** process with no persisted state,
the plugin root must be re-resolved **within the same block** as every bundled-script call. The
prelude is a fixed, **byte-identical** 2-line snippet prepended to each invocation block. It is the
reusable unit the downstream adapter generator copies verbatim (REQ-RES-05), and the checker
asserts every occurrence is byte-for-byte identical to this canonical string (rule 5), so it can
never drift.

```bash
R="$(for d in "$HOME"/.claude/skills/feature-forge "$HOME"/.claude/plugins/*/feature-forge; do [ -x "$d/scripts/forge-root.sh" ] && exec "$d/scripts/forge-root.sh"; done)"
[ -n "$R" ] || { echo "feature-forge: cannot locate plugin root" >&2; exit 1; }
```

Invariants (do **not** "fix" these — see `03-portable-root-resolver.md §4`):

- The prelude probes **paths**, never the forbidden `${CLAUDE_PLUGIN_ROOT}` env var, so its
  presence satisfies REQ-RES-03's "no residual var in canonical surfaces".
- **First-discoverable-resolver-wins:** the `exec` inside `$(…)` means the loop stops at the
  **first** directory holding an executable `forge-root.sh` and delegates ALL final root
  resolution to that script. The `for` list is a *discovery order for `forge-root.sh` itself*, not
  a fallback chain for the plugin root. Removing `exec` to "keep looping" is a regression.
- After the prelude, scripts are invoked as `python3 "$R/scripts/<x>"` / `bash "$R/scripts/<x>"`.
- The prelude's candidate set is a deliberately minimal `$HOME`-Claude bootstrap subset (TQ-1); the
  **authoritative** multi-root probe lives in `forge-root.sh` step 2 (§3 of
  `03-portable-root-resolver.md`). The checker guards prelude *byte-identity* but does **not**
  assert prelude-set ⊆ resolver-set — that subset is a manual-review item.

## 4. Frontmatter Reader Contract (REQ-FM-04)

The checker parses frontmatter with a **minimal hand-rolled reader — stdlib only, no pyyaml**
(matching `epic-manifest.py`'s deliberate no-pyyaml convention; pyyaml is not guaranteed in CI or
other-agent environments). Code to this contract, not to an example:

- The frontmatter block is the content between the first `---` line (column 0) and the next `---`
  line (column 0). A file lacking a well-formed open/close pair → reported as a malformed-block
  violation (REQ-FM-04), **never a crash**.
- A **top-level key** is a line matching `^[A-Za-z][\w-]*:` at **column 0** only.
- Indented lines, continuation lines, and quoted/folded scalar **values** are **not** re-scanned
  for keys. In particular: a `description` whose value contains a colon (`description: "foo: bar"`),
  a `>` or `|` block scalar, nested keys under `metadata:` (e.g. `  argument-hint:`), and blank
  lines must all parse correctly — `metadata.argument-hint` is **not** mistaken for a disallowed
  top-level key, and a colon inside a value is **not** mistaken for a new key.
- CRLF line endings are tolerated.

A frontmatter block the reader cannot resolve into a well-formed top-level key set is itself a
reported violation, not an exception. Full reader spec + the exact hardening fixtures are in
`05-spec-purity-checker.md §2` and `06-testing-strategy.md`.

## 5. Checker Data Types (REQ-VER-01, REQ-VER-02, REQ-OBS-01)

```python
from __future__ import annotations

import enum
from dataclasses import dataclass


class Rule(enum.StrEnum):
    """The five spec-purity rules check-spec-purity.py enforces (tech-spec §3.4).

    Each maps one PRD requirement cluster onto a checkable assertion.
    """

    FRONTMATTER_KEYS = "frontmatter-keys"      # rule 1 — REQ-FM-01/04
    NAME_MATCHES_DIR = "name-matches-dir"      # rule 2 — REQ-FM-02
    NO_RESIDUAL_VAR = "no-residual-var"        # rule 3 — REQ-RES-03
    BODY_SIZE = "body-size"                    # rule 4 — REQ-SIZE-03 (hard fail)
    PRELUDE_IDENTITY = "prelude-identity"      # rule 5 — REQ-RES-05 / REQ-MAINT-01


@dataclass(frozen=True)
class Violation:
    """One spec-purity violation, rendered as `file: reason` (REQ-VER-02, REQ-OBS-01).

    Attributes:
        path: Repo-relative path of the offending file (POSIX separators).
        rule: Which Rule was violated.
        reason: Human-readable explanation, suitable for CI logs.
    """

    path: str
    rule: Rule
    reason: str

    def render(self) -> str:
        """Return the canonical one-line form: ``<path>: <reason>``."""
        return f"{self.path}: {self.reason}"
```

**Canonical violation reason strings** (stable identifiers the tests in
`06-testing-strategy.md` assert against; wording may be elaborated but the leading token is
stable):

| Constant | Rule | Reason (leading token) |
|----------|------|------------------------|
| `VR_DISALLOWED_KEY` | `FRONTMATTER_KEYS` | `disallowed frontmatter key '<key>'` |
| `VR_MISSING_REQUIRED` | `FRONTMATTER_KEYS` | `missing required frontmatter key '<key>'` |
| `VR_MALFORMED_FM` | `FRONTMATTER_KEYS` | `malformed frontmatter block` |
| `VR_NAME_MISMATCH` | `NAME_MATCHES_DIR` | `name '<name>' != directory '<dir>'` |
| `VR_RESIDUAL_VAR` | `NO_RESIDUAL_VAR` | `residual ${CLAUDE_PLUGIN_ROOT} in canonical surface` |
| `VR_BODY_LINES` | `BODY_SIZE` | `body 320 lines exceeds 300` |
| `VR_BODY_WORDS` | `BODY_SIZE` | `body 5120 words exceeds 5000` |
| `VR_PRELUDE_DRIFT` | `PRELUDE_IDENTITY` | `bootstrap prelude not byte-identical to canon` |

## 6. Canonical Surfaces (REQ-RES-03)

The "canonical surfaces" are the shipped skill canon that rule 3 scans for residual
`${CLAUDE_PLUGIN_ROOT}` and that rule 5 scans for prelude occurrences. Defined as glob sets,
relative to the feature-forge repo root:

```python
# Scanned (canonical shipped skill surfaces).
CANONICAL_SURFACES: tuple[str, ...] = (
    "skills/**/SKILL.md",
    "skills/**/references/**",
    "references/**",
    "agents/*.md",
)

# Excluded from the residual-var scan (NOT canonical, or the one sanctioned residual).
RESIDUAL_VAR_EXEMPT: tuple[str, ...] = (
    "scripts/forge-root.sh",   # the single sanctioned residual (env fallback, REQ-RES-02 step 3)
    "hooks/hooks.json",        # non-canonical Claude artifact (REQ-VND-04)
    "specs/**", "plans/**", "docs/**",  # feature-forge's own forge artifacts, not shipped canon
)
```

The exhaustive, grep-verified replacement scope is **23 canonical occurrences across 9 files**;
the per-file table is in `03-portable-root-resolver.md §5`. The 1 occurrence in `hooks/hooks.json`
and the 1 sanctioned residual inside `forge-root.sh` are the only `${CLAUDE_PLUGIN_ROOT}` instances
that survive in the tree (24 total today).

## 7. Script Exit-Code & I/O Contracts

Both new scripts are the feature's only programmatic interfaces (`tech-spec.md §5`).

**`scripts/forge-root.sh`** (the exposed `portable-skill-root-resolver`, REQ-RES-04/05):

| Exit | stdout | stderr | Meaning |
|------|--------|--------|---------|
| 0 | absolute plugin root (one line) | — | Root resolved (self-location, candidate probe, or env fallback). |
| 1 | — | `feature-forge: cannot locate plugin root. Set CLAUDE_PLUGIN_ROOT or run from an installed skill dir.` | No strategy resolved a root (REQ-RES-04). |

Idempotent, side-effect-free; takes no arguments; never sources/executes a discovered path
(REQ-SEC-01).

**`scripts/check-spec-purity.py`** (the checker, REQ-VER-01/02, REQ-OBS-01):

| Exit | Meaning |
|------|---------|
| 0 | Canon clean — zero violations across all 11 skills + canonical surfaces. |
| non-zero (1) | One or more violations; each printed as `file: reason`, preceded by a summary count. |

CLI: `check-spec-purity.py [--root DIR]` (default root derived from `__file__`). Output is a
human-readable summary plus one `file: reason` line per `Violation` — readable in a terminal and
parseable in CI (REQ-OBS-01). Full output format in `05-spec-purity-checker.md §4`.

## 8. Vendor-Construct Disposition Vocabulary (REQ-VND-03)

The audit inventory (`references/vendor-construct-inventory.md`, specified in
`02-frontmatter-purity-and-inventory.md §4`) records every vendor-specific construct with exactly
one disposition from this closed set:

```python
class Disposition(enum.StrEnum):
    """How a discovered vendor-specific construct is handled in the canon (REQ-VND-03)."""

    RELOCATED = "relocated"                          # moved to a spec-allowed location (e.g. metadata)
    REMOVED = "removed"                              # deleted from canon (none expected)
    PRESERVED_AS_SPEC_ALLOWED = "preserved-as-spec-allowed"  # kept; already spec-legal
    OUT_OF_CANON = "out-of-canon"                    # kept but documented as non-canonical (hooks.json)
    ROUTED_THROUGH_RESOLVER = "routed-through-resolver"      # ${CLAUDE_PLUGIN_ROOT} → prelude+forge-root.sh
```

Known dispositions (from `tech-spec.md §3.5`): `argument-hint` ×10 → `relocated`;
`${CLAUDE_PLUGIN_ROOT}` ×23 canonical → `routed-through-resolver`, ×1 in `forge-root.sh` →
`preserved-as-spec-allowed` (sanctioned residual), ×1 in `hooks.json` → `out-of-canon`;
`hooks/hooks.json` SessionStart wiring → `out-of-canon`.

## Dependencies

This is the root foundation document. It depends on no other spec document. Every other document in
this suite depends on it.

## Verification

- [ ] `ALLOWED_FRONTMATTER_KEYS` equals the six-key Agent Skills set (C-2) and is used by the
      checker's rule 1.
- [ ] `MAX_BODY_LINES == 300` and `MAX_BODY_WORDS == 5000` match decision D1 and are consumed by
      rule 4 and `04-body-size-discipline.md`.
- [ ] The `BOOTSTRAP_PRELUDE` string here is byte-identical to the one in
      `references/portable-root.md` and the one rule 5 asserts (`03-portable-root-resolver.md §3`).
- [ ] `SENTINEL_FILES` matches the `is_root` predicate in `forge-root.sh`.
- [ ] `CANONICAL_SURFACES` + `RESIDUAL_VAR_EXEMPT` reproduce the 23-canonical / 2-exempt split that
      the grep in `03-portable-root-resolver.md §5` confirms.
- [ ] Every `Rule` and `Violation` reason constant here is referenced by `05-spec-purity-checker.md`
      and asserted by a test in `06-testing-strategy.md`.
