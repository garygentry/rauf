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
