# API Reference

Signatures and values below are taken from the implementation in the `feature-forge` repo
(`scripts/check-spec-purity.py`, `scripts/forge-root.sh`), not the spec.

## `check-spec-purity.py` — CLI

```
python3 check-spec-purity.py [--root DIR]
```

| Flag         | Default                    | Description        |
| ------------ | -------------------------- | ------------------ |
| `--root DIR` | parent of the script's dir | Repo root to scan. |

### Exit codes

| Code | Meaning                                                                                                                                                          |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | Canon clean — zero violations. Prints `spec-purity: PASS — 0 violations across canonical surfaces.`                                                              |
| `1`  | One or more violations. Prints `spec-purity: FAIL — N violation(s):`, one `  <path>: <reason>` line each, then a `spec-purity: by rule — <rule>=<n>, ...` tally. |
| `2`  | Usage error (argparse).                                                                                                                                          |

Output is deterministic: violations are sorted by `(path, rule.value, reason)`, so repeated
runs over an unchanged tree are byte-identical.

### Reason strings (`VR_*` constants)

Emitted verbatim (single source of truth; never re-typed inline). Placeholder forms are
filled with `str.format()` at emit time.

| Constant              | Rendered reason                                       |
| --------------------- | ----------------------------------------------------- |
| `VR_DISALLOWED_KEY`   | `disallowed frontmatter key '{key}'`                  |
| `VR_MISSING_REQUIRED` | `missing required frontmatter key '{key}'`            |
| `VR_MALFORMED_FM`     | `malformed frontmatter block`                         |
| `VR_NAME_MISMATCH`    | `name '{name}' != directory '{dir}'`                  |
| `VR_RESIDUAL_VAR`     | `residual ${CLAUDE_PLUGIN_ROOT} in canonical surface` |
| `VR_BODY_LINES`       | `body {n} lines exceeds {limit}`                      |
| `VR_BODY_WORDS`       | `body {n} words exceeds {limit}`                      |
| `VR_PRELUDE_DRIFT`    | `bootstrap prelude not byte-identical to canon`       |

## `check-spec-purity.py` — module constants

```python
# Frontmatter schema (REQ-FM-01)
REQUIRED_FRONTMATTER_KEYS = {"name", "description"}
OPTIONAL_FRONTMATTER_KEYS = {"license", "compatibility", "metadata", "allowed-tools"}
ALLOWED_FRONTMATTER_KEYS  = REQUIRED_FRONTMATTER_KEYS | OPTIONAL_FRONTMATTER_KEYS

# Size budget (REQ-SIZE-03, decision D1)
MAX_BODY_LINES = 300
MAX_BODY_WORDS = 5000

# Scanned surfaces — recursive patterns end in /**/* (a bare /** matches dirs only)
CANONICAL_SURFACES = (
    "skills/**/SKILL.md",
    "skills/**/references/**/*",
    "references/**/*",
    "agents/*.md",
)

# Residual-var rule exemptions, matched with fnmatch on the repo-relative POSIX path
RESIDUAL_VAR_EXEMPT = (
    "scripts/forge-root.sh",                      # the single sanctioned residual
    "hooks/hooks.json",                           # out-of-canon Claude artifact
    "specs/**", "plans/**", "docs/**",            # feature-forge's own forge artifacts
    "references/vendor-construct-inventory.md",   # REQ-VND-03 audit prose (in-canon, by name)
)
```

### `class Rule(str, enum.Enum)`

The `(str, enum.Enum)` mixin is used rather than 3.11's `enum.StrEnum` for the repo's
Python 3.10 baseline; `.value` is a plain `str`.

| Member             | `.value`           | Rule |
| ------------------ | ------------------ | ---- |
| `FRONTMATTER_KEYS` | `frontmatter-keys` | 1    |
| `NAME_MATCHES_DIR` | `name-matches-dir` | 2    |
| `NO_RESIDUAL_VAR`  | `no-residual-var`  | 3    |
| `BODY_SIZE`        | `body-size`        | 4    |
| `PRELUDE_IDENTITY` | `prelude-identity` | 5    |

### Key functions

| Function                                      | Contract                                                                                                                                                 |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `iter_canonical_files(root) -> list[Path]`    | Every readable file under `CANONICAL_SURFACES`, deduped, sorted by POSIX path.                                                                           |
| `read_frontmatter(text)`                      | Hand-rolled stdlib reader; tolerant of colon-values, folded scalars, nested `metadata`, blank lines, CRLF; reports (never crashes on) a malformed block. |
| `collect_violations(root) -> list[Violation]` | Runs all five rules; returns the union sorted by `(path, rule.value, reason)`.                                                                           |
| `report(violations) -> int`                   | Prints the human-readable report (REQ-OBS-01); returns the exit code.                                                                                    |

## `forge-root.sh` — resolver contract

```
scripts/forge-root.sh        # takes no arguments
```

| Aspect           | Behavior                                                                                                                                                   |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Success          | Prints the absolute plugin root to **stdout**, exits `0`.                                                                                                  |
| Failure          | Writes `feature-forge: cannot locate plugin root. Set CLAUDE_PLUGIN_ROOT or run from an installed skill dir.` to **stderr**, exits `1`.                    |
| Safety           | Never sources or executes a discovered path — only prints a directory (REQ-SEC-01). Resolution bounded to the candidate roots + the script's own location. |
| Root predicate   | `is_root(dir)` is true iff **both** `dir/scripts/epic-manifest.py` and `dir/.claude-plugin/plugin.json` exist.                                             |
| Resolution order | self-location → candidate probe (`~/.claude/skills/feature-forge`, `~/.claude/plugins/*/feature-forge`) → `$CLAUDE_PLUGIN_ROOT` fallback → fail.           |

### Bootstrap prelude (canonical)

Reproduced byte-identically wherever a bundled script is invoked (canon home:
`references/portable-root.md`; enforced by checker rule 5):

```bash
R="$(for d in "$HOME"/.claude/skills/feature-forge "$HOME"/.claude/plugins/*/feature-forge; do [ -x "$d/scripts/forge-root.sh" ] && exec "$d/scripts/forge-root.sh"; done)"
[ -n "$R" ] || { echo "feature-forge: cannot locate plugin root" >&2; exit 1; }
```

## Tests

| Suite                             | Covers                                                                                                                                                                                                                           |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/test_check_spec_purity.py` | Clean canon (exit 0); one impure fixture per rule; word-limit + both-limbs body-size; both-direction prelude; six reader-robustness corners; references/-tree scan regression; inventory exemption; deterministic sorted output. |
| `tests/test_forge_root.py`        | Self-location, total failure, env fallback, candidate probe — failure/fallback/probe cases run with a redirected `HOME` so the dev `~/.claude` symlink can't false-pass.                                                         |
