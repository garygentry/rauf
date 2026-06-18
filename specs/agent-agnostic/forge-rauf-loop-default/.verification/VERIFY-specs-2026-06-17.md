# Verification Report: forge-rauf-loop-default (specs)
Date: 2026-06-17
Pipeline Stage: forge-4-backlog (verifying forge-3-specs output)
Artifacts Reviewed: PRD.md, tech-spec.md, 00-core-definitions.md, 01-architecture-layout.md, 02-config-schema-and-gating.md, 03-selection-resolution-observability.md, 04-availability-precheck.md, 05-runner-discovery-version-gate.md, 06-loop-runner-contract-doc.md, 07-testing-strategy.md, TRACEABILITY.md

Verification method: 5 parallel `forge-verifier` instances over disjoint check dimensions
(types/contracts, architecture/tech-consistency, cross-reference/traceability, testing,
integration/error-handling/NFR), covering all 38 specs-mode checks (CHECK-S01..S38), plus the
deterministic traceability validator. Findings merged, deduped, and renumbered below.

Deterministic validator: 29 requirements, 8 spec files, **0 uncovered requirements**, 1
orphaned reference (`REQ-DIST-01` — investigated, see V-011).

## Summary
- Total findings: 11
- Gaps: 3
- Inconsistencies: 2
- Improvements: 2
- Errors: 4

## Findings

### V-001: `resolve()` test call sites omit the required `runner_default_id` argument (2-arg vs 3-arg)
- **Severity:** error
- **Location:** 07-testing-strategy.md, §3.1 (lines 88–93)
- **Issue:** The canonical `resolve` signature has **three required** positional params — `resolve(run_selection: str | None, default_agent: str, runner_default_id: str)` — with **no default** on `runner_default_id` (confirmed in 03-selection-resolution-observability.md §3.1 lines 170–174 and 07 §2 lines 51–55). But every test case in §3.1 calls it with **two** args: `resolve("codex", "gemini")`, `resolve(None, "gemini")`, `resolve(None, "")`, `resolve(None, None)`, `resolve("claude-cli", "gemini")`. Each would raise `TypeError: missing 1 required positional argument: 'runner_default_id'`. 03's own Verification block (lines 469–478) correctly uses the 3-arg form (e.g. `resolve("codex", "", "claude-cli")`), so §3.1 is the outlier. A fresh agent transcribing §3.1 verbatim would write tests that cannot run. Additionally, `resolve(None, None)` (line 91) passes `None` for `default_agent`, which is typed `str` (not `str | None`) in 03 §3.1 line 172 and 07 §2 line 53 — a type contradiction (the impl's `_clean` tolerates `None` at runtime, but the annotation forbids it).
- **Suggested fix:** Update every §3.1 call to the 3-arg form, e.g. `resolve("codex", "gemini", "claude-cli")`, `resolve(None, "", "claude-cli")`, matching 03's Verification examples. For `resolve(None, None)`: either change it to `resolve(None, "")` (already listed alongside, exercises the same DEFAULT branch — the `None` case is redundant), or widen `default_agent` to `str | None` consistently in 00 §4, 03 §3.1, and 07 §2. See the alternative unifying fix in V-005 (give `resolve`/`classify` a default `runner_default_id`), which would also resolve this — pick one approach across all three docs.
- **References:** 00-core-definitions.md §4; 03-selection-resolution-observability.md §3.1 (lines 170–174) + Verification (469–478); 07-testing-strategy.md §2 (51–55), §3.1
- **Checklist:** CHECK-S08, CHECK-S11, CHECK-S17, CHECK-S38

### V-002: `classify()` test call sites omit the required `runner_default_id` argument (2-arg vs 3-arg)
- **Severity:** error
- **Location:** 07-testing-strategy.md, §3.2 (lines 106–109)
- **Issue:** `classify` is defined with **three required** params — `classify(resolved_agent: str, agents: list[AgentAvailability], runner_default_id: str)` (04-availability-precheck.md §3.2 lines 165–169; 07 §2 lines 58–63). But §3.2 calls it with **two** args: `classify("codex", agents)`, `classify("gemini", agents)`, `classify("bogus", agents)`. Each would raise `TypeError` for the missing `runner_default_id`. 04's own verification checklist writes the calls correctly with three args (`classify("codex", agents, "claude-cli")`), so §3.2 is the outlier. Same root cause as V-001 (test fixtures don't match the real interface shape).
- **Suggested fix:** Update the three §3.2 invocations to pass the third argument: `classify("codex", agents, "claude-cli")`, `classify("gemini", agents, "claude-cli")`, `classify("bogus", agents, "claude-cli")` (or `RUNNER_DEFAULT_ID`), matching 04 §3.2 and 04's verification list. (Or apply the unifying default from V-005.)
- **References:** 04-availability-precheck.md §3.2 (lines 165–169) + Verification (450–454); 07-testing-strategy.md §2 (58–63), §3.2
- **Checklist:** CHECK-S11, CHECK-S12, CHECK-S37

### V-003: 04 §3.2 uses relative package imports that contradict the single-flat-module contract
- **Severity:** error
- **Location:** 04-availability-precheck.md, §3.2 (lines 161–162)
- **Issue:** `classify`'s code block imports its types via package-relative submodule imports — `from .types import AgentAvailability` and `from .results import Classification, Verdict`. This implies a `types`/`results` package-submodule layout that does not exist: the executable spec is a single flat file `references/loop-agent-selection.py` (00 §4; 07 §2; 07 §3 line 84 states "all import from `references/loop-agent-selection.py`"), and 03 §3.1 imports the same types as `from loop_agent_selection import ...` ("same module (self-reference)"). A single flat module cannot satisfy `from .results import ...`; an implementer copying the snippet verbatim gets `ImportError`. 03's import style is correct; 04's relative imports are the defect.
- **Suggested fix:** In 04 §3.2, replace the two relative imports with the single-module self-referential form used in 03 §3.1 — e.g. `from loop_agent_selection import AgentAvailability, Classification, Verdict`, or a comment noting they are defined in the same module. Do **not** introduce `.types`/`.results` submodules. Keep all five owned types in the one `references/loop-agent-selection.py`.
- **References:** 00-core-definitions.md §4; 03-selection-resolution-observability.md §3.1 (lines 165–167); 04-availability-precheck.md §3.2 (161–162); 07-testing-strategy.md §2, §3 (line 84)
- **Checklist:** CHECK-S10, CHECK-S12, CHECK-S17

### V-004: `AgentAvailability` is referenced in Python annotations but never defined as a Python type
- **Severity:** gap
- **Location:** 00-core-definitions.md §4 (owned Python types) vs §1.1 (consumed TS interface); referenced at 04 §3.2 (line 161) and 07 §2 (line 61)
- **Issue:** `classify` is annotated `agents: list[AgentAvailability]`, and the 04 §3.2 import comment calls `AgentAvailability` "the dict/TypedDict row shape." But `AgentAvailability` is defined **only as a TypeScript `interface`** (00 §1.1, a consumed rauf type) — there is no Python declaration of it anywhere in 00 §4 (the "owned Python types" section). Meanwhile the `classify` body and `advertised_set` (04 §2) actually treat rows as plain dicts (`str(row["id"])`, `row.get("detail")`, mapping-pattern matches). So a Python type named `AgentAvailability` is referenced in annotations but never defined — an undefined-type reference and a TS/Python naming collision.
- **Suggested fix:** In 00 §4, add an explicit Python declaration for the row shape — e.g. `class AgentAvailability(TypedDict): id: str; displayName: str; binaryName: NotRequired[str]; available: bool; detail: NotRequired[str]` — and have 04 §3.2 / 07 §2 reference that one definition. Alternatively, change the annotations to `list[dict[str, object]]` and state plainly that rows are dicts. Pick one shape/name and use it consistently so the Python `AgentAvailability` is defined exactly once.
- **References:** 00-core-definitions.md §1.1 (TS interface), §4 (owned Python types); 04-availability-precheck.md §2 (`advertised_set`), §3.2; 07-testing-strategy.md §2 (line 61)
- **Checklist:** CHECK-S10, CHECK-S12

### V-005: `render_launch` defaults `runner_default_id` while `resolve`/`classify` require it (CON-04 asymmetry)
- **Severity:** inconsistency
- **Location:** 03-selection-resolution-observability.md §3.4 (line 271); mirrored in 07 §2 (line 69)
- **Issue:** `render_launch`'s signature gives `runner_default_id: str = RUNNER_DEFAULT_ID` a default referencing the module constant. Its two sibling functions `resolve` (03 §3.1) and `classify` (04 §3.2) declare `runner_default_id` as a **required, defaultless** parameter, with explicit rationale (00 §2 lines 109–111, CON-04: "passed into resolve()/classify() as a parameter, never hardcoded into the algorithm, so an alternate runner with a different default id is handled without edits"). Hardcoding `RUNNER_DEFAULT_ID` ("claude-cli") as `render_launch`'s default re-introduces the rauf-specific default the design deliberately parameterizes, and is inconsistent with its two siblings. An alternate-runner caller who forgets the arg silently gets rauf's `claude-cli`.
- **Suggested fix:** Choose one convention and apply it to all three functions. Either (a) make `render_launch`'s `runner_default_id` required (drop `= RUNNER_DEFAULT_ID`) so all three share the defaultless CON-04 contract — recommended for strict CON-04 adherence; **or** (b) deliberately give `resolve` and `classify` the same `= RUNNER_DEFAULT_ID` default and document that the default is overridable (still satisfies CON-04 since it is not hardcoded into the algorithm). Note option (b) would simultaneously resolve V-001 and V-002 by making the 2-arg call sites legal. Whichever is chosen, update 00 §4 / 03 / 04 / 07 §2 consistently.
- **References:** 00-core-definitions.md §2 (108–111); 03 §3.1 (`resolve`), §3.4 (`render_launch`); 04 §3.2 (`classify`); 07 §2 (line 69)
- **Checklist:** CHECK-S11, CHECK-S12

### V-006: `Classification` verdict→field invariant is undocumented
- **Severity:** improvement
- **Location:** 00-core-definitions.md §4 (`Classification` dataclass docstring, lines ~184–196)
- **Issue:** `Classification` carries optional fields `detail` and `valid_ids`. The docstring states each field's per-field meaning but not the **mutual-exclusivity invariant by verdict**: `detail` is set only for `UNAVAILABLE`, `valid_ids` only for `UNKNOWN`, both `None` for `AVAILABLE` (this is how `classify` constructs them in 04 §3.1/§4.1, and why §3.2's docstring can claim "Raises: Never"). A fresh implementer could legally construct `Classification(verdict=AVAILABLE, valid_ids=...)` without violating any documented contract.
- **Suggested fix:** Add one line to `Classification`'s docstring in 00 §4: "`detail` is set **iff** `verdict == UNAVAILABLE`; `valid_ids` is set **iff** `verdict == UNKNOWN`; both are `None` for `AVAILABLE` (enforced by `classify` construction, not by the dataclass itself)."
- **References:** 00-core-definitions.md §4; 04-availability-precheck.md §3.1 (decision table), §4.1
- **Checklist:** CHECK-S13, CHECK-S11

### V-007: 05 §3 claims default `loopRunner.bin = "rauf"` resolves on PATH, contradicting the lazy-`npx` provisioning model (REQ-BIN-01)
- **Severity:** inconsistency
- **Location:** 05-runner-discovery-version-gate.md, §3 "How the installer satisfies REQ-BIN-01 / CON-03" (lines 155–160)
- **Issue:** §3 makes two mutually contradictory claims in adjacent sentences. It states the cross-agent installer "provisions rauf by the lazy-`npx` contract — it records `RAUF_PIN = "rauf@0.6.0"` and the forge loop invokes `npx rauf@<pin> …`" (lines 155–158), AND that "The default `loopRunner.bin = "rauf"` resolves the provisioned rauf on PATH after a multi-agent install" (lines 158–159). These cannot both hold: if the installer only records a pin and runs via `npx rauf@<pin>` (and, per the cited `installer/src/rauf.ts`, never vendors a binary onto PATH / mutates global npm state), then after a multi-agent install there is **no `rauf` on PATH** for the default `bin="rauf"` to resolve. REQ-BIN-01 ("reliably locate the installer-provisioned rauf so the default loop path works") would then be unsatisfied by the default config the spec ships, in exactly the multi-agent-install scenario it targets. tech-spec §3.5 repeats the "installer provisions rauf@0.6.0 onto PATH" framing, so the drift is consistent across both docs.
- **Suggested fix:** Resolve the discovery model to one coherent story, cross-checked against `cross-agent-installer/06-rauf-provisioning.md` (the authoritative source). Either (a) if rauf is genuinely reached via lazy-`npx`, specify that the installer-provisioned default sets `loopRunner.bin`/command templates to the `npx rauf@<pin>` launcher (and state the `references/forge-config-schema.json` change that implies), and remove the "resolves on PATH" sentence; or (b) if a multi-agent install genuinely does place `rauf` on PATH, cite the installer step that does so and drop the lazy-`npx` framing. **This requires a user/cross-member decision** — it depends on the authoritative `cross-agent-installer` provisioning contract.
- **References:** 05 §1 (CON-03), §3, §Dependencies; tech-spec.md §3.5; cross-agent-installer/06-rauf-provisioning.md; installer/src/rauf.ts; PRD REQ-BIN-01
- **Checklist:** CHECK-S19, CHECK-S22, CHECK-S25, CHECK-S26

### V-008: 04 §5 probe-failure handling omits empty `agents: []` and rows missing `id`
- **Severity:** gap
- **Location:** 04-availability-precheck.md, §5 (Probe failure handling); §2 (`advertised_set`)
- **Issue:** §5 enumerates probe failures as non-zero exit, unparseable JSON, or valid JSON missing the `agents` array, routing all to surface-failure + choose-another/abort. It does **not** define behavior for (a) a structurally-valid-but-empty `agents: []` result, or (b) a row missing the required `id` key. `advertised_set()` does `frozenset(str(row["id"]) for row in agents)` — a row without `id` raises `KeyError`, yet `classify`'s docstring promises "Raises: Never" because malformed output is "handled BEFORE this call (§5)" — but §5 never lists missing-`id` as a failure mode, so nothing handles it. Separately, empty `agents: []` is exit-0 + parseable + has the array (not a probe failure), so every non-default id classifies `UNKNOWN` with `valid_ids = ()`, producing the §4.1 rejection error with an empty id list ("Valid agent ids: ").
- **Suggested fix:** In §5, add "a row lacking the required `id` field" to the probe-failure list (or make `advertised_set` skip/treat such rows as a parse failure so `classify` never sees them). Add an explicit case for `agents == []`: either treat an empty advertised set as a probe failure (no usable answer ⇒ choose-another/abort, consistent with §5's "never launch a non-default agent unvalidated") or specify graceful degradation of the `UNKNOWN` error text when `valid_ids` is empty. Add corresponding 07 test cases (empty `agents[]`; row missing `id`).
- **References:** 04 §2 (`advertised_set`), §3.2 (`classify` "Raises: Never"), §4.1, §5; 00 §1.1 (`id` required); 07 §3.2, §4
- **Checklist:** CHECK-S18, CHECK-S28

### V-009: Step 3c launch line does not record the "proceed-anyway" path for a known-but-unavailable agent (REQ-OBS-01)
- **Severity:** gap
- **Location:** 03-selection-resolution-observability.md §6.2 (Step 3c "Loop started" template); 04-availability-precheck.md §4.2 (proceed-anyway path)
- **Issue:** REQ-OBS-01 requires that it be auditable which agent drove a run. The §6.2 launch template renders only `Coding agent: {id} (source: {sourceLabel})` with no indication when the run proceeded past an availability warning via the UNAVAILABLE proceed-anyway path (04 §4.2). That is exactly the case where the recorded launch context matters most for an audit trail.
- **Suggested fix:** In 03 §6.2 (or 04 §4.2), specify that when launch proceeds via the UNAVAILABLE proceed-anyway path, the Step 3c line notes it, e.g. `Coding agent: codex (source: per-run selection; proceeded despite unavailability warning)`. Keep it session-side prose only (no new event type — preserves REQ-OBS-02). Add a one-line note tying §6.2 to 04 §4.2.
- **References:** 03 §6.1–6.2; 04 §4.2; PRD REQ-OBS-01, REQ-AVAIL-02
- **Checklist:** CHECK-S19, CHECK-S31

### V-010: tech-spec §6.A cites `commands.ts:197` for the `--agent` flag; actual declaration is `:198`
- **Severity:** error
- **Location:** tech-spec.md, §6.A (Integration Points)
- **Issue:** §6.A cites the `--agent` run flag at `packages/cli/src/commands.ts:197`, but the actual `name: "--agent <id>"` declaration is at line **198** (line 197 is the option entry's opening brace). The implementation specs that re-derive this (05 §1 table) correctly cite `:198`, so the tech-spec is off-by-one — a stale integration-section citation.
- **Suggested fix:** Update tech-spec §6.A `commands.ts:197` → `commands.ts:198` to match the verified source and 05 §1. (Other §6.A citations — loop-commands.ts:1190, schemas.ts:72, version.ts, agent-selection.ts:24 — verified accurate.)
- **References:** tech-spec.md §6.A; 05-runner-discovery-version-gate.md §1; packages/cli/src/commands.ts:198
- **Checklist:** CHECK-S22, CHECK-S26

### V-011: Deterministic traceability validator reports `valid=false` on `REQ-DIST-01` — a cross-member citation false positive (no spec change needed)
- **Severity:** improvement
- **Location:** 05-runner-discovery-version-gate.md §4.2 (the citation `cross-agent-installer/07-cli-and-reporting.md §1.1, REQ-DIST-01`)
- **Issue:** `validate-traceability.py` flags `REQ-DIST-01` as an orphaned reference (referenced by a spec but absent from this feature's PRD.md), reporting `valid=false`. Investigation: `REQ-DIST-01` is a real, defined requirement — but in the **cross-agent-installer** member's PRD (`specs/agent-agnostic/cross-agent-installer/PRD.md`), and the cited `cross-agent-installer/07-cli-and-reporting.md §1.1` heading exists. So the 05 §4.2 reference is a **valid cross-epic-member citation**, not a typo or a missing local requirement. The validator's `valid=false` is a false positive from scoping REQ-IDs to the local PRD and not recognizing path-prefixed cross-member references.
- **Suggested fix:** **No spec change required** — do NOT add a `REQ-DIST-01` to this feature's PRD (it belongs to cross-agent-installer). The citation already carries the `cross-agent-installer/` path prefix and pairs the REQ-ID with its file:§, which is correct. Record this as a known validator-scoping false positive. (Optional, out of scope here: teach `validate-traceability.py` to ignore REQ-IDs that appear with a sibling-member path prefix, so the forge gate isn't tripped by `valid=false`.)
- **References:** 05 §4.2; specs/agent-agnostic/cross-agent-installer/PRD.md; specs/agent-agnostic/cross-agent-installer/07-cli-and-reporting.md §1.1
- **Checklist:** CHECK-S14, CHECK-S38

## Fix Execution Plan

### User Decisions Required
- **V-007 (discovery model): RESOLVED 2026-06-17 → lazy-`npx`.** Confirmed against the authoritative `cross-agent-installer/06-rauf-provisioning.md` §1–§2: the installer "never vendors a binary, never mutates global npm state, never invokes rauf" — it only records `RAUF_PIN = "rauf@0.6.0"` and preflights resolvability; forge invokes `npx rauf@<pin>`. Applied: removed the "resolves the provisioned rauf on PATH after a multi-agent install" claim from 05 §3 and tech-spec §3.5; stated default `bin="rauf"` works only when rauf is already on PATH (dev/global install), and that the multi-agent-installer path reaches rauf via `npx rauf@<pin>` per the recorded pin.
- **V-001/V-002/V-005 (signature convention): RESOLVED 2026-06-17 → all required (option a).** Made `render_launch`'s `runner_default_id` required (dropped `= RUNNER_DEFAULT_ID`); pass `runner_default_id` explicitly at every `resolve`/`classify`/`render_launch` call site in 07. Strictest CON-04 — no rauf-specific default id baked into any signature.

### Execution Steps

#### Step 1: Fix the executable-spec test call sites in 07 (signatures)
- **Files:** specs/agent-agnostic/forge-rauf-loop-default/07-testing-strategy.md
- **Addresses:** V-001, V-002
- **Checklist:** CHECK-S08, CHECK-S11, CHECK-S12, CHECK-S17, CHECK-S37, CHECK-S38
- **Action:** Per the chosen convention (User Decision above). For option (a): rewrite §3.1 `resolve(...)` calls to 3 args (`resolve("codex", "gemini", "claude-cli")`, etc.) and §3.2 `classify(...)` calls to 3 args (`classify("codex", agents, "claude-cli")`, etc.); change `resolve(None, None)` → `resolve(None, "", "claude-cli")` (or widen `default_agent` to `str | None` across 00/03/07). For option (b): instead edit the signatures in Step 2 and leave call sites 2-arg.
- **Depends on:** none (but coordinate with the V-005 convention choice)
- **Rationale:** Test fixtures must match real interface shapes; same root cause grouped together.

#### Step 2: Unify the `runner_default_id` defaulting convention across the three functions
- **Files:** 00-core-definitions.md (§4), 03-selection-resolution-observability.md (§3.1, §3.4), 04-availability-precheck.md (§3.2), 07-testing-strategy.md (§2)
- **Addresses:** V-005 (and the signature half of V-001/V-002)
- **Checklist:** CHECK-S11, CHECK-S12
- **Action:** Apply the chosen convention. Option (a): drop `= RUNNER_DEFAULT_ID` from `render_launch` so all three are defaultless. Option (b): add `= RUNNER_DEFAULT_ID` to `resolve` and `classify` and document overridability per CON-04. Keep 00/03/04/07 signatures identical.
- **Depends on:** Step 1 (same convention choice)
- **Rationale:** Fix the shared signature contract once, in the defining docs, before/with the call-site edits.

#### Step 3: Fix type-definition and import defects in 00 and 04
- **Files:** 00-core-definitions.md (§4), 04-availability-precheck.md (§3.2)
- **Addresses:** V-003, V-004, V-006
- **Checklist:** CHECK-S10, CHECK-S11, CHECK-S12, CHECK-S13
- **Action:** (V-003) Replace 04 §3.2's `from .types import ...` / `from .results import ...` with the single-module form `from loop_agent_selection import AgentAvailability, Classification, Verdict`. (V-004) Add an explicit Python `AgentAvailability` definition in 00 §4 (TypedDict) OR change annotations to `list[dict[str, object]]`. (V-006) Add the verdict→field mutual-exclusivity invariant line to `Classification`'s docstring in 00 §4.
- **Depends on:** none
- **Rationale:** All type-system integrity fixes in the defining doc + its one consumer, grouped.

#### Step 4: Resolve the REQ-BIN-01 discovery contradiction in 05 (and tech-spec §3.5)
- **Files:** 05-runner-discovery-version-gate.md (§3), tech-spec.md (§3.5)
- **Addresses:** V-007
- **Checklist:** CHECK-S19, CHECK-S22, CHECK-S25, CHECK-S26
- **Action:** Per the User Decision. Make §3 describe a single coherent invocation model; remove the contradictory "resolves on PATH" sentence (or the lazy-`npx` framing) per the chosen answer; align tech-spec §3.5 to match. Cite `cross-agent-installer/06-rauf-provisioning.md`.
- **Depends on:** User Decision (V-007)
- **Rationale:** Highest-substance correctness issue; isolate it because it needs an external contract decision.

#### Step 5: Fill probe-failure and observability gaps in 04 and 03
- **Files:** 04-availability-precheck.md (§5), 03-selection-resolution-observability.md (§6.2), 07-testing-strategy.md (§3.2/§4 — add the new cases)
- **Addresses:** V-008, V-009
- **Checklist:** CHECK-S18, CHECK-S19, CHECK-S28, CHECK-S31
- **Action:** (V-008) Add empty-`agents[]` and missing-`id`-row handling to 04 §5; add matching 07 test cases. (V-009) Specify the proceed-anyway annotation in the Step 3c launch line (03 §6.2 / 04 §4.2).
- **Depends on:** none
- **Rationale:** Edge-case + observability gaps, grouped by the docs they touch.

#### Step 6: Fix the stale source citation in tech-spec
- **Files:** tech-spec.md (§6.A)
- **Addresses:** V-010
- **Checklist:** CHECK-S22, CHECK-S26
- **Action:** Change `commands.ts:197` → `commands.ts:198`.
- **Depends on:** none
- **Rationale:** Trivial isolated correctness fix.

#### Step 7 (optional / no artifact change): Record the REQ-DIST-01 validator false positive
- **Files:** none (informational)
- **Addresses:** V-011
- **Checklist:** CHECK-S14, CHECK-S38
- **Action:** No spec edit. Optionally file a follow-up to make `validate-traceability.py` ignore path-prefixed cross-member REQ-IDs so the forge gate isn't tripped by `valid=false`.
- **Depends on:** none
- **Rationale:** The reference is correct; only the validator's scoping over-reports.

## Fix Progress

- Step 1: [APPLIED] 2026-06-17 — 07 §3.1/§3.2/§3.3/§3.4 call sites updated to pass `runner_default_id` explicitly (3-arg `resolve`/`classify`, 4-arg `render_launch`); `resolve(None, None)` → `resolve(None, "   ", "claude-cli")` (whitespace-as-unset, type-correct). Resolves V-001, V-002.
- Step 2: [APPLIED] 2026-06-17 — Dropped `= RUNNER_DEFAULT_ID` default from `render_launch` in 07 §2 and 03 §3.4 (all three functions now require `runner_default_id`, strict CON-04). Resolves V-005. 03/04 Verification blocks already used the correct arity.
- Step 3: [APPLIED] 2026-06-17 — 04 §3.2 relative imports (`from .types`/`from .results`) replaced with single-module `from loop_agent_selection import ...` (V-003); added Python `AgentAvailability` TypedDict (`_AgentRow` base + `total=False` subclass, 3.10-safe) to 00 §4 + `from typing import TypedDict`, and listed it in 07 §2 (V-004); added the verdict→field invariant to `Classification`'s docstring in 00 §4 (V-006).
- Step 4: [APPLIED] 2026-06-17 — 05 §3 and tech-spec §3.5 rewritten: removed the false "resolves the provisioned rauf on PATH" claim; documented the two coherent discovery shapes (on-PATH dev/global vs. `npx rauf@<pin>` for installer projects) per cross-agent-installer/06. Resolves V-007 (decision: lazy-npx).
- Step 5: [APPLIED] 2026-06-17 — 04 §5 probe-failure list extended with empty `agents: []` and missing-`id` rows (V-008); added 07 §3.6 probe-failure edge-case tests; added the proceed-anyway audit note to the Step 3c template in 03 §6.2 (V-009).
- Step 6: [APPLIED] 2026-06-17 — tech-spec §6.A citation `commands.ts:197` → `:198` (V-010).
- Step 7: [N/A] 2026-06-17 — V-011 is a validator-scoping false positive; no spec change. (Follow-up to teach `validate-traceability.py` about cross-member REQ-IDs left as an optional out-of-scope item.)
