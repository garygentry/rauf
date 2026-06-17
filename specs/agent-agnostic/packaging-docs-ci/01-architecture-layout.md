# 01 — Architecture & Layout

> **Feature:** `packaging-docs-ci` (epic `agent-agnostic`, capstone 6 of 6).
> **Status:** foundation document. Depends on `00-core-definitions.md`.

This document fixes *where everything lives* across the two repos, the workflow topology, the
composite-action pattern, and build/deployment considerations. There is no compiled artifact — the
"build" is: workflows run validators, the generator regenerates one adapter field, and docs/config are
authored in place. The deliverable surface is the `release-and-ci-gates` contract.

## Requirement Coverage

| REQ ID | Requirement | Section |
|--------|-------------|---------|
| REQ-CIINFRA-01 | All gates on GitHub Actions | §2, §3 |
| REQ-CIINFRA-02 | Shared gates factored (pattern-reuse) | §3.3 |
| REQ-CONST-01 | GitHub Actions is the CI platform | §3 |
| REQ-CONST-02 | Edits land in both repos | §1 |
| REQ-PERF-01 | Fast per-PR gate; matrix/eval off the fast path | §3.1 |
| REQ-SEC-01 | Third-party actions version-pinned | §4 |
| REQ-MAINT-01 | Generated artifacts marked | §1 (disposition column) |

## 1. Cross-Repo File Inventory

Disposition codes per `00-core-definitions.md` §1: **NEW / EDIT / REGENERATED / UNCHANGED**. The repo
column drives forge-4 backlog item `repo` declarations (REQ-CONST-02).

### 1.1 feature-forge (`../feature-forge`)

```
feature-forge/
├── .github/                                    # ENTIRE TREE NEW (no .github today — verified)
│   ├── workflows/
│   │   ├── ci.yml                  NEW   per-PR blocking gate (deterministic, fast path)
│   │   ├── os-matrix.yml           NEW   installer dry-run + uninstall on ubuntu/macos/windows
│   │   └── eval.yml                NEW   advisory trigger-accuracy (workflow_dispatch + schedule)
│   └── actions/
│       └── quality-gate/
│           └── action.yml          NEW   composite: provision venv + validate.sh + shellcheck + ruff + version-sync
├── references/
│   └── skill-frontmatter.schema.json   NEW   declarative SKILL.md frontmatter schema (source of truth, 00 §3)
├── scripts/
│   ├── check-spec-purity.py        EDIT  load allowed/required keys from the schema (stdlib json)
│   ├── build-adapters.py           EDIT  bump GEMINI_EXTENSION_VERSION 0.0.0 -> 0.10.0 (:298)
│   ├── check-version-sync.py       NEW   the three-field version-sync gate (or a validate.sh step)
│   ├── validate.sh                 EDIT  add claude-plugin-validate step + wire validate-traceability.py
│   ├── validate-traceability.py    UNCHANGED  wired into validate.sh (standalone today)
│   └── requirements-adapters.txt   UNCHANGED  PyYAML pin (adapter venv); ruff/anthropic CI-installed
├── ruff.toml                       NEW   ruff rule floor (E/F/W, line-length 100)
├── .shellcheckrc                   NEW   shellcheck rule floor (error+warning fail)
├── eval/
│   ├── run-eval.py                 NEW   LLM-judged trigger-accuracy harness
│   └── fixtures/<skill>.json       NEW   per-skill should-trigger / should-not-trigger cases
├── docs/
│   └── agents/
│       ├── claude.md               NEW   per-agent setup doc (also hosts default-loop-path, REQ-DOCS-04)
│       ├── codex.md                NEW
│       ├── copilot.md              NEW
│       ├── cursor.md               NEW
│       └── gemini.md               NEW
├── .claude-plugin/
│   ├── plugin.json                 EDIT(confirm)  version 0.10.0 (already correct)
│   └── marketplace.json            EDIT  plugins[0].version 0.9.0 -> 0.10.0
├── adapters/
│   └── gemini/gemini-extension.json  REGENERATED  version 0.0.0 -> 0.10.0 (via generator)
├── README.md                       REWRITE  (a)->(b)->(c) install-first structure
├── LICENSE                         NEW   MIT (none today — verified)
├── .gitattributes                  NEW   LF normalization + export-ignore
├── CHANGELOG.md                    EDIT  record this feature under [0.10.0]
└── AGENTS.md                       UNCHANGED  hand-authored; referenced from docs
```

### 1.2 rauf (this repo)

```
rauf/
├── .gitattributes                  NEW   LF normalization + export-ignore (+ test-sandbox/)
├── README.md                       EDIT  add labeled cross-agent section linking feature-forge
├── CHANGELOG.md                    EDIT  record this feature under ## Unreleased
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                  UNCHANGED  existing (-> quality-gate composite -> pnpm gate)
│   │   ├── docs.yml                UNCHANGED  existing check:docs path
│   │   ├── release.yml             UNCHANGED  no live publish
│   │   └── npm-publish.yml         NEW (optional)  workflow_dispatch-only publish machinery (§3.13 tech-spec)
│   └── actions/quality-gate/action.yml  UNCHANGED  existing (pnpm gate)
└── packages/cli/package.json (or root, per OQ-A)  EDIT  npm-publishability prep (publishConfig/files/bin)
                                    on the ONE chosen `rauf` publish target only; NO version change, NO publish (06 §7.1)
```

> **Public API surface:** none in the code sense. The feature's surface is the `release-and-ci-gates`
> contract — the workflows, the schema artifact, the docs set, and the
> versioning/licensing/`.gitattributes` state across both repos.

## 2. Workflow Topology

```
feature-forge (NET-NEW CI)                       rauf (EXISTING CI — unchanged)
─────────────────────────                        ─────────────────────────────
ci.yml ─────────────► .github/actions/           ci.yml ─► .github/actions/
  on: pull_request,     quality-gate/action.yml     on: push(main),  quality-gate/action.yml
      push                (composite)                    pull_request,   (composite)
                          │                              workflow_dispatch    │
                          ├─ provision Python+Node                            └─ pnpm gate
                          ├─ bash scripts/validate.sh        (build, schema:check, version:check,
                          ├─ shellcheck scripts/*.sh          typecheck, lint, format:check, test,
                          ├─ ruff check scripts/ eval/        check:docs)
                          └─ check-version-sync (3 fields)

os-matrix.yml ──────► matrix: ubuntu/macos/windows   release.yml (unchanged — no publish)
  on: pull_request,     installer dry-run + uninstall   npm-publish.yml (NEW, optional)
      push              (--skip-rauf)                      on: workflow_dispatch ONLY

eval.yml ───────────► run-eval.py (advisory)
  on: workflow_dispatch,  reads ANTHROPIC_API_KEY (secret);
      schedule(weekly)    NEVER on pull_request; never blocks
```

**Three feature-forge workflows, by trigger and blocking status:**

| Workflow | Triggers | Blocking? | Rationale |
|---|---|---|---|
| `ci.yml` | `pull_request`, `push` | **Yes** | fast deterministic gate; completes in minutes (REQ-PERF-01) |
| `os-matrix.yml` | `pull_request`, `push` | **Yes** (P0) | slower matrix kept in its own workflow so required-checks can be tuned independently |
| `eval.yml` | `workflow_dispatch`, `schedule` (weekly) | **No** (advisory) | LLM-judged, non-deterministic, costs tokens (REQ-EVAL-02) |

## 3. Composite-Action Pattern & Shared Infrastructure (REQ-CIINFRA-01, -02)

### 3.1 Fast-path / slow-path separation (REQ-PERF-01)

The deterministic per-PR gate (`ci.yml`) stays fast by delegating to one composite action that runs
the canonical local gate. The OS matrix and the LLM eval live in separate workflows so they do not
slow the per-PR feedback loop.

### 3.2 feature-forge composite action — mirrors rauf

feature-forge gets `.github/actions/quality-gate/action.yml`, a **local composite action** shaped like
rauf's. rauf's verified action is minimal:

```yaml
# rauf/.github/actions/quality-gate/action.yml (VERIFIED — the pattern to mirror)
name: Quality Gate
description: The canonical gate — `pnpm gate` ...
runs:
  using: composite
  steps:
    - run: pnpm gate
      shell: bash
```

feature-forge's composite is the analogue: one entry point that runs the repo's canonical gate
(`validate.sh` + lint + version-sync). The detailed step list is in `02-ci-blocking-gates.md`.

### 3.3 Why pattern-reuse, not cross-repo reusable workflows (REQ-CIINFRA-02 — P1 SHOULD)

True cross-repo reuse (`uses: garygentry/rauf/.github/workflows/…@…`) is **rejected**: rauf's
quality-gate runs `pnpm gate` (TS-specific) and is not transferable to feature-forge's Python/shell
gate; extracting a shared public action repo is a heavy lift for a P1 SHOULD. The two composite
actions being **structurally parallel** (each a local composite with one canonical entry point) is the
practical form of "factored, not duplicated inline in every workflow." This satisfies REQ-CIINFRA-02.

## 4. Build & Deployment Considerations

- **No compiled output.** The only "generation" step is `build-adapters.py` regenerating
  `adapters/gemini/gemini-extension.json` after the version constant bump (`00 §5`).
- **Action pinning (REQ-SEC-01, P2 SHOULD):** third-party actions SHOULD be pinned to a tag or commit
  SHA. rauf already pins to major tags (`actions/checkout@v5`, `oven-sh/setup-bun@v2`,
  `pnpm/action-setup@v6` — verified). feature-forge's new workflows use `actions/checkout`,
  `actions/setup-node`, `actions/setup-python`, pinned consistently.
- **Permissions:** workflows declare least-privilege `permissions: contents: read` (rauf's ci.yml does
  — the pattern to mirror). The eval job additionally needs the `ANTHROPIC_API_KEY` secret only.
- **No secrets in deterministic gates (REQ-SEC-02):** `ci.yml` and `os-matrix.yml` require zero
  secrets (they operate on the repo tree). Only `eval.yml` reads a secret.
- **Done bar (PRD §8):** "authored + locally validated," NOT "confirmed green on real GitHub." The
  architecture is validated by running the gates locally; observing a live matrix run is post-merge.

## Dependencies

- `00-core-definitions.md` — repo IDs, file dispositions, agent set, version contract.

## Verification

- [ ] feature-forge gains `.github/workflows/{ci,os-matrix,eval}.yml` and
      `.github/actions/quality-gate/action.yml`; it had no `.github/` before (verified).
- [ ] rauf's existing `.github/` is untouched except the optional `npm-publish.yml`.
- [ ] `ci.yml` and `os-matrix.yml` trigger on `pull_request`+`push`; `eval.yml` only on
      `workflow_dispatch`+`schedule` (never `pull_request`).
- [ ] Every NEW/EDIT/REGENERATED file in §1 is accounted for by a forge-4 backlog item with a `repo`
      declaration.
- [ ] Third-party actions are pinned (tag/SHA) in all new workflows (REQ-SEC-01).
