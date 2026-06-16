# 05 — Spec-Purity Checker

> Feature: `forge-skill-spec-purity` (epic `agent-agnostic`, target repo **feature-forge**).
> Source of truth: `PRD.md` (v1) §3.5–§3.6 + `tech-spec.md` (v1) §3.4, §3.6. This document
> specifies the runnable spec-purity checker `scripts/check-spec-purity.py` — its CLI, the
> stdlib-only frontmatter reader, the five rules it enforces, its output format, its `validate.sh`
> wiring, and the internal-consistency guarantees it underwrites. It is the feature's **completion
> gate** (REQ-VER-03).
>
> **Stack note:** the configured `stack` is `typescript`, but this artifact ships **Python 3
> (stdlib only) + Bash**. There is NO TypeScript here, and NO `pyyaml` (matching
> `scripts/epic-manifest.py`'s deliberate no-pyyaml convention — pyyaml is not guaranteed in CI or
> other-agent environments). All Python below follows the existing house style:
> `from __future__ import annotations`, full type annotations, Google-style docstrings with
> `Args` / `Returns` / `Raises`, `enum.StrEnum` + `@dataclass(frozen=True)` for value types. See
> the Python stack profile (`references/stacks/python.md`).
>
> **This document does NOT re-define shared types.** `Rule`, `Violation`,
> `ALLOWED_FRONTMATTER_KEYS`, `MAX_BODY_LINES`/`MAX_BODY_WORDS`, the canonical reason strings,
> `CANONICAL_SURFACES`/`RESIDUAL_VAR_EXEMPT`, the `BOOTSTRAP_PRELUDE`, and the exit-code contract
> all live in `00-core-definitions.md`. The checker **imports and uses** them; this doc is the
> implementation that wires them together. All cross-references use exact filenames.

## Requirement Coverage

| REQ ID | Requirement | Section |
|--------|-------------|---------|
| REQ-VER-01 | Runnable spec-purity checker, standalone CLI | §1, §3 |
| REQ-VER-02 | Exit non-zero + `file: reason` per violation; exit zero when clean | §4, §7 |
| REQ-VER-03 | Checker green vs final 11 skills = completion gate (via `validate.sh`) | §5 |
| REQ-OBS-01 | Human-readable summary + per-violation detail; CI-consumable | §4 |
| REQ-FM-01 | Frontmatter keys ⊆ allowed set; `name`+`description` present | §3.1 (rule 1) |
| REQ-FM-04 | Frontmatter parses; malformed block = reported violation, not crash | §2, §3.1, §7 |
| REQ-FM-02 | `name` == containing directory | §3.2 (rule 2) |
| REQ-RES-03 | Zero `${CLAUDE_PLUGIN_ROOT}` in canonical surfaces (exemptions honored) | §3.3 (rule 3) |
| REQ-SIZE-03 | Body ≤300 lines AND ≤5000 words — hard fail | §3.4 (rule 4) |
| REQ-RES-05 | Bootstrap-prelude occurrences byte-identical to canon | §3.5 (rule 5) |
| REQ-MAINT-01 | Prelude can never drift (rule 5 guards identity) | §3.5 |
| REQ-COMPAT-03 | Checker step does not break bundled-script runnability | §5 |
| REQ-SOT-01 | After refactor, `skills/*` + `references/` + resolver = single canon | §6 |
| REQ-SOT-02 | No per-agent output produced | §6 |
| REQ-SOT-03 | Cross-references resolve; no single-agent-only paths | §6 |

---

## 1. Purpose & CLI (REQ-VER-01)

`scripts/check-spec-purity.py` is a **standalone, stdlib-only** Python program that validates the
`feature-forge` skill canon against the five spec-purity rules (§3). It is one of this feature's
acceptance gates and is wired into `validate.sh` (§5); `packaging-docs-ci` later wires the **same
verbatim script** into CI, so it must run with no arguments and no environment setup beyond
`python3`.

```
usage: check-spec-purity.py [--root DIR]

Validate the feature-forge skill canon for spec purity.

options:
  --root DIR   Repo root to scan (default: the parent of this script's
               directory, i.e. realpath(__file__)/../..).
```

- **Default root** is derived from `__file__` so the script works whether invoked as
  `python3 scripts/check-spec-purity.py` from the repo root or by absolute path from `validate.sh`.
  `--root` overrides it (the pytest suite in `06-testing-strategy.md` points it at fixture trees).
- **Exit codes** are the contract in `00-core-definitions.md §7`: **0** when the canon is clean
  (zero violations), **1** when one or more violations are found. No other exit code is emitted on
  normal operation (a usage error from `argparse` exits 2 per argparse convention; that is a
  caller mistake, not a canon verdict).
- The program is **read-only**: it opens files for reading, never writes, never executes a
  discovered path, never imports the canon. This mirrors the side-effect-free posture of
  `forge-root.sh` (REQ-SEC-01, by analogy) and keeps it safe to run in any CI sandbox.

### 1.1 Entry point & top-level orchestration

```python
#!/usr/bin/env python3
"""Validate the feature-forge skill canon for spec purity (REQ-VER-01..03).

Stdlib-only (no pyyaml), matching scripts/epic-manifest.py. Enforces the five
rules from tech-spec.md §3.4 against the canonical skill surfaces, printing a
human-readable report (REQ-OBS-01) and exiting non-zero on any violation
(REQ-VER-02). See spec docs 00-core-definitions.md (types/constants) and
05-spec-purity-checker.md (this implementation).

Usage:
    python3 check-spec-purity.py [--root DIR]

Exit codes:
    0 = canon clean (zero violations)
    1 = one or more violations (each printed as `file: reason`)
    2 = usage error (argparse)
"""

from __future__ import annotations

import argparse
import enum
import re
import sys
from dataclasses import dataclass
from pathlib import Path


def main(argv: list[str] | None = None) -> int:
    """Parse arguments, run all rules, print the report, return an exit code.

    Args:
        argv: Argument vector excluding the program name. Defaults to
            ``sys.argv[1:]`` when None.

    Returns:
        0 when the canon is clean, 1 when any violation was found.
    """
    parser = argparse.ArgumentParser(
        prog="check-spec-purity.py",
        description="Validate the feature-forge skill canon for spec purity.",
    )
    parser.add_argument(
        "--root",
        type=Path,
        default=Path(__file__).resolve().parent.parent,
        help="Repo root to scan (default: parent of this script's dir).",
    )
    args = parser.parse_args(argv)
    root: Path = args.root.resolve()

    violations = collect_violations(root)
    return report(violations)


if __name__ == "__main__":
    raise SystemExit(main())
```

`collect_violations` (§3.6) runs every rule and returns a **deterministically ordered** list of
`Violation` (see `00-core-definitions.md §5` for the dataclass; §7 here for ordering). `report`
(§4) renders the summary + per-violation lines and maps "any violations" → exit 1.

---

## 2. The stdlib frontmatter reader (REQ-FM-04)

This is the implementation of the **frontmatter-reader contract** defined in
`00-core-definitions.md §4`. It is hand-rolled (no pyyaml) and codes to that contract — not to any
single example. Restating the binding rules from §4:

- The frontmatter block is the content between the **first** column-0 `---` line and the **next**
  column-0 `---` line.
- A **top-level key** is a line matching `^[A-Za-z][\w-]*:` at **column 0 only**.
- Indented lines, continuation lines, and quoted / folded scalar **values** are **not** re-scanned
  for keys. So `metadata:`'s nested `  argument-hint:` is not a top-level key; a `description`
  whose value contains a colon (`description: "foo: bar"`) or is a `>` / `|` block scalar does not
  spuriously register a second key.
- CRLF line endings and blank lines inside the block are tolerated.
- A block the reader cannot resolve into a well-formed key set (no opening `---`, no closing `---`,
  or empty content) yields a **malformed signal**, never an exception (REQ-FM-04).

### 2.1 Return type

The reader returns a small frozen result so callers can distinguish "well-formed, here are the
keys" from "malformed" without exceptions or sentinel strings:

```python
@dataclass(frozen=True)
class Frontmatter:
    """Result of parsing a SKILL.md frontmatter block (00 §4 contract).

    Attributes:
        ok: True iff a well-formed ``---`` … ``---`` block was found and parsed.
        keys: Ordered tuple of top-level keys (column-0 ``key:`` lines), in
            file order. Empty when ``ok`` is False.
        body_start_line: 0-based line index of the first body line (the line
            after the closing ``---``). ``-1`` when ``ok`` is False. Used by
            rule 4 (§3.4) to slice the body.
    """

    ok: bool
    keys: tuple[str, ...]
    body_start_line: int
```

### 2.2 The reader

```python
#: A column-0 top-level key: a letter, then word chars / hyphens, then a colon.
#: Anchored at column 0 — indented and quoted/folded value lines never match.
_TOP_LEVEL_KEY_RE: re.Pattern[str] = re.compile(r"^([A-Za-z][\w-]*):")


def read_frontmatter(text: str) -> Frontmatter:
    """Parse a Markdown file's YAML frontmatter without pyyaml (00 §4).

    Locates the leading ``---`` … ``---`` fence and extracts only the
    column-0 ``key:`` lines as top-level keys. Values (including colon-bearing
    or ``>`` / ``|`` block scalars), indented/nested keys, continuation lines,
    and blank lines are NOT re-scanned for keys. CRLF endings are tolerated.

    Args:
        text: The full file contents (already decoded to ``str``).

    Returns:
        A ``Frontmatter`` with ``ok=True`` and the ordered top-level keys when a
        well-formed block is found; otherwise ``ok=False`` (a malformed-block
        signal, never an exception — REQ-FM-04).
    """
    # Normalize CRLF (and lone CR) so column-0 matching is line-ending agnostic.
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")

    # The opening fence must be the first non-empty line and be exactly "---".
    open_idx = -1
    for i, line in enumerate(lines):
        if line == "":
            continue
        open_idx = i if line == "---" else -1
        break
    if open_idx == -1:
        return Frontmatter(ok=False, keys=(), body_start_line=-1)

    # The closing fence is the next column-0 "---" after the opener.
    close_idx = -1
    for i in range(open_idx + 1, len(lines)):
        if lines[i] == "---":
            close_idx = i
            break
    if close_idx == -1:
        return Frontmatter(ok=False, keys=(), body_start_line=-1)

    keys: list[str] = []
    in_block_scalar = False
    block_scalar_indent = 0
    for line in lines[open_idx + 1 : close_idx]:
        if line.strip() == "":
            continue
        # Inside a `>` / `|` block scalar, every more-indented line is value
        # content — skip until indentation returns to column 0.
        if in_block_scalar:
            if line[:1] in (" ", "\t"):
                continue
            in_block_scalar = False
        # Indented lines are nested keys or values — never top-level keys.
        if line[:1] in (" ", "\t"):
            continue
        match = _TOP_LEVEL_KEY_RE.match(line)
        if match is None:
            # A column-0 line that is neither blank nor `key:` (e.g. a stray
            # list item or malformed YAML) makes the block ill-formed.
            return Frontmatter(ok=False, keys=(), body_start_line=-1)
        keys.append(match.group(1))
        # Detect the start of a block scalar so its indented body is skipped.
        value = line[match.end() :].strip()
        if value in (">", "|") or value.startswith((">", "|")):
            in_block_scalar = True

    if not keys:
        # A well-fenced but empty / keyless block is malformed for our purposes.
        return Frontmatter(ok=False, keys=(), body_start_line=-1)

    return Frontmatter(ok=True, keys=tuple(keys), body_start_line=close_idx + 1)
```

**Notes on the contract corners** (each maps to a `06-testing-strategy.md` reader-robustness
fixture):

- `description: "foo: bar"` → matches `_TOP_LEVEL_KEY_RE` once on `description`; the value's inner
  colon is in `match.end():` and never re-scanned. **One** key, correct.
- `description: >` (or `|`) → recorded as the `description` key, then `in_block_scalar` is set so the
  following indented folded/literal lines are skipped. No phantom key.
- `metadata:` then `  argument-hint: …` → `metadata` is column-0 (a key); the indented
  `argument-hint` line is skipped (not a top-level key). Correct — rule 1 never flags it.
- CRLF file → normalized up front; column-0 matching unaffected.
- No opening `---`, no closing `---`, or empty block → `ok=False` (malformed signal). Rule 1 turns
  this into a `VR_MALFORMED_FM` violation (§3.1), never a crash.

> The line-based `body_start_line` is what rule 4 uses to slice the body; the body definition
> ("everything after the second `---`") is authoritative in `00-core-definitions.md §2`.

---

## 3. The five rules

Each rule is a function `Path-root → list[Violation]`. Every `Violation` is built from the
`Violation` dataclass and canonical reason strings in `00-core-definitions.md §5`. The reason
**leading token** is stable (tests assert on it); the trailing detail is interpolated. Paths in
violations are **repo-relative, POSIX-separated** (computed via `path.relative_to(root).as_posix()`).

A shared discovery helper enumerates the canonical surfaces for rules 3 and 5:

```python
#: Canonical shipped skill surfaces scanned for residual var + prelude identity
#: (00 §6 — CANONICAL_SURFACES). Globs are relative to the repo root.
CANONICAL_SURFACES: tuple[str, ...] = (
    "skills/**/SKILL.md",
    "skills/**/references/**",
    "references/**",
    "agents/*.md",
)


def iter_canonical_files(root: Path) -> list[Path]:
    """Return every readable file under the canonical surfaces, deduped + sorted.

    Honors CANONICAL_SURFACES (00 §6). Directories matched by recursive globs
    are filtered out (only files are returned). Result is sorted by POSIX path
    for deterministic violation ordering (§7).

    Args:
        root: The repo root to scan.

    Returns:
        Sorted unique list of file ``Path`` objects under the canonical surfaces.
    """
    seen: set[Path] = set()
    for pattern in CANONICAL_SURFACES:
        for path in root.glob(pattern):
            if path.is_file():
                seen.add(path)
    return sorted(seen, key=lambda p: p.relative_to(root).as_posix())


def _read_text(path: Path) -> str | None:
    """Read a file as UTF-8, returning None when it cannot be read (§7).

    Args:
        path: File to read.

    Returns:
        The decoded contents, or None on OSError / decode failure (the caller
        treats an unreadable file gracefully rather than crashing).
    """
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None
```

### 3.1 Rule 1 — Frontmatter keys (REQ-FM-01, REQ-FM-04)

For every `skills/*/SKILL.md`: the parsed top-level key set MUST be a subset of
`ALLOWED_FRONTMATTER_KEYS` (`00 §1`), and both required keys (`name`, `description`) MUST be
present. A malformed frontmatter block is itself a single violation (REQ-FM-04).

```python
# Imported conceptually from 00-core-definitions.md §1 (do NOT redefine).
ALLOWED_FRONTMATTER_KEYS: frozenset[str] = frozenset(
    {"name", "description", "license", "compatibility", "metadata", "allowed-tools"}
)
REQUIRED_FRONTMATTER_KEYS: frozenset[str] = frozenset({"name", "description"})


def check_frontmatter_keys(root: Path) -> list[Violation]:
    """Rule 1: every SKILL.md frontmatter is well-formed, keys ⊆ allowed, name+description present.

    Maps to REQ-FM-01 (closed allow-list) and REQ-FM-04 (parseable; malformed =
    reported violation, not crash). Emits VR_MALFORMED_FM, VR_DISALLOWED_KEY, or
    VR_MISSING_REQUIRED (00 §5) per offending file.

    Args:
        root: The repo root to scan.

    Returns:
        One or more Violation per offending SKILL.md, in file order.
    """
    violations: list[Violation] = []
    for skill_md in sorted(root.glob("skills/*/SKILL.md"),
                           key=lambda p: p.relative_to(root).as_posix()):
        rel = skill_md.relative_to(root).as_posix()
        text = _read_text(skill_md)
        if text is None:
            violations.append(Violation(rel, Rule.FRONTMATTER_KEYS,
                                        "malformed frontmatter block (unreadable file)"))
            continue
        fm = read_frontmatter(text)
        if not fm.ok:
            violations.append(Violation(rel, Rule.FRONTMATTER_KEYS,
                                        "malformed frontmatter block"))
            continue
        keys = set(fm.keys)
        for key in sorted(keys - ALLOWED_FRONTMATTER_KEYS):
            violations.append(Violation(rel, Rule.FRONTMATTER_KEYS,
                                        f"disallowed frontmatter key '{key}'"))
        for key in sorted(REQUIRED_FRONTMATTER_KEYS - keys):
            violations.append(Violation(rel, Rule.FRONTMATTER_KEYS,
                                        f"missing required frontmatter key '{key}'"))
    return violations
```

Reason tokens (`00 §5`): `VR_MALFORMED_FM` → `malformed frontmatter block`;
`VR_DISALLOWED_KEY` → `disallowed frontmatter key '<key>'`; `VR_MISSING_REQUIRED` →
`missing required frontmatter key '<key>'`. Disallowed/missing keys are emitted **sorted** so the
output is deterministic (§7).

> Cross-ref: this rule enforces the frontmatter shape produced by
> `02-frontmatter-purity-and-inventory.md` (the `argument-hint`→`metadata` relocation). After that
> refactor, the only top-level keys present are `name`, `description`, and `metadata` — all in the
> allow-list — so a clean canon yields zero rule-1 violations.

### 3.2 Rule 2 — `name` == directory (REQ-FM-02)

For every `skills/<dir>/SKILL.md`, the frontmatter `name` value MUST equal `<dir>`. The reader
(§2) only yields keys, not values, so rule 2 extracts the `name` value with a small column-0
matcher (the same anchoring discipline as the reader):

```python
#: Capture a column-0 `name:` value (unquoted or single/double quoted scalar).
_NAME_VALUE_RE: re.Pattern[str] = re.compile(r'^name:\s*["\']?([^"\'\r\n]+?)["\']?\s*$')


def check_name_matches_dir(root: Path) -> list[Violation]:
    """Rule 2: each skill's frontmatter `name` equals its containing directory (REQ-FM-02).

    Emits VR_NAME_MISMATCH (00 §5) when they differ. Skills with a malformed
    block or absent `name` are already reported by rule 1 (§3.1); rule 2 simply
    skips them (no double-reporting of the same root cause).

    Args:
        root: The repo root to scan.

    Returns:
        One Violation per skill whose name != directory, in directory order.
    """
    violations: list[Violation] = []
    for skill_md in sorted(root.glob("skills/*/SKILL.md"),
                           key=lambda p: p.relative_to(root).as_posix()):
        rel = skill_md.relative_to(root).as_posix()
        dir_name = skill_md.parent.name
        text = _read_text(skill_md)
        if text is None:
            continue  # rule 1 reports unreadable/malformed
        name_value: str | None = None
        for line in text.replace("\r\n", "\n").split("\n"):
            if line == "---" and name_value is None:
                continue
            match = _NAME_VALUE_RE.match(line)
            if match is not None:
                name_value = match.group(1).strip()
                break
        if name_value is not None and name_value != dir_name:
            violations.append(Violation(rel, Rule.NAME_MATCHES_DIR,
                                        f"name '{name_value}' != directory '{dir_name}'"))
    return violations
```

Reason token: `VR_NAME_MISMATCH` → `name '<name>' != directory '<dir>'` (`00 §5`). The audit
(`tech-spec.md §3.1`) confirms `name == <dir>` already holds for all 11 skills, so a clean canon
yields zero rule-2 violations; the rule exists to keep it that way.

### 3.3 Rule 3 — No residual `${CLAUDE_PLUGIN_ROOT}` in canonical surfaces (REQ-RES-03)

Scan every canonical-surface file (`00 §6` `CANONICAL_SURFACES`) for any occurrence of the literal
`${CLAUDE_PLUGIN_ROOT}`. The exemptions (`00 §6` `RESIDUAL_VAR_EXEMPT`) are **not** reachable by
`iter_canonical_files` (they live in `scripts/`, `hooks/`, `specs/`, `plans/`, `docs/`), so no
explicit exclusion filter is needed — but the rule asserts the exemption set defensively in case a
future surface glob widens.

```python
#: The forbidden literal. The single sanctioned residual lives in
#: scripts/forge-root.sh (00 §6 RESIDUAL_VAR_EXEMPT), which is NOT a canonical
#: surface and is therefore never scanned by this rule.
_RESIDUAL_VAR: str = "${CLAUDE_PLUGIN_ROOT}"


def check_no_residual_var(root: Path) -> list[Violation]:
    """Rule 3: zero ${CLAUDE_PLUGIN_ROOT} across canonical surfaces (REQ-RES-03).

    Scans CANONICAL_SURFACES (00 §6). The exempt loci — scripts/forge-root.sh
    (sanctioned env fallback), hooks/hooks.json (non-canonical Claude artifact),
    and specs/plans/docs (feature-forge's own forge artifacts) — are outside the
    canonical globs and so are never visited. Emits VR_RESIDUAL_VAR (00 §5).

    Args:
        root: The repo root to scan.

    Returns:
        One Violation per offending canonical file, in sorted path order.
    """
    violations: list[Violation] = []
    for path in iter_canonical_files(root):
        text = _read_text(path)
        if text is None:
            continue
        if _RESIDUAL_VAR in text:
            rel = path.relative_to(root).as_posix()
            violations.append(Violation(rel, Rule.NO_RESIDUAL_VAR,
                                        "residual ${CLAUDE_PLUGIN_ROOT} in canonical surface"))
    return violations
```

Reason token: `VR_RESIDUAL_VAR` → `residual ${CLAUDE_PLUGIN_ROOT} in canonical surface` (`00 §5`).

> Cross-ref: the loci this rule polices are exactly the 23 canonical occurrences across 9 files
> rewritten by `03-portable-root-resolver.md §5` (the prelude replaces every invocation; prose
> mentions are reworded). After that workstream lands, a clean canon yields zero rule-3 violations.
> The verified loci (grep-confirmed at authoring): `skills/forge-0-epic/SKILL.md` (12),
> `skills/forge/SKILL.md` (3), `skills/forge-5-loop/SKILL.md` (1), `skills/forge-6-docs/SKILL.md`
> (1), `skills/forge-init/SKILL.md` (1), `skills/forge-verify/SKILL.md` (1),
> `skills/forge-verify/references/verification-checklists.md` (1),
> `references/shared-conventions.md` (2), `agents/forge-verifier.md` (1).

### 3.4 Rule 4 — Body size budget (REQ-SIZE-03) — HARD FAIL

For every `skills/*/SKILL.md`, the **body** (everything after the closing frontmatter `---`, per
`00 §2`) MUST satisfy **both** limits: `≤ MAX_BODY_LINES` lines AND `≤ MAX_BODY_WORDS` words. An
over-budget body is a hard failure (the checker exits non-zero), so the three named over-budget
skills (`forge-0-epic`, `forge-5-loop`, `forge-verify`) block completion until reduced.

```python
# Imported from 00-core-definitions.md §2 (decision D1; do NOT redefine).
MAX_BODY_LINES: int = 300
MAX_BODY_WORDS: int = 5000


def check_body_size(root: Path) -> list[Violation]:
    """Rule 4: each SKILL.md body ≤300 lines AND ≤5000 words (REQ-SIZE-03, hard fail).

    Body = content after the closing frontmatter `---` (00 §2). Line count =
    number of body lines; word count = whitespace-split token count. Both limits
    are checked independently, so an over-line and an over-word body produce two
    violations. Emits VR_BODY_LINES / VR_BODY_WORDS (00 §5).

    Args:
        root: The repo root to scan.

    Returns:
        Up to two Violation per offending skill (lines and/or words), in
        directory order.
    """
    violations: list[Violation] = []
    for skill_md in sorted(root.glob("skills/*/SKILL.md"),
                           key=lambda p: p.relative_to(root).as_posix()):
        rel = skill_md.relative_to(root).as_posix()
        text = _read_text(skill_md)
        if text is None:
            continue  # rule 1 reports unreadable
        fm = read_frontmatter(text)
        if not fm.ok:
            continue  # rule 1 reports malformed; body undefined without a close fence
        body_lines = text.replace("\r\n", "\n").split("\n")[fm.body_start_line:]
        # Drop a single trailing empty element from a final newline so the count
        # reflects real body lines, not the split artifact.
        if body_lines and body_lines[-1] == "":
            body_lines = body_lines[:-1]
        n_lines = len(body_lines)
        n_words = sum(len(line.split()) for line in body_lines)
        if n_lines > MAX_BODY_LINES:
            violations.append(Violation(rel, Rule.BODY_SIZE,
                                        f"body {n_lines} lines exceeds {MAX_BODY_LINES}"))
        if n_words > MAX_BODY_WORDS:
            violations.append(Violation(rel, Rule.BODY_SIZE,
                                        f"body {n_words} words exceeds {MAX_BODY_WORDS}"))
    return violations
```

Reason tokens: `VR_BODY_LINES` → `body <n> lines exceeds 300`; `VR_BODY_WORDS` →
`body <n> words exceeds 5000` (`00 §5`).

> Cross-ref: `04-body-size-discipline.md` performs the reduction; this rule is its gate. Because
> the prelude additions (§3.5) slightly grow each body, `04`'s reduction targets must leave
> headroom under 300 lines — the gate measured here, not the authorship-time table in
> `tech-spec.md §3.3`, is authoritative.

### 3.5 Rule 5 — Bootstrap-prelude byte-identity (REQ-RES-05, REQ-MAINT-01)

Every occurrence of the bootstrap prelude across the canonical surfaces MUST be **byte-identical**
to the single canonical snippet in `references/portable-root.md` (which is itself byte-identical to
`BOOTSTRAP_PRELUDE` in `00 §3`). This is what makes the prelude un-driftable (REQ-MAINT-01) and
copy-verbatim safe for the downstream adapter generator (REQ-RES-05).

The canonical 2-line snippet (`00 §3` — reproduced here only for the rule's matcher; it is **not**
re-defined, it is the same string):

```python
# The canonical bootstrap prelude (00 §3 / references/portable-root.md).
# Defined ONCE here as the comparison oracle; identical to 00 §3 byte-for-byte.
BOOTSTRAP_PRELUDE: str = (
    'R="$(for d in "$HOME"/.claude/skills/feature-forge '
    '"$HOME"/.claude/plugins/*/feature-forge; do '
    '[ -x "$d/scripts/forge-root.sh" ] && exec "$d/scripts/forge-root.sh"; done)"\n'
    '[ -n "$R" ] || { echo "feature-forge: cannot locate plugin root" >&2; exit 1; }'
)

#: First line of the prelude — its presence marks a prelude occurrence to verify.
_PRELUDE_SENTINEL: str = '[ -x "$d/scripts/forge-root.sh" ] && exec "$d/scripts/forge-root.sh"'


def check_prelude_identity(root: Path) -> list[Violation]:
    """Rule 5: every bootstrap-prelude occurrence is byte-identical to canon (REQ-RES-05).

    A file is "using the prelude" iff it contains _PRELUDE_SENTINEL (the unique
    inner exec line). For each such file, assert the canonical BOOTSTRAP_PRELUDE
    string (00 §3) appears verbatim; if the sentinel is present but the exact
    two-line snippet is not, the prelude has drifted. Emits VR_PRELUDE_DRIFT
    (00 §5). This guards REQ-MAINT-01 (prelude can never drift).

    Args:
        root: The repo root to scan.

    Returns:
        One Violation per file whose prelude is not byte-identical to canon.
    """
    violations: list[Violation] = []
    for path in iter_canonical_files(root):
        text = _read_text(path)
        if text is None:
            continue
        normalized = text.replace("\r\n", "\n")
        if _PRELUDE_SENTINEL in normalized and BOOTSTRAP_PRELUDE not in normalized:
            rel = path.relative_to(root).as_posix()
            violations.append(Violation(rel, Rule.PRELUDE_IDENTITY,
                                        "bootstrap prelude not byte-identical to canon"))
    return violations
```

Reason token: `VR_PRELUDE_DRIFT` → `bootstrap prelude not byte-identical to canon` (`00 §5`).

> Cross-ref: `03-portable-root-resolver.md §3` defines the prelude and `references/portable-root.md`
> hosts the canonical string; the `00-core-definitions.md` Verification checklist requires that
> string to be byte-identical to `BOOTSTRAP_PRELUDE`. Rule 5 enforces it mechanically. The detection
> sentinel keys on the inner `exec "$d/scripts/forge-root.sh"` line because a drifted prelude that
> still calls the resolver will retain that line — exactly the drift the rule must catch (whitespace
> changes, a re-flowed loop, a "fixed" missing `exec`, etc.).

### 3.6 Orchestration — `collect_violations`

```python
def collect_violations(root: Path) -> list[Violation]:
    """Run all five rules and return their violations in deterministic order (§7).

    Args:
        root: The repo root to scan.

    Returns:
        The concatenation of every rule's violations, then globally sorted for
        stable CI output (§7).
    """
    violations: list[Violation] = []
    violations += check_frontmatter_keys(root)   # rule 1 — REQ-FM-01/04
    violations += check_name_matches_dir(root)   # rule 2 — REQ-FM-02
    violations += check_no_residual_var(root)    # rule 3 — REQ-RES-03
    violations += check_body_size(root)          # rule 4 — REQ-SIZE-03
    violations += check_prelude_identity(root)   # rule 5 — REQ-RES-05
    return sorted(violations, key=lambda v: (v.path, v.rule.value, v.reason))
```

---

## 4. Output format (REQ-OBS-01, REQ-VER-02)

`report(violations)` prints a human-readable summary plus one `file: reason` line per violation,
then returns the process exit code. Output goes to **stdout** (CI-capturable, REQ-OBS-01); a clean
run prints a single success line. Exit codes follow `00 §7`.

```python
def report(violations: list[Violation]) -> int:
    """Print the human-readable report and return the exit code (REQ-OBS-01, REQ-VER-02).

    Args:
        violations: The deterministically ordered violations from
            ``collect_violations``.

    Returns:
        0 when ``violations`` is empty (canon clean), else 1.
    """
    if not violations:
        print("spec-purity: PASS — 0 violations across canonical surfaces.")
        return 0

    print(f"spec-purity: FAIL — {len(violations)} violation(s):")
    for v in violations:
        print(f"  {v.render()}")  # `<path>: <reason>` (00 §5 Violation.render)
    # Per-rule tally aids triage and stays machine-parseable.
    counts: dict[str, int] = {}
    for v in violations:
        counts[v.rule.value] = counts.get(v.rule.value, 0) + 1
    summary = ", ".join(f"{rule}={n}" for rule, n in sorted(counts.items()))
    print(f"spec-purity: by rule — {summary}")
    return 1
```

**Example — clean run (exit 0):**

```text
$ python3 scripts/check-spec-purity.py
spec-purity: PASS — 0 violations across canonical surfaces.
$ echo $?
0
```

**Example — failing run (exit 1):**

```text
$ python3 scripts/check-spec-purity.py
spec-purity: FAIL — 4 violation(s):
  agents/forge-verifier.md: residual ${CLAUDE_PLUGIN_ROOT} in canonical surface
  skills/forge-0-epic/SKILL.md: body 517 lines exceeds 300
  skills/forge-1-prd/SKILL.md: disallowed frontmatter key 'argument-hint'
  skills/forge-5-loop/SKILL.md: bootstrap prelude not byte-identical to canon
spec-purity: by rule — body-size=1, frontmatter-keys=1, no-residual-var=1, prelude-identity=1
spec-purity: cannot locate plugin root
$ echo $?
1
```

(The `cannot locate plugin root` line above is illustrative of a residual-var path's downstream
symptom and would not actually be emitted by the checker — the real checker prints only the three
shown lines per the code above. The canonical example to follow is the code, not this annotation.)

Each violation line is `path: reason` (`Violation.render`, `00 §5`) — readable in a terminal and
grep-/awk-parseable in CI (REQ-OBS-01). The per-rule tally line gives an at-a-glance count without
re-parsing.

---

## 5. `validate.sh` wiring (REQ-VER-03, REQ-COMPAT-03)

The checker is inserted into `scripts/validate.sh` as **one new step**, placed **after** the
existing `epic-manifest` `py_compile` substep and **before** the `pytest` substep — i.e. between
the current step 6 (script permissions) machinery and the soft-skipped pytest run, exactly per
`tech-spec.md §3.4` and the integration map in `01-architecture-layout.md §5`.

The current source (verified, `scripts/validate.sh`) compiles `epic-manifest.py` with
`py_compile`, then conditionally runs `pytest`. The new step goes between them:

```bash
# 7a. Spec-purity gate (REQ-VER-01..03) — runs UNCONDITIONALLY.
#     python3 stdlib only (no pyyaml), so it is always available; under
#     `set -euo pipefail` a non-zero exit fails validate.sh immediately.
#     This is a HARD gate — it is NEVER soft-skipped (unlike the pytest step).
echo ""
echo "Checking spec purity..."
if python3 "$REPO_ROOT/scripts/check-spec-purity.py"; then
  echo "PASS: spec-purity checker (all canonical surfaces clean)"
else
  echo "FAIL: spec-purity checker reported violations (see above)"
  ERRORS=$((ERRORS + 1))
fi
```

**Placement & semantics:**

- **Unconditional.** Unlike the `pytest` substep (which prints `SKIP … (non-fatal)` when pytest is
  absent and increments `WARNINGS`), the checker requires only `python3` stdlib, which is the same
  interpreter `validate.sh` already relies on for JSON validation and `py_compile`. There is no
  skip path: it always runs.
- **Hard gate.** The invocation captures the checker's exit code. A non-zero exit increments
  `ERRORS`, which makes `validate.sh` exit 1 at its tail (`if [ "$ERRORS" -eq 0 ]` … `else … exit 1`).
  Equivalently, the bare `python3 …` under `set -euo pipefail` would abort immediately; the
  `if`-guard variant above is used so the failure is reported in the script's existing
  PASS/FAIL/ERRORS idiom rather than aborting mid-report. Either way the gate is hard.
- **Invocation form.** Always invoked as `python3 "$REPO_ROOT/scripts/check-spec-purity.py"` — never
  executed directly as `./scripts/check-spec-purity.py`. This is deliberate (see executable-bit note
  below) and matches how `validate.sh` already invokes `epic-manifest.py` (via `python3 -m
  py_compile`) and `python3 -m pytest`. The checker's `--root` defaults from `__file__`, so no
  `--root` argument is needed here.

**Executable-bit subtlety (`01-architecture-layout.md §5`, `tech-spec.md §2`):** `validate.sh`'s
script-permission step (current step 6) globs `scripts/*.sh` only, so it gates the `0755` bit of
`scripts/forge-root.sh` (a `.sh`) but **not** of `scripts/check-spec-purity.py` (a `.py`). This
mirrors `epic-manifest.py`, which is non-executable and invoked via `python3`. The checker is
created `0755` per the tech spec for standalone convenience, but its executable bit is **not** a
gate-enforced requirement — invoking it via `python3` makes the bit irrelevant to `validate.sh`.
Do **not** add `*.py` to the permission-check glob.

**Completion gate (REQ-VER-03).** The feature is complete iff BOTH:
1. `python3 scripts/check-spec-purity.py` exits 0 against the **final** state of all 11 skills
   (zero violations across canonical surfaces), AND
2. `bash scripts/validate.sh` passes end-to-end (every existing step plus the new checker step).

This preserves REQ-COMPAT-03: the new step is read-only and additive — it does not touch how
`epic-manifest.py` or the other bundled scripts are located or run, so they remain runnable in the
existing Claude environment exactly as before.

---

## 6. Internal consistency (REQ-SOT-01, REQ-SOT-02, REQ-SOT-03)

The checker is the mechanical backstop for the canon's internal-consistency guarantees; the
remainder is verified by manual review (recorded in `02-frontmatter-purity-and-inventory.md`'s
inventory and `01-architecture-layout.md`'s diff checklist).

- **REQ-SOT-01 — single canon.** After the refactor, `skills/*/SKILL.md` + their `references/` +
  `scripts/forge-root.sh` are the single canonical source from which adapters are later generated.
  The checker scans exactly these surfaces (`CANONICAL_SURFACES`, `00 §6`) and the resolver
  (excluded as the sanctioned-residual locus), so "clean checker" ⇒ "this set is internally
  spec-pure." No other tree is treated as canon.
- **REQ-SOT-02 — no per-agent output.** This feature, and this checker, produce **no** per-agent
  artifact (no Codex mirror, Copilot copy, Cursor `.mdc`, `gemini-extension.json`, or `AGENTS.md`).
  The checker writes nothing at all (§1, read-only); the layout (`01-architecture-layout.md §2`)
  creates no `adapters/` tree. Verified by the `git diff --stat` checklist in
  `01-architecture-layout.md` Verification.
- **REQ-SOT-03 — cross-references resolve; no single-agent-only paths.** Two mechanisms cover this:
  (a) **rule 3** guarantees no canonical surface references the Claude-only `${CLAUDE_PLUGIN_ROOT}`
  directly — every script reference is routed through the portable resolver, so no skill points to
  a path that only exists under one agent; (b) relocated body content keeps explicit in-body
  pointers (REQ-SIZE-02, enforced by `04-body-size-discipline.md`), and the inventory + manual
  review (`02-frontmatter-purity-and-inventory.md`) confirm those pointers resolve. The checker
  does **not** crawl Markdown links for dead references — that residual is a documented manual-review
  item, consistent with `tech-spec.md §3.6`.

---

## 7. Error handling

Every operation is specified so the checker reports rather than crashes, and produces stable output:

- **Malformed frontmatter → reported, not crashed (REQ-FM-04).** The reader (§2) returns a
  `Frontmatter(ok=False)` signal for any block it cannot resolve (no opening/closing fence, empty
  block, stray column-0 non-key line). Rule 1 turns that into a single `VR_MALFORMED_FM` violation
  (§3.1). No `yaml.YAMLError`, no traceback — there is no YAML parser to throw.
- **Unreadable / missing files → graceful.** `_read_text` (§3) catches `OSError` and
  `UnicodeDecodeError` and returns `None`; rules skip a `None` file (rule 1 additionally records an
  unreadable `SKILL.md` as a malformed-block violation so it is never silently passed). A missing
  glob target simply yields no paths — `iter_canonical_files` and the per-rule `glob` calls return
  empty rather than raising.
- **Deterministic ordering (stable CI output).** Within each rule, files are iterated in sorted
  repo-relative POSIX-path order, and disallowed/missing keys are emitted sorted (§3.1).
  `collect_violations` (§3.6) then globally sorts the combined list by `(path, rule, reason)`. The
  same canon therefore always yields byte-identical report output — important for CI diffing and
  for the assertion style in `06-testing-strategy.md`.
- **No partial-failure exit ambiguity.** The exit code is a pure function of "did any rule emit a
  violation" (`report`, §4): 0 ⇔ empty list, 1 otherwise. A rule that internally skipped an
  unreadable file does not change the verdict for files it could read.

---

## Dependencies

- **`00-core-definitions.md`** (hard dependency) — supplies every shared contract this checker
  uses without redefining: `Rule` / `Violation` + `Violation.render` (§5), the canonical reason
  strings (§5), `ALLOWED_FRONTMATTER_KEYS` / `REQUIRED_FRONTMATTER_KEYS` (§1),
  `MAX_BODY_LINES` / `MAX_BODY_WORDS` + the body definition (§2), `CANONICAL_SURFACES` /
  `RESIDUAL_VAR_EXEMPT` (§6), `BOOTSTRAP_PRELUDE` (§3), the frontmatter-reader contract (§4), and
  the exit-code/I-O contract (§7).
- **`01-architecture-layout.md`** — locates the checker at `scripts/check-spec-purity.py`, fixes the
  `validate.sh` integration point (§5), and states the executable-bit subtlety this doc implements.
- **Verifies the outputs of:**
  - `02-frontmatter-purity-and-inventory.md` — its frontmatter reduction is what rules 1 & 2 gate.
  - `03-portable-root-resolver.md` — its prelude + resolver are what rules 3 & 5 gate (the
    sanctioned residual it documents is the one exempt locus).
  - `04-body-size-discipline.md` — its body reduction is what rule 4 gates.
- **Tested by `06-testing-strategy.md`** — `tests/test_check_spec_purity.py` drives this checker
  over clean + impure fixture trees (one fixture per rule, plus reader-robustness fixtures for the
  §2 corners) and asserts exit code + that the offending `file: reason` appears.
- **Runtime:** Python 3.10+ stdlib only (`argparse`, `enum`, `re`, `dataclasses`, `pathlib`). No
  third-party packages; no `pyyaml` (C-5 / `tech-spec.md §9`).

## Verification

- [ ] `python3 scripts/check-spec-purity.py` against the **final** clean canon prints
      `spec-purity: PASS …` and exits 0 (REQ-VER-02, REQ-VER-03).
- [ ] **Rule 1:** a `SKILL.md` with a disallowed top-level key (e.g. leftover `argument-hint`)
      yields a `disallowed frontmatter key 'argument-hint'` violation on that file and exit 1;
      a `SKILL.md` missing `name` or `description` yields `missing required frontmatter key …`.
- [ ] **Rule 1 (malformed):** a `SKILL.md` with no closing `---` yields exactly one
      `malformed frontmatter block` violation and does **not** raise (REQ-FM-04).
- [ ] **Reader corners (§2):** `description: "foo: bar"`, `description: >` block scalar, a
      `metadata:`/`  argument-hint:` pair, a blank-line-containing block, and a CRLF file each
      parse to the correct top-level key set — no false `disallowed`/`missing` violation.
- [ ] **Rule 2:** a skill whose `name` ≠ its directory yields `name '<n>' != directory '<d>'`.
- [ ] **Rule 3:** a canonical-surface file containing `${CLAUDE_PLUGIN_ROOT}` yields
      `residual ${CLAUDE_PLUGIN_ROOT} in canonical surface`; the sanctioned residual in
      `scripts/forge-root.sh` and the `hooks/hooks.json` occurrence do **not** (they are outside
      `CANONICAL_SURFACES`).
- [ ] **Rule 4:** an over-300-line body yields `body <n> lines exceeds 300` and exit 1; an
      over-5000-word body yields `body <n> words exceeds 5000`; both is two violations (hard fail).
- [ ] **Rule 5:** a file whose prelude differs by even one byte from `BOOTSTRAP_PRELUDE` yields
      `bootstrap prelude not byte-identical to canon`; an identical prelude does not.
- [ ] **Determinism:** two runs over the same impure tree print byte-identical output (sorted by
      `(path, rule, reason)`).
- [ ] **validate.sh:** with an impure canon, `bash scripts/validate.sh` fails (exit 1) at the new
      spec-purity step; with the clean canon it passes end-to-end; the checker step is never
      `SKIP`-ped (REQ-VER-03, REQ-COMPAT-03).
- [ ] **Standalone:** `python3 scripts/check-spec-purity.py --root /path/to/fixture` runs against an
      arbitrary tree (used by `06-testing-strategy.md`), confirming `packaging-docs-ci` can wire it
      verbatim (REQ-VER-01).
