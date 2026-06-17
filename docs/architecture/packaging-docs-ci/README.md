# Packaging, Docs & CI (Release-and-CI Gates)

This is the **capstone** of the `agent-agnostic` epic (feature 6 of 6). The five
preceding features assembled a cross-agent system — a spec-pure canonical skill
set, a generator that derives per-agent adapters, a cross-platform installer that
bundles rauf, and a forge↔rauf loop integration. Each was built and verified in
isolation. This feature makes the **assembled whole shippable, discoverable, and
regression-proof**: it stands up CI gates, authors the user-facing docs, and
finalizes cross-OS hygiene, versioning, and licensing across **both repos**
(`rauf` and `feature-forge`).

It is overwhelmingly a **wiring + authoring** feature, not a new-engine feature.
The substantive validators already exist (`feature-forge/scripts/validate.sh` and
rauf's `pnpm gate`). The capstone's job is to (a) run those validators on every PR
via GitHub Actions, (b) author the small set of genuinely-missing artifacts (a
SKILL.md JSON Schema, lint gates, an OS-matrix installer job, a trigger-accuracy
eval harness, a version-sync gate), (c) author the READMEs + five per-agent setup
docs, and (d) finalize `.gitattributes`, MIT licensing, and version reconciliation.

> **Where the artifacts live.** This feature has **no importable code API**. Its
> surface is the `release-and-ci-gates` contract — a set of files spread across two
> working trees:
>
> - **feature-forge** (`../feature-forge`): `.github/workflows/{ci,os-matrix,eval}.yml`,
>   `.github/actions/quality-gate/action.yml`, `references/skill-frontmatter.schema.json`,
>   `scripts/check-version-sync.py`, `ruff.toml`, `.shellcheckrc`, `eval/run-eval.py`
>   + `eval/fixtures/`, `docs/agents/{claude,codex,copilot,cursor,gemini}.md`,
>   `README.md`, `LICENSE`, `.gitattributes`, `CHANGELOG.md`.
> - **rauf** (this repo): `.gitattributes`, `README.md` cross-agent section,
>   `.github/workflows/npm-publish.yml` (manual-dispatch publish machinery),
>   `CHANGELOG.md`.
>
> The pipeline/backlog state for the feature lives in **this** repo
> (`specs/agent-agnostic/packaging-docs-ci/`), but the bulk of the edits land in
> feature-forge — see [architecture.md](./architecture.md#the-two-repo-reality).

## Quick Start

There is nothing to import or call. You interact with this feature by **running the
gates locally** (the same gates CI runs) and by **reading the install docs**.

Run the full feature-forge per-PR gate exactly as CI does:

```bash
cd ../feature-forge
bash scripts/validate.sh        # aggregate gate: plugin-validate, schema purity, adapters regen-diff, traceability, installer build+test
shellcheck scripts/*.sh         # REQ-CI-03 shell lint
ruff check scripts/ eval/       # REQ-CI-03 python lint
python3 scripts/check-version-sync.py   # REQ-CI-05 version-sync (the three fields agree at 0.10.0)
```

Run rauf's half of the gate (unchanged by this feature, but it must stay green):

```bash
# in this repo
pnpm gate                       # build + schema:check + version:check + typecheck + lint + format:check + test
```

Preview an installer plan the way the OS-matrix CI leg does (writes nothing):

```bash
cd ../feature-forge/installer && npm ci && npm run build
node dist/cli.js install --dry-run --skip-rauf --json   # plan only, no rauf preflight
```

## Key Concepts

- **Two repos, one capstone.** The feature edits both `rauf` and `feature-forge`.
  Each repo owns a **parallel, structurally-similar** CI surface (a composite
  "quality-gate" action invoked by a thin workflow) rather than sharing a
  cross-repo reusable workflow — see [api-reference.md](./api-reference.md).
- **The workflow is a thin runner.** CI never reimplements gate logic in YAML. It
  calls the same `validate.sh` / `pnpm gate` a contributor runs locally, so CI and
  local can never drift.
- **Blocking vs. advisory.** The deterministic gates (`ci.yml`) and the OS-matrix
  installer gate (`os-matrix.yml`) **block** PRs. The trigger-accuracy eval
  (`eval.yml`) is **advisory** — it runs on demand + weekly, never on `pull_request`,
  and never fails a PR.
- **Spec-purity is load-bearing.** No gate, schema, or version mechanism may
  reintroduce vendor keys or a `version` field into a canonical `SKILL.md`. The
  SKILL.md schema's `additionalProperties: false` mechanically enforces this;
  versions live in manifests only.
- **Machinery, not a release.** This feature ships the *ability* to publish (npm
  packaging prep + a manual `npm-publish.yml`) and to install via `npx rauf@0.6.0`,
  but it does **not** run a publish. CI uses `--skip-rauf` because rauf is still
  unpublished.

## What is gated

| Gate | Workflow | Blocking? | Requirement |
|---|---|---|---|
| `claude plugin validate --strict` (or documented equivalent) | `ci.yml` → `validate.sh` | yes | REQ-CI-01 |
| SKILL.md schema validation (`name`/`description`, `name == dir`) | `ci.yml` → `validate.sh` | yes | REQ-CI-02 |
| shellcheck + ruff | `ci.yml` | yes | REQ-CI-03 |
| Adapters regenerate-and-diff | `ci.yml` → `validate.sh` (`build-adapters.py --check`) | yes | REQ-CI-04 |
| Version-sync (3 fields → `0.10.0`) | `ci.yml` → `check-version-sync.py` | yes | REQ-CI-05 |
| Existing spec-purity / traceability / installer build+test | `ci.yml` → `validate.sh` | yes | REQ-CI-06 |
| Installer `--dry-run` + `uninstall` on Ubuntu/macOS/Windows | `os-matrix.yml` | yes | REQ-CI-07/08 |
| Trigger-accuracy eval | `eval.yml` | **no (advisory)** | REQ-EVAL-01/02 |

## Configuration

This feature introduces no runtime configuration. The values it pins:

- **Reconciled feature-forge version:** `0.10.0` across `.claude-plugin/plugin.json`,
  `.claude-plugin/marketplace.json` (`plugins[0].version`), and the generated
  `adapters/gemini/gemini-extension.json`. `installer/package.json` is a separately
  published sub-package and is **excluded** from the sync gate.
- **Lint floor:** shellcheck `error`+`warning`; ruff `E`/`F`/`W`, line-length 100.
- **Eval cadence:** `workflow_dispatch` + weekly `cron: "0 6 * * 1"`, model pinned
  to `claude-haiku-4-5-20251001`, `max_tokens` 64.
- **Licensing:** MIT in both repos (deliberate divergence from the charter's
  Apache-2.0 — see the PRD's REQ-CONS-03).

## Further Reading

- [Architecture](./architecture.md) — the two-repo wiring, the gate data flow, and the
  composite-action pattern.
- [API Reference](./api-reference.md) — every gate, the SKILL.md schema, the
  version-sync contract, and the CLI/CI contracts this feature consumes.
- [Integration Guide](./guides/integration.md) — how to add a gate, add a per-agent
  doc, reproduce CI locally, and (eventually) cut a release.
- Epic overview: [agent-agnostic](../agent-agnostic/README.md) — how this capstone
  sits atop the other five features.
