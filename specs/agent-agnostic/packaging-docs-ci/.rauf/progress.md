# Progress — packaging-docs-ci

## Item 001 (SKILL.md frontmatter schema + schema-driven check-spec-purity.py)

- All deliverables live in `../feature-forge`, not rauf. Edits left in that repo's working tree.
- **Schema-root vs scan-root gotcha:** `_load_frontmatter_key_sets` must resolve the schema from the
  script's own repo root (`Path(__file__).resolve().parent.parent`), NOT from `args.root`. The
  existing subprocess fixture tests pass `--root <tmp fixture tree>` which carries no schema; using
  `args.root` makes the loader SystemExit and breaks ~21 pre-existing tests. The frontmatter key set
  is a property of the canon, independent of which tree is scanned.
- **importlib for the hyphenated module:** `tests/test_check_spec_purity.py` loads `check-spec-purity.py`
  via `importlib.util.spec_from_file_location`; must `sys.modules[spec.name] = module` before
  `exec_module` or dataclass annotation resolution (`from __future__ import annotations`) fails.
- `bash scripts/validate.sh` exits 1 overall on a clean tree too — that's the pre-existing **adapters
  regen-diff (step 6b)** drift from the gemini 0.0.0 desync (item 012 fixes it). Step 6a (spec-purity)
  passes. Don't chase the overall exit-1.
- zsh `cp` is aliased to `cp -i` (interactive) — use `/bin/cp -f` for non-interactive restores.

## Item 003 (lint floors .shellcheckrc + ruff.toml + fix scripts/ violations)

- **Tooling was absent on this host** — installed ad hoc: `pip install ruff` (0.15.17) and
  `apt-get install shellcheck` (0.8.0). Needed before any of the criteria can run.
- **shellcheck 0.8.0 does NOT honor the `severity=warning` directive in `.shellcheckrc`** — info-level
  findings still make `shellcheck scripts/*.sh` exit 1 even with the spec's exact rc. Do NOT rely on the
  severity floor to suppress them on this version. Instead I FIXED the 3 SC2295 (info) findings in
  validate.sh using shellcheck's own suggested quoting `${VAR#"$REPO_ROOT"/}` (behavior-identical for
  normal paths). Global `disable=` in the rc is forbidden by criterion 5, so fixing is the right call.
- **ruff E501 (12 hits) were ALL in sibling-owned `epic-manifest.py`** — scoped each with a per-line
  `# noqa: E501` (spec 02 §4.3 explicitly blesses this carve-out for the sibling files), zero behavior
  risk vs. reflowing someone else's message strings. Floor stays E/F/W; nothing removed.
- **Criterion 4 ("validate.sh still exits 0") cannot be met literally** — validate.sh exits 1 from the
  PRE-EXISTING step-6b adapters regen-diff drift (gemini 0.0.0 desync → item 012, PLUS item 001's
  `references/skill-frontmatter.schema.json` not yet regenerated into `adapters/*/references/`).
  Proven not-my-fault via `git stash` → validate still exits 1 with the identical "out of date" error.
  The criterion's true intent ("no behavior change from lint fixes") IS satisfied: my validate.sh diff is
  only the 3 quote fixes and all frontmatter/permission steps still PASS.
- **feature-forge changes accumulate UNCOMMITTED across items** — the loop commits in rauf, not the
  sibling repo. `git diff` in feature-forge shows item 001's edits + item 003's together; that's expected
  for this cross-repo epic, not stray work.
