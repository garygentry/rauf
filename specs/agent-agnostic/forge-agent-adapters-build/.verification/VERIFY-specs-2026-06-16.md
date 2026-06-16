# Verification Report: forge-agent-adapters-build (specs)
Date: 2026-06-16
Pipeline Stage: forge-3-specs complete → forge-4-backlog
Epic: agent-agnostic
Artifacts Reviewed: PRD.md, tech-spec.md, 00-core-definitions.md, 01-architecture-layout.md, 02-generator-engine.md, 03-per-agent-emitters.md, 04-provenance-selfcontainment-report.md, 05-purity-exemption-and-drift-guard.md, 06-testing-strategy.md, TRACEABILITY.md

Verification method: parallel dimensioned fan-out — 5 `forge-verifier` instances across
(1) types/contracts [S09–S13, S18–S21], (2) architecture/layout [S05–S08, S32],
(3) cross-reference & traceability [S01–S04, S14–S17, S38], (4) testing strategy [S33–S37],
(5) integration & non-functional [S22–S31]. All 38 specs-mode checks executed.
Deterministic traceability validator: **32 requirements, 0 uncovered, 0 orphaned** (CHECK-S01/S38 PASS).

## Summary
- Total findings: 19
- Gaps: 7
- Inconsistencies: 8
- Improvements: 3
- Errors: 1

This is a high-quality spec suite. Traceability is complete (validator-confirmed),
architecture claims were cross-checked against the live feature-forge source and match
exactly (file paths, line numbers, constants, counts), and the error/security/determinism
contracts are well-developed. The one structurally significant gap is the **manifest-
aggregation seam** (V-001) — the only finding that requires a user decision before fixing.
The remainder are precision fixes: cross-reference repointing, test-fixture corrections,
and docstring/contract tightening.

## Findings

### V-001: Manifest-aggregation seam is undefined — `EmitResult` cannot carry the per-record entries that Codex `openai.yaml` and Gemini `gemini-extension.json` aggregate
- **Severity:** gap
- **Location:** 00-core-definitions.md §5 (`EmitResult`/`EmittedFile`); 02-generator-engine.md §4.1 (`build_tree` per-record loop, `_publish_emit_result`); 03-per-agent-emitters.md §4.3 (Codex `emit_agent`), §7 / §7.1 / §7.4 (Gemini manifest); 04-provenance-selfcontainment-report.md §1.3, §1.5.
- **Issue:** Two emitters produce **whole-bundle aggregate artifacts** that are not 1:1 with a single record: Codex's `agents/openai.yaml` (one manifest for the set of sub-agents) and Gemini's `gemini-extension.json` (one manifest for the set of skills). 03 §4.3 says "the engine merges per-agent emissions" and 03 §7 says the manifest "is assembled once per bundle from all skills' manifest entries by the engine, not per-`emit_skill`" — but explicitly defers the mechanism ("whether `emit_skill` returns a manifest-entry **sidecar** or the engine re-derives from the records is the engine/provenance contract"). The engine spec (02 §4.1) only shows `emit_skill`/`emit_agent` returning per-record `EmitResult`s written immediately via `_publish_emit_result`. `EmitResult` (00 §5) has exactly two fields — `files: tuple[EmittedFile, ...]` and `drops: tuple[DropRecord, ...]` — neither of which can express "a fragment to be merged later." There is no `ManifestEntry`/`ManifestFragment` type and no aggregation point in `build_tree`. A fresh implementer cannot satisfy "the manifest is assembled once per bundle" because the return type carries no such data and the merge owner/shape/write-point is unspecified. (Merged from the types/contracts and integration verifiers, which independently flagged the same seam.)
- **Suggested fix:** Pick ONE mechanism and specify it once in 02 (engine) + 00 (types), then reference it from 03 §4.3/§7 and 04 §1.3:
  - **(a) Sidecar field:** add a `ManifestEntry` frozen dataclass to 00 §5 (`name: str`, `description: str`, plus any TQ-1 manifest fields) and an optional third field on `EmitResult` (e.g. `manifest_entries: tuple[ManifestEntry, ...] = ()`, "non-empty only for manifest-bearing emitters: codex agents, gemini skills"). The engine collects entries across the per-record loop and a serialization step writes the single merged manifest (Form C, `_generated`/fixed-key-order first) after the loop; or
  - **(b) Finalize hook:** emitters emit body files only; add a per-target `finalize_bundle(skills, agents) -> EmittedFile | None` engine hook (one per manifest-bearing emitter) that re-derives the manifest from the parsed records after the loop.
  Whichever is chosen, show the aggregation point in `build_tree` (02 §4.1) and ensure 04 §1.3 writes the *merged* manifest.
- **References:** 00-core-definitions.md §5; 02-generator-engine.md §3, §4.1; 03-per-agent-emitters.md §4.3, §7, §7.4; 04 §1.3, §1.5; REQ-FMT-01, REQ-OUT-01, REQ-DET-01.
- **Checklist:** CHECK-S10, CHECK-S12, CHECK-S22, CHECK-S23, CHECK-S24

### V-002: Gemini manifest `version` is a "required" field with no defined type, canonical source, or serialization in the authoritative example
- **Severity:** gap
- **Location:** 03-per-agent-emitters.md §7.1 (manifest "required `version`"), §7.4 worked example (`"version": "0.0.0"`), note (~line 654: "`version` value MUST be a fixed, canon-sourced constant"); 04-provenance-selfcontainment-report.md §1.3 (worked `gemini-extension.json` omits `version` entirely); 00-core-definitions.md §7 (constants).
- **Issue:** 03 says the gemini manifest carries a required `version` that "MUST be a fixed, canon-sourced constant" whose "source is `04`'s manifest-assembly contract." But 04 §1.3's authoritative `gemini-extension.json` shows only `_generated`, `name`, `skills` — **no `version` key** — and defines no `version` constant or source. No constant exists in 00 §7 for it, and feature-forge has no `package.json` to source it from. This is both an undefined contract value and a 03↔04 inconsistency on whether `version` appears at all.
- **Suggested fix:** Decide the `version` source and pin it as a named constant in 00 §7 (e.g. `GEMINI_EXTENSION_VERSION: str = "0.0.0"` with a comment naming its canonical source), then make 04 §1.3's worked JSON include `version` in the fixed key order so 03 and 04 agree. If `version` is genuinely optional, change 03 §7.1 to stop calling it "required."
- **References:** 03 §7.1/§7.4; 04 §1.3; 00 §7.
- **Checklist:** CHECK-S10, CHECK-S12

### V-003: tech-spec §4 data-model summary is informal and conflicts with the authoritative 00-core-definitions.md
- **Severity:** inconsistency
- **Location:** tech-spec.md §4 (Data Model block) vs 00-core-definitions.md §2.
- **Issue:** tech-spec §4's `AgentRecord` lists `name, description, body, claude_keys` but **omits `source_path`**, which 00 §2 defines as required (used throughout 02/03/04 for provenance + error messages). It writes `metadata: dict|None` (not `dict[str, object] | None`). It also asserts the canonical frontmatter schema is `{name, description, license, compatibility, metadata, allowed-tools}`, but 00 §3 and the parse code only read `{name, description, metadata}` and never reference `license`/`compatibility`/`allowed-tools`. These pre-spec summaries conflict with the authoritative definitions a fresh agent might read first.
- **Suggested fix:** Add a pointer at the top of tech-spec §4: "Authoritative, fully-annotated definitions live in `00-core-definitions.md §2`; the block below is a summary." Correct the summary to include `AgentRecord.source_path` and align field types, or defer entirely to 00 §2. Reconcile the license/compatibility/allowed-tools sentence with the fact that the generator only parses `{name, description, metadata}` (state the broader schema is what the upstream checker enforces, not what this generator reads).
- **References:** tech-spec.md §4; 00-core-definitions.md §2, §3.
- **Checklist:** CHECK-S09, CHECK-S10, CHECK-S12

### V-004: `MissingNameError` docstring omits the agent `name != stem` case
- **Severity:** error
- **Location:** 00-core-definitions.md §8 (`MissingNameError` docstring: "Required `name` absent, non-string, or (skills) != directory name"); raised in 02-generator-engine.md §3 `parse_agent` for `name != path.stem`.
- **Issue:** The docstring enumerates the cases it represents but only mentions the **skills** directory-name mismatch. `parse_agent` raises the same `MissingNameError` for the **agent** case `name != path.stem`, so the error-hierarchy documentation is incomplete vs its actual use — a maintainer reading 00 §8 would not learn that an agent stem mismatch maps to this class.
- **Suggested fix:** Update the docstring in 00 §8 to: "Required `name` absent, non-string, or != its identity source (skills: directory name; agents: file stem)."
- **References:** 00 §8; 02 §3 (`parse_agent`).
- **Checklist:** CHECK-S11, CHECK-S13, CHECK-S18

### V-005: `MalformedFrontmatterError` is documented as block-structure-only but is reused for field-value type violations
- **Severity:** improvement
- **Location:** 00-core-definitions.md §8 (`MalformedFrontmatterError`: "Frontmatter block missing/unbalanced `---`, or not a YAML mapping."); raised for non-structural field-type errors in 02-generator-engine.md §3 (`"'description' is not a string"`, `"'metadata' is not a mapping"`).
- **Issue:** The class is documented as a *block-structure* error but the parse code reuses it for **field-value type** violations (description not a string, metadata not a mapping) — a different category (the block is well-formed; a field has the wrong type). Not a runtime bug (the `source_path: reason` message still names the cause), but the hierarchy's documented semantics don't match its usage.
- **Suggested fix:** Broaden the docstring in 00 §8 to: "Frontmatter block missing/unbalanced `---`, not a YAML mapping, **or a required field has the wrong type** (e.g. non-string `description`, non-mapping `metadata`)." (A dedicated subclass is also acceptable but heavier; the docstring fix closes the gap with no code change.)
- **References:** 00 §8; 02 §3.
- **Checklist:** CHECK-S11, CHECK-S18, CHECK-S13

### V-006: `EmittedFile.content` "provenance header already applied" invariant holds only because Form B and EXEMPT files are deliberately not `EmittedFile`s — but the type doc doesn't say so
- **Severity:** improvement
- **Location:** 00-core-definitions.md §5 (`EmittedFile.content` docstring); 04-provenance-selfcontainment-report.md §1.4, §1.5, §1.6, §3.
- **Issue:** `EmittedFile.content`'s doc asserts the provenance header is always already applied. True for emitter-produced files (Form A/C), but `GENERATION-REPORT.md` (Form B) and the verbatim/EXEMPT copies (`forge-root.sh`, `references/`) are written by the engine's report/self-containment passes and are deliberately *not* `EmittedFile`s — a fact stated in 04 but not in the 00 §5 type doc. The blanket statement can mislead.
- **Suggested fix:** Add a clause to `EmittedFile.content` in 00 §5: "Applies to emitter-produced native artifacts (Form A/C, §7). Frontmatter-less report output (Form B) and verbatim/EXEMPT copies (forge-root.sh, references/) are written by the engine's self-containment/report passes, not as `EmittedFile`s (`04 §1.5`)."
- **References:** 00 §5; 04 §1.4, §1.5, §1.6, §3.
- **Checklist:** CHECK-S12, CHECK-S13

### V-007: Record-map `dict[str, object]` vs emitter `dict[str, Any]` typing contract is implicit
- **Severity:** improvement
- **Location:** 00-core-definitions.md §2 (`SkillRecord.metadata: dict[str, object] | None`, `AgentRecord.claude_keys: dict[str, object]`); 02 §3 (`parse_*`); 03 §2.2 (`hint_value`), §3.3 (`native.update(agent.claude_keys)`).
- **Issue:** `metadata`/`claude_keys` values are typed `object`, but emitters project them into `dict[str, Any]` frontmatter maps. Sound at runtime, but the record→emitter type transition is unstated; a strict mypy/pyright run would need casts no spec mentions.
- **Suggested fix:** Add one sentence to 00 §2 stating the typing contract: record map values are `object` (post-`safe_load`), and emitters deliberately re-widen to `Any` when projecting into frontmatter, with `name`/`description`/`argument-hint` narrowed via `isinstance` before use (as `hint_value`/`parse_*` already do).
- **References:** 00 §2; 02 §3; 03 §2.2, §3.3.
- **Checklist:** CHECK-S09, CHECK-S13

### V-008: No error type, exit code, or recovery path for venv / pinned-dependency provisioning failure
- **Severity:** gap
- **Location:** tech-spec.md §9 (venv auto-provision: `pip install -q -r scripts/requirements-adapters.txt`); 00-core-definitions.md §8 (error hierarchy), §9 (exit codes); 02-generator-engine.md §6 (error table); 05-purity-exemption-and-drift-guard.md (validate.sh wiring).
- **Issue:** The feature's single permitted runtime dependency (pinned YAML lib) is auto-provisioned into `.venv-adapters/` by `validate.sh` step 6b before invoking the generator. This can fail (no network, PEP-668, pip error, corrupt requirements file), yet there is no error type, no exit-code row, and no recovery/diagnostic-message contract anywhere. 00 §8 covers only `CanonError` subclasses; 00 §9's exit table covers 0/1/2 for canon/drift/usage. A provisioning failure would surface as a raw pip/bash error with no specified message or remediation — a gap for a fail-able operation that gates the whole verify command (REQ-CI-04).
- **Suggested fix:** Add a row to the 00 §9 exit-code table (or a short subsection in 05) specifying provisioning-failure behavior: non-zero exit distinguishable from a canon error (it is an environment/setup failure, not a `CanonError`), a clear stderr message (e.g. "adapters: failed to provision the pinned YAML dependency into .venv-adapters/ — see scripts/requirements-adapters.txt"), and the recovery action (network/offline-cache guidance).
- **References:** tech-spec.md §9; 00 §8, §9; 02 §6; 05 (validate.sh).
- **Checklist:** CHECK-S18, CHECK-S19, CHECK-S20, CHECK-S21

### V-009: `diff -r` tool error (returncode > 1) is mishandled as drift in `check()`
- **Severity:** gap
- **Location:** 02-generator-engine.md §4.3 (`check()`); §6 error table (lists only "Drift detected" for `check`).
- **Issue:** `check()` runs `subprocess.run(["diff", "-r", ...])` and branches only on `returncode == 0` (identical) vs everything-else (treated as **drift**, exit 1 + remediation). But `diff` exit codes are 0 = identical, 1 = differs, **>1 = error** (unreadable file, `diff` not installed). A `diff`-tool error (returncode 2) is mapped into the drift path, printing the misleading `REMEDIATION_MESSAGE` ("adapters/ is out of date — run … and commit"). A tool error is not drift, and 00 §9 says only 0/1 are verdict codes.
- **Suggested fix:** In `check()` branch explicitly: `returncode == 0` → return 0; `== 1` → print diff + `REMEDIATION_MESSAGE`, return 1; `else` (>1) → print a distinct stderr message ("adapters: `diff -r` failed to compare trees (exit {rc}) — not a drift verdict") and return a non-verdict code, or raise a non-`CanonError` so it propagates as a generator/environment fault. Add the corresponding row to the §6 error table and note `diff` may be absent on some platforms.
- **References:** 02 §4.3, §6; 00 §9.
- **Checklist:** CHECK-S18, CHECK-S19, CHECK-S20, CHECK-S21

### V-010: tech-spec §6 leaves the shared `references/` file count implicit while 01 §7 and 04 §2.1/§3.3 hard-code "14" (9 root + stacks×5)
- **Severity:** inconsistency
- **Location:** tech-spec.md §6 (`references/` bullet) vs 01-architecture-layout.md §7 ("references/ (repo-root, 14 files)") and 04-provenance-selfcontainment-report.md §2.1 ("14-file"), §3.3 (hard-coded "14 files: 9 root + `stacks/`×5").
- **Issue:** tech-spec §6 enumerates the reference set inline (9 root + 5 stacks = 14, content-correct) but states **no count**, while 01 and 04 (and the §3.3 report section and the 06 §3.3 self-containment test) depend on a hard "14." A future canon addition (a 15th reference file) would update 01/04 but leave tech-spec §6 with no number to update, silently diverging. Verified ground truth in feature-forge (`forge/skill-spec-purity`): exactly 9 root + 5 stacks = 14.
- **Suggested fix:** In tech-spec §6, add the explicit count to the `references/` bullet: "(repo-root, **14 files: 9 root + `stacks/`×5**)", pinning the same number across all three docs and the report.
- **References:** tech-spec.md §6, §3.1, §7; 01 §7; 04 §2.1, §3.3; 06 §3.3.
- **Checklist:** CHECK-S07

### V-011: Implementation specs 02, 03, 04 have no dedicated "public API (exported vs internal)" section
- **Severity:** gap
- **Location:** 02-generator-engine.md, 03-per-agent-emitters.md, 04-provenance-selfcontainment-report.md (whole). Contrast: 00 §5/§7/§9 and 01 §4 do have explicit public-API definitions.
- **Issue:** CHECK-S32 asks each impl spec to declare its public surface vs internals. 00 and 01 §4 satisfy this; 02/03/04 define many module-level functions/classes (e.g. 02: `discover_skill_paths`, `parse_skill`, `build_tree`, `generate`, `check`, `main`, plus `_`-prefixed helpers; 03: five `*Emitter` classes + `render_frontmatter_block`/`order_fields`/`hint_value`/`drop_all_claude_keys`; 04: `run_self_containment_pass`/`render_generation_report` + `_`-helpers) without declaring which are the intended public surface. The leading-underscore convention is an implicit signal, but with all modules collapsed into one file (`scripts/build-adapters.py`, 02 §2) and tests subprocess-driving only the CLI plus importlib-loading helpers (06 §1), the export boundary is load-bearing for how an implementer factors the file.
- **Suggested fix:** Add a short "Public API / exported vs internal" subsection (one 3-column table: Symbol | Visibility | Notes) to each of 02/03/04 per the per-file mapping: 02 → `main`/CLI is the only true public entry, `generate`/`check`/`build_tree`/`discover_*`/`parse_*`/`safe_write` module-internal-but-test-importable, `_`-helpers private; 03 → five `*Emitter` classes are registry-facing public, shared helpers module-internal; 04 → `run_self_containment_pass`/`render_generation_report` engine-called entry points, `_`-helpers private. State the only externally-stable contract for the whole feature remains the three items in 01 §4 (`build-adapters` CLI, `AGENTS.md`, `adapters-output`).
- **References:** 01 §4 (exemplar); 00 §5, §9; 02 §2, §5; 03 §1; 04 §1.5, §2; 06 §1.
- **Checklist:** CHECK-S32

### V-012: YAML dumper-config citations point to `02-generator-engine.md §3` (the parse stage) — the config actually lives in `03 §2.1`
- **Severity:** inconsistency
- **Location:** 00-core-definitions.md §2, §4; 03-per-agent-emitters.md §2.1 lead-in and Dependencies; 06-testing-strategy.md §3.1. Target: 02 §3.
- **Issue:** Several specs cite `02 §3` as the home of the YAML **dumper serialization config** (`sort_keys=False`, `default_flow_style=False`, `allow_unicode=True`, wide `width`). But 02 §3 is the *parse* stage (`safe_load` only) — it contains zero `safe_dump` config. The dumper config lives only in 03 §2.1 (`render_frontmatter_block`) and narratively in tech-spec §3.6. The `02 §3` citations that refer to *parsing* are correct; only the *dumper-config* citations are broken.
- **Suggested fix:** Repoint the dumper-config citations to 03 §2.1: 00 §2 ("the YAML dumper is configured to preserve it") and 00 §4 ("invoked with `sort_keys=False`"); 03 §2.1 lead-in + Dependencies (reference §2.1 itself / tech-spec §3.6, not `02 §3`); 06 §3.1. Do NOT touch `02 §3` citations that correctly refer to parsing. (Alternatively, hoist a shared "YAML dumper" subsection into 02 §3/§4 so the existing references become correct — lighter fix is repointing.)
- **References:** 02 §3 (parse), §4; 03 §2.1; tech-spec.md §3.6.
- **Checklist:** CHECK-S15

### V-013: Logical module alias for the 00-defined symbols differs between 02 (`core_definitions`) and 03 (`build_adapters_types`), and 03's comment is inaccurate
- **Severity:** inconsistency
- **Location:** 02-generator-engine.md (`from core_definitions import …`); 03-per-agent-emitters.md (`from build_adapters_types import …  # … imported as named in the engine`).
- **Issue:** Both 02 and 03 use spec-level "logical imports" for the shared 00-defined symbols, but 02 names the module `core_definitions` and 03 names it `build_adapters_types` for the *same* symbols. Worse, 03's comment claims they are "imported as named in the engine" — but the engine (02) imports from `core_definitions`, so the comment is factually wrong. Both docs disclaim these as illustrative logical imports resolving to the single-file `scripts/build-adapters.py`, so not an impl defect, but the divergent alias plus inaccurate comment could mislead.
- **Suggested fix:** Use one alias across the suite — `core_definitions` (matches 02 and the `00-core-definitions.md` filename). In 03 change `from build_adapters_types import (` to `from core_definitions import (` and fix the comment to "the `00-core-definitions.md §1–§9` definitions (logical import; resolved in-file in scripts/build-adapters.py)".
- **References:** 02 §2 module-layout note; 03 §1.1, Dependencies.
- **Checklist:** CHECK-S17

### V-014: `test_description_byte_fidelity` reads `SKILL.md` for codex/copilot, but those emitters write `<name>.md`
- **Severity:** inconsistency
- **Location:** 06-testing-strategy.md §3.7 (`test_description_byte_fidelity`).
- **Issue:** The test parametrizes `[("claude","SKILL.md"), ("codex","SKILL.md"), ("copilot","SKILL.md")]` and reads `adapters/<agent>/skills/with-refs/SKILL.md`. But 03 fixes the codex skill relpath at `skills/<name>/<name>.md` (§4.1) and copilot at `skills/<name>/<name>.md` (§5.1); only claude emits `SKILL.md` (§3.1). As written, the codex/copilot iterations read a non-existent path and the test errors on a missing file. The post-§3.7 note calls out only the cursor `.mdc` divergence, not codex/copilot.
- **Suggested fix:** Change the §3.7 parametrization to each emitter's actual filename: `("codex","with-refs.md")`, `("copilot","with-refs.md")`, keeping `("claude","SKILL.md")`. Update the note to list all per-agent native filenames (claude `SKILL.md`, codex/copilot `<name>.md`, cursor `<name>.mdc`) and state the file name is resolved from each emitter's `EmittedFile.relpath`.
- **References:** 03 §3.1, §4.1, §5.1, §6.1; 06 §3.7.
- **Checklist:** CHECK-S35, CHECK-S37

### V-015: Byte-fidelity assertions compare raw frontmatter text, but the REQ-FMT-04 contract is the *decoded* scalar
- **Severity:** inconsistency
- **Location:** 06-testing-strategy.md §3.6 (`_frontmatter_value`), §3.7.
- **Issue:** `_frontmatter_value` returns the raw post-`key:` text (`line[len(key)+1:].strip()`), preserving on-disk quoting (e.g. `"…"` *with* quotes). §3.7 then compares raw emitted vs raw canon. But 00 §2 and 03 §2.1 state the REQ-FMT-04 contract is that the **decoded** scalar round-trips byte-for-byte — "not the on-disk quoting style." The shared `safe_dump` may legally re-quote (canon double-quoted → emitter single-quoted/plain) while keeping the decoded value identical; a raw-text compare would then fail spuriously. The test method contradicts the contract it claims to verify.
- **Suggested fix:** Decode the scalar before comparing (matching 00 §2 / 03 §2.1). Default to `json.loads` for the quoted-scalar case to preserve the suite's no-mandatory-YAML-import property (06 §2 preamble); if `yaml.safe_load` is used instead, gate it with `pytest.importorskip("yaml")`. State explicitly in §3.7 that the comparison is on the decoded scalar, not the raw line.
- **References:** 00 §2; 03 §2.1, Verification bullet; 06 §2 preamble, §3.6, §3.7.
- **Checklist:** CHECK-S34, CHECK-S37

### V-016: No test names/asserts the no-timestamp (cross-run header+report) determinism rule from 04 §1
- **Severity:** gap
- **Location:** 06-testing-strategy.md §3.1, Requirement Coverage table; 04-provenance-selfcontainment-report.md §1 (No-timestamp rule, REQ-DET-01), Verification.
- **Issue:** 04 §1 states a "No-timestamp rule (REQ-DET-01)" — no provenance form or the report carries a timestamp/host/user/PID — and its Verification requires "Build twice → byte-identical headers + report." 06's `test_build_is_deterministic` (§3.1) builds twice and hashes the whole `adapters/` tree (which *would* catch a timestamp), but 06 never names this contract, never asserts the report's Form B provenance line is byte-stable, and the coverage table has no row mapping the rule to a test. `GENERATION-REPORT.md` (Form B) is the highest-risk place for an accidental timestamp.
- **Suggested fix:** Add a coverage-table row mapping 04 §1's no-timestamp rule (REQ-DET-01) to `test_build_is_deterministic`, and add a sentence/assertion in §3.1 that the build-twice byte-equality covers timestamp-free Form A/B/C provenance. Optionally add a targeted assertion that no generated header line matches a date/time regex, to fail fast with a clear message.
- **References:** 04 §1, Verification; 06 §3.1.
- **Checklist:** CHECK-S34, CHECK-S36

### V-017: Self-containment test asserts the positive own-`references/` copy but not the negative (discovery-driven `own_refs is None` → no copy)
- **Severity:** inconsistency
- **Location:** 06-testing-strategy.md §3.3 (`test_bundle_is_self_contained`), fixture §2.2.1; 04-provenance-selfcontainment-report.md §2.2 (REQ-SCALE-01); 00-core-definitions.md §2 (`own_refs`).
- **Issue:** 04 §2.2 specifies a discovery-driven contract: a skill's own `references/` is copied only where `SkillRecord.own_refs is not None`; the skills without one must get **no** copy. §3.3 asserts the positive case (`with-refs` skill's `references/detail.md` lands in the bundle) but never the negative — that the `noarg` skill (no `references/` in the fixture) does **not** receive an own-`references/` dir. A generator that wrongly copies the shared tree (or an empty dir) into every skill dir would pass §3.3.
- **Suggested fix:** Add an assertion (in `test_bundle_is_self_contained` or a sibling) that `not (bundle / "skills" / "noarg" / "references").exists()` for every agent, proving the copy is discovery-driven (`own_refs is None` → no copy) per 04 §2.2 / REQ-SCALE-01. Note it in the §3.3 docstring and add the Verification-checklist bullet.
- **References:** 04 §2.2, Verification; 00 §2 (`own_refs`); 06 §2.2.1, §3.3.
- **Checklist:** CHECK-S35, CHECK-S37

### V-018: Cross-OS byte-identity of the verbatim `references/` copies depends on an unstated canon line-ending (CRLF) normalization contract
- **Severity:** gap
- **Location:** 04-provenance-selfcontainment-report.md §2.4 (`_copytree_verbatim`), §2.3; 02-generator-engine.md §4.2 (`safe_write` uses `newline=""`).
- **Issue:** REQ-DET-01 requires byte-identical output across OSes, and the *emitter* path is hardened (`safe_write` opens with `newline=""`). But the self-containment pass copies the 14 shared `references/` files (and each skill's own `references/`) via `shutil.copyfile` — a raw byte copy. There is no spec for what happens when canonical `references/` files contain CRLF on a Windows checkout: the verbatim copies inherit CRLF while emitter-produced files are forced to `\n`. The drift guard (`diff -r`) would then fail `--check` on a different OS for a non-canon (line-ending) reason. The "byte-identical across OSes" claim is only actually enforced for the emitted path.
- **Suggested fix:** Add a normalization-contract paragraph to 04 §2.4: state canonical `references/`/`forge-root.sh` are assumed `\n`-normalized in the repo (declare the `.gitattributes` `* text=auto eol=lf` dependency as **owned by `packaging-docs-ci`**, per PRD §6 / epic manifest), OR have `_copytree_verbatim` read-normalize-write text files to `\n` (keeping `shutil.copyfile` + byte-identity assertion only for `forge-root.sh`). Note the impact on the `--check` drift guard's cross-OS validity in 05 §2.1.
- **References:** PRD REQ-DET-01, REQ-SEC-01, §6 (`.gitattributes` ownership); 02 §4.2; 04 §2.4; 05 §2.1; epic-manifest `packaging-docs-ci`.
- **Checklist:** CHECK-S27, CHECK-S28

### V-019: `argument-hint` drop rows are specified per-skill (×10) but the report example shows a single illustrative row, risking an under-complete report
- **Severity:** inconsistency
- **Location:** 04-provenance-selfcontainment-report.md §3.2 (bullet 2) vs §3.4 example; 03-per-agent-emitters.md §4.2/§5.2/§6.2/§7.2.
- **Issue:** REQ-OBS-01 requires the report record *every* dropped construct. 04 §3.2 states `argument-hint` drops are recorded for **each of the 10 hinted skills** for every non-Claude target (the emitters emit one `DropRecord` per hinted skill). But the §3.4 worked example shows only **one** `argument-hint` row per agent, with the surrounding sub-agent rows shown in full — so a reader reasonably infers the hint section is also complete. A fresh agent building `expected-adapters/` could implement a single aggregate row and believe it matches, under-satisfying the per-construct visibility.
- **Suggested fix:** In 04 §3.4, annotate each non-Claude table's `argument-hint` row with an explicit ellipsis/parenthetical — e.g. a footnote under each table: "one `argument-hint` row per hinted skill — 10 rows for the real canon (forge-init excluded)." Makes the per-skill enumeration unambiguous at the point of use.
- **References:** PRD REQ-OBS-01, REQ-FMT-03; 04 §3.2, §3.4; 03 §4.2/§5.2/§6.2/§7.2; 06 §3.8.
- **Checklist:** CHECK-S31

## Fix Execution Plan

### User Decisions Required
- **V-001 (manifest-aggregation seam):** **RESOLVED 2026-06-16 → option (a)** — add a frozen
  `ManifestEntry` dataclass to 00 §5 and an optional `manifest_entries: tuple[ManifestEntry, ...] = ()`
  field on `EmitResult`; the engine collects entries across the per-record loop and writes the
  merged manifest after. (Rejected (b) finalize_bundle hook — it leaks each target's manifest
  shape into the engine.) Gates Step 1.
- **V-018 (verbatim-copy cross-OS):** **RESOLVED 2026-06-16 → declare** the `.gitattributes`
  LF dependency (owned by `packaging-docs-ci`, PRD §6); keep `shutil.copyfile` + byte-identity
  assertion intact. (Rejected the read-normalize-write change to `_copytree_verbatim`.) Gates Step 8.
- All other findings can be applied directly.

### Execution Steps

Apply in order. Each step is self-contained.

#### Step 1: Specify the manifest-aggregation seam
- **Files:** 00-core-definitions.md (§5), 02-generator-engine.md (§3, §4.1); cross-refs in 03-per-agent-emitters.md (§4.3, §7, §7.1, §7.4), 04-provenance-selfcontainment-report.md (§1.3, §1.5)
- **Addresses:** V-001
- **Checklist:** CHECK-S10, CHECK-S12, CHECK-S22, CHECK-S23, CHECK-S24
- **Action:** Per the user's mechanism choice, add the type/field (option a) or engine hook (option b) to 00/02, show the aggregation point in `build_tree` after the per-record loop and before publish, and replace the "sidecar vs re-derive" hand-wave in 03 §4.3/§7 with a concrete reference. Ensure 04 §1.3 writes the *merged* manifest (`_generated`/fixed-key-order first).
- **Depends on:** User decision (V-001).

#### Step 2: Pin the gemini manifest `version` source and align 03↔04
- **Files:** 00-core-definitions.md (§7), 03-per-agent-emitters.md (§7.1), 04-provenance-selfcontainment-report.md (§1.3)
- **Addresses:** V-002
- **Checklist:** CHECK-S10, CHECK-S12
- **Action:** Add a named `GEMINI_EXTENSION_VERSION` constant in 00 §7 (comment its canonical source) and include `version` in 04 §1.3's worked JSON in fixed key order; or, if optional, drop "required" in 03 §7.1.
- **Depends on:** Step 1 (touches the same gemini manifest contract — sequence to avoid conflicts).

#### Step 3: Tighten the type-system / error-hierarchy docstrings and the data-model summary
- **Files:** 00-core-definitions.md (§2, §5, §8), tech-spec.md (§4)
- **Addresses:** V-003, V-004, V-005, V-006, V-007
- **Checklist:** CHECK-S09, CHECK-S11, CHECK-S12, CHECK-S13, CHECK-S18
- **Action:** (V-004) Broaden `MissingNameError` docstring to cover agent-stem mismatch. (V-005) Broaden `MalformedFrontmatterError` docstring to include wrong-field-type. (V-006) Add the Form-A/C scope clause to `EmittedFile.content`. (V-007) Add the record→emitter `object`→`Any` typing-contract sentence to 00 §2. (V-003) Add the "authoritative defs in 00 §2" pointer to tech-spec §4, add `AgentRecord.source_path`, align field types, and reconcile the license/compatibility/allowed-tools schema sentence.
- **Depends on:** none.

#### Step 4: Specify error contracts for provisioning failure and `diff` tool error
- **Files:** 00-core-definitions.md (§9), 02-generator-engine.md (§4.3, §6); optionally 05-purity-exemption-and-drift-guard.md
- **Addresses:** V-008, V-009
- **Checklist:** CHECK-S18, CHECK-S19, CHECK-S20, CHECK-S21
- **Action:** (V-008) Add an exit-code row + stderr message + recovery guidance for venv/dependency provisioning failure, distinguishable from a `CanonError`. (V-009) Branch `check()` on `diff` returncode 0/1/>1 — treat >1 as a tool error (distinct message, non-verdict code or non-`CanonError`), and add the §6 error-table row.
- **Depends on:** none.

#### Step 5: Add "Public API / exported vs internal" sections to specs 02, 03, 04
- **Files:** 02-generator-engine.md, 03-per-agent-emitters.md, 04-provenance-selfcontainment-report.md
- **Addresses:** V-011
- **Checklist:** CHECK-S32
- **Action:** Insert a 3-column table (Symbol | Visibility | Notes) near the top of each spec's section 1 per the V-011 mapping, with a one-line cross-ref that the only externally-stable contract is the three items in 01 §4.
- **Depends on:** none.

#### Step 6: Repoint cross-references (dumper config + module alias)
- **Files:** 00-core-definitions.md (§2, §4), 03-per-agent-emitters.md (§2.1, §1.1, Dependencies), 06-testing-strategy.md (§3.1)
- **Addresses:** V-012, V-013
- **Checklist:** CHECK-S15, CHECK-S17
- **Action:** (V-012) Repoint the YAML dumper-config citations from `02 §3` to `03 §2.1` (leave parse-stage `02 §3` citations untouched). (V-013) Change 03's `from build_adapters_types import (` to `from core_definitions import (` and fix the inaccurate comment.
- **Depends on:** none.

#### Step 7: Fix the testing-strategy fixture/assertion gaps
- **Files:** 06-testing-strategy.md (§3.1, §3.3, §3.6, §3.7, coverage table, Verification checklist)
- **Addresses:** V-014, V-015, V-016, V-017
- **Checklist:** CHECK-S34, CHECK-S35, CHECK-S36, CHECK-S37
- **Action:** (V-014) Correct codex/copilot filenames to `<name>.md` in §3.7 + expand the note. (V-015) Make the description compare decode-aware (`json.loads` default). (V-016) Add the no-timestamp coverage-table row + §3.1 assertion. (V-017) Add the negative own-`references/` absence assertion + Verification bullet.
- **Depends on:** Step 1 (V-014's filename set is downstream of the emitter contracts; apply after the manifest seam is settled to avoid re-touching 03-referenced shapes). Otherwise independent.

#### Step 8: Cross-OS verbatim-copy normalization + report drop-row disambiguation
- **Files:** 04-provenance-selfcontainment-report.md (§2.4, §3.4), 05-purity-exemption-and-drift-guard.md (§2.1, for V-018 note)
- **Addresses:** V-018, V-019
- **Checklist:** CHECK-S27, CHECK-S28, CHECK-S31
- **Action:** (V-018) Per the user's choice, add the `.gitattributes` LF dependency declaration (default) or the read-normalize-write change to `_copytree_verbatim`; note the `--check` cross-OS impact in 05 §2.1. (V-019) Annotate each non-Claude `argument-hint` row in the §3.4 example with the per-skill enumeration footnote.
- **Depends on:** V-018 user decision; otherwise independent.

## Fix Progress

- Step 1: [APPLIED] 2026-06-16 — Added `ManifestEntry` dataclass + `EmitResult.manifest_entries` field (00 §5); engine aggregates entries in `build_tree` and writes the merged manifest via `_publish_manifest` (02 §4.1); CodexEmitter.emit_agent + GeminiEmitter.emit_skill now return `ManifestEntry`s (03 §4.3/§7); serialization specified in 04 §1.3; Form C ownership moved to engine (04 §1.5). Addresses V-001.
- Step 2: [APPLIED] 2026-06-16 — Added `GEMINI_EXTENSION_VERSION` constant (00 §7); 03 §7.1/§7.4 and 04 §1.3 worked JSON now include/pin `version`. Addresses V-002.
- Step 3: [APPLIED] 2026-06-16 — Broadened `MissingNameError`/`MalformedFrontmatterError` docstrings (00 §8); scoped `EmittedFile.content` (00 §5); added record→emitter `object`→`Any` typing contract (00 §2); tech-spec §4 now points to 00 §2, adds `source_path`, aligns types, reconciles the license-schema sentence. Also pinned the references count in tech-spec §6 (V-010). Addresses V-003, V-004, V-005, V-006, V-007, V-010.
- Step 4: [APPLIED] 2026-06-16 — `check()` branches on `diff` returncode 0/1/>1 and missing-`diff`, returning exit 2 for tool faults with a distinct message, no `REMEDIATION_MESSAGE` (02 §4.3); 00 §9 exit table + provisioning note broadened; 02 §6 error table rows added. Addresses V-008, V-009.
- Step 5: [APPLIED] 2026-06-16 — Added "Public API — exported vs internal" sections to 02 (§8), 03, and 04. Addresses V-011.
- Step 6: [APPLIED] 2026-06-16 — Repointed YAML dumper-config citations to 03 §2.1 (00 §2/§4, 06 §3.1, 03 Dependencies); unified module alias to `core_definitions` and fixed the inaccurate comment (03 §2.1). Addresses V-012, V-013.
- Step 7: [APPLIED] 2026-06-16 — §3.7 parametrization fixed to per-emitter filenames (codex/copilot `<name>.md`) and made decode-aware via `_decode_scalar`; added `test_no_timestamp_in_generated_headers` + coverage row (§3.1, §0); added negative own-`references/` assertion to §3.3. Addresses V-014, V-015, V-016, V-017.
- Step 8: [APPLIED] 2026-06-16 — Added the `.gitattributes` LF cross-OS dependency declaration to 04 §2.4 + 05 §2.1 (V-018, per user decision: declare); added per-skill enumeration cue rows + footnote to 04 §3.4 (V-019); strengthened 05 §2.2 provisioning-failure message with recovery guidance + env-fault note (V-008). Addresses V-018, V-019.
