# API Reference

This feature exposes **no programmatic API**. Its public surface is the
`release-and-ci-gates` contract: the CI gates, the SKILL.md schema artifact, the
version-sync gate, the advisory eval harness, and the CLI/CI commands it consumes.
This reference documents each of those as a contract a contributor or maintainer
interacts with.

## CI Gates

### Deterministic per-PR gate — `ci.yml`

**Triggers:** `pull_request`, `push` to `main`.
**Blocking:** yes. **Permissions:** `contents: read` (no secrets).

`ci.yml` is a thin runner — checkout, then `uses: ./.github/actions/quality-gate`.
The composite action (`.github/actions/quality-gate/action.yml`) runs, in order:

1. Provision Node 20 and Python 3.11; `pip install ruff pytest`; best-effort
   `npm install -g @anthropic-ai/claude-code`.
2. Provision the isolated adapter venv: `python3 -m venv .venv-adapters` +
   `pip install -r scripts/requirements-adapters.txt` (PyYAML).
3. Ensure `shellcheck` is present.
4. `bash scripts/validate.sh` — the aggregate gate (see below).
5. `shellcheck scripts/*.sh`.
6. `ruff check scripts/ eval/` (falls back to `ruff check scripts/` if `eval/` is absent).
7. `python3 scripts/check-version-sync.py`.

> **`pytest` is required, not optional.** `validate.sh`'s schema↔checker anti-drift
> test soft-skips when pytest is absent, so the composite action installs it — else
> the drift guard silently no-ops on the runner.

### `bash scripts/validate.sh` — the aggregate gate

The single source of truth contributors run locally and CI runs verbatim. It
delivers, in one call:

| Step                                                                     | Gate                                               | Requirement |
| ------------------------------------------------------------------------ | -------------------------------------------------- | ----------- |
| `claude plugin validate --strict` (or documented JSON+schema equivalent) | plugin manifest validity                           | REQ-CI-01   |
| `check-spec-purity.py`                                                   | SKILL.md schema purity + `name == dir`             | REQ-CI-02   |
| `build-adapters.py --check`                                              | adapters regenerate-and-diff (no drift from canon) | REQ-CI-04   |
| marketplace/plugin JSON checks, agent-frontmatter, script perms          | existing validators                                | REQ-CI-06   |
| `validate-traceability.py`                                               | spec traceability                                  | REQ-CI-06   |
| `installer/`: `npm ci && build && test`                                  | installer build+test                               | REQ-CI-06   |

**`claude plugin validate --strict` (REQ-CI-01):** attempted first (the composite
action installs the CLI). If the CLI cannot be installed on the runner, REQ-CI-01's
"or the documented equivalent" clause covers the fallback — the existing
marketplace/plugin JSON validation plus the SKILL.md schema gate — logged via
`::notice::`, never a silent skip.

### OS-matrix installer gate — `os-matrix.yml`

**Triggers:** `pull_request`, `push` to `main`.
**Blocking:** yes. **Matrix:** `ubuntu-latest`, `macos-latest`, `windows-latest`
with `fail-fast: false`.

Each leg builds the installer (`cd installer && npm ci && npm run build`) then runs:

```bash
# LEG 1 — plan only, no writes, no rauf preflight; assert exit 0 + valid JSON
node installer/dist/cli.js install --dry-run --skip-rauf --json | tee dry-run.json
node -e "JSON.parse(require('node:fs').readFileSync('dry-run.json','utf8'))"

# LEG 2 — exercise the uninstall path non-interactively
node installer/dist/cli.js uninstall -y --skip-rauf

# LEG 3 (Linux/macOS ONLY) — exercise the symlink plan path
node installer/dist/cli.js install --symlink --dry-run --skip-rauf --json
```

- `--skip-rauf` is **mandatory on every leg**: rauf is unpublished, so the rauf
  registry preflight would otherwise fail the gate for an out-of-scope reason.
- **Windows (REQ-CI-08):** the Windows leg never passes `--symlink` (the installer
  is copy-by-default on Windows). Leg 3 is guarded with `if: runner.os != 'Windows'`.
- JSON is validated with `node -e` (not `jq`/`python`) because Node is the only
  interpreter guaranteed present across all three runners.

### Advisory trigger-accuracy eval — `eval.yml`

**Triggers:** `workflow_dispatch` + weekly `schedule` (`cron: "0 6 * * 1"`).
**Blocking:** **no.** **Secret:** `ANTHROPIC_API_KEY` (from repo/org settings).

Runs `python3 eval/run-eval.py`. Never runs on `pull_request`; never fails a PR. If
the secret is absent (e.g. on a fork) the harness prints `skipped (no key)` and
exits 0.

## `references/skill-frontmatter.schema.json`

The declarative **source of truth** for the spec-sanctioned SKILL.md frontmatter.
JSON Schema draft 2020-12:

```jsonc
{
  "type": "object",
  "required": ["name", "description"],
  "additionalProperties": false, // mechanically enforces spec-purity
  "properties": {
    "name": { "type": "string" },
    "description": { "type": "string" },
    "license": { "type": "string" },
    "compatibility": {},
    "metadata": { "type": "object" },
    "allowed-tools": {},
  },
}
```

- The 6-key allowed set is exactly the spec-pure set from `forge-skill-spec-purity`.
- **No `version` key** (REQ-VER-03): versions live in manifests only.
- `check-spec-purity.py` **loads** its allowed/required key sets from this file
  (stdlib `json`). A pytest case asserts the checker's loaded set equals this
  schema's `properties` keys, preventing drift.
- The two checks JSON Schema cannot express — `name == <directory name>` and the
  `${CLAUDE_PLUGIN_ROOT}` / prelude / size rules — remain in Python.

## `scripts/check-version-sync.py`

Asserts feature-forge's three version fields are byte-equal (REQ-CI-05).

**Synced fields:**

| File                                    | Accessor             |
| --------------------------------------- | -------------------- |
| `.claude-plugin/plugin.json`            | `version`            |
| `.claude-plugin/marketplace.json`       | `plugins[0].version` |
| `adapters/gemini/gemini-extension.json` | `version`            |

**Excluded:** `installer/package.json` (independent release line).

**Usage:**

```bash
python3 scripts/check-version-sync.py [--root DIR]   # default root: parent of the script dir
```

**Exit codes:** `0` = all three agree · `1` = mismatch (prints each conflicting
file+value, REQ-OBS-01) · `2` = a field missing/unreadable (config error).

By design the gate **fails on the live desync** until reconciliation lands, then
passes at `0.10.0` (SC-03).

## `eval/run-eval.py`

Advisory trigger-accuracy harness. For each `eval/fixtures/<skill>.json`:

```jsonc
{ "skill": "forge-1-prd", "shouldTrigger": ["…prompt…"], "shouldNotTrigger": ["…prompt…"] }
```

it asks a pinned low-cost model (`claude-haiku-4-5-20251001`, `max_tokens` 64) to
route the prompt to one skill from the canonical `skills/*/SKILL.md` descriptions,
then scores a should-trigger case correct when the expected skill is chosen and a
should-not-trigger case correct when it is _not_.

**Usage:**

```bash
python3 eval/run-eval.py            # human-readable per-skill + overall accuracy
python3 eval/run-eval.py --json     # machine-readable report
```

**Exit codes:** always `0` for a low score or an absent `ANTHROPIC_API_KEY`
(advisory — REQ-EVAL-02). The only non-zero exit is a harness bug (bad fixture).
The `anthropic` SDK is imported **only** when a key is present, keeping the
absent-key path dependency-free.

## CLI / CI contracts consumed (not defined here)

These commands are owned by upstream features; this capstone runs and documents them.

| Command                                                           | Purpose                      | Owning contract             |
| ----------------------------------------------------------------- | ---------------------------- | --------------------------- |
| `bash scripts/validate.sh`                                        | feature-forge aggregate gate | existing                    |
| `python3 scripts/build-adapters.py [--check]`                     | regen / drift-guard          | `adapters-output`           |
| `node installer/dist/cli.js install --dry-run --skip-rauf --json` | OS-matrix plan               | `cross-agent-installer-cli` |
| `node installer/dist/cli.js uninstall -y --skip-rauf`             | OS-matrix uninstall          | `cross-agent-installer-cli` |
| `python3 scripts/check-spec-purity.py`                            | schema/purity gate           | `spec-pure-skills`          |
| `pnpm gate` / `pnpm version:check` (rauf)                         | rauf gate (unchanged)        | existing                    |

### Installer flags exercised

`install`(alias `add`) / `update` / `uninstall`(alias `remove`) / `list`(alias `ls`);
`-a/--agent`, `-g/--global`, `--symlink`, `--force`, `--dry-run`, `-y/--yes`,
`--json`, `--skip-rauf`, `-h/--help`, `--version`. Exit codes `0`/`1`/`2`. The
detection map: claude→`~/.claude`, codex→`~/.codex`, copilot→`~/.copilot`,
cursor→`~/.cursor`, gemini→`~/.gemini`.

> **Unverified config dirs.** The cross-agent-installer spec marks the
> codex/copilot/cursor/gemini destinations as "best-known, not source-verified."
> The per-agent docs therefore derive the install path from the installer's
> `--dry-run --json` output rather than asserting an agent's config convention.

## Cross-OS & packaging artifacts

| Artifact                            | Repo(s) | Notes                                                                                                                                                           |
| ----------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.gitattributes`                    | both    | `* text=auto eol=lf`; `*.png`/`*.jpg` binary; `export-ignore` for `specs/`, `tests/`, `.github/` (+ `eval/`,`plans/` in feature-forge; `test-sandbox/` in rauf) |
| `LICENSE` (MIT)                     | both    | feature-forge net-new; rauf already MIT                                                                                                                         |
| `CHANGELOG.md`                      | both    | feature-forge `[0.10.0]`; rauf `## Unreleased`                                                                                                                  |
| `.github/workflows/npm-publish.yml` | rauf    | `workflow_dispatch`-only publish machinery; **no live publish**                                                                                                 |
| `package.json` publishability prep  | rauf    | metadata only (`publishConfig`/`files`/`bin`); no `version` change                                                                                              |
