# Verification Findings: forge-agent-adapters-build (tech)

- **Feature:** forge-agent-adapters-build
- **Epic:** agent-agnostic
- **Mode:** tech
- **Date:** 2026-06-16
- **Pipeline Stage:** forge-3-specs (verifying forge-2-tech output)
- **Artifacts Reviewed:**
  - `specs/agent-agnostic/forge-agent-adapters-build/PRD.md`
  - `specs/agent-agnostic/forge-agent-adapters-build/tech-spec.md`
  - cross-referenced against feature-forge canon (`/home/gary/workspace/feature-forge`) and `specs/agent-agnostic/epic-manifest.json`
- **Checks Executed:** 17 of 17 — **14 pass, 3 fail, 0 not-applicable**
- **Dispatch:** single `forge-verifier` (tech mode, ~15 checks)

## Summary

| Severity | Count |
|---|---|
| error | 1 |
| gap | 1 |
| inconsistency | 0 |
| improvement | 1 |
| **Total** | **3** |

Both pipeline-state special-attention items were confirmed **satisfied**:

- **TQ-1** (confirm Codex/Copilot/Cursor/Gemini native frontmatter schemas against official docs) is properly captured as an explicit deferred-to-impl open question (§10 TQ-1, the §6 WARNING box, and per-row `TQ-1` flags in the §5 mapping table) — not silently assumed.
- **TQ-2** (YAML library pin as part of the determinism contract) is concretely specified: PyYAML named as default in `scripts/requirements-adapters.txt` with version-pinning intent (§9), tied to byte-stability (§3.6); §10 TQ-2 defers only the PyYAML-vs-ruamel emit-fidelity *choice*, keeping "version pinned, emit options fixed" non-negotiable.

---

## Findings

### V-001: AgentRecord / sub-agent key schema is wrong — omits `effort` and treats `memory`/`skills` as universal

- **Severity:** error
- **Location:** tech-spec.md §3.1 (step 2 "Parse" + "Sub-agent translation" para), §4 Data Model (`AgentRecord.claude_keys` comment), §6 Integration Points (`agents/*.md` line)
- **What's wrong:** Three places assert the canonical sub-agent frontmatter is `{name, description, tools, model, maxTurns, memory, skills}`. Verified against the actual 3 canon files in feature-forge, the per-agent key sets are NOT uniform and do not match:
  - `forge-researcher.md`: `name, description, tools, model, maxTurns, effort`
  - `forge-spec-writer.md`: `name, description, tools, model, maxTurns`
  - `forge-verifier.md`: `name, description, tools, model, maxTurns, memory, skills`

  So `effort` is a real Claude-only key the spec never names, and `memory`/`skills` appear on only one agent each (not universal). Because REQ-GEN-06's translation + the drop-with-record report (REQ-OBS-01) must enumerate exactly which Claude-only keys get dropped per target, an incomplete/incorrect key list causes the generator to silently miss `effort` (neither translated nor recorded-as-dropped — a drop-without-record, violating REQ-FMT-03/REQ-OBS-01), and the AgentRecord data model fails to capture it.
- **Suggested fix:** In §3.1, §4, and §6, replace the fixed list `{tools, model, maxTurns, memory, skills}` with the verified **union** of Claude-only keys actually present across `agents/*.md`: `{tools, model, maxTurns, effort, memory, skills}`, and state that the set is **per-file (discovered from each agent's frontmatter), not a fixed schema** — i.e., the AgentRecord must carry whatever non-`{name, description}` frontmatter keys each file actually has, so a future agent adding a new Claude-only key is auto-covered (consistent with REQ-SCALE-01's discovery principle). Add to §3.1's sub-agent-translation paragraph: "every Claude-only key not representable in the target is dropped-with-record, enumerated from the parsed frontmatter rather than a hard-coded list."
- **References:** feature-forge `agents/forge-researcher.md` (has `effort`), `agents/forge-verifier.md` (has `memory`+`skills`), `agents/forge-spec-writer.md` (neither); PRD REQ-GEN-06, REQ-FMT-03, REQ-OBS-01, REQ-SCALE-01
- **Checklist:** CHECK-T05, CHECK-T12, CHECK-T16

### V-002: `.gitignore` amendment for `.venv-adapters/` and `adapters.tmp-<pid>/` is unspecified

- **Severity:** gap
- **Location:** tech-spec.md §2 Module Structure (lists `.venv-adapters/ — NEW, GITIGNORED`), §3.1 step 4 (atomic publish via sibling `adapters.tmp-<pid>/`), §9 Dependencies
- **What's wrong:** The spec relies on two untracked working artifacts: the gitignored `.venv-adapters/` venv (§9) and sibling temp build dirs `adapters.tmp-<pid>/` used by atomic publish (§3.1 step 4). It labels `.venv-adapters/` "GITIGNORED" but never states that `.gitignore` must be **amended** to add these patterns — and feature-forge's current `.gitignore` contains no `venv`, `.tmp`, or `adapters.tmp` entry (verified). Without the entry: (a) the venv shows as a large untracked tree on every `validate.sh` run, and (b) an aborted build (REQ-ROB-01 fail-fast path) can leave an `adapters.tmp-<pid>/` dir that appears as untracked noise and could pollute a future `--check` diff or a maintainer's commit. This is a concrete, missing implementation step for REQ-DET-02 / REQ-SEC-01 hygiene.
- **Suggested fix:** Add to §2 (or §9) an explicit deliverable: "Amend `feature-forge/.gitignore` to add `.venv-adapters/` and `adapters.tmp-*/` (and any `adapters.tmp-<pid>` temp pattern)." Optionally specify the generator places its temp dir under a name covered by that ignore pattern (e.g. `adapters.tmp-<pid>/`) so the ignore rule is a single glob. Note this `.gitignore` edit is outside `adapters/` and is permitted by REQ-SEC-01 only as a repo-config change — call it out so the path-sandbox assertion in §7 isn't read as forbidding it (the generator itself still writes only under `adapters/`; the `.gitignore` edit is a one-time setup deliverable, not a generator write).
- **References:** feature-forge `.gitignore` (no venv/tmp entry — verified); PRD REQ-DET-02, REQ-ROB-01, REQ-SEC-01; tech-spec §7 path-safety
- **Checklist:** CHECK-T08, CHECK-T13, CHECK-T14

### V-003: GENERATION-REPORT.md provenance-header treatment is ambiguous

- **Severity:** improvement
- **Location:** tech-spec.md §3.5 (Provenance header rules vs. Generation report), §2 (`adapters/GENERATION-REPORT.md — committed drop-with-record report`)
- **What's wrong:** REQ-OUT-01 requires "every generated file in `adapters/`" to carry a provenance header. `GENERATION-REPORT.md` is a generated, committed `adapters/` file (§3.5 explicitly says it is "part of the drift-guarded tree"), so by the literal requirement it needs a provenance header — but §3.5's provenance rules enumerate only "Markdown / `.mdc` / YAML-frontmatter files", "Strict JSON", and "Copied scripts (`forge-root.sh`, no header)". The report is markdown but has no frontmatter block, so it's unclear whether it gets the in-frontmatter comment form (it has no `---` block), a body-top line, or is treated like `forge-root.sh` (header-exempt). A fresh implementing agent could reasonably do any of the three, and the §8 provenance test ("every generated `.md`/`.mdc` has the in-frontmatter header") would then either falsely fail on the report or need an unspecified carve-out.
- **Suggested fix:** Add one sentence to §3.5 stating the report's provenance treatment explicitly — recommended: `GENERATION-REPORT.md` carries a body-top provenance line (`<!-- GENERATED — DO NOT EDIT. Generated by python3 scripts/build-adapters.py -->` as its first line) since it has no frontmatter block, and amend the §8 provenance-test description to scope "in-frontmatter header" to files that have frontmatter, with frontmatter-less generated markdown (the report) asserted to carry the body-top form.
- **References:** PRD REQ-OUT-01, REQ-OBS-01; tech-spec §8 (provenance test)
- **Checklist:** CHECK-T10, CHECK-T11, CHECK-T16

---

## Per-check Results

| Check | Result | Note |
|---|---|---|
| CHECK-T01 (decisions trace to REQ) | pass | D1–D5 + every §3 subsection cite REQ-IDs |
| CHECK-T02 (no contradiction of constraints) | pass | C-1..C-5 honored; venv auto-provision satisfies C-4; canon read-only honored |
| CHECK-T03 (every P0 has a decision/deferral) | pass | All P0 REQs covered; deferrals (TQ-1/TQ-2) are field-level, not requirement-level |
| CHECK-T04 (integration analysis complete) | pass | §6 names all deps + both downstream consumers |
| CHECK-T05 (import paths/signatures verified) | **fail** | V-001: agent frontmatter key set wrong |
| CHECK-T06 (shared contracts named) | pass | spec-pure-skills, portable-skill-root-resolver, adapters-output all named |
| CHECK-T07 (data-flow direction clear) | pass | canon→generator→adapters/; read-only in, write only adapters/ |
| CHECK-T08 (changes to existing pkgs specified) | **fail** | check-spec-purity.py + validate.sh edits specified; `.gitignore` edit missing (V-002) |
| CHECK-T09 (alternatives considered) | pass | D2 PyYAML vs ruamel; D5 whole-tree vs per-file closure; stdlib-hand-emit weighed |
| CHECK-T10 (error handling defined) | pass | §7 fail-fast/atomic-publish/path-safety; one report-header edge (V-003) |
| CHECK-T11 (testing approach specified) | pass | §8 maps a test to each major REQ; tests run via soft-skippable pytest step (matches existing pattern) |
| CHECK-T12 (data model aligns w/ PRD) | **fail** | V-001: AgentRecord key list inaccurate |
| CHECK-T13 (module structure + exports map) | pass | §2 tree + §2 "Public API surface" (3 exposed contracts) |
| CHECK-T14 (configuration approach) | pass | requirements-adapters.txt pin + venv provisioning; minor `.gitignore` gap rolled into V-002 |
| CHECK-T15 (migration/deployment) | pass | D1 keeps plugin.json loading skills/ (no live-plugin migration); "in CI" deferred to packaging-docs-ci correctly |
| CHECK-T16 (integration surprises) | pass | TQ-1 WARNING box + TQ-3 parser-tolerance flag real impl risks; V-001/V-003 are the concrete ones |
| CHECK-T17 (scalability concerns) | pass | REQ-SCALE-01 discovery-driven; §3.6 perf bounded (~11×5 markdown, sub-second) |

---

## Fix Execution Plan

### User Decisions Required

None — all three fixes can be applied directly. V-001 uses the verified key union; V-002 is a standard ignore-pattern addition; V-003 has a recommended concrete form.

### Execution Steps

#### Step 1: Correct the sub-agent frontmatter key schema (V-001)

- **Files:** `specs/agent-agnostic/forge-agent-adapters-build/tech-spec.md` — §3.1 (step 2 + sub-agent-translation paragraph), §4 (AgentRecord comment), §6 (`agents/*.md` line)
- **Checklist:** CHECK-T05, CHECK-T12, CHECK-T16
- **Action:** Replace every occurrence of the Claude-only key list `{tools, model, maxTurns, memory, skills}` with `{tools, model, maxTurns, effort, memory, skills}`, and add a clause stating these keys are **discovered per-file from each agent's frontmatter, not a fixed schema** (so drop-with-record enumerates actual keys; new keys auto-covered per REQ-SCALE-01). Ground truth: `forge-researcher` has `effort`; only `forge-verifier` has `memory`+`skills`; `forge-spec-writer` has neither.
- **Depends on:** none
- **Rationale:** Foundational — the data model and REQ-GEN-06/REQ-OBS-01 coverage depend on the correct key set; fix before any downstream spec doc cites AgentRecord.

#### Step 2: Specify the `.gitignore` amendment deliverable (V-002)

- **Files:** `specs/agent-agnostic/forge-agent-adapters-build/tech-spec.md` — §2 or §9; cross-note §7
- **Checklist:** CHECK-T08, CHECK-T13, CHECK-T14
- **Action:** Add an explicit deliverable to amend `feature-forge/.gitignore` with `.venv-adapters/` and the temp-build pattern (`adapters.tmp-*/`). Note in §7 that this one-time repo-config edit is permitted alongside REQ-SEC-01 (the generator itself still writes only under `adapters/`).
- **Depends on:** none
- **Rationale:** Independent hygiene fix; groups naturally with the venv/atomic-publish description.

#### Step 3: Disambiguate GENERATION-REPORT.md provenance (V-003)

- **Files:** `specs/agent-agnostic/forge-agent-adapters-build/tech-spec.md` — §3.5 (provenance rules) + §8 (provenance test description)
- **Checklist:** CHECK-T10, CHECK-T11, CHECK-T16
- **Action:** Add a sentence to §3.5 stating `GENERATION-REPORT.md` (markdown, no frontmatter) carries a body-top provenance line as its first line; amend the §8 provenance-test wording to scope "in-frontmatter header" to files with frontmatter and assert the body-top form for frontmatter-less generated markdown.
- **Depends on:** none
- **Rationale:** Smallest, localized clarification; ordered last as it's an improvement, not a correctness blocker.

---

## Fix Progress

- Step 1: [APPLIED] 2026-06-16 — V-001: corrected sub-agent frontmatter key schema to the per-file discovered union `{tools, model, maxTurns, effort, memory, skills}` across §3.1 (step 2 + sub-agent-translation para), §4 (AgentRecord comment), §6 (`agents/*.md` line); stated keys are discovered per-file, not a fixed schema (REQ-SCALE-01), so `effort` is enumerated for drop-with-record.
- Step 2: [APPLIED] 2026-06-16 — V-002: added explicit `.gitignore` amendment deliverable (`.venv-adapters/`, `adapters.tmp-*/`) to §9; added §7 note that the one-time repo-config edit is not a generator write and does not violate REQ-SEC-01.
- Step 3: [APPLIED] 2026-06-16 — V-003: specified `GENERATION-REPORT.md` (frontmatter-less) carries a body-top provenance line in §3.5; scoped the §8 provenance test to frontmatter files + asserted the body-top form for the report.
