# forge-agent-adapters-build — Product Requirements Document

> Epic: `agent-agnostic` (member 3 of 6). Target repo: **feature-forge**.
> Depends on: `forge-skill-spec-purity` (complete). Downstream consumers: `cross-agent-installer`, `packaging-docs-ci`.
> Specs/backlog/loop are driven from **rauf** (`specs/agent-agnostic/forge-agent-adapters-build/`); implementation lands in **feature-forge** (see Constraints §5).

## 1. Problem Statement

The `forge-skill-spec-purity` feature established a single, vendor-neutral canonical source: 11 spec-pure `skills/*/SKILL.md` files (frontmatter reduced to `{name, description[, metadata]}`, with Claude's `argument-hint` relocated losslessly to `metadata.argument-hint`) plus a portable `scripts/forge-root.sh` resolver. That canon is deliberately not directly consumable by most coding agents: each agent (Claude Code, OpenAI Codex, GitHub Copilot, Cursor, Gemini CLI) expects skills/instructions in its own native frontmatter or manifest format.

Today there is no mechanism to turn the neutral canon into per-agent artifacts, and no guarantee that any hand-made per-agent copies stay in sync with canon. Without this, the downstream installer (`cross-agent-installer`) has nothing to ship, and the multi-agent promise of the epic cannot be delivered. Hand-maintaining N per-agent copies of 11 skills would drift immediately and silently.

This feature solves that by adding a deterministic **canonical→per-agent build step**: a generator that derives per-agent artifacts from canon, a hand-authored canonical `AGENTS.md`, and a CI guard that makes drift impossible.

## 2. User Stories

- As a **feature-forge maintainer**, I want to edit a skill in exactly one place (the canon) and regenerate every agent's copy with one command, so I never hand-edit divergent per-agent files.
- As a **maintainer reviewing a PR**, I want generated per-agent output committed and diffable, so I can see exactly what changed for each agent and trust that it matches canon.
- As a **CI system**, I want to regenerate adapters and fail the build if the committed output differs from a fresh generation, so generated artifacts can never silently drift from canon.
- As the **downstream installer (`cross-agent-installer`)**, I want a stable, self-contained `adapters/` tree per agent, so I can copy/symlink a working skill set into each agent's config directory.
- As a **developer using any supported coding agent**, I want a canonical `AGENTS.md` describing build/test commands, conventions, and install priority, so I can work in the repo regardless of which agent I run.
- As a **maintainer**, I want a record of every canonical construct that could not be represented in a given agent's format, so dropped behavior is visible rather than silently lost.

## 3. Functional Requirements

### 3.1 Adapter Generator (`build-adapters`)

- **REQ-GEN-01**: The system MUST provide a generator that walks every canonical skill under `skills/`, parses its frontmatter and body, and emits per-agent artifacts into an `adapters/` tree.
  - Priority: P0
- **REQ-GEN-02**: The generator MUST be invokable as a single command from the feature-forge repo root, requiring no interactive input.
  - Priority: P0
- **REQ-GEN-03**: The generator MUST target these agents in v1: **Claude**, **Codex**, **Copilot**, **Cursor**, **Gemini**. Claude is included as a generated target (not merely the canon), so all five agents' artifacts derive from the same source.
  - Priority: P0
  - Notes: Claude is generated to restore native frontmatter (see REQ-VND-01) and to keep every agent uniformly derived from canon.
- **REQ-GEN-04**: For each canonical skill, the generated per-agent bundle MUST be self-contained: it MUST include the skill's `references/`, any shared references the skill depends on (e.g. `shared-conventions.md`), and the `forge-root.sh` resolver, such that the skill set is runnable for that agent without reaching back into canon.
  - Priority: P0
  - Notes: Exact on-disk layout per agent is a tech-spec decision; the self-containment requirement is fixed here.
- **REQ-GEN-05**: The `forge-root.sh` resolver MUST be copied **verbatim** (byte-identical) into each per-agent script mirror; the generator MUST NOT reflow or edit it.
  - Priority: P0
- **REQ-GEN-06**: Canonical sub-agent definitions (e.g. `agents/forge-verifier.md`) MUST be translated into each target agent's native form where the agent supports an equivalent construct, and recorded as dropped where it does not (see REQ-OBS-01).
  - Priority: P1

### 3.2 Per-Agent Format Translation

- **REQ-FMT-01**: Each agent's adapter MUST use that agent's documented native skill/instruction format (e.g. Cursor `.mdc` rule files, Copilot skill frontmatter, a Gemini `gemini-extension.json` manifest, a Codex skill mirror plus an optional `agents/openai.yaml`).
  - Priority: P0
  - Notes: The exact field-level mapping per agent is delegated to forge-2-tech; the requirement is native-format fidelity, not lowest-common-denominator output.
- **REQ-FMT-02**: Where a target format supports an equivalent, relocated canonical metadata MUST be reconstructed losslessly — in particular `metadata.argument-hint` MUST be reconstructed into the agent's native invocation-hint field.
  - Priority: P0
- **REQ-FMT-03**: A canonical construct that has no equivalent in a target agent's format MUST be omitted from that agent's output (never emitted as invalid frontmatter) and MUST be recorded (see REQ-OBS-01).
  - Priority: P0
- **REQ-FMT-04**: Skill `description` text MUST be preserved byte-for-byte in every target that has a description field (descriptions are trigger-tuned and behavior-significant).
  - Priority: P0

### 3.3 Claude Adapter Specifics

- **REQ-VND-01**: The Claude adapter MUST restore top-level `argument-hint` frontmatter (reconstructed from `metadata.argument-hint`), producing Claude-native skills with no information loss relative to the pre-purity originals.
  - Priority: P0
- **REQ-VND-02**: The Claude adapter MUST retain Claude-only artifacts that are valid for Claude (e.g. `hooks/hooks.json`), since for the Claude target these are representable and behavior-relevant.
  - Priority: P1
  - Notes: These same artifacts are omitted-with-record for non-Claude agents per REQ-FMT-03.

### 3.4 Canonical AGENTS.md

- **REQ-DOC-01**: The system MUST include a hand-authored canonical `AGENTS.md` at the feature-forge repo root.
  - Priority: P0
- **REQ-DOC-02**: `AGENTS.md` MUST document: build/test commands, repository conventions, and the install-path priority (Claude marketplace install preferred, then the universal install path).
  - Priority: P0
- **REQ-DOC-03**: `AGENTS.md` is authored, not generated; it MUST NOT carry a DO-NOT-EDIT generated header and is not subject to the regenerate-and-diff guard.
  - Priority: P1

### 3.5 Generated-Output Provenance & Storage

- **REQ-OUT-01**: Every generated file in `adapters/` MUST carry a provenance header marking it as generated ("GENERATED — DO NOT EDIT"), naming the canonical source path it derived from, and stating the exact command to regenerate.
  - Priority: P0
  - Notes: For file formats where a comment header is not expressible (e.g. strict JSON manifests), the equivalent provenance MUST be carried in a documented, format-appropriate way (resolved in tech spec).
- **REQ-OUT-02**: The generated `adapters/` tree MUST be committed to version control (checked in), so it is reviewable in PRs and serves as the baseline for the drift guard.
  - Priority: P0

### 3.6 Determinism & Robustness

- **REQ-DET-01**: The generator MUST be deterministic: identical canon input MUST produce byte-identical `adapters/` output across runs, machines, and time (no timestamps, no nondeterministic ordering, no random values in output).
  - Priority: P0
- **REQ-DET-02**: The generator MUST perform a full regenerate: each run produces the complete `adapters/` tree from scratch (stale or orphaned files from prior runs MUST NOT survive), so the committed tree always equals a clean generation.
  - Priority: P0
- **REQ-DET-03**: Re-running the generator with no canon changes MUST produce no diff against the committed `adapters/` tree (idempotency).
  - Priority: P0
- **REQ-ROB-01**: If the generator encounters canon it cannot process (malformed frontmatter, missing required `name`, unreadable file), it MUST fail fast — abort the entire build with a clear per-file error and a non-zero exit — and MUST NOT write a partial `adapters/` tree.
  - Priority: P0
  - Notes: Canon is pre-gated pure by `check-spec-purity.py` upstream, so any failure here represents a real defect that must block.

### 3.7 Spec-Purity Exemption

- **REQ-PUR-01**: The spec-purity checker (`check-spec-purity.py`) MUST exclude the `adapters/` tree from its scan, so generated copies carrying intentional vendor frontmatter never trip the purity gate.
  - Priority: P0
- **REQ-PUR-02**: The exemption MUST NOT weaken purity enforcement over canonical surfaces (`skills/`, `references/`, `agents/`); only the generated `adapters/` tree is exempted.
  - Priority: P0

### 3.8 CI Regenerate-and-Diff Drift Guard

- **REQ-CI-01**: The system MUST provide a regenerate-and-diff guard that regenerates `adapters/` and fails (non-zero exit) if the freshly generated tree differs from the committed tree.
  - Priority: P0
- **REQ-CI-02**: The guard MUST run as a step in `scripts/validate.sh` (so it runs locally as part of the standard gate) AND in CI.
  - Priority: P0
- **REQ-CI-03**: On detected drift, the guard MUST print a clear remediation message instructing the maintainer to re-run the generator and commit the result.
  - Priority: P0
- **REQ-CI-04**: `bash scripts/validate.sh` MUST remain the single verification command for this feature (the generator, its dependencies, and the drift guard are all reachable through it).
  - Priority: P0

## 4. Non-Functional Requirements

### 4.1 Performance

- **REQ-PERF-01**: A full regeneration of all skills across all five target agents MUST complete fast enough to run in every local `validate.sh` invocation and CI run without being a perceptible bottleneck (target: a few seconds, not minutes).
  - Priority: P1

### 4.2 Security / Safety

- **REQ-SEC-01**: The generator MUST write only within the `adapters/` tree (plus the repo-root `AGENTS.md` if it touches it); it MUST NOT write anywhere else in the repo and MUST NOT write outside the repository root.
  - Priority: P0

### 4.3 Observability

- **REQ-OBS-01**: The generator MUST emit a generation report (or mapping document) that records, per agent, every canonical construct that was dropped or could not be represented (the "with-record" half of drop-with-record), so lost behavior is visible rather than silent.
  - Priority: P0
  - Notes: Whether the report is itself a committed artifact or build-time output is a tech-spec decision; the requirement is that the information is produced and discoverable.
- **REQ-OBS-02**: Generator error output on failure MUST identify the offending canonical file and the reason, sufficient for a maintainer to locate and fix the defect.
  - Priority: P0

### 4.4 Accessibility

- Not applicable — this feature produces files and CLI/CI tooling, with no end-user interface.

### 4.5 Scalability

- **REQ-SCALE-01**: Adding a new canonical skill MUST require no generator code change — the generator discovers skills by walking `skills/`, and the next regeneration emits the new skill for every agent automatically.
  - Priority: P1

## 5. Constraints

- **C-1 (target repo & cross-repo execution):** Implementation lands in `/home/gary/workspace/feature-forge`; this feature's specs/backlog/loop are driven from `rauf`. The forge-5-loop stage MUST use the validated native-in-feature-forge pattern (staged gitignored `.forge-loop/backlog.json` with absolute `specReferences`, run `rauf-stable loop run . --backlog .forge-loop` inside feature-forge, sync statuses back). rauf's `pnpm gate` does NOT apply.
- **C-2 (verification command):** The feature's verify command is `bash scripts/validate.sh` in feature-forge. There is no TypeScript/`pnpm` gate for this work.
- **C-3 (consumes, read-only):** The generator consumes `spec-pure-skills` (the 11 canonical `SKILL.md` + their `references/`) and `portable-skill-root-resolver` (`scripts/forge-root.sh`), both produced by `forge-skill-spec-purity`, strictly read-only. This feature MUST NOT modify canon.
- **C-4 (runtime dependency):** A new runtime dependency (e.g. a YAML parser or templating library) is permitted if it materially simplifies frontmatter translation. Any new dependency MUST be declared and provisioned such that `bash scripts/validate.sh` and CI install/run it automatically (the verify command must not require manual setup). Prefer minimal, well-maintained dependencies.
- **C-5 (canon authority):** Claude Code's plugin + marketplace install path stays first-class/preferred; everything else is derived from the single canonical source and never hand-edited divergently.

## 6. Out of Scope

The following are explicitly OWNED BY DOWNSTREAM EPIC MEMBERS and are NOT part of this feature:

- **Installing adapters into agent config directories** — detection, copy/symlink, add/update/uninstall/list, `--dry-run`, etc. Owned by `cross-agent-installer`. This feature only generates the `adapters/` tree into the repo.
- **Non-Claude bootstrap discovery paths** — extending `forge-root.sh`'s candidate-probe list so foreign agents can locate the resolver. The resolver is copied verbatim here; adding foreign-agent discovery is `cross-agent-installer`'s job.
- **Broader CI gates** — OS matrix, installer dry-run/uninstall matrix, trigger-accuracy evals, `claude plugin validate --strict`, version-header sync, `.gitattributes`/licensing alignment. Owned by `packaging-docs-ci`. This feature adds ONLY the regenerate-and-diff guard.
- **READMEs and per-agent setup/install documentation** — owned by `packaging-docs-ci`. (`AGENTS.md` is in scope; user-facing READMEs are not.)
- **Modifying canonical skills, descriptions, or triggering behavior** — owned upstream by `forge-skill-spec-purity`; this feature is purely additive and treats canon as read-only.

## 7. Open Questions

- **OQ-1 (Claude load source — deferred to forge-2-tech):** After build, does Claude's live plugin repoint `.claude-plugin/plugin.json` to `adapters/claude/` (uniform: every agent loads generated output; resolves the REQ-COMPAT smoke risk by construction), or does Claude keep loading `skills/` canon with `adapters/claude/` as a parallel packaging copy? The requirement (lossless Claude-native output MUST be generated) is fixed; the load-source wiring is a tech-spec decision.
- **OQ-2 (provenance for non-comment formats):** The exact mechanism for carrying provenance in formats that cannot hold a comment header (e.g. strict JSON manifests) is to be resolved in the tech spec (REQ-OUT-01).
- **OQ-3 (generation report location):** Whether the generation/mapping report is a committed artifact under `adapters/` or build-time-only output (REQ-OBS-01) — tech-spec decision.
- **OQ-4 (REQ-COMPAT dependency):** `forge-skill-spec-purity`'s manual REQ-COMPAT behavioral smoke (does Claude read `metadata.argument-hint`?) is still outstanding. Its outcome informs OQ-1 but does not block this feature, since the Claude adapter restores top-level `argument-hint` regardless.

## 8. Success Criteria

- Running the generator from a clean checkout produces a complete `adapters/` tree containing native artifacts for all five target agents (Claude, Codex, Copilot, Cursor, Gemini), each skill self-contained (references + resolver), every generated file carrying a provenance header.
- A canonical `AGENTS.md` exists at the feature-forge repo root documenting build/test, conventions, and install priority.
- `check-spec-purity.py` passes with `adapters/` excluded, while still enforcing purity over `skills/`/`references/`/`agents/`.
- `bash scripts/validate.sh` runs the generator + drift guard and passes on a freshly committed tree; introducing a canonical change without regenerating causes `validate.sh` (and CI) to fail with a clear regenerate-and-commit remediation message.
- Re-running the generator with no canon change yields no git diff (idempotency / determinism verified).
- A maintainer can edit one canonical skill, run one command, and see correct per-agent output regenerated for all five agents — with any unrepresentable constructs recorded in the generation report.
- The downstream `cross-agent-installer` has a stable, self-contained `adapters/` tree to consume (its `adapters-output` contract obligation is satisfied).
