# Verification Report: cross-agent-installer (prd)

- **Date:** 2026-06-16
- **Mode:** prd
- **Pipeline Stage:** forge-1-prd complete; forge-verify-prd pending
- **Verifier:** `forge-verifier` subagent (single, prd mode)

**Artifacts Reviewed:**
- `specs/agent-agnostic/cross-agent-installer/PRD.md` (primary — artifact under test)
- `specs/agent-agnostic/EPIC.md`
- `specs/agent-agnostic/epic-manifest.json`
- `specs/agent-agnostic/forge-agent-adapters-build/PRD.md` (dependency — exposes `adapters-output`)
- `specs/agent-agnostic/rauf-agent-cli-adapters/PRD.md` (dependency — exposes `agent-cli-registry`)
- `/home/gary/workspace/feature-forge/adapters/` (on-disk ground truth for the consumed adapters tree)

**Checks Executed:** 15 of 15 (12 pass, 3 fail, 0 not-applicable)

## Summary

- **Total findings:** 4
- **Gaps:** 2 · **Inconsistencies:** 1 · **Improvements:** 1 · **Errors:** 0
- **Blocking:** none. One finding (V-001) requires a user/architectural decision before its fix can be applied.

---

## Findings

### V-001: Consumed contract `agent-cli-registry` is named in Constraints but never bound to a functional requirement
- **Severity:** gap
- **Location:** PRD.md §3.7 (Rauf Bundling) and §5 C-3; cross-reference to `epic-manifest.json` `cross-agent-installer.consumes[1]`
- **What's wrong:** The epic manifest declares this feature `consumes` `agent-cli-registry` from `rauf-agent-cli-adapters` ("rauf's agent adapter layer, bundled as the default loop runner in the multi-agent install"). The §3.7 REQ-RAUF-* requirements bundle rauf strictly as a **published Node package / runnable bin** (REQ-RAUF-02) and never reference, consume, or depend on the `agent-cli-registry` module/contract itself — only on rauf-the-runnable-artifact. Constraint C-3 says "`agent-cli-registry` / the rauf binary … for bundling," conflating the registry module (a code contract) with the binary (a packaged artifact). Net: a contract obligation (`consumes: agent-cli-registry`) that does not cleanly trace to any REQ, and a C-3 statement that misdescribes what is consumed. Note §6 explicitly puts "rauf's internal agent-adapter code … `agent-cli-registry`" out of scope, which strongly suggests the manifest is mis-modeling the consumed thing.
- **Suggested fix:** Resolve the underlying question (see User Decision below), then either:
  - **(a) Manifest mis-models the consume:** the consumed thing is "a runnable rauf bin," not the `agent-cli-registry` module. Add a note to §5 C-3 separating "the rauf bin (bundled)" from the registry module (out of scope per §6), and flag the epic-manifest `consumes` entry for correction.
  - **(b) Registry genuinely consumed:** the installer must align its agent set with the agent ids rauf's registry recognizes. Add REQ-RAUF-06: "The installer's supported-agent set MUST stay consistent with the agent ids rauf's `agent-cli-registry` recognizes," and reword C-3 accordingly.
- **References:** `epic-manifest.json` lines 53–56; EPIC.md lines 138–140; PRD.md §3.7, §5 C-3, §6 (2nd bullet); rauf-agent-cli-adapters/PRD.md REQ-ADP-05 (defines `agent-cli-registry`)
- **Checklist:** CHECK-P08, CHECK-P14

### V-002: `agent-detection-map` exposed contract declared `kind: function` but PRD models it as static data, with no consistency check against rauf's agent set
- **Severity:** inconsistency
- **Location:** PRD.md §3.2 (REQ-DET-01); `epic-manifest.json` `cross-agent-installer.exposes[1]`
- **What's wrong:** (1) The manifest declares `agent-detection-map` as `kind: "function"` ("Per-agent config-dir map + detection used to target installs and CI dry-runs"), but REQ-DET-01 specifies it purely as a static data structure; the runtime-probe half that makes it a `function` contract lives in REQ-DET-02, and the PRD never frames the map+probe as the single exposed surface the manifest names. The downstream consumer `packaging-docs-ci` (OS-matrix dry-runs against it) needs to know whether it consumes a data table or a callable. (2) The map covers five agents; rauf's registry covers the same five plus `generic-cli`. The PRD never states the two agent sets must stay aligned, so they can silently drift (see V-001).
- **Suggested fix:** Add a sentence to REQ-DET-01 (or a new REQ-DET-05) making `agent-detection-map` the single exposed surface combining the static per-agent config-dir/destination table (REQ-DET-01) **and** the detection probe (REQ-DET-02), satisfying the manifest's `kind: function` characterization and the downstream consumer's expectation with one named requirement. Optionally cross-reference (consistent with the V-001 decision) whether alignment with rauf's registry ids is required.
- **References:** `epic-manifest.json` line 51; PRD.md §3.2 REQ-DET-01/02; EPIC.md lines 128–129, 183 (packaging-docs-ci consumes installer)
- **Checklist:** CHECK-P08, CHECK-P14

### V-003: No requirement covers behavior when the consumed `adapters/{agent}/` bundle is absent or malformed
- **Severity:** gap
- **Location:** PRD.md §3.3 (Operations) / §4.3 (Observability)
- **What's wrong:** The installer consumes `adapters/{agent}/` read-only (C-3) and copies/symlinks it (REQ-OPS-01). On-disk ground truth confirms per-agent bundles (`claude/codex/copilot/cursor/gemini`, each with `skills/ references/ scripts/ agents/`; gemini also `gemini-extension.json`). But no requirement covers the failure mode where a requested agent's bundle is **missing or incomplete** in the consumed tree (partial generation, or a checkout where `adapters/` was never generated). REQ-DET-04 covers "zero agents detected"; REQ-OBS-02 covers permission/conflict errors; neither covers "agent detected on the machine, but no source bundle exists to install for it." This is a realistic operational state (fresh clone before generation), leaving undefined behavior at the consumed-contract seam.
- **Suggested fix:** Add a P1 requirement under §3.3 or §4.3 (e.g., REQ-OPS-06 / REQ-OBS-04): "If a target agent is detected but its source bundle `adapters/{agent}/` is absent or fails a minimal integrity check, the installer MUST report this clearly (naming the agent and the expected source path) and MUST NOT write a partial install for that agent; it MUST continue with other agents per the per-agent partial-failure rule (REQ-OBS-03)." Symmetric to REQ-DET-04's zero-detection handling.
- **References:** PRD.md REQ-OPS-01, REQ-DET-04, REQ-OBS-02/03, §5 C-3; forge-agent-adapters-build/PRD.md REQ-OUT-02 (adapters committed); on-disk `/home/gary/workspace/feature-forge/adapters/`
- **Checklist:** CHECK-P14, CHECK-P08

### V-004: Gemini `gemini-extension.json` handling is deferred to a tech-spec Open Question with no governing outcome requirement
- **Severity:** improvement
- **Location:** PRD.md §7 OQ-5 (and §3.3 Operations)
- **What's wrong:** OQ-5 correctly defers the *method* of installing Gemini's `gemini-extension.json` (plain copy vs. place/merge) to the tech spec — legitimate deferral, not a gap. But the manifest is a distinguishing, behavior-relevant artifact (on-disk: `adapters/gemini/gemini-extension.json`, unique to Gemini), and there is no *requirement* that the install MUST yield a functional Gemini extension — only an open question about *how*. Contrast REQ-RAUF-01 (fixes the outcome) paired with REQ-RAUF-02/03 + OQ-1 (defer the shape): the Gemini manifest has an OQ for the how but no paired outcome REQ for the what.
- **Suggested fix:** Add a one-line outcome REQ (under REQ-OPS-01 notes or a new REQ-OPS-07): "For Gemini, the install MUST leave a valid, agent-loadable `gemini-extension.json` in the install destination (placement/merge mechanism is OQ-5)." Mirrors the REQ-RAUF-01-outcome / OQ-1-shape pattern already used well in the PRD.
- **References:** PRD.md §7 OQ-5, §3.3 REQ-OPS-01; on-disk `/home/gary/workspace/feature-forge/adapters/gemini/gemini-extension.json`; forge-agent-adapters-build/PRD.md REQ-FMT-01
- **Checklist:** CHECK-P04, CHECK-P05

---

## Per-Check Results

| Check | Result | Notes |
|---|---|---|
| CHECK-P01 (all template sections populated) | pass | §1–§8 all present and populated. |
| CHECK-P02 (no TBD/TODO) | pass | No placeholders; deferrals routed to §7. |
| CHECK-P03 (out-of-scope specific) | pass | §6 lists five concrete sibling-owned exclusions, each naming the owner. |
| CHECK-P04 (open questions actionable) | pass | OQ-1..OQ-5 specific, tech-spec-routed. (V-004 is about a missing paired REQ, not an OQ defect.) |
| CHECK-P05 (success criteria measurable) | pass | §8 criteria concrete, each cites the REQs it verifies. |
| CHECK-P06 (unique REQ IDs) | pass | All IDs unique and category-prefixed. No collisions. |
| CHECK-P07 (priorities assigned) | pass | Every REQ carries P0/P1. |
| CHECK-P08 (testable) | **fail** | Contributes to V-001 and V-002. |
| CHECK-P09 (no tech leakage / labeled constraints) | pass | Node/npx, published-package, pin decisions framed as requirements-with-rationale + §5 constraints; manifest schema correctly deferred to OQ-2. No HOW-creep. |
| CHECK-P10 (user stories cover actors) | pass | Developer (multiple modes), CI/scripted, first-time user, downstream consumers. |
| CHECK-P11 (NFRs quantified) | pass | REQ-PERF-01 "seconds not minutes" + "effectively instant" dry-run/list. |
| CHECK-P12 (security explicit) | pass | §4.2 write-confinement, no elevated privileges, path sandboxing, symlink-escape protection. |
| CHECK-P13 (mandate vs preference) | pass | MUST/MAY/SHOULD precise; C-5 Claude-preferred vs universal clear. |
| CHECK-P14 (implicit requirements) | **fail** | Surfaces V-001, V-002, V-003. |
| CHECK-P15 (requirement conflicts/tensions) | pass | Copy-vs-symlink, project-vs-global, Claude-preferred-vs-universal, and network-vs-instant-detection tensions all resolved. |

---

## Fix Execution Plan

### User Decisions Required

- **V-001 requires a decision before fixing:** Is `agent-cli-registry` genuinely a consumed contract (installer must align its agent set with rauf's registry), or is the epic manifest mis-modeling "consumes the published rauf bin"? This determines option (a) flag-manifest vs. option (b) add-REQ-RAUF-06. §6 putting `agent-cli-registry` out of scope strongly suggests option (a). Resolve via `AskUserQuestion` (in `forge-fix`) before applying Steps 1–2.

### Execution Steps

#### Step 1: Resolve and bind the consumed `agent-cli-registry` contract
- **Files:** PRD.md §3.7, §5 C-3; possibly flag `specs/agent-agnostic/epic-manifest.json`
- **Addresses:** V-001 · **Checklist:** CHECK-P08, CHECK-P14
- **Action:** After the user decision — (a) note in C-3 that the consumed thing is the published runnable rauf and that the registry module is out of scope per §6, recommending the manifest `consumes` entry be revisited; or (b) add REQ-RAUF-06 (agent-set/registry-id alignment) and reword C-3 to separate "rauf bin (bundled)" from "agent-cli-registry (consumed for id alignment)."
- **Depends on:** User decision.

#### Step 2: Clarify the `agent-detection-map` exposed surface
- **Files:** PRD.md §3.2 (REQ-DET-01, or new REQ-DET-05)
- **Addresses:** V-002 · **Checklist:** CHECK-P08, CHECK-P14
- **Action:** Add a sentence making `agent-detection-map` the single exposed surface combining the static table (REQ-DET-01) and the detection probe (REQ-DET-02), satisfying the manifest `kind: function` and the OS-matrix consumer. Include the optional registry-id-alignment clause only if Step 1 chose option (b).
- **Depends on:** Step 1 (alignment wording must be consistent).

#### Step 3: Add missing-bundle failure-mode requirement
- **Files:** PRD.md §3.3 or §4.3 (new REQ-OPS-06 / REQ-OBS-04)
- **Addresses:** V-003 · **Checklist:** CHECK-P14, CHECK-P08
- **Action:** Add the P1 requirement described in V-001's... see V-003 suggested fix (detected-but-no-source-bundle → report, no partial install, continue per REQ-OBS-03).
- **Depends on:** none.

#### Step 4: Add Gemini manifest outcome requirement
- **Files:** PRD.md §3.3 (REQ-OPS-01 notes or new REQ-OPS-07)
- **Addresses:** V-004 · **Checklist:** CHECK-P04, CHECK-P05
- **Action:** Add the one-line Gemini outcome REQ (valid, agent-loadable `gemini-extension.json` in destination; mechanism = OQ-5).
- **Depends on:** none.

---

**Overall assessment:** A strong, disciplined PRD — clean on template completeness, requirement IDs/priorities, security, no-tech-leakage, and Open-Questions discipline. The four findings cluster at the epic-member contract seams (one consumed-contract mismodel needing a decision, one exposed-surface ambiguity, two missing failure-mode/outcome requirements). None are blocking; V-001 needs a quick decision in the fix pass.
