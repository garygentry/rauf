# Integration Guide

This guide covers the maintenance tasks this feature's surface enables:
reproducing CI locally, adding a gate, adding a per-agent setup doc, changing the
synced version, extending the eval, and (eventually) cutting a release.

Everything below assumes the two-repo layout: `rauf/` (this repo) and
`feature-forge/` checked out as siblings (`../feature-forge`).

## Reproduce the full CI locally

CI never does anything you cannot reproduce on your machine — that is the point of
routing through `validate.sh` / `pnpm gate`.

```bash
# feature-forge per-PR gate (what ci.yml runs)
cd ../feature-forge
python3 -m venv .venv-adapters && .venv-adapters/bin/pip install -r scripts/requirements-adapters.txt
pip install ruff pytest
bash scripts/validate.sh
shellcheck scripts/*.sh
ruff check scripts/ eval/
python3 scripts/check-version-sync.py

# OS-matrix leg (what os-matrix.yml runs on each OS)
cd installer && npm ci && npm run build && cd ..
node installer/dist/cli.js install --dry-run --skip-rauf --json
node installer/dist/cli.js uninstall -y --skip-rauf

# rauf gate (unchanged by this feature, but it must stay green)
cd ../rauf && pnpm gate
```

If a gate passes locally and fails in CI (or vice-versa), that is a **bug in the
provisioning**, not in your change — the gate logic is identical. Check the
composite action's tool-install steps first.

## Add a new blocking gate

Gates live in the **composite action**, never inline in a workflow YAML. To add one
to feature-forge:

1. If the check is something a contributor should run locally, add it to
   `scripts/validate.sh` (preferred — keeps one source of truth). Only add a step
   directly to `.github/actions/quality-gate/action.yml` when it is genuinely
   CI-only (e.g. needs a tool you don't want every contributor to install).
2. Make the step **fail loudly** with an actionable message (REQ-OBS-01) — print
   the offending file/line/value, not just a non-zero exit.
3. Keep the per-PR gate fast (REQ-PERF-01). If the check is slow (like the OS
   matrix), give it its own workflow so a green required-check set can be tuned
   independently.

```yaml
# .github/actions/quality-gate/action.yml — add as the last step
- name: my-new-gate
  shell: bash
  run: python3 scripts/my-new-gate.py # exits non-zero + prints the conflict on failure
```

Mirror the same shape in rauf's `.github/actions/quality-gate` if the gate applies
there too — the two composites are intentionally parallel, not shared.

## Add or update a per-agent setup doc

The five docs live at `feature-forge/docs/agents/{claude,codex,copilot,cursor,gemini}.md`
and each is linked from the README's per-surface table.

When adding a sixth agent (or revising one), each doc MUST cover:

- **Install** — the installer invocation (`npx feature-forge install -a <agent>`)
  and/or the adapter location (`adapters/<agent>/`).
- **First-use check** — a confirmation step (list installed skills, invoke a forge
  skill).
- **Install path** — derive it from `npx feature-forge install -a <agent> --dry-run --json`,
  **not** from an asserted config-dir convention (only Claude's `~/.claude` is
  treated as well-known; the others are best-known/unverified).

Then add the row to the README per-surface table:

```markdown
| <Agent> | `npx feature-forge install -a <agent>` | [docs/agents/<agent>.md](docs/agents/<agent>.md) |
```

> **REQ-README-03 / SC-08:** every command, agent name, and path shown in either
> README must resolve to a real artifact. After editing, `ls`-confirm each
> referenced `docs/agents/*.md` and `adapters/<agent>/` path, and run the installer
> `--dry-run` to confirm the commands work. No aspirational instructions — the one
> sanctioned exception is the `npx rauf@0.6.0` path, which must be explicitly
> labeled "available once rauf 0.6.0 is published."

## Change the synced version

To bump feature-forge from `0.10.0` to the next version, change **all three** synced
fields, respecting how each is reconciled:

```bash
cd ../feature-forge
# 1. plugin.json — hand-edit "version"
# 2. marketplace.json — hand-edit plugins[0].version
# 3. gemini-extension.json — NEVER hand-edit (DO-NOT-EDIT header). Bump the constant:
#    edit GEMINI_EXTENSION_VERSION in scripts/build-adapters.py, then regenerate:
python3 scripts/build-adapters.py
# 4. verify they agree
python3 scripts/check-version-sync.py    # exit 0 = synced
```

Leave `installer/package.json` alone — it is an independent line. rauf's version is
also independent (single source in `packages/core/src/version.ts`, checked by
`pnpm version:check`); there is **no** requirement that the two repos share a number.

## Add a trigger-accuracy fixture

```bash
cd ../feature-forge
cat > eval/fixtures/<skill-name>.json <<'JSON'
{
  "skill": "<skill-name>",
  "shouldTrigger": ["a prompt that should route here", "another"],
  "shouldNotTrigger": ["a prompt that should NOT route here"]
}
JSON
ANTHROPIC_API_KEY=sk-... python3 eval/run-eval.py    # runs locally; advisory only
```

The `skill` value must match an existing `skills/<name>/` directory (the harness
raises on an unknown skill). The eval never blocks a PR — to see its score on
CI, trigger the workflow manually (`workflow_dispatch`) or wait for the weekly run.

## Cut a release (maintainer, manual)

This feature ships the **machinery**, not a release. When ready to publish rauf:

1. Confirm `pnpm gate` is green and the version is set (`packages/core/src/version.ts`).
2. Trigger `.github/workflows/npm-publish.yml` via `workflow_dispatch` (it is
   intentionally **not** on the PR gate).
3. Resolve OQ-A (the published distribution form — Bun-required npm package vs.
   compiled binary) when authoring the actual publish step; the Bun shebang means a
   plain `npm install` needs Bun present.
4. Once rauf `0.6.0` is published, the installer's `npx rauf@0.6.0` provisioning
   path becomes live and the "available once published" caveats in the docs can be
   dropped.

Marketplace submission/refresh for the Claude plugin is a separate manual step —
this feature documents the marketplace install but does not submit the entry.

## When to use / when NOT to use this surface

**Use it when:**

- You are adding or changing a CI gate, a per-agent doc, or the version, and need it
  to behave identically locally and in CI.
- You need to verify the assembled cross-agent system still installs and validates
  before relying on it.

**Do NOT reach for it when:**

- You are changing a _skill's behavior_ — edit the canonical `skills/*/SKILL.md`
  (owned by `forge-skill-spec-purity`); the gates here will validate it.
- You are changing _adapter output_ — edit the generator
  (`forge-agent-adapters-build`); never hand-edit `adapters/`, the regen-diff gate
  will reject it.
- You are changing _installer behavior_ — that is `cross-agent-installer`; this
  feature only exercises the installer in CI.
- You want to _publish_ — that is a deliberate manual step, not part of the gate.
