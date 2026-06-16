# Verification Report: forge-skill-spec-purity (specs)
Date: 2026-06-16
Pipeline Stage: forge-3-specs complete → forge-verify-specs
Artifacts Reviewed: PRD.md, tech-spec.md, 00-core-definitions.md, 01-architecture-layout.md, 02-frontmatter-purity-and-inventory.md, 03-portable-root-resolver.md, 04-body-size-discipline.md, 05-spec-purity-checker.md, 06-testing-strategy.md, TRACEABILITY.md

Method: parallel dimensioned fan-out — five `forge-verifier` instances covering (1) types/contracts, (2) architecture/layout & tech↔spec consistency, (3) cross-reference & traceability, (4) testing strategy, (5) integration/error-handling/edge-cases. All 38 specs-mode checks (CHECK-S01..S38) executed. Supplemented by the deterministic `validate-traceability.py` run (28 requirements, 0 uncovered, 0 orphaned references — clean).

## Summary
- Total findings: 22
- Errors: 1
- Gaps: 8
- Inconsistencies: 6
- Improvements: 7

This is a disciplined, tightly cross-referenced spec suite — the prelude byte-identity, the canonical-surface/exempt sets, and the 300/5000 caps are all internally consistent and grep-confirmed against the live repo (23 residual-var loci across 9 files matched exactly). Findings cluster on three real seams: (a) a few "constants" in 00 that are documented but never bound as code, (b) the `validate.sh` insertion wording that, if implemented literally, would silently break the unconditional-gate guarantee, and (c) the cross-agent portability promise that the Claude-only bootstrap prelude does not actually deliver (deferred to `cross-agent-installer`, but framed as a footnote rather than a scope boundary). One broken section cross-reference (`02 §7`) is the lone `error`.

## Findings

### V-001: `VR_*` violation-reason names are referenced as defined constants but never bound as code
- **Severity:** gap
- **Location:** 00-core-definitions.md §5 (table headed "Constant", lines ~219-228); referenced from 05 §3.1–§3.5 docstrings and 04 §1/§2 (`VR_BODY_LINES`/`VR_BODY_WORDS`)
- **Issue:** 00 §5 presents `VR_DISALLOWED_KEY`, `VR_MISSING_REQUIRED`, `VR_MALFORMED_FM`, `VR_NAME_MISMATCH`, `VR_RESIDUAL_VAR`, `VR_BODY_LINES`, `VR_BODY_WORDS`, `VR_PRELUDE_DRIFT` in a column literally headed "Constant," and calls them "stable identifiers the tests assert against." But no document binds them as Python identifiers — 05 §3.1–§3.5 hardcode inline f-string literals (`f"disallowed frontmatter key '{key}'"`, `"malformed frontmatter block"`, …) with no reference to any `VR_*` symbol. So the "constants" are a documentation fiction with no single source of truth, yet 00 §5's own Verification item asserts "every violation-reason constant here is referenced by 05 and asserted by a test in 06" — only literally true if they are real.
- **Suggested fix:** Either (a) make them real — add a block in 00 §5 defining each as a module-level format-string constant (e.g. `VR_DISALLOWED_KEY = "disallowed frontmatter key {key!r}"`) and have 05's rule functions interpolate those constants instead of inline literals; or (b) demote honestly — rename the §5 column "Constant" → "Reason token (informative)" and state these are stable *leading tokens* asserted by tests, not code symbols. (a) preferred for genuine single-source-of-truth.
- **References:** 00 §5 (incl. its Verification checklist), 05 §3.1–§3.5, 04 §1/§2, 06 (assertion targets)
- **Checklist:** CHECK-S09, CHECK-S13

### V-002: `BODY_SIZE` reason strings in 00 §5 hardcode example counts that read as the contract value
- **Severity:** inconsistency
- **Location:** 00-core-definitions.md §5, rows `VR_BODY_LINES` → `body 320 lines exceeds 300`; `VR_BODY_WORDS` → `body 5120 words exceeds 5000`
- **Issue:** The reason-string table embeds concrete sample measurements (`320`, `5120`) in cells whose siblings use `<placeholder>` form. 05 §3.4 correctly emits `f"body {n_lines} lines exceeds {MAX_BODY_LINES}"` (interpolated count, fixed cap). A reader cross-checking 00 §5 against 05 sees literal `320`/`5120` that never appear as constants and could mistake them for the contract.
- **Suggested fix:** Change the two cells to placeholder form matching 05's f-strings: `body <n> lines exceeds 300` and `body <n> words exceeds 5000` (the fixed `300`/`5000` are the genuine constants; only `<n>` varies).
- **References:** 00 §5, 00 §2 (`MAX_BODY_LINES`/`MAX_BODY_WORDS`), 05 §3.4
- **Checklist:** CHECK-S12, CHECK-S13

### V-003: `BOOTSTRAP_PRELUDE` is described as defined in 00 §3 but only bound as a code symbol in 05 §3.5
- **Severity:** inconsistency
- **Location:** 00-core-definitions.md §3 (+ its Requirement Coverage row and Verification checklist) vs 05-spec-purity-checker.md §3.5
- **Issue:** 00 §3's coverage table and Verification refer to a named constant `BOOTSTRAP_PRELUDE` "here" in 00, and 05 §3.5 says it is "Defined ONCE here as the comparison oracle; identical to 00 §3 byte-for-byte." But 00 §3's actual content is a bare ```bash fenced literal with no `BOOTSTRAP_PRELUDE: str = …` assignment — the only place the Python symbol is bound is 05 §3.5. So 05 claims to import a constant from 00 that 00 never defines as code, then re-defines it locally — a contract-ownership inconsistency against 00's "defines names and constants only" framing and 05's "does NOT re-define shared types" framing. (The reconstructed string was verified byte-identical, so this is a labeling/ownership fix, not a value change.)
- **Suggested fix:** In 00 §3, add the explicit `BOOTSTRAP_PRELUDE: str = (...)` binding (same multi-fragment concatenation 05 §3.5 uses) beneath the bash literal so 00 owns the symbol. Then change 05 §3.5's comment to "Imported conceptually from 00 §3 (do NOT redefine)", matching how 05 already annotates `ALLOWED_FRONTMATTER_KEYS`/`MAX_BODY_LINES`.
- **References:** 00 §3, 05 §3.5 (incl. its Dependencies note)
- **Checklist:** CHECK-S10, CHECK-S12

### V-004: Checker exit-code contract in 00 §7 omits exit 2, which 05 §1 introduces
- **Severity:** gap
- **Location:** 00-core-definitions.md §7 (`check-spec-purity.py` table) vs 05 §1 / §1.1 docstring
- **Issue:** 00 §7 is declared "the exit-code/violation contract that every other spec references," and lists only `0` (clean) and `non-zero (1)` (violations). But 05 §1/§1.1 document a third code — `2` = argparse usage error — and 05 has to add a caveat precisely because 00 §7 didn't account for it. A downstream consumer (`packaging-docs-ci`) reading only 00 §7 might treat exit 2 as "violations found."
- **Suggested fix:** Add a third row to 00 §7's table: `| 2 | usage error (argparse) — caller mistake, not a canon verdict |`, mirroring 05 §1.1's wording; keep the note that 0/1 are the only canon-verdict codes.
- **References:** 00 §7, 05 §1, 05 §1.1
- **Checklist:** CHECK-S11

### V-005: `SENTINEL_FILES` constant is defined but never structurally consumed by `is_root`
- **Severity:** improvement
- **Location:** 00-core-definitions.md §2 (`SENTINEL_FILES` + `is_root`), 03 §2
- **Issue:** 00 §2 defines `SENTINEL_FILES = ("scripts/epic-manifest.py", ".claude-plugin/plugin.json")` then defines the Bash `is_root()` predicate with the two paths hardcoded rather than derived from it (recurs in 03 §2). Because the resolver is Bash and `SENTINEL_FILES` is a Python tuple, they can never be mechanically linked, and no Python consumer reads the tuple — 00's own Verification item makes the link a manual by-eye check.
- **Suggested fix:** Add one sentence after the `SENTINEL_FILES` definition: it is the spec/documentation source for the sentinel pair; the Bash `is_root` predicates deliberately hardcode the same two paths (no Python consumer exists, per decision D2's "no Python twin"). No code change to `is_root`.
- **References:** 00 §2, 03 §2, tech-spec.md §1 (D2)
- **Checklist:** CHECK-S13, CHECK-S10

### V-006: Tech-spec module tree omits the `tests/fixtures/` deliverable that 01 and 06 require
- **Severity:** inconsistency
- **Location:** tech-spec.md §2 (Module Structure tree) vs 01 §2 (`tests/fixtures/ ★`) and 06 §1/§2
- **Issue:** tech-spec §2's `tests/` block lists only `test_check_spec_purity.py — NEW`, but 01 §2 marks `tests/fixtures/ ★` as a NEW deliverable and 06 §1/§2 makes the fixture trees (`clean-skills`, `bad-*`, `reader-*`) a hard requirement — the checker test cannot run without them. The tech-spec's tree is incomplete relative to its downstream specs.
- **Suggested fix:** In tech-spec §2, under `tests/`, add: `└── fixtures/ — NEW: clean + impure skill-tree fixtures (clean-skills, bad-*, reader-*) for the checker test`. Lower-authority doc catching up; no decision change.
- **References:** tech-spec.md §2, 01 §2/§3, 06 §1/§2.1–2.3
- **Checklist:** CHECK-S06, CHECK-S05

### V-007: No single decision-map legend for D1–D4 (defensive)
- **Severity:** improvement
- **Location:** tech-spec.md §1
- **Issue:** All D-letter citations across the suite are correct (verified D1=size, D2=resolver, D3=hooks, D4=checker), but there is no single legend table downstream specs cite against, so the load-bearing mapping is reconstructed per-doc.
- **Suggested fix:** Optional belt-and-suspenders: add a one-line legend after the D1–D4 block in §1 — "Decision map: D1 = body size, D2 = resolver, D3 = hooks.json, D4 = checker." No current content mis-cites these.
- **References:** tech-spec.md §1, §10
- **Checklist:** CHECK-S05, CHECK-S08

### V-008: 04-body-size-discipline.md lacks an explicit contract-surface ("produced vs internal") section
- **Severity:** improvement
- **Location:** 04-body-size-discipline.md (no public-API section; relevant content scattered through §5)
- **Issue:** CHECK-S32 asks each spec to make clear what is the contract surface vs internal. 01 §4, 02 §5, 03 §2, 05 §1 all do this explicitly; 04's produced artifacts (relocated `references/*.md` files + appended `verification-checklists.md` content) are scattered through §5 prose without a collected "what this workstream produces" statement.
- **Suggested fix:** Add a short "Produced artifacts (contract surface vs internal)" note at the head of §5 listing the NEW `references/` files this workstream produces (`forge-0-epic/references/{epic-manifest-subcommands,edit-mode}.md`, `forge-5-loop/references/{runner-contract,result-reporting}.md`, appended sections in the existing `forge-verify/references/verification-checklists.md`) and naming the reduced `SKILL.md` bodies as the agent-facing entrypoint, mirroring 02 §5's framing.
- **References:** 04 §4/§5; compare 01 §4, 02 §5, 03 §2/§4, 05 §1
- **Checklist:** CHECK-S32

### V-009: Dangling cross-reference — 04 cites a non-existent `02 §7`
- **Severity:** error
- **Location:** 04-body-size-discipline.md §5.1 (lines ~217-218)
- **Issue:** 04 §5.1 states the epic-manifest flag surface "is *owned* by `02-frontmatter-purity-and-inventory.md §7` per the body's own note." Spec 02 has no §7 (it contains §1 Audit, §2 Transformation, §3 VND-02 Contingency, §4 VND-04, §5 Inventory Deliverable, then Dependencies/Verification). Moreover the epic-manifest mutator flag surface is not in spec 02 at all — 02 is exclusively frontmatter purity + vendor-construct inventory. This reads as a copy-paste artifact and misdirects a fresh implementer.
- **Suggested fix:** Remove the false `02 §7` attribution. Rewrite to: "(The exact `epic-manifest.py` mutator flag surface is defined by the existing `forge-0-epic` SKILL.md body and `scripts/epic-manifest.py --help`; the relocated reference file only needs a catalog + an in-body pointer, not a re-specification of the flags.)" If a cross-reference is desired, point to `01-architecture-layout.md §3` (which enumerates the subcommands).
- **References:** 04 §5.1, 02 (§1–§5 only), 01 §3
- **Checklist:** CHECK-S15, CHECK-S38

### V-010: TRACEABILITY.md REQ-SIZE-03 row states "≤300" without marking it as the D1-tightened value
- **Severity:** inconsistency
- **Location:** TRACEABILITY.md REQ-SIZE-03 row ("Budget ≤300 lines AND ≤5000 words") vs PRD §3.4 REQ-SIZE-03 (provisional "500 lines / 5,000 words")
- **Issue:** Not a true contradiction — tech-spec D1 explicitly tightens the PRD's provisional 500 → 300, which PRD §7 OQ-1 permits ("MAY tighten; MUST NOT loosen"), and all implementation specs are consistent at 300. But the traceability matrix presents "300" as if it were the requirement, with no marker that it is a tightened value; a reader cross-checking against the PRD's "500" will suspect a defect. The spec docs handle the lineage gracefully (04 §1 shows the 500→300 tightening); only the matrix omits it.
- **Suggested fix:** Change the REQ-SIZE-03 row summary to "Budget ≤300 lines AND ≤5000 words (D1 tightens OQ-1's provisional 500)". No code/spec change — 300 is correct everywhere else.
- **References:** TRACEABILITY.md, PRD §3.4 + §7 OQ-1, tech-spec §3.3/§10 D1, 00 §2, 04 §1
- **Checklist:** CHECK-S38, CHECK-S03

### V-011: 02–06 Dependencies sections interleave hard deps with forward references (false-cycle risk)
- **Severity:** improvement
- **Location:** Dependencies sections of 02–06
- **Issue:** Extracting literal `NN-*.md` mentions per Dependencies block yields apparent mutual references (02↔05, 03↔04, 05↔06). On inspection these are NOT build-order cycles — each doc separates true upstream deps (always 00, plus 01 for layout) from "verified-by / tested-by / owned-elsewhere" forward annotations, and 01 §6 gives the authoritative acyclic DAG (so CHECK-S16 passes). The risk is purely presentational: a future automated dependency-graph extractor keying on "Dependencies" headings would flag false cycles.
- **Suggested fix:** Optional. In each domain doc's Dependencies section, split into "Hard upstream dependencies (must land first)" vs "Forward references (verified-by / tested-by / owned-elsewhere)" so the DAG is machine-extractable. Content already correct; low priority.
- **References:** 01 §6 (authoritative graph), Dependencies sections of 02–06
- **Checklist:** CHECK-S16

### V-012: Resolver candidate-root probe (03 §2 step 2) has no test case
- **Severity:** gap
- **Location:** 06-testing-strategy.md §3 (resolver coverage table)
- **Issue:** 03 §2 specifies a four-step resolution order callers must "implement in this exact order": (1) self-location, (2) candidate-root probe (`$HOME/.claude/skills/feature-forge`, `$HOME/.claude/plugins/*/feature-forge`), (3) env fallback, (4) failure. 06 §3 tests only (a) self-location, (b) total failure, (c) env fallback. Step 2 — the "authoritative multi-root probe (TQ-1)" — is never exercised.
- **Suggested fix:** Add a case (d): invoke `forge-root.sh` from a location where self-location FAILS (script copied outside any root) with a candidate root present at a `HOME`-redirected path containing the sentinel pair; assert exit 0 and stdout == that candidate root. Drive with `env={**os.environ, "HOME": str(fake_home)}` so the step-2 globs resolve deterministically inside `tmp_path`. If judged infeasible, state the waiver explicitly per the §3 fallback clause.
- **References:** 03 §2 (step 2), 03 §6, 06 §3
- **Checklist:** CHECK-S34

### V-013: Reader-robustness fixtures' on-disk placement and required-key content unspecified
- **Severity:** gap
- **Location:** 06-testing-strategy.md §2.3 (reader-robustness fixtures table)
- **Issue:** The checker reads frontmatter only for `skills/*/SKILL.md` (05 §3.1 rule 1, §3.2 rule 2). 06 §2.3 describes each reader fixture purely by "frontmatter shape" and asserts `expect_clean=True`, but never states (a) each fixture must live at `skills/<name>/SKILL.md`, or (b) each "expect clean" fixture must also carry valid `name` (== `<name>`) + `description`. Without (a) the file is never scanned → test passes vacuously (false negative); without (b) a fixture would fail rule 1/2 for the wrong reason, masking what it claims to verify.
- **Suggested fix:** Add to §2.3: "Each reader fixture is a complete `skills/<name>/SKILL.md` whose frontmatter additionally carries valid `name` (== `<name>`) and `description`, so the only variable under test is the reader-corner construct; otherwise rule 1/2 would mask the reader assertion."
- **References:** 05 §3.1/§3.2, 00 §1/§4, 06 §2.3
- **Checklist:** CHECK-S37, CHECK-S35

### V-014: `clean-skills` fixture rationale invokes a sentinel pair the checker never uses
- **Severity:** inconsistency
- **Location:** 06-testing-strategy.md §2.1 (clean-skills fixture description)
- **Issue:** §2.1 says the clean fixture includes "a `scripts/forge-root.sh` sentinel pair so canonical-surface scanning has a real root." `check-spec-purity.py` does NOT consult the sentinel pair — it takes `--root` directly and globs `CANONICAL_SURFACES` (05 §3.3). The sentinel pair is exclusively the resolver's concern (03 §2 `is_root`). Stating the checker needs it misleads the fixture author.
- **Suggested fix:** Reword §2.1 to a minimal spec-pure tree: ≥2 `skills/<name>/SKILL.md` carrying only `{name, description}` (one with `metadata.argument-hint`), one in-canon body with a byte-identical bootstrap prelude, and no `${CLAUDE_PLUGIN_ROOT}` in any canonical surface. Drop the sentinel-pair clause (or move it to §3 where the resolver is tested and `is_root` applies).
- **References:** 05 §1/§3.3, 00 §2/§6, 03 §2, 06 §2.1
- **Checklist:** CHECK-S35, CHECK-S37

### V-015: No coverage target or explicit "enough" rationale stated
- **Severity:** improvement
- **Location:** 06-testing-strategy.md (no Coverage section)
- **Issue:** CHECK-S36 asks for a stated coverage target or explicit rationale. 06 enumerates a strong required-case matrix but never states the coverage philosophy, so "is this enough?" is implicit and a future contributor adding a sixth rule has no stated obligation to add the matching fixture pair.
- **Suggested fix:** Add a "Coverage target" subsection: coverage is behavioral, not line-%: every checker Rule (00 §5) MUST have ≥1 clean + ≥1 impure fixture asserting its leading reason token; every frontmatter-reader corner (00 §4) MUST have a fixture; the resolver MUST have a case per 03 §2 resolution step (or a documented waiver). Adding a new rule/reason without its fixture pair is a spec/CI regression.
- **References:** 00 §4/§5, 06 §2/§3/Verification
- **Checklist:** CHECK-S36

### V-016: Both-limbs body-size case (two violations) is not asserted
- **Severity:** improvement
- **Location:** 06-testing-strategy.md §2.2
- **Issue:** §2.2 tests each body-size limb in isolation (over-lines, over-words), but 05 §3.4 explicitly produces TWO violations when a body exceeds both limits ("an over-line and an over-word body produce two violations"). The both-over case is uncovered.
- **Suggested fix:** Add a fixture `bad-oversized-both` (>300 lines AND >5000 words) asserting both `exceeds 300` and `exceeds 5000` tokens appear and the `by rule` tally is `body-size=2`.
- **References:** 05 §3.4 + Verification, 00 §5
- **Checklist:** CHECK-S34, CHECK-S37

### V-017: Resolver tests are non-hermetic — host `$HOME` leaks into the "total failure" case
- **Severity:** gap
- **Location:** 06-testing-strategy.md §3 (case (b) `test_forge_root_fails_actionably`, and (c))
- **Issue:** Case (b) asserts exit 1 + actionable stderr when "no discoverable root and `CLAUDE_PLUGIN_ROOT` unset," but the sample harness sets only `CLAUDE_PLUGIN_ROOT: ""` and leaves the real `$HOME` in `env`. forge-root.sh step 2 probes `$HOME/.claude/skills/feature-forge`; on the maintainer's self-hosting machine that is a live dev symlink to an installed feature-forge (sentinel pair present), so step 2 resolves a root and case (b) FALSE-FAILS (exit 0, not 1) in CI run from that account or any dev box with feature-forge installed.
- **Suggested fix:** Specify that the resolver harness MUST run with an isolated `HOME` for cases (b) and (c): `env={**os.environ, "HOME": str(tmp_path / "empty-home"), "CLAUDE_PLUGIN_ROOT": ""}`, so neither the dev symlink nor real plugin installs leak into the probe. Note the self-hosting hazard explicitly.
- **References:** 03 §2 (step 2 `$HOME` globs), 06 §3 cases (b)/(c); CLAUDE.md self-hosting / dev-symlink note
- **Checklist:** CHECK-S34, CHECK-S35

### V-018: Cross-agent portability is promised by the PRD but the Claude-only prelude does not deliver it
- **Severity:** gap
- **Location:** 03 §3 (prelude), 00 §3 (`BOOTSTRAP_PRELUDE`), tech-spec §3.2, PRD §3.3 REQ-RES-01 + user story
- **Issue:** The PRD frames the resolver around portability to non-Claude agents (REQ-RES-01: "without depending on the Claude-only `${CLAUDE_PLUGIN_ROOT}`"; user story: "functions when installed under a non-Claude agent"). But the bootstrap prelude — the only entry point a skill body executes — hardcodes two Claude-only globs (`$HOME/.claude/skills/feature-forge`, `$HOME/.claude/plugins/*/feature-forge`). Under any non-Claude agent neither matches, so `forge-root.sh` is never discovered and the guard exits 1; the genuinely portable self-location path is unreachable because nothing names the script's path outside `~/.claude`. The specs disclose this (TQ-1, 03 §3 invariant 3, deferred to `cross-agent-installer`) but as a maintainability footnote, not as a scope boundary on REQ-RES-01 — so the PRD success criteria read as fully satisfied when portability is not yet delivered.
- **Suggested fix:** Add an explicit scope note to 03 §1 (and a one-line caveat under PRD §8 success criterion 3 or §6 Out-of-Scope): this feature delivers the resolver mechanism + removes env-var coupling from canonical surfaces, but the prelude's discovery globs remain Claude-only; wiring per-agent discovery paths so a non-Claude agent can bootstrap-discover `forge-root.sh` is owned by `cross-agent-installer` (TQ-1). No prelude code change in this feature.
- **References:** PRD REQ-RES-01/02 + user story; 03 §3 invariant 3; tech-spec §3.2 + TQ-1 (§10); TRACEABILITY.md REQ-RES-01 row
- **Checklist:** CHECK-S22, CHECK-S24, CHECK-S30

### V-019: Concurrent / loop-context execution of the checker and resolver is not addressed
- **Severity:** gap
- **Location:** 05 §7, 03 §6 (no concurrency note in either)
- **Issue:** This repo is self-hosting (the rauf loop mutates working trees) and `packaging-docs-ci` wires the checker into CI, where it may run during a live loop iteration mutating `SKILL.md` files. Neither spec addresses concurrent access: the checker is read-only (safe from corruption) but takes no snapshot, so a concurrent edit can produce a transient false violation (half-written frontmatter read as `VR_MALFORMED_FM`). For a hard gate this failure mode deserves one sentence.
- **Suggested fix:** Add a "Concurrency" note to 05 §7: read-only/stateless ⇒ safe to run in parallel, but no snapshot ⇒ a tree mutated mid-run can yield transient malformed/size violations; run the gate against a quiescent (post-iteration) tree, as `validate.sh` already does. Add a one-line concurrency-safe note to 03 §6 for the resolver.
- **References:** CLAUDE.md self-hosting note; 05 §1/§7; tech-spec §3.4 (CI wiring)
- **Checklist:** CHECK-S27

### V-020: Empty-skill-dir / missing-`SKILL.md` edge is unspecified
- **Severity:** gap
- **Location:** 05 §3.1/§3.2/§3.4 (`root.glob("skills/*/SKILL.md")`) vs §3 `iter_canonical_files` + §7
- **Issue:** A `skills/<name>/` directory with no `SKILL.md` yields no glob match and is silently skipped — no violation; and an entirely empty `skills/` tree exits 0 (clean) per §7's "missing glob target yields empty rather than raising." For a canon-purity gate, whether a skill dir that lost its `SKILL.md` should pass clean is left undefined.
- **Suggested fix:** State the intended behavior in 05 §7 (or §3.1): either (a) "a `skills/<name>/` without a `SKILL.md` is out of scope — the checker validates files that exist; tree-completeness is covered by 01's diff checklist," or (b) add a rule requiring every immediate child dir of `skills/` to contain a `SKILL.md`. Recommend (a) (lighter, matches current intent). Also state explicitly: "an empty `skills/` tree yields zero violations (exit 0); completeness is not the checker's concern."
- **References:** 05 §3.1/§3.4/§3/§7, 06 §2.2 (no empty-dir fixture), 01 §2
- **Checklist:** CHECK-S28

### V-021: `validate.sh` insertion-point wording would nest the gate inside a conditional, silently breaking the "unconditional" guarantee
- **Severity:** inconsistency
- **Location:** 01 §5, 05 §5, tech-spec §3.4/§6 — vs actual `feature-forge/scripts/validate.sh` (the `py_compile`+`pytest` block)
- **Issue:** All three specs describe the insertion as "between the `py_compile` substep and the `pytest` substep" / "after py_compile, before pytest." In the real source, `py_compile` and the `pytest` block are BOTH nested inside a single `if [ -f "$HELPER" ]` guard. Inserting the checker step literally between them would place it inside that guard — so the spec-purity gate would be SKIPPED ENTIRELY when `epic-manifest.py` is absent, directly contradicting the specs' own "runs UNCONDITIONALLY, never soft-skipped" requirement (05 §5, 01 §5).
- **Suggested fix:** Correct the placement language in 01 §5, 05 §5, and tech-spec §3.4/§6: insert the spec-purity step as a new TOP-LEVEL step OUTSIDE the `if [ -f "$HELPER" ]` guard — cleanest spot is after step 6 (script-permission) and before step 7 (the HELPER guard) — so it runs unconditionally regardless of whether `epic-manifest.py` is present.
- **References:** `feature-forge/scripts/validate.sh` (HELPER guard block); 01 §5; 05 §5 ("runs UNCONDITIONALLY"); tech-spec §3.4/§6
- **Checklist:** CHECK-S22, CHECK-S25, CHECK-S26

### V-022: Performance-sensitive path (recursive globbing + repeated reads) is not identified
- **Severity:** improvement
- **Location:** 05 §3 (`iter_canonical_files`, recursive `CANONICAL_SURFACES` globs); no NFR note in the suite
- **Issue:** CHECK-S29: the checker uses recursive globs (`skills/**/references/**`, `references/**`), reads every match into memory, and re-reads each `SKILL.md` up to 4× (rules 1/2/4). At ~11 skills this is almost certainly sub-second, so not a correctness concern — but the specs never identify this as the one scaling axis nor note the duplicate reads.
- **Suggested fix:** Add a one-sentence note to 05 §7 or §3: single full scan over recursive globs; sub-second at current scale (~11 skills); each `SKILL.md` read independently by rules 1/2/4 (no shared cache) — acceptable now; cache `read_text` per path if the canon grows large.
- **References:** 05 §3; 04 (relocation grows `references/`)
- **Checklist:** CHECK-S29

## Fix Execution Plan

### User Decisions Required
- **V-001:** ✅ RESOLVED (2026-06-16) → **(a) make them real.** Add Python format-string constants in 00 §5 and refactor 05 §3.1–§3.5 to interpolate them.
- **V-020:** ✅ RESOLVED (2026-06-16) → **(a) out of scope.** Document in 05 §7 that the checker validates files that exist; tree-completeness is 01's diff checklist; empty `skills/` tree exits 0.

All other fixes can be applied directly (documentation-only clarifications or low-risk additions).

### Execution Steps

Apply in order. Each step is self-contained.

#### Step 1: Fix the `validate.sh` insertion-point wording (HIGHEST VALUE)
- **Files:** 01-architecture-layout.md (§5), 05-spec-purity-checker.md (§5), tech-spec.md (§3.4 and §6)
- **Addresses:** V-021
- **Checklist:** CHECK-S22, CHECK-S25, CHECK-S26
- **Action:** Replace "between the py_compile substep and the pytest substep" / "after py_compile, before pytest" with: insert as a new TOP-LEVEL step OUTSIDE the `if [ -f "$HELPER" ]` guard — cleanest spot is after step 6 (script-permission) and before step 7 (the HELPER guard) — so the hard gate runs unconditionally even when `epic-manifest.py` is absent. Keep the "runs UNCONDITIONALLY / never soft-skipped" language; this fix makes the placement honor it.
- **Depends on:** none
- **Rationale:** If implemented literally, current wording silently breaks the unconditional-gate guarantee. Fix first because it changes how every downstream backlog item wires the gate.

#### Step 2: Fix the dangling `02 §7` cross-reference in 04
- **Files:** 04-body-size-discipline.md (§5.1)
- **Addresses:** V-009
- **Checklist:** CHECK-S15, CHECK-S38
- **Action:** Remove the false `02 §7` attribution; rewrite the parenthetical to point at the existing `forge-0-epic` SKILL.md body / `scripts/epic-manifest.py --help` as the flag-surface authority, optionally cross-referencing `01 §3` (which enumerates the subcommands). Do not invent a §7 in spec 02.
- **Depends on:** none
- **Rationale:** Lone `error`; misdirects a fresh implementer.

#### Step 3: Reconcile the constant/contract story in 00 (+ 05 counterparts)
- **Files:** 00-core-definitions.md (§2, §3, §5, §7), 05-spec-purity-checker.md (§3.1–§3.5)
- **Addresses:** V-001, V-002, V-003, V-004, V-005
- **Checklist:** CHECK-S09, S10, S11, S12, S13
- **Action:**
  - V-001 (per user decision): if (a), add a Python block in 00 §5 binding each `VR_*` as a module-level format-string and refactor 05 §3.1–§3.5 to interpolate them ("imported from 00 §5, do NOT redefine"); if (b), rename the §5 column "Constant" → "Reason token (informative)" and add the one-sentence clarification.
  - V-002: change the `VR_BODY_LINES`/`VR_BODY_WORDS` cells to placeholder form `body <n> lines exceeds 300` / `body <n> words exceeds 5000` (do regardless of V-001 choice).
  - V-003: add the `BOOTSTRAP_PRELUDE: str = (...)` binding in 00 §3 beneath the bash literal (byte-identical to 05 §3.5); change 05 §3.5's comment to "Imported conceptually from 00 §3 (do NOT redefine)".
  - V-004: add the `| 2 | usage error (argparse) … |` row to 00 §7's `check-spec-purity.py` exit-code table.
  - V-005: add one sentence after `SENTINEL_FILES` in 00 §2 documenting its spec-anchor role (Bash `is_root` intentionally hardcodes the pair; no Python consumer per D2).
- **Depends on:** V-001 user decision
- **Rationale:** All touch 00's canonical definitions and 05's emission sites; group so the canon and the consumer stay in lockstep.

#### Step 4: Tighten the testing strategy (06)
- **Files:** 06-testing-strategy.md (§2.1, §2.2, §2.3, §3, new Coverage subsection)
- **Addresses:** V-012, V-013, V-014, V-015, V-016, V-017
- **Checklist:** CHECK-S34, S35, S36, S37
- **Action:**
  - V-012 + V-017 (§3 resolver harness): add candidate-probe case (d) driven by a redirected `HOME`; require cases (b)/(c)/(d) to run with isolated `HOME` (`HOME=tmp_path/empty-home`) so the maintainer's live dev symlink can't false-fail the total-failure case.
  - V-013 (§2.3): require each reader fixture to be a full `skills/<name>/SKILL.md` carrying valid `name` (== dir) + `description`.
  - V-014 (§2.1): drop the "sentinel pair so canonical-surface scanning has a real root" clause; reword to a minimal spec-pure tree.
  - V-016 (§2.2): add `bad-oversized-both` fixture asserting two BODY_SIZE violations (`body-size=2` tally).
  - V-015: add a "Coverage target" subsection defining coverage behaviorally (per-rule clean+impure fixture; per reader corner; per resolver step or waiver).
- **Depends on:** Step 3 (V-013/V-016 reference the reason tokens / constants finalized there)
- **Rationale:** All are 06 fixtures/cases; the gaps (V-012, V-013, V-017) are the substantive ones.

#### Step 5: Add the cross-agent portability scope boundary
- **Files:** 03-portable-root-resolver.md (§1), PRD.md (§8 success criterion 3 or §6 Out-of-Scope), TRACEABILITY.md (REQ-RES-01 row note, optional)
- **Addresses:** V-018
- **Checklist:** CHECK-S22, CHECK-S24, CHECK-S30
- **Action:** Add an explicit note that this feature delivers the resolver mechanism + removes env-var coupling from canonical surfaces, but the prelude's discovery globs remain Claude-only; per-agent discovery wiring is owned by `cross-agent-installer` (TQ-1). Reframe the TQ-1 deferral as an intended scope boundary on REQ-RES-01. No prelude code change.
- **Depends on:** none
- **Rationale:** Closes the gap between the PRD's portability promise and what ships; documentation-only.

#### Step 6: Add checker concurrency, empty-input, and performance notes
- **Files:** 05-spec-purity-checker.md (§7, and a sentence in §3/§3.1), 03-portable-root-resolver.md (§6, one line)
- **Addresses:** V-019, V-020, V-022
- **Checklist:** CHECK-S27, CHECK-S28, CHECK-S29
- **Action:**
  - V-019: "Concurrency" note in 05 §7 (read-only/stateless safe; no snapshot ⇒ transient violations on a mutating tree; run against quiescent tree) + one-line concurrency-safe note in 03 §6.
  - V-020 (per user decision): state the missing-`SKILL.md`-in-a-skill-dir behavior (recommend out-of-scope) and that an empty `skills/` tree exits 0.
  - V-022: one-sentence performance note (single full scan, sub-second at ~11 skills, per-rule reads acceptable).
- **Depends on:** V-020 user decision
- **Rationale:** Three small documentation additions closing the remaining edge/NFR checks honestly.

#### Step 7: Tech-spec / 04 / Dependencies polish (low priority)
- **Files:** tech-spec.md (§2, §1), 04-body-size-discipline.md (§5), Dependencies sections of 02–06
- **Addresses:** V-006, V-007, V-008, V-011
- **Checklist:** CHECK-S05, S06, S08, S16, S32
- **Action:**
  - V-006: add the `tests/fixtures/` line to tech-spec §2's `tests/` block.
  - V-008: add a "Produced artifacts (contract surface vs internal)" note at the head of 04 §5.
  - V-007 (optional): add a D1–D4 decision-map legend to tech-spec §1.
  - V-011 (optional): split each domain doc's Dependencies into hard-deps vs forward-refs.
- **Depends on:** none
- **Rationale:** All low-severity clarity/consistency improvements; safe to batch last.

## Fix Progress

- Step 1: [APPLIED] 2026-06-16 — V-021: rewrote the `validate.sh` insertion-point wording in 01 §5, 05 §5, and tech-spec §3.4/§6 to place the spec-purity gate as a TOP-LEVEL step OUTSIDE the `if [ -f "$HELPER" ]` epic-manifest guard (was "between py_compile and pytest", which are both inside that guard).
- Step 2: [APPLIED] 2026-06-16 — V-009: removed the dangling `02 §7` cross-reference in 04 §5.1; now points at the forge-0-epic SKILL.md body / `epic-manifest.py --help` and `01 §3`.
- Step 3: [APPLIED] 2026-06-16 — V-001 (decision a) / V-002 / V-003 / V-004 / V-005: added real `VR_*` format-string constants + `BOOTSTRAP_PRELUDE` Python binding to 00 (§5, §3), refactored 05 §3.1–§3.5 rule functions to interpolate them; fixed the `<n>` placeholder cells; added exit-code 2 to 00 §7; documented `SENTINEL_FILES`' spec-anchor role in 00 §2.
- Step 4: [APPLIED] 2026-06-16 — V-012/V-013/V-014/V-015/V-016/V-017: added resolver candidate-probe case (d) + mandatory HOME isolation for cases (b)/(c)/(d) in 06 §3; specified reader-fixture placement/required keys in §2.3; corrected the clean-skills sentinel-pair rationale in §2.1; added a `bad-oversized-both` two-violation case in §2.2; added a behavioral Coverage-target subsection (§1.1); updated the Verification checklist.
- Step 5: [APPLIED] 2026-06-16 — V-018: added the cross-agent portability scope boundary to 03 §1, PRD §6 Out-of-Scope, and the TRACEABILITY REQ-RES-01 row (mechanism delivered here; full cross-agent discovery owned by cross-agent-installer / TQ-1).
- Step 6: [APPLIED] 2026-06-16 — V-019/V-020 (decision a)/V-022: added Concurrency, empty/missing-input (out-of-scope), and Performance notes to 05 §7, plus a resolver concurrency-safe note to 03 §6.
- Step 7: [APPLIED] 2026-06-16 — V-006/V-007/V-008/V-011: added `tests/fixtures/` to tech-spec §2; added the D1–D4 decision-map legend to tech-spec §1; added a "Produced artifacts (contract surface vs internal)" note to 04 §5; split the 04 and 06 Dependencies sections into hard-upstream vs forward-reference groups.

All 22 findings addressed. Post-fix checks: `validate-traceability.py` clean (28/28, 0 uncovered, 0 orphaned); the two `BOOTSTRAP_PRELUDE` Python bindings (00 §3, 05 §3.5) verified byte-identical.
