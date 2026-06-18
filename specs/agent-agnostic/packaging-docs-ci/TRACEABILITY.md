# Traceability Matrix — packaging-docs-ci

Maps every PRD requirement (`REQ-XXX-NN`) to the implementation spec document(s) and section(s) that
implement it. **Primary** is the doc that owns the implementation detail; **Also** lists supporting
docs (foundation contracts in `00`/`01`, verification in `07`).

> Coverage check (Step 5): all 39 PRD requirements are covered; no gaps. All inter-doc cross-references
> resolve to existing files.

## 3.1 README Rewrites

| REQ ID | Requirement | Primary | Also |
|--------|-------------|---------|------|
| REQ-README-01 | feature-forge README leads with (a)→(b)→(c) install | `05` §1 | `00` §6 |
| REQ-README-02 | rauf README keeps loop-runner shape + cross-links | `05` §2 | `00` §6 |
| REQ-README-03 | Both READMEs accurate vs shipped artifacts | `05` §§1.4, 2.2, 5 | `06`, `07` §5 |

## 3.2 Per-Agent Setup Docs

| REQ ID | Requirement | Primary | Also |
|--------|-------------|---------|------|
| REQ-DOCS-01 | A setup doc per supported agent | `05` §3.1 | `00` §2 |
| REQ-DOCS-02 | Per-agent docs reachable from README table | `05` §§1.3, 3.1 | — |
| REQ-DOCS-03 | Per-agent docs cover install + first use | `05` §3.2 | — |
| REQ-DOCS-04 | Default forge↔rauf loop path documented | `05` §4 | `00` §6, `01`, `07` §5 |

## 3.3 Deterministic CI Gates (Blocking)

| REQ ID | Requirement | Primary | Also |
|--------|-------------|---------|------|
| REQ-CI-01 | `claude plugin validate --strict` gate | `02` §§3, 4.1 | `07` §2.1 |
| REQ-CI-02 | SKILL.md schema validation (name+desc, name==dir) | `02` §4.2 | `00` §3, `07` §2.2 |
| REQ-CI-03 | shellcheck + ruff lint gates | `02` §4.3 | `06`, `07` §2.5 |
| REQ-CI-04 | Adapters regenerate-and-diff gate | `02` §4.4 | `06` §2.3, `07` §2.3 |
| REQ-CI-05 | Version-sync gate | `02` §4.5 | `00` §5, `06` §2, `07` §2.4 |
| REQ-CI-06 | Existing test/spec-purity checks in CI | `02` §4.6 | `06` |

## 3.4 OS-Matrix Installer Gate

| REQ ID | Requirement | Primary | Also |
|--------|-------------|---------|------|
| REQ-CI-07 | Installer exercised on OS matrix | `03` §§2, 3, 4 | `00` §7, `07` §3 |
| REQ-CI-08 | Windows path uses copy semantics | `03` §§3.2, 5 | `00` §7 |

## 3.5 Trigger-Accuracy Evals (Advisory)

| REQ ID | Requirement | Primary | Also |
|--------|-------------|---------|------|
| REQ-EVAL-01 | Minimal trigger-accuracy eval harness | `04` §§3, 4, 5, 6 | `00` §4, `07` §4 |
| REQ-EVAL-02 | Evals advisory, never blocking | `04` §§2, 7 | `01` §2 |

## 3.6 Cross-OS Hygiene

| REQ ID | Requirement | Primary | Also |
|--------|-------------|---------|------|
| REQ-OS-01 | `.gitattributes` for both repos | `06` §5 | `07` §6 |
| REQ-OS-02 | Executable bits correct and preserved | `06` §6 | `02` §4.3, `07` §6 |

## 3.7 Versioning, Licensing, CHANGELOG

| REQ ID | Requirement | Primary | Also |
|--------|-------------|---------|------|
| REQ-VER-01 | Independent semver per repo | `06` §1 | `00` §5, `02` §4.5 |
| REQ-VER-02 | Within-repo version fields reconciled | `06` §2 | `00` §5, `07` §2.4 |
| REQ-VER-03 | SKILL.md files carry no version field | `06` §2.4 | `00` §3, `02` §4.2, `07` §2.2 |
| REQ-LIC-01 | MIT license in both repos | `06` §§3.1, 3.2 | — |
| REQ-LIC-02 | Docs share the code license | `06` §3.3 | — |
| REQ-CHANGELOG-01 | Maintained CHANGELOG in both repos | `06` §4 | — |

## 3.8 Shared CI Infrastructure

| REQ ID | Requirement | Primary | Also |
|--------|-------------|---------|------|
| REQ-CIINFRA-01 | Gates run on GitHub Actions | `01` §§2, 3 | `02` §3 |
| REQ-CIINFRA-02 | Shared gates factored (pattern-reuse) | `01` §3.3 | `02` §§3, 6 |

## 4. Non-Functional Requirements

| REQ ID | Requirement | Primary | Also |
|--------|-------------|---------|------|
| REQ-SEC-01 | Third-party actions version-pinned | `01` §4 | `02` §3.1, `03` §3.1, `04` §7.1 |
| REQ-SEC-02 | No secrets in CI logs | `04` §§6.4, 7.3 | `01` §4, `02` §3.1, `03` §§2, 3.1 |
| REQ-OBS-01 | Gate failures are diagnosable | `00` §8 | `02` §5, `03` §§4, 6, `04` §§5, 6.5 |
| REQ-PERF-01 | PR-blocking gates complete quickly | `01` §2 | `02` §3, `03` §2, `04` §§2, 7.2, `07` §2.6 |
| REQ-MAINT-01 | Generated artifacts clearly marked | `00` §5 | `01` §1, `03` §3.3, `06` §2.3 |

## 5. Constraints

| REQ ID | Requirement | Primary | Also |
|--------|-------------|---------|------|
| REQ-CONST-01 | GitHub Actions is the CI platform | `01` §3 | `02`, `03` §§2, 3 |
| REQ-CONST-02 | Edits land in both repos | `00` §1 | `01` §1, `05` |
| REQ-CONST-03 | Respect spec-purity | `00` §3 | `02` §4.2, `07` §2.2 |
| REQ-CONST-04 | Generated adapters derived, never hand-edited | `02` §4.4 | `00` §1, `06` §2.3, `07` §2.3 |

### Charter Deviations (recorded decisions)

| REQ ID | Decision | Primary |
|--------|----------|---------|
| REQ-CONS-01 | rauf keeps loop-runner README + cross-links (not marketplace-first) | `05` §2 |
| REQ-CONS-02 | Versions sync across manifests only; SKILL.md stays spec-pure | `00` §3, `06` §2.4 |
| REQ-CONS-03 | MIT for both repos; docs share code license (not Apache-2.0) | `06` §§3.1–3.3 |

## Open Questions — resolution pointers

| OQ | Resolved in | Resolution |
|----|-------------|------------|
| OQ-01 | `00` §2 | Per-agent docs at `docs/agents/<agent>.md` (mirrors `adapters/<agent>/`) |
| OQ-02 | `00` §5, `06` §2 | Reconciled feature-forge version = `0.10.0` |
| OQ-03 | `04` §§2, 7 | Eval on `workflow_dispatch` + weekly `schedule` |
| OQ-04 | `02` §4.3 | shellcheck error+warning fail; ruff `E`/`F`/`W` floor, line-length 100 |
| OQ-A (tech §10) | `06` §7.4 | **UNRESOLVED — flagged.** No unscoped `rauf` npm package exists; shipped form is a compiled binary via `release.yml`. Distribution form (Bun-required npm pkg vs compiled-binary-via-thin-wrapper) surfaced to the maintainer; does not block CI (`--skip-rauf`). |
| OQ-B / IR-1 (tech §10) | `05` §3.2 | Installed-bundle self-location gap flagged in per-agent docs (fix owned by `forge-agent-adapters-build`) |
| OQ-C (tech §10) | `02` §4.1 | `claude plugin validate --strict` attempted; documented-equivalent JSON fallback |
| OQ-D (tech §10) | `04` §§6.3, 8 | Pinned small model (`claude-haiku-4-5-20251001`) + low `max_tokens`; weekly cadence bounds cost |
| OQ-E (tech §10) | `05` §§0, 3.2 | Per-agent docs derive non-Claude install paths from `--dry-run --json`, not unverified conventions |
