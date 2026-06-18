# packaging-docs-ci — Product Requirements Document

> **Epic:** `agent-agnostic` — capstone feature (6 of 6). Depends on `cross-agent-installer`,
> `forge-rauf-loop-default`, `forge-agent-adapters-build`, `forge-skill-spec-purity` (all complete).
> **Exposes:** `release-and-ci-gates`.

## 1. Problem Statement

The `agent-agnostic` epic assembled a cross-agent system: a spec-pure canonical skill set, a
generator that derives per-agent adapters, a cross-platform installer that bundles rauf, and a
forge↔rauf loop integration. Each piece was built and verified in isolation, but the **assembled
whole is neither documented for users nor gated against regression**.

Today:

- **Discovery is broken.** Neither repo's README leads with how a user actually installs the
  cross-agent system. feature-forge's README has an `## Install` section but no universal install
  path and no per-surface guidance; rauf's README is loop-runner-focused with no link to the
  cross-agent story. There are **no per-agent setup docs** for the five supported agents
  (Claude, Codex, Copilot, Cursor, Gemini).
- **Nothing is gated.** feature-forge has **no CI at all**. Generated adapters can silently drift
  from canon. Spec-purity, skill-schema conformance, and shell/Python lint are unenforced. The
  installer is never exercised on the OS matrix it claims to support.
- **Packaging is inconsistent.** feature-forge already ships a **version desync** across three
  files (`.claude-plugin/plugin.json` at `0.10.0`, `.claude-plugin/marketplace.json` at `0.9.0`,
  and the generated `adapters/gemini/gemini-extension.json` at `0.0.0`). There is no version-sync
  check.
  Neither repo declares cross-OS file handling (`.gitattributes` for LF normalization and
  export-ignore), and feature-forge has no `LICENSE` file.

This matters **now** because the epic is otherwise complete: the substantive work is done and
must be made shippable, discoverable, and regression-proof before it can be relied upon. Without
this capstone, the system works on the maintainer's machine but cannot be trusted to stay working
or be adopted by anyone else.

## 2. User Stories

- **As a new user evaluating the system**, I want each repo's README to show me — before the first
  non-install section — the preferred Claude install, a universal one-liner, and a table telling me
  what to do for my specific agent, so that I can get running without reading the whole repo.
- **As a user of a specific coding agent** (Codex/Copilot/Cursor/Gemini), I want a dedicated setup
  doc for my agent, so that I know exactly how to install and use the skills on my surface.
- **As the maintainer**, I want CI to fail any PR that lets generated adapters drift from canon,
  breaks a SKILL.md's schema, regresses spec-purity, or desyncs version numbers, so that the
  assembled system cannot rot between releases.
- **As the maintainer**, I want the installer exercised (dry-run + uninstall) on Ubuntu, macOS,
  and Windows in CI, so that cross-OS breakage is caught before a user hits it.
- **As a contributor**, I want an advisory trigger-accuracy eval I can run, so that I can see
  whether a skill-description change improved or hurt how reliably skills fire — without that
  signal blocking my unrelated PR.
- **As a downstream consumer**, I want consistent versioning, a maintained CHANGELOG, and a clear
  license in both repos, so that I can depend on releases predictably.

## 3. Functional Requirements

### 3.1 README Rewrites

- **REQ-README-01: feature-forge README leads with the cross-agent install story.** The README
  MUST open — before the first non-install `##`-level section after the title — with, in order:
  (a) the Claude-preferred marketplace install, (b) a universal one-liner install, (c) a
  per-surface table mapping each supported agent to its install path / setup doc. The ordered
  presence of (a)→(b)→(c) ahead of any non-install content is the verifiable bar.
  - Priority: P0
- **REQ-README-02: rauf README keeps its loop-runner shape and cross-links the cross-agent story.**
  rauf's README MUST retain its loop-runner product framing (pitch, install-as-binary, CLI/web)
  and MUST add a clearly labeled section that links to feature-forge's cross-agent install story.
  rauf's README is NOT required to adopt the marketplace-first/per-surface-table structure.
  - Priority: P0
  - Notes: Deliberate divergence from the charter's "rewrite both READMEs to the same shape" —
    rauf is a binary, not a per-agent skills bundle. See REQ-CONS-01.
- **REQ-README-03: Both READMEs are accurate against the shipped artifacts.** Every install
  command, agent name, and file path shown in either README MUST correspond to a real,
  current artifact (installer flag, adapter dir, doc file). No aspirational or stale commands.
  - Priority: P0

### 3.2 Per-Agent Setup Docs

- **REQ-DOCS-01: A dedicated setup doc per supported agent.** There MUST be a setup doc for each
  of the five supported agents — Claude, Codex, Copilot, Cursor, Gemini — authored as separate
  files under the docs directory (e.g. `docs/agents/<agent>.md`).
  - Priority: P0
- **REQ-DOCS-02: Per-agent docs are reachable from the README table.** The feature-forge README's
  per-surface table (REQ-README-01c) MUST link to each agent's setup doc.
  - Priority: P0
- **REQ-DOCS-03: Per-agent docs cover install + first use.** Each per-agent doc MUST describe how
  to install the skills for that agent (the relevant installer invocation / adapter location) and
  how to confirm they work (a first-use check).
  - Priority: P1
- **REQ-DOCS-04: The default forge↔rauf loop path is documented.** At least one doc (the per-agent
  setup docs and/or the feature-forge README) MUST explain that `forge-5-loop` defaults to rauf as
  its loop runner and how agent selection flows forge→rauf, satisfying the charter's
  `consumes forge-loop-runner-contract` obligation.
  - Priority: P1
  - Notes: Covers the `forge-loop-runner-contract` contract consumed from `forge-rauf-loop-default`.

### 3.3 Deterministic CI Gates (Blocking)

All gates in this section MUST run in CI on every pull request to the affected repo and MUST fail
the PR when they do not pass.

- **REQ-CI-01: `claude plugin validate --strict` gate.** feature-forge CI MUST run
  `claude plugin validate --strict` (or the documented equivalent) and fail on any validation
  error.
  - Priority: P0
- **REQ-CI-02: SKILL.md schema validation.** CI MUST validate every `SKILL.md` against a defined
  schema requiring at minimum a `name` and `description`, and asserting `name` equals the skill's
  directory name. A new SKILL.md schema artifact MUST be authored if one does not already exist.
  - Priority: P0
  - Notes: Must respect spec-purity — the schema validates the spec-sanctioned frontmatter set, it
    does not reintroduce vendor keys.
- **REQ-CI-03: Shell + Python lint gates.** CI MUST run `shellcheck` over bundled shell scripts and
  `ruff` over bundled Python scripts, failing on lint violations at the agreed severity.
  - Priority: P0
- **REQ-CI-04: Adapters regenerate-and-diff gate.** CI MUST regenerate the per-agent adapters from
  canon and fail if the working tree's committed `adapters/` differs from the freshly generated
  output (generated artifacts can never drift from canon).
  - Priority: P0
- **REQ-CI-05: Version-sync gate.** CI MUST assert that the synced version fields agree **within
  each repo**. For feature-forge this spans `.claude-plugin/plugin.json`,
  `.claude-plugin/marketplace.json`, and the generated `adapters/gemini/gemini-extension.json`.
  For rauf this is its existing `version:check` (single source in `packages/core/src/version.ts`).
  The gate MUST currently FAIL on the existing feature-forge version desync (plugin.json `0.10.0` /
  marketplace.json `0.9.0` / gemini-extension.json `0.0.0`) until it is reconciled (REQ-VER-02).
  - Priority: P0
- **REQ-CI-06: feature-forge's existing test/spec-purity checks run in CI.** The repo's existing
  validators (e.g. spec-purity check, traceability validation, adapter build) MUST be wired into
  CI as blocking gates.
  - Priority: P1

### 3.4 OS-Matrix Installer Gate

- **REQ-CI-07: Installer exercised on an OS matrix.** CI MUST run the installer's `--dry-run`
  followed by an `uninstall` on a matrix covering **Ubuntu (Linux), macOS, and Windows**, failing
  the PR if the installer errors on any OS.
  - Priority: P0
- **REQ-CI-08: Windows path uses copy semantics.** The Windows matrix leg MUST exercise the
  installer's Windows behavior (copy-by-default, no symlink) and pass without relying on
  POSIX-only assumptions.
  - Priority: P1

### 3.5 Trigger-Accuracy Evals (Advisory)

- **REQ-EVAL-01: A minimal trigger-accuracy eval harness exists.** This feature MUST author a
  minimal harness plus fixtures (per-skill should-trigger / should-not-trigger cases) that
  produces a trigger-accuracy score.
  - Priority: P1
- **REQ-EVAL-02: Evals run advisory, never blocking.** The eval job MUST report its score but MUST
  NOT fail the PR gate. It MAY run on a schedule or on demand rather than on every PR.
  - Priority: P1
  - Notes: A blocking eval threshold is explicitly out of scope (§6).

### 3.6 Cross-OS Hygiene

- **REQ-OS-01: `.gitattributes` for both repos.** Each repo MUST add a `.gitattributes` enforcing
  LF normalization for text files and `export-ignore` for files that should not appear in release
  archives.
  - Priority: P0
- **REQ-OS-02: Executable bits are correct and preserved.** Scripts intended to be executable MUST
  carry the executable bit, and the repos' attributes/CI MUST not silently strip it across
  platforms.
  - Priority: P1

### 3.7 Versioning, Licensing, and CHANGELOG

- **REQ-VER-01: Independent semver per repo.** rauf and feature-forge each maintain their own
  semver line. There is NO requirement that the two repos share a version number.
  - Priority: P0
- **REQ-VER-02: Within-repo version fields are reconciled.** The current feature-forge version
  desync MUST be reconciled to a single agreed version across `.claude-plugin/plugin.json`
  (currently `0.10.0`), `.claude-plugin/marketplace.json` (currently `0.9.0`), and
  `adapters/gemini/gemini-extension.json` (currently `0.0.0`), after which REQ-CI-05 keeps them
  synced. Because `gemini-extension.json` is a generated adapter (DO-NOT-EDIT, REQ-MAINT-01), it
  MUST be reconciled at the generator/source, not by hand-edit. The exact reconciled value is
  deferred to the tech spec (OQ-02).
  - Priority: P0
- **REQ-VER-03: SKILL.md files carry no version field.** To preserve spec-purity, version numbers
  live in the per-repo manifests only (`plugin.json` / `.claude-plugin` manifest /
  `gemini-extension.json`), NOT in `SKILL.md` frontmatter.
  - Priority: P0
  - Notes: Deliberate divergence from the charter's literal "synced version headers across …
    SKILL.md". See REQ-CONS-02.
- **REQ-LIC-01: MIT license in both repos.** Both repos MUST carry an MIT `LICENSE` file
  (feature-forge currently has none). rauf remains MIT; its README MIT badge stays accurate.
  - Priority: P0
  - Notes: Deliberate divergence from the charter's Apache-2.0 mandate. See REQ-CONS-03.
- **REQ-LIC-02: Docs share the code license.** Documentation is licensed under the same MIT license
  as the code; no separate docs license is introduced.
  - Priority: P1
- **REQ-CHANGELOG-01: Maintained CHANGELOG in both repos.** Both repos MUST keep a CHANGELOG
  (both already exist) updated with the changes this feature introduces, following a consistent
  format (e.g. Keep a Changelog / semver headings).
  - Priority: P1

### 3.8 Shared CI Infrastructure

- **REQ-CIINFRA-01: Gates run on GitHub Actions.** All CI gates MUST be implemented as GitHub
  Actions workflows (rauf already uses GitHub Actions; feature-forge adds them net-new).
  - Priority: P0
- **REQ-CIINFRA-02: Shared gates are factored as reusable workflows / composite actions.** Gates
  common to both repos (e.g. lint, schema validation) SHOULD be expressed as reusable workflows or
  composite actions referenced by both repos rather than duplicated.
  - Priority: P1

## 4. Non-Functional Requirements

### 4.1 Security / Supply-Chain

- **REQ-SEC-01: Third-party GitHub Actions are version-pinned.** External actions referenced in
  workflows SHOULD be pinned (tag or commit SHA) rather than floating on a mutable ref.
  - Priority: P2
- **REQ-SEC-02: No secrets in CI logs.** Workflows MUST NOT echo secrets; the deterministic gates
  MUST require no secrets at all (they operate on the repo tree). Any API-dependent advisory eval
  that needs a key MUST read it from CI secrets, never from the repo.
  - Priority: P1

### 4.2 Observability

- **REQ-OBS-01: Gate failures are diagnosable from CI logs.** Each gate MUST emit a clear,
  actionable failure message (e.g. the regen-diff gate prints the diff; the version-sync gate
  prints the conflicting files and values). No silent failures.
  - Priority: P1

### 4.3 Performance

- **REQ-PERF-01: PR-blocking gates complete quickly.** The deterministic per-PR gate set SHOULD
  complete within a few minutes on a standard runner so it does not impede iteration. The OS matrix
  and advisory eval MAY run longer / on a schedule.
  - Priority: P2

### 4.4 Maintainability

- **REQ-MAINT-01: Generated artifacts are clearly marked.** Any file produced by a generator
  (adapters, synced manifests) MUST be recognizable as generated so contributors do not hand-edit
  it (the adapters already carry DO-NOT-EDIT headers; this must remain true).
  - Priority: P1

## 5. Constraints

> **Priority note:** Constraints (`REQ-CONST-*`) are P0 mandates by definition — they bound every
> requirement above. Charter-Deviation records (`REQ-CONS-*`, below) document decisions and carry
> no independent priority.

- **REQ-CONST-01: GitHub Actions is the CI platform.** Mandated by existing infrastructure — rauf
  already runs GitHub Actions; introducing a second CI system is not acceptable.
- **REQ-CONST-02: Edits land in both repos.** This feature's loop edits files in BOTH the rauf repo
  and the feature-forge repo (`../feature-forge`), even though the pipeline/backlog state lives in
  the rauf repo. The implementation must account for the cross-repo working-tree reality.
- **REQ-CONST-03: Respect spec-purity.** No CI gate, schema, or version-sync mechanism may
  reintroduce vendor-specific keys or version fields into canonical `SKILL.md` files; the
  `forge-skill-spec-purity` invariant is load-bearing.
- **REQ-CONST-04: Generated adapters are derived, never hand-edited.** All per-agent outputs come
  from the generator; the regen-diff gate enforces this.

### Charter Deviations (recorded decisions)

- **REQ-CONS-01:** The charter calls to "rewrite both repos' READMEs" to the same marketplace-first
  shape. Decision: rauf keeps its loop-runner README and cross-links instead (REQ-README-02).
- **REQ-CONS-02:** The charter lists "synced version headers across … SKILL.md". Decision: versions
  sync across manifests only; SKILL.md stays spec-pure (REQ-VER-03).
- **REQ-CONS-03:** The charter mandates Apache-2.0 + a separate docs license. Decision: MIT for both
  repos, docs share the code license (REQ-LIC-01, REQ-LIC-02).

## 6. Out of Scope

- **Executing a real release.** No npm publish of rauf, no git tag/release cut. This feature ships
  the *machinery* (workflows, version-sync, CHANGELOG discipline); pressing "publish" is a separate
  manual maintainer step.
- **Marketplace submission/refresh.** Docs describe the marketplace install; this feature does not
  submit or refresh the live Claude marketplace entry.
- **New product features.** No new installer flags, adapter formats, or loop capabilities. This
  capstone documents and gates the *existing* assembled system only.
- **Blocking trigger-accuracy threshold.** Evals are advisory; making them fail PRs is excluded.
- **Confirmed-green-on-real-GitHub as the done bar.** Done is "authored + locally validated"
  (§8); observing a live green matrix run on GitHub is a post-merge confirmation, not a gate on
  this feature's completion.
- **Relicensing churn beyond adding/aligning MIT.** No migration to Apache-2.0; no per-file SPDX
  sweep is required (a top-level LICENSE per repo suffices).

## 7. Open Questions

- **OQ-01:** Exact filename/location convention for per-agent docs (`docs/agents/<agent>.md` vs
  `docs/setup/<agent>.md`) — to be settled in the tech spec; REQ-DOCS-01 only fixes "separate files
  under docs/".
- **OQ-02:** The single reconciled feature-forge version number for REQ-VER-02 (likely `0.10.0`,
  the highest of the three desynced files: plugin.json `0.10.0` / marketplace.json `0.9.0` /
  gemini-extension.json `0.0.0`) — deferred to the tech spec / when the version-sync gate is
  implemented.
- **OQ-03:** Whether the advisory eval runs on a schedule, on a label, or on-demand only — a CI
  ergonomics choice for the tech spec.
- **OQ-04:** shellcheck/ruff severity floor (which rules are errors vs warnings) — to be set in the
  tech spec.

## 8. Success Criteria

- **SC-01:** feature-forge's README presents the (a)→(b)→(c) install elements in order before its
  first non-install `##` section (REQ-README-01); rauf's README retains its loop-runner shape and
  cross-links the cross-agent story (REQ-README-02); and every command/path shown in either README
  resolves to a real artifact (REQ-README-03).
- **SC-02:** A setup doc exists for each of the five agents and is linked from the feature-forge
  README's per-surface table, and the default forge↔rauf loop path is documented (REQ-DOCS-04).
- **SC-03:** All deterministic blocking gates (REQ-CI-01..06, REQ-CI-07) are authored as GitHub
  Actions and **pass when run locally** against both current trees — except the version-sync gate,
  which correctly **fails** until the feature-forge version desync is reconciled, then passes.
- **SC-04:** Running the adapters regen-diff locally against committed `adapters/` produces no diff.
- **SC-05:** The installer `--dry-run` + `uninstall` complete without error when run locally on the
  available OS legs, and the workflow declares all three (Ubuntu/macOS/Windows) matrix legs.
- **SC-06:** The trigger-accuracy eval harness runs and emits a score, wired as a non-blocking job.
- **SC-07:** Both repos have a `.gitattributes` (LF + export-ignore) and an MIT `LICENSE`; their
  within-repo version fields agree; CHANGELOGs reflect this feature's changes.
- **SC-08:** Each install command/path in both READMEs is exercised in a local dry-run (installer
  `--dry-run`, marketplace path resolved, every referenced doc/adapter path `ls`-confirmed to
  exist), producing zero stale or failing instructions.
