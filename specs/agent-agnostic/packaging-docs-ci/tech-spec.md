# packaging-docs-ci — Technical Specification

> **Epic:** `agent-agnostic` — capstone (6 of 6). Depends on `cross-agent-installer`,
> `forge-rauf-loop-default`, `forge-agent-adapters-build`, `forge-skill-spec-purity` (all complete).
> **Exposes:** `release-and-ci-gates`.
>
> **Based-on versions:** `forge-1-prd` v1.

## 1. Overview

This is the capstone that makes the assembled cross-agent system **shippable, discoverable, and
regression-proof** across the two repos — `rauf` (this repo) and `feature-forge` (`../feature-forge`).
It is overwhelmingly a **wiring + authoring** feature, not a build-new-engine feature: the substantive
validators already exist and are exercised today by `feature-forge/scripts/validate.sh` and
`rauf`'s `pnpm gate`. The capstone's job is to (a) stand up the CI workflows that run those validators
on every PR, (b) author the small set of genuinely-missing artifacts (a SKILL.md JSON Schema, lint
gates, an OS-matrix installer job, a trigger-accuracy eval harness), (c) author user-facing docs
(READMEs + five per-agent setup docs), and (d) finalize cross-OS hygiene, versioning, and licensing.

### Key architectural decisions (settled in interview)

1. **rauf-on-npm = machinery + documented gap (not a live publish).** The installer pins
   `RAUF_PIN = "rauf@0.6.0"` and provisions via lazy `npx rauf@0.6.0`, but rauf is `private:true`
   and unpublished. This feature adds the rauf npm-packaging *prerequisites* (so a maintainer *can*
   publish) and documents the `npx` path as "available once rauf 0.6.0 is published," but does **not**
   execute the publish (honoring PRD §6). CI installer dry-runs pass `--skip-rauf` to avoid the
   registry preflight. (Reconciles IR-2 / C-7 against PRD §6.)
2. **Version-sync = the three REQ-CI-05 fields → `0.10.0`; `installer/package.json` stays
   independent.** `installer/` is a separately npm-published sub-package with its own release cadence.
3. **SKILL.md schema = one declarative JSON Schema as source of truth; `check-spec-purity.py` reads
   it.** No new validator, no new dependency, no drift. `name==dir` (inexpressible in plain JSON
   Schema) stays in Python.
4. **Lint gates = feature-forge only.** shellcheck over its 4 shell scripts, ruff over its 4 Python
   scripts. rauf's shell corpus is out of REQ-CI-03 scope.
5. **Per-agent docs = `feature-forge/docs/agents/<agent>.md`**, mirroring the `adapters/<agent>/`
   naming.
6. **Trigger-accuracy eval = LLM-judged Python harness**, non-blocking, on `workflow_dispatch` +
   weekly `schedule`, reading `ANTHROPIC_API_KEY` from CI secrets.
7. **Shared CI = pattern-reuse, not cross-repo reusable workflows.** Each repo owns a parallel
   `quality-gate`-style composite action (REQ-CIINFRA-02 is P1 SHOULD; true cross-repo factoring is a
   heavy lift for little gain — see §3.9).

### Cross-repo reality (REQ-CONST-02)

The pipeline/backlog state lives in **this** repo (`rauf/specs/agent-agnostic/packaging-docs-ci/`),
but the implementation edits files in **both** working trees:
- **feature-forge** (`../feature-forge`): all of `.github/`, README, `docs/agents/`, `LICENSE`,
  `.gitattributes`, the SKILL.md schema, the eval harness, the version reconciliation, the lint
  configs, CHANGELOG.
- **rauf** (`.`): `.gitattributes`, README cross-agent link, CHANGELOG, npm-packaging prep + publish
  workflow.

Backlog items must declare which repo each touches; the loop runner commits in the rauf repo, so
feature-forge edits are staged/committed per the cross-repo loop technique already used by sibling
features (see `[[forge_crossrepo_loop_execution]]`-style handling in this epic).

## 2. Module Structure

Nothing in this feature is a conventional importable package. The "module" is the union of CI
workflows, config files, schema artifacts, scripts, and docs across both repos. Project locations:

### feature-forge (`../feature-forge`)

```
.github/
  workflows/
    ci.yml                       # NEW — per-PR blocking gate (deterministic)
    os-matrix.yml                # NEW — installer dry-run + uninstall on ubuntu/macos/windows
    eval.yml                     # NEW — advisory trigger-accuracy (workflow_dispatch + schedule)
  actions/
    quality-gate/action.yml      # NEW — composite: provision venv + `bash scripts/validate.sh` + lint
references/
  skill-frontmatter.schema.json  # NEW — declarative SKILL.md frontmatter JSON Schema (source of truth)
scripts/
  check-spec-purity.py           # EDIT — load allowed/required keys from the schema (stdlib)
  lint-shell.sh                  # NEW (thin) — shellcheck wrapper over scripts/*.sh
  build-adapters.py              # EDIT — bump GEMINI_EXTENSION_VERSION 0.0.0 → 0.10.0 (REQ-VER-02)
  requirements-adapters.txt      # (unchanged) PyYAML pin; ruff installed separately in CI
ruff.toml                        # NEW — ruff config (rule floor)
.shellcheckrc                    # NEW — shellcheck config (rule floor / disables)
eval/
  run-eval.py                    # NEW — LLM-judged trigger-accuracy harness
  fixtures/<skill>.json          # NEW — per-skill should-trigger / should-not-trigger cases
docs/
  agents/{claude,codex,copilot,cursor,gemini}.md   # NEW — per-agent setup docs
.claude-plugin/
  plugin.json                    # EDIT — 0.10.0 (already); confirm
  marketplace.json               # EDIT — 0.9.0 → 0.10.0 (REQ-VER-02)
adapters/gemini/gemini-extension.json              # REGENERATED — 0.0.0 → 0.10.0 (via generator)
README.md                        # REWRITE — (a)→(b)→(c) install-first structure
LICENSE                          # NEW — MIT
.gitattributes                   # NEW — LF + export-ignore
CHANGELOG.md                     # EDIT — record this feature
AGENTS.md                        # (unchanged) hand-authored; referenced from docs
```

### rauf (this repo)

```
.gitattributes                   # NEW — LF + export-ignore
README.md                        # EDIT — add labeled cross-agent section linking feature-forge
CHANGELOG.md                     # EDIT — record this feature
.github/workflows/docs.yml       # (exists) — runs check:docs; the rauf README edit must keep it green
.github/workflows/release.yml    # (exists) — no live publish; npm-prep is package.json metadata only
package.json (chosen rauf target) # EDIT — npm-publishability prep (publishConfig/files/bin) on the ONE
                                 #   package that becomes published `rauf` (per OQ-A); NO version change, NO publish
.github/workflows/npm-publish.yml# NEW (optional, manual-dispatch only) — the publish *machinery*
```

> **Public API surface:** none in the code sense. The feature's "surface" is the
> `release-and-ci-gates` contract: the workflows, the schema artifact, the docs set, and the
> versioning/licensing/`.gitattributes` state in both repos.

## 3. Technical Decisions

### 3.1 feature-forge per-PR blocking gate — `ci.yml` + composite action (REQ-CI-01, -02, -03, -04, -05, -06, REQ-CIINFRA-01)

feature-forge has **no `.github/` today**. We add `ci.yml` triggered on `pull_request` and `push`,
delegating to a local composite action `.github/actions/quality-gate` (mirrors rauf's pattern, §3.9).
The composite action runs, in order:

1. **Provision** Python (with `ruff` + `jsonschema` if needed) and Node ≥18; create the
   `.venv-adapters` (PyYAML) the way `validate.sh` expects.
2. **`bash scripts/validate.sh`** — the existing aggregator. This single call already delivers:
   - `claude plugin validate --strict` **(REQ-CI-01)** — *currently NOT in validate.sh; this feature
     adds it as a validate.sh step* (see §3.1.1).
   - SKILL.md schema validation **(REQ-CI-02)** via `check-spec-purity.py`, now schema-driven (§3.3).
   - Adapters regenerate-and-diff **(REQ-CI-04, REQ-CONST-04)** via `build-adapters.py --check`
     (validate.sh step 6b) — generated adapters are derived, never hand-edited; the diff gate enforces it.
   - Spec-purity + existing validators **(REQ-CI-06)**: `check-spec-purity.py`, marketplace/plugin
     JSON checks, agent-frontmatter checks, script-permission checks, installer `npm ci && build &&
     test`. **Also wire `validate-traceability.py`** into validate.sh (it is standalone today).
3. **shellcheck + ruff** **(REQ-CI-03)** — see §3.4.
4. **Version-sync gate** **(REQ-CI-05)** — see §3.5.

**Why route through `validate.sh` rather than reimplement steps in YAML:** `validate.sh` is the
single source of truth contributors already run locally; duplicating its steps in YAML would let CI
and local drift. The workflow is a thin runner. (Mirrors rauf's `pnpm gate` → composite-action
pattern.)

#### 3.1.1 `claude plugin validate --strict` (REQ-CI-01)

`claude` CLI may not be present on a stock runner. The gate runs `claude plugin validate --strict`
when the CLI is available and **fails on validation error**; if the CLI cannot be installed in CI,
the documented equivalent is the existing marketplace/plugin JSON validation already in `validate.sh`
plus the SKILL.md schema gate. **Decision:** attempt `claude plugin validate --strict` first (install
the CLI in the composite action); REQ-CI-01's "or the documented equivalent" clause covers the
fallback, documented in the workflow comment. This keeps REQ-CI-01 a real gate, not a no-op.

### 3.2 OS-matrix installer gate — `os-matrix.yml` (REQ-CI-07, REQ-CI-08)

Separate workflow (matrix jobs are slower; keeping them off the fast per-PR path satisfies
REQ-PERF-01). Matrix: `ubuntu-latest`, `macos-latest`, `windows-latest`. Each leg:

```
node installer/dist/cli.js install --dry-run --skip-rauf --json   # plan only, no rauf preflight
node installer/dist/cli.js uninstall -y --skip-rauf               # exercise uninstall path
```

- `--dry-run` prints the plan and writes nothing; `--json` gives a machine-checkable report
  (the leg asserts exit 0 and valid JSON).
- `--skip-rauf` suppresses the npm registry preflight (rauf is unpublished — IR-2); without it the
  install dry-run would fail the gate for an out-of-scope reason.
- **Windows leg (REQ-CI-08):** runs the same commands; the installer's Windows behavior is
  copy-by-default (it ignores `--symlink` on Windows per the cross-agent-installer spec D8). The leg
  must pass without POSIX-only assumptions. We do **not** pass `--symlink` on the Windows leg; the
  Linux/macOS legs MAY add a `--symlink --dry-run` variant to exercise that path.
- The installer must be built first (`cd installer && npm ci && npm run build`) on each leg.

Triggered on `pull_request` + `push`. It is **blocking** (REQ-CI-07 is P0, SC-05 requires all three
legs declared), but lives in its own workflow so a green required-check set can be configured
independently.

### 3.3 SKILL.md frontmatter schema (REQ-CI-02, REQ-VER-03, REQ-CONST-03)

Author `references/skill-frontmatter.schema.json` — a JSON Schema (draft 2020-12) that is the
**single declarative source of truth** for the spec-sanctioned frontmatter:

```jsonc
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["name", "description"],
  "additionalProperties": false,
  "properties": {
    "name":          { "type": "string" },
    "description":   { "type": "string" },
    "license":       { "type": "string" },
    "compatibility": {},
    "metadata":      { "type": "object" },
    "allowed-tools": {}
  }
}
```

The 6-key allowed set is exactly the spec-pure set from `forge-skill-spec-purity`
(`name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools`). **No `version`
key** — REQ-VER-03 / REQ-CONS-02 (charter deviation): versions live in manifests only, never SKILL.md. `additionalProperties:false`
mechanically enforces spec-purity (REQ-CONST-03).

**Integration with the checker:** `check-spec-purity.py` is edited so its allowed/required key sets
are **loaded from this schema** (stdlib `json` — the file sits at a path the script already knows its
root for via `forge-root.sh`). The two checks the schema cannot express stay in Python:
- `name == <directory name>` (per-file context — REQ-CI-02's "name equals the skill's directory name").
- the `${CLAUDE_PLUGIN_ROOT}` / portable-prelude / size-budget rules (unchanged).

This makes the schema authoritative for *which keys are allowed* while keeping one executable gate.
A unit assertion (in the existing pytest suite) confirms the checker's loaded set equals the schema's
`properties` keys, preventing drift.

### 3.4 Shell + Python lint (REQ-CI-03, OQ-04)

- **shellcheck** over `feature-forge/scripts/*.sh` (4 files: `validate.sh`, `forge-init.sh`,
  `forge-root.sh`, `session-check.sh`). Config: `.shellcheckrc`. **Severity floor:** `error` and
  `warning` fail; per-line `# shellcheck disable=SCxxxx` directives are permitted for justified
  exceptions. (Settles OQ-04.)
- **ruff** over `feature-forge/scripts/*.py` (4 files) and `eval/*.py`. Config: `ruff.toml` with
  ruff's default rule set (`E`, `F`, `W`) as the floor; line-length 100. ruff is installed in the CI
  composite action (not added to `requirements-adapters.txt`, which is the PyYAML-only adapter venv).
- **Pre-existing sibling scripts:** the `scripts/*.py` glob also matches `epic-manifest.py` and
  `validate-traceability.py`, owned by sibling features — not authored here. The chosen floor MUST
  be validated against all four files; pre-existing violations are resolved by minimal fixes or
  scoped `# noqa: <rule>`, never by weakening the floor below `E`/`F`/`W` (mirrors the shellcheck
  per-line-disable carve-out above).
- **`eval/` ordering:** `eval/` is created by this feature (§3.8), so before that backlog item lands
  the path does not exist. The ruff target must tolerate an absent `eval/` (a glob that matches zero
  files cleanly, e.g. `ruff check scripts/ eval/ 2>/dev/null || ruff check scripts/`), or — preferred —
  sequence the lint-gate backlog item AFTER the eval-harness item. This is a forge-4 backlog
  dependency-ordering constraint.
- **Scope:** feature-forge only (interview decision). rauf's 18 shell scripts are out of scope.
- Both run inside the composite action so a local `shellcheck`/`ruff` reproduces CI.

### 3.5 Version-sync gate + reconciliation (REQ-CI-05, REQ-VER-01, REQ-VER-02)

**Reconciled value: `0.10.0`** (highest of the three desynced files — OQ-02).

- `plugin.json`: already `0.10.0` (confirm, no change).
- `marketplace.json` (`plugins[0].version`): `0.9.0` → `0.10.0` (hand-edit; it is not generated).
- `gemini-extension.json`: `0.0.0` → `0.10.0`, reconciled **at the generator** not by hand —
  bump the `GEMINI_EXTENSION_VERSION` constant in `scripts/build-adapters.py` to `"0.10.0"`, then
  `python3 scripts/build-adapters.py` to regenerate. The file carries a DO-NOT-EDIT header
  (REQ-MAINT-01), so editing the constant + regenerating is the only sanctioned path (REQ-VER-02).

**The gate** (`scripts/check-version-sync.py`, NEW, or a `validate.sh` step) asserts the three fields
are byte-equal and prints the conflicting files+values on mismatch (REQ-OBS-01). `installer/package.json`
(`0.1.0`) is **excluded** (interview decision — independent line). The gate must **currently fail**
on the existing desync until reconciliation lands, then pass (SC-03).

**rauf side (REQ-CI-05, REQ-VER-01):** unchanged. rauf's existing `pnpm version:check`
(`scripts/check-versions.ts`, source of truth `packages/core/src/version.ts`, 6 package.jsons)
already satisfies its half. No new rauf version gate. The two repos keep independent semver lines
(REQ-VER-01).

### 3.6 README rewrites (REQ-README-01, -02, -03)

**feature-forge README (REQ-README-01):** restructure so that, *before the first non-install
`##`-level section after the title*, it presents in order:
- **(a)** the Claude-preferred marketplace install (`/plugin marketplace add …` then `/plugin install`);
- **(b)** a universal one-liner (`npx feature-forge install`);
- **(c)** a per-surface table mapping each of the 5 agents → install path + link to its
  `docs/agents/<agent>.md` (REQ-DOCS-02).

The current README opens `## Overview` → `## Install`; the rewrite makes the install elements lead.
Existing content (Pipeline, Stages, etc.) follows unchanged.

**rauf README (REQ-README-02, REQ-CONS-01):** keep the loop-runner product framing (pitch,
install-as-binary, CLI/web). **Add** a clearly labeled section (e.g. `## Multi-agent / feature-forge`)
linking to feature-forge's cross-agent install story. rauf does **not** adopt the marketplace-first
table. Must pass rauf's existing `check:docs` gate (which scans README for stale grammar / `ralph`
branding / version-tag pins / CLI drift) — the new section must avoid those triggers.

**Accuracy (REQ-README-03, SC-08):** every install command, agent name, and file path shown in
either README must resolve to a real artifact. Verification: the installer `--dry-run` resolves, the
marketplace coordinate is real, and every referenced `docs/agents/*.md` and `adapters/<agent>/` path
is `ls`-confirmed. No aspirational commands — except the documented `npx rauf@0.6.0` path, which is
explicitly labeled "available once rauf 0.6.0 is published" (decision 1), not presented as working
today.

### 3.7 Per-agent setup docs (REQ-DOCS-01, -02, -03, -04)

Five files: `feature-forge/docs/agents/{claude,codex,copilot,cursor,gemini}.md` (interview decision).
Each doc (REQ-DOCS-03) covers:
- **Install:** the relevant installer invocation (`npx feature-forge install -a <agent>`) and/or the
  adapter location (`adapters/<agent>/` → the agent's config dir from the detection map, §6).
- **First-use check:** a confirmation step (e.g. list installed skills / invoke a forge skill).

Each is linked from the README per-surface table (REQ-DOCS-02). **REQ-DOCS-04 (default loop path):**
at least one doc (and/or the README) explains that `forge-5-loop` defaults to rauf and how agent
selection flows forge→rauf, sourced from `feature-forge/references/ralph-loop-contract.md`
(the `forge-loop-runner-contract` expose). Natural home: `docs/agents/claude.md` plus a shared note,
since rauf is the default runner. This satisfies the `consumes forge-loop-runner-contract` obligation.

### 3.8 Trigger-accuracy eval (REQ-EVAL-01, -02, REQ-SEC-02)

`eval/run-eval.py` (Python; uses the Anthropic SDK). For each fixture
`eval/fixtures/<skill>.json` holding `shouldTrigger` and `shouldNotTrigger` prompt lists, the harness
asks Claude to select the best-matching skill from the canonical `SKILL.md` descriptions and scores:
- a should-trigger case is correct if the expected skill is selected;
- a should-not-trigger case is correct if the expected skill is *not* selected.

It prints an aggregate trigger-accuracy score (and per-skill breakdown). **Advisory only**
(REQ-EVAL-02): `eval.yml` runs on `workflow_dispatch` + weekly `schedule`, never on `pull_request`,
and never fails the PR gate. It reads `ANTHROPIC_API_KEY` from CI secrets (REQ-SEC-02 — secret never
echoed, never in the repo). If the key is absent the job reports "skipped (no key)" and exits 0.

### 3.9 Shared CI infrastructure (REQ-CIINFRA-01, -02)

All gates are GitHub Actions (REQ-CIINFRA-01; REQ-CONST-01 mandates GH Actions). **REQ-CIINFRA-02
(P1 SHOULD)** — shared gates factored as reusable workflows/composite actions: satisfied by
**pattern-reuse**. feature-forge gets its own `.github/actions/quality-gate` composite action shaped
like rauf's (one entry point that runs the repo's canonical gate). True cross-repo reuse
(`uses: garygentry/rauf/.github/workflows/…@…`) is rejected: rauf's quality-gate is a local composite
calling `pnpm gate` (TS-specific), not transferable to feature-forge's Python/shell gate; extracting a
public action repo is a heavy lift for a P1 SHOULD. The two composite actions are structurally
parallel, which is the practical form of "factored, not duplicated inline in every workflow."

### 3.10 Cross-OS hygiene (REQ-OS-01, REQ-OS-02)

**`.gitattributes` in both repos (REQ-OS-01):**

```gitattributes
* text=auto eol=lf
*.png binary
*.jpg binary
# export-ignore: keep dev-only trees out of release archives
specs/      export-ignore
tests/      export-ignore
.github/    export-ignore
```

(feature-forge additionally `export-ignore`s `eval/`, `plans/`; rauf additionally `test-sandbox/`.)
LF normalization for text; `export-ignore` for dev-only trees.

**Executable bits (REQ-OS-02):** scripts intended to be executable keep their `+x` bit; `validate.sh`
already checks `scripts/*.sh` are executable. `.gitattributes` LF normalization does not strip the
mode bit (git tracks mode separately). No `* -text` blanket that would corrupt it.

### 3.11 Licensing (REQ-LIC-01, -02, REQ-CONS-03)

- feature-forge: add an **MIT** `LICENSE` (currently none). (REQ-CONS-03: deliberate divergence from
  the charter's Apache-2.0 — MIT for both repos.)
- rauf: already MIT; README MIT badge stays accurate. No change.
- Docs share the code's MIT license (REQ-LIC-02); no separate docs license, no per-file SPDX sweep
  (PRD §6).

### 3.12 CHANGELOG (REQ-CHANGELOG-01)

Both repos already have Keep-a-Changelog CHANGELOGs. Add an entry in each recording this feature's
changes (CI gates, docs, hygiene, version reconciliation) under the appropriate semver heading
(feature-forge `[0.10.0]`; rauf under `## Unreleased`). Consistent format retained.

### 3.13 rauf npm-publishability machinery (decision 1; supports the installer's default path)

To make rauf *publishable* without publishing:
- Remove `private:true` / add `publishConfig`, `files`, and a proper `bin` to the package that will
  become the published unscoped `rauf` that the installer's `rauf@0.6.0` pin targets. **Which package
  that is remains deferred to OQ-A** (see 06 §7.1/§7.4): the root `rauf` package currently has no
  `bin`, while `@rauf/cli` carries `bin: rauf` but is scoped and `private` — so the publish target is
  a deliberately open decision, not a settled fact. The prep edits metadata fields only, on that one
  chosen target, and changes no `version` field. The Bun
  shebang (`#!/usr/bin/env bun`) means npm consumers need Bun, or a compiled binary is shipped; the
  packaging-prep documents the chosen distribution form (compiled binary via the existing
  `release.yml` cross-compile, or a Bun-required npm package). **This feature does not run
  `npm publish`.**
- Optionally add a **manual-dispatch-only** `npm-publish.yml` (the publish machinery) so a maintainer
  can cut the release later. It is `workflow_dispatch`-only and out of the PR gate.
- Docs (README + per-agent) state the `npx rauf@0.6.0` install path is "available once rauf 0.6.0 is
  published"; CI never depends on it (`--skip-rauf`).

## 4. Data Model

No persistent runtime data model. The structured artifacts this feature defines:

- **`skill-frontmatter.schema.json`** — JSON Schema (draft 2020-12), §3.3.
- **`eval/fixtures/<skill>.json`** — `{ "skill": "<name>", "shouldTrigger": ["prompt", …],
  "shouldNotTrigger": ["prompt", …] }`.
- **Version fields** — the three reconciled to `0.10.0` (§3.5).
- **Installer `--json` report** — consumed (not defined) by the OS-matrix legs; shape owned by
  `cross-agent-installer`.

## 5. API Design

No programmatic API. The feature's interfaces are the **CLI/CI contracts** it consumes:

| Command | Purpose | Owner (consumed contract) |
|---|---|---|
| `bash scripts/validate.sh` | feature-forge aggregate gate | existing |
| `python3 scripts/build-adapters.py [--check]` | regen / drift-guard | `adapters-output` |
| `node installer/dist/cli.js install --dry-run --skip-rauf --json` | OS-matrix plan | `cross-agent-installer-cli` |
| `node installer/dist/cli.js uninstall -y --skip-rauf` | OS-matrix uninstall | `cross-agent-installer-cli` |
| `python3 scripts/check-spec-purity.py` | schema/purity gate | `spec-pure-skills` |
| `python3 eval/run-eval.py` | advisory eval | NEW |
| `pnpm gate` / `pnpm version:check` (rauf) | rauf gate | existing |

## 6. Integration Points

### 6.1 `cross-agent-installer` → OS-matrix + install docs (consumes `cross-agent-installer-cli`)

- **Entry point:** `feature-forge/installer/dist/cli.js`, bin `feature-forge` (TypeScript, Node ≥18,
  zero runtime deps).
- **Verified flags:** `install`(alias `add`)/`update`/`uninstall`(alias `remove`)/`list`(alias `ls`);
  `-a/--agent`, `-g/--global`, `--symlink`, `--force`, `--dry-run`, `-y/--yes`, `--json`,
  `--skip-rauf`, `-h/--help`, `--version`. Exit codes `0`/`1`/`2`.
- **Detection map** (for per-agent docs): claude→`~/.claude`, codex→`~/.codex`, copilot→`~/.copilot`,
  cursor→`~/.cursor`, gemini→`~/.gemini`; install dests per the cross-agent-installer tech-spec table
  (e.g. cursor → `~/.cursor/rules/feature-forge/`, gemini → `~/.gemini/extensions/feature-forge/`).
  > **WARNING:** the cross-agent-installer spec marks the codex/copilot/cursor/gemini config-dir
  > paths as "best-known, not source-verified" (its TQ-1). Per-agent docs should state the install
  > path as produced by the installer (`--dry-run --json`) rather than asserting an agent's config
  > convention we haven't verified.
- **rauf provisioning:** `RAUF_PIN = "rauf@0.6.0"` in `installer/src/rauf.ts`; lazy `npx`. **CI uses
  `--skip-rauf`** (decision 1) — IR-2: rauf is unpublished, the preflight would otherwise fail.

### 6.2 `forge-rauf-loop-default` → REQ-DOCS-04 (consumes `forge-loop-runner-contract`)

- **Contract doc:** `feature-forge/references/ralph-loop-contract.md` (the `forge-loop-runner-contract`
  expose). Documents: `forge-5-loop` defaults to rauf; alternate runners via `loopRunner` config
  (`bin`, `agentArgument`, `agentsProbeCommand`, `defaultAgent`, `minRunnerVersion` floor `0.6.0`);
  agent selection precedence `item (rauf) > run (forge --agent) > project (forge --agent) > rauf
  default (claude-cli)`. `validate` (forge-4/forge-verify) is agent-agnostic — never `--agent`.
- The per-agent docs summarize this default-loop path (REQ-DOCS-04) and link the contract doc.

### 6.3 `forge-agent-adapters-build` → REQ-CI-04 + REQ-CONST-04 + REQ-VER-02 (consumes `adapters-output`)

- **Generator:** `feature-forge/scripts/build-adapters.py`; `--check` is the drift-guard already
  wired into `validate.sh` step 6b. The capstone **does not build a new diff gate** — it stands up
  the workflow that runs `validate.sh`. (Confirmed: the regen-and-diff mechanism is delivered by
  `forge-agent-adapters-build`, not this capstone.)
- **`GEMINI_EXTENSION_VERSION`** constant is the source for `gemini-extension.json`'s
  version → bump to `0.10.0` and regenerate (REQ-VER-02).
- Adapter dirs: `adapters/{claude,codex,copilot,cursor,gemini}/` — drives the per-agent doc set and
  the README per-surface table rows.

### 6.4 `forge-skill-spec-purity` → REQ-CI-02 + REQ-CONST-03 (consumes `spec-pure-skills`)

- **Checker:** `feature-forge/scripts/check-spec-purity.py` (stdlib). Edited (§3.3) to load
  allowed/required keys from `skill-frontmatter.schema.json`; `name==dir`, `${CLAUDE_PLUGIN_ROOT}`,
  prelude, and size rules stay in Python.
- **Allowed key set (verbatim):** `name`, `description`, `license`, `compatibility`, `metadata`,
  `allowed-tools`. Required: `name`, `description`. `name == dir` invariant holds for all 11 skills.
- **Portable resolver:** `scripts/forge-root.sh` — the bootstrap prelude consumers use; the checker
  asserts byte-identity. Docs that show shell snippets must use the canonical prelude verbatim.

### 6.5 rauf existing CI (this repo)

- `ci.yml` → `.github/actions/quality-gate` (composite, `pnpm gate`, 8 steps incl. `version:check`
  and `check:docs`). The rauf README edit must keep `check:docs` green. `version:check`
  (`scripts/check-versions.ts`) already covers rauf's 6 package.jsons — **no change** for REQ-CI-05's
  rauf half.

### 6.6 Conflicts with in-progress features

None. All five sibling features are **complete**; this capstone is the only active feature in the
epic (`render-status`: `actionable: [packaging-docs-ci]`). No other spec dir is mid-flight.

## 7. Error Handling

- **Gate failures are diagnosable (REQ-OBS-01):** version-sync gate prints conflicting files+values;
  regen-diff prints the `diff`; shellcheck/ruff print file:line:rule; OS-matrix asserts installer
  exit 0 + valid JSON and surfaces the installer's own error on failure. No silent failures.
- **Missing tooling:** if `claude` CLI can't install on a runner, REQ-CI-01 falls back to the
  documented-equivalent JSON validation (§3.1.1) — logged, not silently skipped. If `ANTHROPIC_API_KEY`
  is absent, the eval job reports "skipped (no key)" and exits 0 (advisory — REQ-EVAL-02).
- **rauf preflight (IR-2):** CI never hits it (`--skip-rauf`); the installer's own non-silent failure
  message ("pinned default loop runner `rauf@<pin>` is not resolvable…") is documented as expected
  until rauf is published.
- **Cross-repo commit (REQ-CONST-02):** loop edits to `../feature-forge` are committed in that repo's
  working tree per the established cross-repo loop technique; a feature-forge gate failure blocks the
  feature-forge PR, not the rauf backlog item's local gate.

## 8. Testing Approach

- **Local-validated done bar (PRD §8):** "authored + locally validated," not "green on real GitHub."
- **feature-forge gate:** `bash scripts/validate.sh` passes locally; `shellcheck scripts/*.sh` and
  `ruff check scripts eval` pass; the version-sync gate **fails before** reconciliation and **passes
  after** (SC-03); `build-adapters.py --check` produces no diff after the gemini bump (SC-04).
- **OS-matrix:** installer `--dry-run --skip-rauf` + `uninstall -y --skip-rauf` complete without
  error on the locally available leg; the workflow **declares** all three legs (SC-05).
- **Schema:** a pytest case asserts `check-spec-purity.py`'s loaded key set == the schema's
  `properties` keys (anti-drift, §3.3); all 11 SKILL.md validate.
- **Eval:** `run-eval.py` runs against fixtures and emits a score; wired non-blocking (SC-06).
- **READMEs (SC-08):** every install command/path exercised in a local dry-run — installer
  `--dry-run`, marketplace coordinate resolved, every `docs/agents/*.md` and `adapters/<agent>/` path
  `ls`-confirmed. Zero stale/failing instructions (REQ-README-03).
- **rauf:** `pnpm gate` stays green after the README edit (esp. `check:docs`) and `.gitattributes`
  add.
- **Tooling:** Python via stdlib + ruff/jsonschema (CI-installed); shell via shellcheck; installer via
  `node --test`; rauf via vitest/`pnpm gate`. No new test framework introduced.

## 9. Dependencies

**External (CI-provisioned, not committed runtime deps):**
- `shellcheck` (CI), `ruff` (CI pip), `jsonschema` (CI pip — only if formal schema validation beyond
  the stdlib key-set load is later desired; the chosen design needs only stdlib `json`).
- `anthropic` Python SDK (eval job only; CI-installed).
- `claude` CLI (REQ-CI-01 attempt; documented fallback if unavailable).
- GitHub Actions: `actions/checkout`, `oven-sh/setup-bun` (rauf), `pnpm/action-setup` (rauf),
  `actions/setup-node` + `actions/setup-python` (feature-forge). **Pin to tag/SHA (REQ-SEC-01).**

**Internal (consumed, unchanged):** `validate.sh`, `build-adapters.py`, `check-spec-purity.py`,
`installer/`, `references/ralph-loop-contract.md` (feature-forge); `pnpm gate`, `check-versions.ts`
(rauf).

**Version constraints:** Node ≥18 (installer); Python ≥3.10 (scripts); PyYAML 6.0.2 (adapter venv,
unchanged); Bun (rauf). Reconciled feature-forge plugin version `0.10.0`; `installer/package.json`
independent; rauf semver independent (REQ-VER-01).

## 10. Open Technical Questions

- **OQ-A (rauf npm distribution form):** does the published `rauf@0.6.0` ship as a Bun-required npm
  package or a compiled binary downloaded by a thin npm wrapper? The Bun shebang means a plain npm
  install needs Bun present. Resolve when the publish machinery (§3.13) is authored; does not block
  CI (which uses `--skip-rauf`).
- **OQ-B (installed-bundle self-location, IR-1):** installed `adapters/<agent>/` bundles lack
  `epic-manifest.py` / `.claude-plugin/plugin.json`, so `forge-root.sh` can't self-locate from an
  installed non-Claude bundle. Owned by the generator (`forge-agent-adapters-build`, its OQ-A) — this
  capstone should **flag** it in the per-agent docs/install-flow, not fix it.
- **OQ-C (REQ-CI-01 CLI availability):** confirm `claude plugin validate --strict` can run on a
  GitHub-hosted runner (CLI install path) vs. falling back to the documented-equivalent JSON
  validation (§3.1.1). Final form set when the workflow is authored.
- **OQ-D (eval determinism/cost):** the LLM-judged eval is inherently non-deterministic and costs API
  tokens; the weekly cadence + `workflow_dispatch` bounds cost, but a small fixed model + low
  `max_tokens` and a pinned model id should be chosen when authoring `run-eval.py`.
- **OQ-E (codex/copilot/cursor/gemini config dirs, TQ-1):** the installer's non-claude config-dir
  paths are "best-known, unverified." Per-agent docs should derive paths from the installer's
  `--dry-run --json` output rather than asserting unverified conventions.
