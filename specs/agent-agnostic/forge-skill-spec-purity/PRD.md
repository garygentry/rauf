# forge-skill-spec-purity — Product Requirements Document

> **Epic:** `agent-agnostic` · **Feature:** `forge-skill-spec-purity` · **Version:** 1
> **Target repo:** `feature-forge` · **Depends on:** none · **Consumed by:** `forge-agent-adapters-build`

## 1. Problem Statement

The `feature-forge` skill suite (11 `SKILL.md` files plus bundled scripts, hooks, and references) was authored exclusively for Claude Code. Its `SKILL.md` files carry Claude-specific frontmatter (`argument-hint`), its scripts and hooks are located via the Claude-only `${CLAUDE_PLUGIN_ROOT}` environment variable (~20 occurrences), and several skill bodies exceed the recommended size for the Agent Skills format. This Claude-coupling blocks the broader `agent-agnostic` epic: before per-agent adapters (Codex, Copilot, Cursor, Gemini) can be **generated**, there must first exist a **canonical, vendor-neutral source of truth** that conforms to the published Agent Skills specification.

Today there is no such canon. Every downstream feature in the epic (`forge-agent-adapters-build`, `cross-agent-installer`, `packaging-docs-ci`) consumes "the spec-pure skills" as a read-only input — but that artifact does not yet exist. This feature creates it.

**Who has the problem:** the maintainer (Gary), who must keep one source of truth rather than N hand-edited per-agent copies; and every downstream epic feature, which cannot begin until canon exists.

**Why now:** it is the root of the epic dependency graph (`dependsOn: []`). Nothing else in the `feature-forge` half of the epic can start until this lands.

## 2. User Stories

- **As the feature-forge maintainer**, I want every `SKILL.md` to carry only spec-sanctioned frontmatter, so that the files validate against the Agent Skills schema and remain portable across coding agents.
- **As the maintainer**, I want all Claude-specific data preserved (not discarded) in a spec-allowed location, so that the later adapter generator can faithfully reconstruct Claude-native output with no information loss.
- **As the author of `forge-agent-adapters-build`**, I want a single, consistent, machine-parseable canonical skill set as my read-only input, so that I can derive every per-agent artifact deterministically.
- **As the author of `packaging-docs-ci`**, I want a runnable definition of "spec-pure", so that I can wire it into CI as a gate without re-deriving the rules.
- **As any coding agent running a bundled forge script**, I want the script's location resolved without depending on a Claude-only environment variable, so that the skill functions when installed under a non-Claude agent.
- **As an existing Claude Code user of feature-forge**, I want every skill to keep triggering and behaving exactly as before, so that this refactor is invisible to me.

## 3. Functional Requirements

### 3.1 Frontmatter Spec-Purity

- **REQ-FM-01**: Every `skills/*/SKILL.md` frontmatter MUST contain only keys from the spec-sanctioned set: `name`, `description` (both required) plus the optional set `license`, `compatibility`, `metadata`, `allowed-tools`. No other top-level frontmatter keys may remain.
  - Priority: P0
- **REQ-FM-02**: Each skill's `name` MUST exactly equal its containing directory name (`skills/<name>/SKILL.md`).
  - Priority: P0
- **REQ-FM-03**: Each skill's `description` MUST be preserved verbatim (the existing descriptions are already trigger-tuned); reduction work MUST NOT alter description text.
  - Priority: P0
- **REQ-FM-04**: Frontmatter MUST remain valid YAML and parse without error.
  - Priority: P0

### 3.2 Vendor-Key Relocation

- **REQ-VND-01**: The Claude-specific `argument-hint` key MUST be relocated out of top-level frontmatter into the spec-allowed `metadata` map (preserving its value), for every skill that currently declares it.
  - Priority: P0
  - Notes: Default chosen in lieu of a per-agent sidecar; keeps canon self-contained and lossless.
- **REQ-VND-02**: Any other vendor-only directive discovered during the audit (Claude hook wiring, and forward-looking Codex/Copilot/Cursor invocation policy) MUST be removed from the canonical `SKILL.md` body and frontmatter, and either relocated to a clearly non-canonical location or documented as belonging to a later per-agent adapter.
  - Priority: P0
- **REQ-VND-03**: The audit MUST be exhaustive: a documented inventory of every vendor-specific construct found across all 11 skills (and their `references/`) MUST be produced, with each item's disposition (relocated / removed / preserved-as-spec-allowed) recorded.
  - Priority: P1
- **REQ-VND-04**: Claude hook wiring (`hooks/hooks.json`) is Claude-specific. This feature MUST NOT delete functioning Claude behavior; it MAY leave `hooks.json` in place as a non-canonical Claude artifact, but MUST document it as vendor-specific (out of canon) so the adapter build treats it accordingly.
  - Priority: P1

### 3.3 Portable Script-Root Resolution

- **REQ-RES-01**: A portable resolver MUST be provided that locates bundled scripts/assets without depending on the Claude-only `${CLAUDE_PLUGIN_ROOT}` environment variable.
  - Priority: P0
- **REQ-RES-02**: The resolver MUST resolve the skill/plugin root relative to its own on-disk location first (so it works under any agent's install layout), then fall back to probing known candidate skill roots and finally honored environment variables (including `${CLAUDE_PLUGIN_ROOT}` for backward compatibility).
  - Priority: P0
- **REQ-RES-03**: Every current `${CLAUDE_PLUGIN_ROOT}` usage in canonical surfaces — `SKILL.md` bodies, `references/`, and `hooks` invocations — MUST be replaced by (or routed through) the portable resolver, OR retained only as a documented fallback inside the resolver itself.
  - Priority: P0
  - Notes: ~20 occurrences identified across `forge-0-epic`, `forge`, `forge-verify`, `forge-5-loop`, `forge-6-docs`, `forge-init`, `shared-conventions.md`, and `hooks.json`.
- **REQ-RES-04**: When the root cannot be resolved by any strategy, the resolver MUST fail with a clear, actionable error message (not a silent failure or an empty path).
  - Priority: P1
- **REQ-RES-05**: The resolver MUST be a reusable unit (a single function/script) so the later adapter build can copy it verbatim into per-agent script mirrors. It is one of this feature's two exposed artifacts (`portable-skill-root-resolver`).
  - Priority: P0

### 3.4 Skill Body Size Discipline

- **REQ-SIZE-01**: Each `SKILL.md` body SHOULD be reduced to within the Agent Skills recommended size budget; overflow detail MUST be moved into the skill's `references/` directory rather than deleted.
  - Priority: P1
  - Notes: Known overruns to address: `forge-0-epic` (522 lines), `forge-5-loop` (423), `forge-verify` (342). Remaining 8 skills are already within budget and need no size work.
- **REQ-SIZE-02**: Relocating content into `references/` MUST preserve all instructions; any reference the body relied on inline MUST become an explicit pointer to the moved content so the agent can still find it.
  - Priority: P0
- **REQ-SIZE-03**: A concrete, checkable size budget MUST be defined (e.g., a maximum line and/or word count for the body) so "within recommended size" is objectively verifiable.
  - Priority: P1

### 3.5 Canonical Single Source of Truth

- **REQ-SOT-01**: After this feature, `skills/*/SKILL.md` (plus their `references/` and the portable resolver) MUST constitute the single canonical source from which all per-agent adapters are later generated. This is the exposed `spec-pure-skills` artifact.
  - Priority: P0
- **REQ-SOT-02**: This feature MUST NOT produce any per-agent output (no Codex mirror, no Copilot copy, no Cursor `.mdc`, no `gemini-extension.json`, no `AGENTS.md`). Those belong to `forge-agent-adapters-build`.
  - Priority: P0
- **REQ-SOT-03**: The canonical set MUST be internally consistent: cross-references between skills and references MUST resolve, and no skill may point to a vendor-specific path that only exists under one agent.
  - Priority: P1

### 3.6 Spec-Purity Verification

- **REQ-VER-01**: A runnable spec-purity checker MUST be delivered that validates the canon against the rules in §3.1–§3.4: allowed-frontmatter-keys-only, `name == directory`, required keys present, no residual `${CLAUDE_PLUGIN_ROOT}` in canonical surfaces (outside the resolver's documented fallback), and size budget compliance.
  - Priority: P0
  - Notes: `packaging-docs-ci` wires this into CI later; this feature owns the check itself so it has an objective acceptance gate.
- **REQ-VER-02**: The checker MUST exit non-zero and report each violation with file + reason when canon is impure, and exit zero when canon is clean.
  - Priority: P0
- **REQ-VER-03**: The checker MUST run green against the final state of all 11 skills as the feature's completion gate.
  - Priority: P0

## 4. Non-Functional Requirements

### 4.1 Behavioral Preservation (Compatibility)

- **REQ-COMPAT-01**: All 11 skills MUST continue to trigger and behave identically under Claude Code after the refactor. Reducing frontmatter, relocating `argument-hint`, moving body content to `references/`, and swapping the resolver MUST be behavior-preserving for the current (Claude) agent.
  - Priority: P0
- **REQ-COMPAT-02**: The `feature-forge` plugin MUST remain installable and loadable as a Claude Code plugin (plugin manifest still valid; skills still discovered).
  - Priority: P0
- **REQ-COMPAT-03**: Bundled scripts (`epic-manifest.py`, `session-check.sh`, `forge-init.sh`, `validate-traceability.py`, `validate.sh`) MUST continue to be locatable and runnable via the new resolver in the existing Claude environment.
  - Priority: P0

### 4.2 Maintainability

- **REQ-MAINT-01**: The relocation/reduction MUST favor a mechanical, reviewable transformation (one concern per change) so the diff is auditable and the canon stays easy to keep pure.
  - Priority: P1

### 4.3 Observability

- **REQ-OBS-01**: The spec-purity checker's output MUST be human-readable (clear pass/fail summary plus per-violation detail) and suitable for later machine consumption in CI.
  - Priority: P1

### 4.4 Security / Safety

- **REQ-SEC-01**: The portable resolver MUST resolve only to legitimate skill-root locations and MUST NOT execute or source untrusted paths; path resolution MUST be bounded to candidate roots and the script's own location.
  - Priority: P1

## 5. Constraints

- **C-1 (target repo):** All implementation changes land in the `feature-forge` repository (`/home/gary/workspace/feature-forge`), even though this epic's specs, backlog, and loop run from the `rauf` repository (`/home/gary/workspace/rauf/specs/agent-agnostic/`). The loop iteration operates against the `feature-forge` working tree.
- **C-2 (spec authority):** "Spec-sanctioned frontmatter" is defined by the published Agent Skills specification: `name`, `description` (required) plus optional `license`, `compatibility`, `metadata`, `allowed-tools`. This set is the binding contract for §3.1.
- **C-3 (no per-agent output):** This feature changes no per-agent artifact; adapter generation is owned by the downstream `forge-agent-adapters-build` feature.
- **C-4 (Claude remains first-class):** Claude Code is the agent currently exercising these skills; backward compatibility with Claude (including `${CLAUDE_PLUGIN_ROOT}` as a resolver fallback) MUST be retained.
- **C-5 (existing tooling):** Bundled scripts are Python 3 and Bash; the resolver and checker SHOULD fit the existing `scripts/` toolchain conventions.

## 6. Out of Scope

- Generating any per-agent adapter (Codex/Copilot/Cursor/Gemini) or `AGENTS.md` — that is `forge-agent-adapters-build`.
- Building the cross-agent installer — that is `cross-agent-installer`.
- Standing up CI gates, OS matrices, evals, versioning/licensing alignment — that is `packaging-docs-ci` (this feature only provides the runnable checker it will wire in).
- Wiring `forge-5-loop` to default to rauf across agents — that is `forge-rauf-loop-default`.
- Rewriting skill *descriptions* or changing skill *behavior/triggering*.
- Any changes to the `rauf` repository's own skills (this feature targets `feature-forge` skills only).

## 7. Open Questions

- **OQ-1:** Exact line/word budget for §3.4 — adopt the Agent Skills published recommendation verbatim, or a stricter project-local budget? (Default: published recommendation, ~500 lines / ~5k words body.) → tech spec.
- **OQ-2:** Resolver implementation surface — a shared shell snippet, a tiny Python helper, or both (since bundled scripts are mixed Bash/Python)? → tech spec.
- **OQ-3:** Final disposition of `hooks/hooks.json` — leave in place as a documented Claude artifact vs. relocate under a future `adapters/claude/` location now. (Default: leave + document; relocation is the adapter build's concern.) → tech spec.

## 8. Success Criteria

1. The spec-purity checker (REQ-VER-01) runs green against all 11 skills.
2. Every `SKILL.md` frontmatter contains only spec-sanctioned keys, with `argument-hint` preserved under `metadata` (REQ-FM-01, REQ-VND-01).
3. No canonical surface depends on `${CLAUDE_PLUGIN_ROOT}` except as a documented resolver fallback (REQ-RES-03).
4. The three oversized skills are within the defined size budget, with relocated content intact in `references/` (REQ-SIZE-01/02).
5. All 11 skills still trigger and behave identically under Claude Code; the plugin still loads (REQ-COMPAT-01/02).
6. A vendor-construct inventory with dispositions exists (REQ-VND-03).
7. The canon is consumable as the read-only `spec-pure-skills` + `portable-skill-root-resolver` inputs by `forge-agent-adapters-build` (REQ-SOT-01/05).
