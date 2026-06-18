# Verification Findings — packaging-docs-ci (specs mode)

- **Feature:** packaging-docs-ci
- **Epic:** agent-agnostic
- **Mode:** specs
- **Date:** 2026-06-17
- **Verifier:** forge-verify (parallel dimensioned fan-out — 5 forge-verifier instances)
- **Artifacts verified:** PRD.md, tech-spec.md, 00-core-definitions.md, 01-architecture-layout.md, 02-ci-blocking-gates.md, 03-os-matrix-installer-gate.md, 04-trigger-accuracy-eval.md, 05-readme-and-agent-docs.md, 06-packaging-versioning-hygiene.md, 07-testing-strategy.md, TRACEABILITY.md

## Summary

Executed **38 of 38** specs-mode checks (CHECK-S01..S38) across five dimensions
(types/contracts/errors · architecture/layout · cross-reference/traceability ·
testing/non-functional · integration), plus the deterministic
`validate-traceability.py` validator.

**Result: 11 findings — 2 error, 2 gap, 3 inconsistency, 4 improvement.**

The spec suite is strong: full requirement coverage (39/39 REQs traced, 0 uncovered
per the deterministic validator), a clean dependency DAG (00→01→02–06→07, no cycles),
consistent exit-code taxonomies, and faithful reflection of all 7 tech-spec interview
decisions. The two `error`-severity findings are both at real integration/packaging
seams and were positively confirmed against repo source:

1. **V-001** — tech-spec §3.13 asserts a publish target ("the unscoped `rauf` package —
   bin `rauf`") that does not exist in the repo, contradicting 06 §7.1 / OQ-A.
2. **V-002** — the new `validate.sh` traceability-gate wiring (02 §4.6) invokes
   `validate-traceability.py` with an argument shape the script's CLI rejects, and
   suppresses its diagnostic.

Deterministic validator (`validate-traceability.py`): `total_requirements=39`,
`uncovered_requirements=[]`, `orphaned_references=[REQ-FM-01, REQ-VND-01]` — the two
orphans are addressed by V-009 (quoted foreign-feature source, benign).

### Per-dimension coverage tally

| Dimension | Checks | Pass | Finding-bearing |
|---|---|---|---|
| Types / contracts / errors | S09–S13, S18–S21 (9) | 7 | V-006, V-002 |
| Architecture / layout | S05–S08 (4) | 2 | V-001, V-005, V-008 |
| Cross-reference / traceability | S01–S04, S14–S17, S38 (9) | 8 | V-009 |
| Testing / non-functional | S27–S37 (11) | 8 | V-003, V-004, V-007 |
| Integration | S22–S26 (5) | 4 | V-002, V-010, V-011 |

## Findings

### V-001: tech-spec §3.13 asserts a non-existent "unscoped `rauf` package — bin `rauf`" as the npm publish target

- **Severity:** error
- **Location:** `tech-spec.md` §3.13 (~line 353); contradicted by `06-packaging-versioning-hygiene.md` §7.1 (~lines 436–442) and OQ-A (§7.4)
- **What's wrong:** §3.13 says the npm prep should add `publishConfig`/`files`/`bin` "to the rauf package that the installer's `rauf@0.6.0` pin targets (the unscoped `rauf` package — **bin `rauf`**)." Verified against the repo: the unscoped root package `rauf` (`/home/gary/workspace/rauf/package.json`) is `private:true` and has **no `bin`** field; the only package carrying `bin: { rauf }` is the **scoped, private** `@rauf/cli` (`packages/cli/package.json:6–7`). So "the unscoped `rauf` package — bin `rauf`" describes a package that does not exist. 06 §7.1 correctly treats *which* package becomes the published `rauf` as a **deliberately deferred** decision (OQ-A). The tech-spec presents as settled fact what 06 and OQ-A treat as open — an upstream decision contradicted downstream, and the upstream statement is factually wrong.
- **Suggested fix:** Edit tech-spec §3.13 — drop the parenthetical "(the unscoped `rauf` package — bin `rauf`)" and replace with a forward reference to the deferred target choice, e.g. "…to the package that will become the published unscoped `rauf` (root `rauf` currently has no `bin`; `@rauf/cli` carries `bin: rauf` but is scoped/private — the publish target is deferred to OQ-A; see 06 §7.1/§7.4)." Keep the rest of §3.13 (Bun-shebang note, no-publish, optional `npm-publish.yml`) intact.
- **References:** `package.json:2–4` (no bin), `packages/cli/package.json:6–7` (bin rauf, private, scoped); 06 §7.1, §7.4 OQ-A; tech-spec §1 decision 1, §10 OQ-A
- **Checklist:** CHECK-S05, CHECK-S08

### V-002: `validate.sh` traceability-gate wiring (02 §4.6) invokes `validate-traceability.py` with an argument shape its CLI rejects, and suppresses its diagnostic

- **Severity:** error
- **Location:** `02-ci-blocking-gates.md` §4.6 — the "New `validate.sh` step (insert before the final tally)" code block (the `python3 "$TRACE" "$TRACE_PRD"/*/PRD.md "$TRACE_PRD" 2>/dev/null` line)
- **What's wrong:** The real signature (verified at `/home/gary/workspace/feature-forge/scripts/validate-traceability.py:35–40`) is exactly two positionals — `prd_path` (a single PRD.md **file**) and `specs_dir` (one directory) — plus optional `--json`. The proposed glob `"$TRACE_PRD"/*/PRD.md` (with `TRACE_PRD="$REPO_ROOT/specs"`) expands to zero, one, or many paths, and every branch fails the real contract:
  - **Multiple** PRD.md → argparse binds first to `prd_path`, second to `specs_dir`, errors on the third+ → exit 2.
  - **Exactly one** PRD.md → command is `<prd> <specs-dir> <specs-dir>` = 3 positionals where 2 are allowed → exit 2.
  - **Zero** matches → `prd_path` is the literal un-expanded glob → "PRD file not found" → exit 2.

  Separately, even with a correct invocation the wiring runs the validator inside a plain `if … then PASS else FAIL` that treats the validator's distinct **exit 2** (config/file-not-found) identically to **exit 1** (real gaps/orphans), and the `2>/dev/null` discards the validator's own stderr diagnostic — so a config error is mislabeled "gaps/orphans" with no detail, undercutting the no-silent-failure obligation (00 §8 / REQ-OBS-01) at the one gate this doc introduces.
- **Suggested fix:** Replace the invocation with a per-suite loop that calls the validator once per matched `*/PRD.md` with its own `dirname` as `specs_dir`, guards the no-match case, branches on the validator's exit code, and drops `2>/dev/null`:
  ```bash
  for prd in "$TRACE_PRD"/*/PRD.md; do
    [ -e "$prd" ] || continue                       # no suites → SKIP, not a bogus failure
    specs_dir="$(dirname "$prd")"
    python3 "$TRACE" "$prd" "$specs_dir"; rc=$?
    case "$rc" in
      0) echo "PASS: traceability ($specs_dir)" ;;
      1) echo "FAIL: traceability gaps/orphans in $specs_dir (see above)"; ERRORS=$((ERRORS + 1)) ;;
      *) echo "FAIL: traceability config error in $specs_dir (rc=$rc)"; ERRORS=$((ERRORS + 1)) ;;
    esac
  done
  ```
  Update the surrounding prose ("run once per spec suite") to match the corrected per-PRD/specs-dir contract. This mirrors how §4.5's `check-version-sync.py` already separates exit 2 (config) from exit 1 (mismatch).
- **References:** `/home/gary/workspace/feature-forge/scripts/validate-traceability.py:32–55` (signature + `usage: validate-traceability.py <prd-path> <specs-dir> [--json]`); §4.5 `check-version-sync.py` (the consistent exit-code-branching pattern); 00 §8 `GateDiagnostic`; REQ-CI-06, REQ-OBS-01
- **Checklist:** CHECK-S23, CHECK-S26, CHECK-S11, CHECK-S19
- **Note:** Merges two independently-reported findings on this same snippet (integration arg-shape + error-handling exit-code/diagnostic-suppression).

### V-003: No coverage target stated for the trigger-accuracy eval (which skills must have fixtures)

- **Severity:** gap
- **Location:** `04-trigger-accuracy-eval.md` §4 / §4.1 and `07-testing-strategy.md` §4
- **What's wrong:** The eval scores "over whatever fixtures are present" (04 §4, ~line 127) and only **two** of the 11 skills get fixtures (`forge-1-prd`, `forge-5-loop`). There is no stated minimum-fixture floor, no list of which skills should eventually be covered, and no obligation that new skills add a fixture — a contributor could delete a fixture and the score would silently narrow with no check noticing. This is the only "coverage target" notion (CHECK-S36) that applies to the capstone; PRD REQ-EVAL-01 ("per-skill should-trigger/should-not-trigger cases") reads broader than two.
- **Suggested fix:** Add a short "Coverage target" subsection to 04 (and a row in 07 §1 taxonomy or §4) stating the explicit bar, e.g. "SC-06 is met by ≥2 authored fixtures that discriminate against each other (`forge-1-prd` / `forge-5-loop`); broadening to all 11 skills is out of scope for this capstone and tracked as follow-up." This converts the implicit two-fixture floor into a stated, verifiable target and records the deliberate non-goal.
- **References:** `00-core-definitions.md` §4 (`EvalFixture`), PRD §3.5 REQ-EVAL-01, SC-06
- **Checklist:** CHECK-S36, CHECK-S35

### V-004: Anti-drift pytest (the capstone's one net-new test) soft-skips when pytest is absent — untested CI failure mode

- **Severity:** gap
- **Location:** `07-testing-strategy.md` §2.2; `02-ci-blocking-gates.md` step-7 row (~line 101 "pytest soft-skips if absent"); `tech-spec.md` §8
- **What's wrong:** 07 §2.2 / tech-spec §8 present the anti-drift pytest assertion (`check-spec-purity.py` loaded `ALLOWED` == schema `properties`) as the mechanical guard that schema and checker never silently diverge — the most important *new* test this feature adds. But it runs only via `validate.sh` step 7, which (verified in real `scripts/validate.sh`, lines 178–186) **soft-skips non-fatally when pytest is not installed** ("SKIP: pytest not installed … (non-fatal)") and still prints "All checks passed!". So on any runner without pytest the sole drift guard silently no-ops. 07 lists pytest under "Provisioning: pytest (CI-installed)" but never requires the feature-forge CI workflow to install it, nor flags that a missing pytest turns the guard into a no-op.
- **Suggested fix:** In 07 §2.2 (and the §1 taxonomy "Provisioning" cell for the pytest row) state explicitly that the feature-forge CI composite MUST `pip install pytest` so `validate.sh` step 7 is a **hard** gate in CI, and that locally the assertion is only enforced when pytest is present. Add a verification-checklist line: "the CI workflow installs pytest so `validate.sh` step 7 cannot soft-skip the anti-drift assertion in CI." Cross-reference 02's step-7 row so the soft-skip is a documented local-only affordance, not a CI gap.
- **References:** real `feature-forge/scripts/validate.sh:178–186`; `02-ci-blocking-gates.md` step-7 row; `00-core-definitions.md` §3 (anti-drift invariant); REQ-CI-02, REQ-CONST-03
- **Checklist:** CHECK-S28, CHECK-S33, CHECK-S34

### V-005: 01 §1.2 inventories the rauf npm-prep as `packages/*/package.json` (all 5 packages); 06 §7.1 scopes it to ONE package

- **Severity:** inconsistency
- **Location:** `01-architecture-layout.md` §1.2 (line 87: `packages/*/package.json EDIT npm-publishability prep`); `tech-spec.md` §2 (line 104: `package.json (per package) # EDIT`); contradicted by `06-packaging-versioning-hygiene.md` §7.1 (~line 442: "For **the package** that will become the published `rauf`…")
- **What's wrong:** The architecture inventory (and tech-spec §2's mirror) declares the npm-publishability prep touches `packages/*/package.json` — a glob over all 5 workspace packages (`cli, core, docs, loop, web`, verified). But 06 §7.1, which owns the execution, edits only **one** package (the chosen publish target) and explicitly warns the edit must NOT change any `version` field across the 6-manifest `version:check` set. Adding `publishConfig`/`files`/`bin` to all 5 is wrong (only the publish target needs them) and risks polluting the version-sync contract surface. The 01 inventory drives forge-4 backlog `repo` declarations, so this over-broad glob would mis-scope a backlog item.
- **Suggested fix:** Change 01 §1.2 line 87 to a single-target line, e.g. `packages/cli/package.json (or root, per OQ-A) EDIT — npm-publishability prep (publishConfig/files/bin) on the chosen rauf publish target only; NO version change, NO publish (06 §7.1)`. Align tech-spec §2 line 104 (`package.json (per package)`) to the same single-target phrasing. (Do not force-resolve OQ-A — only make the specs mutually consistent.)
- **References:** 06 §7.1 (single target, no version change), §1 (6-manifest `version:check` set); `packages/*/` = 5 dirs (verified); tech-spec §10 OQ-A
- **Checklist:** CHECK-S06, CHECK-S08

### V-006: `EvalReport` documented JSON shape (camelCase) contradicts what `run-eval.py` actually emits (snake_case)

- **Severity:** inconsistency
- **Location:** `04-trigger-accuracy-eval.md` §5 (TypeScript `EvalReport`/`EvalSkillResult`/`EvalCaseResult`, ~lines 186–213) vs §6 (the `run-eval.py` harness — dataclasses `Report`/`SkillResult`/`CaseResult` serialized via `asdict()`, ~lines 282–290, 416–417, 436)
- **What's wrong:** §5 fixes the `--json` contract as TS interfaces with camelCase multi-word fields (`totalCases`, `totalCorrect`, `skipReason`) and explicitly claims parity ("the harness implements the same shape as Python dataclasses → `dict`"). But §6 defines `Report` with `total_cases`/`total_correct`/`skip_reason` and emits via `json.dumps(asdict(report))`. `dataclasses.asdict()` preserves Python attribute names verbatim, so the emitted JSON keys are snake_case — not the documented camelCase. A machine consumer parsing the eval `--json` against the §5 `EvalReport` interface would find three keys missing and three unexpected. (Single-token fields — `model`, `skills`, `accuracy`, `skipped`, and the `EvalCaseResult`/`EvalSkillResult` fields — happen to match; only the multi-word fields diverge.)
- **Suggested fix:** Make the two representations agree. Preferred: change the §5 interfaces to snake_case (`total_cases`, `total_correct`, `skip_reason`) so `EvalReport` matches `asdict()` output, and drop the implication that camelCase TS names are the wire format. Alternatively, if camelCase on the wire is desired, give the harness an explicit serializer (`to_json_dict()` renaming the three fields) and reference it from §6 instead of bare `asdict()`. State the canonical wire-key casing once; make both §5 and §6 conform.
- **References:** `04-trigger-accuracy-eval.md` §5 (interfaces), §6 (`Report` dataclass + `asdict` emission), §6.5 (claims `--json` "emits the `EvalReport`")
- **Checklist:** CHECK-S12, CHECK-S09

### V-007: Local ruff recipe in 07 is not actually "tolerant of absent eval/" as its comment claims

- **Severity:** inconsistency
- **Location:** `07-testing-strategy.md` §2 (line 49: `ruff check scripts/ eval/  # … tolerant of absent eval/, §2.5`) and §2.5 ("Ordering" bullet)
- **What's wrong:** The local command is written as `ruff check scripts/ eval/`. `ruff` errors (non-zero, "No such file or directory") when a path argument does not exist — it is **not** self-tolerant of an absent `eval/`. The tolerance actually defined is a CI-side `[ -d eval ]` guard in the **composite action** (02 §lint, ~lines 519–524) plus the local fallback `ruff check scripts/` (02 ~line 526). 07 §2.5 hedges "must tolerate an absent `eval/` **or** the lint-gate item is sequenced after the eval item," but the §2 pass-bar recipe a developer copies verbatim gives the un-guarded form with a comment that misleadingly promises tolerance. Run before `eval/` exists, it fails for an out-of-scope reason.
- **Suggested fix:** In 07 §2, change line 49 to a guarded local form, e.g. `ruff check scripts/ $( [ -d eval ] && echo eval )  # REQ-CI-03 (python; eval/ optional until authored, §2.5)`, or split into `ruff check scripts/` plus `[ -d eval ] && ruff check eval/`. Rewrite the §2.5 "Ordering" bullet to state the CI composite owns the `[ -d eval ]` guard (02 §lint) so ordering is irrelevant — drop the "or sequence after" alternative.
- **References:** `02-ci-blocking-gates.md` §lint (lines 519–528), `tech-spec.md` §3.4, `04-trigger-accuracy-eval.md` §9
- **Checklist:** CHECK-S28, CHECK-S34

### V-008: tech-spec §2 rauf inventory omits `docs.yml`; 01 §1.2 adds it

- **Severity:** improvement
- **Location:** `tech-spec.md` §2 rauf block (lines 99–106) vs `01-architecture-layout.md` §1.2 (line 84: `docs.yml UNCHANGED`)
- **What's wrong:** tech-spec §2's rauf file inventory lists `release.yml (exists)` and `npm-publish.yml NEW` but omits the existing `.github/workflows/docs.yml` (verified present), which is load-bearing for REQ-README-02's `check:docs` gate referenced throughout 02/05/06. 01 §1.2 correctly lists it as UNCHANGED. Not a contradiction (01 is more complete than tech-spec), but the asymmetry means a reader of tech-spec §2 alone would miss that `check:docs` runs via its own workflow.
- **Suggested fix:** Add `.github/workflows/docs.yml # (exists) — runs check:docs; rauf README edit must keep it green` to tech-spec §2's rauf block for parity with 01 §1.2.
- **References:** rauf `.github/workflows/docs.yml` (verified); 05 §2.2 (`check:docs`), 06 §4.2
- **Checklist:** CHECK-S06

### V-009: Validator-flagged orphan refs `REQ-FM-01` / `REQ-VND-01` are foreign-feature REQ IDs quoted verbatim from source

- **Severity:** improvement
- **Location:** `02-ci-blocking-gates.md` §4.2 (lines ~326 and ~347, both inside fenced ```python blocks)
- **What's wrong:** `validate-traceability.py` reports `REQ-FM-01` and `REQ-VND-01` as orphaned references (cited in a spec doc, undefined in this PRD). Investigation: these are NOT typos for packaging-docs-ci REQs and NOT requirements dropped from this PRD — they belong to a *different* epic feature (`forge-skill-spec-purity`) and appear only because 02 §4.2 quotes the real `check-spec-purity.py` source **verbatim** (the comment `# §1 — frontmatter schema (REQ-FM-01, REQ-VND-01).` is line 34 of `/home/gary/workspace/feature-forge/scripts/check-spec-purity.py`). The validator is pattern-matching REQ IDs inside quoted code — a known false-positive class. No coverage of any packaging-docs-ci requirement is affected.
- **Suggested fix (lowest-churn first):** (1, preferred) Add a one-line note in 02 §4.2 above the first code block clarifying that `REQ-FM-01`/`REQ-VND-01` in the quoted source are `forge-skill-spec-purity`'s requirement IDs (carried in the real `check-spec-purity.py`), NOT packaging-docs-ci requirements — keeping the source quote byte-accurate (the block's premise is "verified current state"). (2, optional, separate scope) Teach the traceability validator to skip REQ IDs inside fenced code blocks. **Do NOT** edit the quoted comment to remove the IDs — that would make the spec diverge from the real source.
- **References:** `/home/gary/workspace/feature-forge/scripts/check-spec-purity.py:34`; PRD §3.3 (REQ-CI-02, the real requirement these blocks implement); validator `orphaned_references` output
- **Checklist:** CHECK-S04, CHECK-S38

### V-010: 03 §3.4 cites `RAUF_PIN` at `rauf.ts:84–104` but the constant is at `rauf.ts:30`

- **Severity:** improvement
- **Location:** `03-os-matrix-installer-gate.md` §3.4 (first sentence: "Verified behavior (`installer/src/rauf.ts:84–104`)")
- **What's wrong:** §3.4 attributes `preflightRauf({ skip: true })` behavior to `rauf.ts:84–104` (correct for the function body, with the skip short-circuit at 88–90), but `RAUF_PIN` itself lives at `rauf.ts:30` (verified), which 06 §7 cites correctly. Both citations point at real code, but a reader cross-referencing the two docs sees `RAUF_PIN` attributed to two different line ranges. Minor traceability friction; behavior described is accurate.
- **Suggested fix:** In 03 §3.4, cite `RAUF_PIN` at `rauf.ts:30` and `preflightRauf` at `rauf.ts:84–104` separately, matching 06 §7's `:30`.
- **References:** `/home/gary/workspace/feature-forge/installer/src/rauf.ts:30` (const), `:84–104` (function); 06 §7
- **Checklist:** CHECK-S26

### V-011: 06 §7.4 cites `release.yml:65–77` for the cross-compile block; the `run:` compile lines are 73–77

- **Severity:** improvement
- **Location:** `06-packaging-versioning-hygiene.md` §7.4 OQ-A ("verified `release.yml:65–77`")
- **What's wrong:** The cross-compile step in `/home/gary/workspace/rauf/.github/workflows/release.yml` begins at line 65 (`- name: Cross-compile binaries`), but the actual `bun build --compile … --outfile dist/rauf-*` invocations are lines 73–77 (66–72 are comments + `run: |` + `mkdir`). The 65–77 range brackets the whole step so it is defensible, and the quoted example line matches line 73 verbatim. Cosmetic precision only — the integration claim (rauf ships a compiled binary via release.yml, not an npm tarball, which makes `npx rauf@0.6.0` not-yet-satisfiable) is correct and load-bearing.
- **Suggested fix:** Optionally tighten to `release.yml:73–77` for the compile invocations (or keep 65–77 as the step range and say "step at :65, compile invocations :73–77").
- **References:** `/home/gary/workspace/rauf/.github/workflows/release.yml:65` (step name), `:73–77` (compile run lines)
- **Checklist:** CHECK-S26

## Fix Execution Plan

### User Decisions Required

None block the fixes. **Note:** V-001 and V-005 both stem from the genuinely-open
**OQ-A** (which package becomes the published `rauf`). The fixes only make the specs
mutually consistent and consistent with the repo — they must **NOT** force-resolve
OQ-A (06 §7.4 deliberately defers it). V-009 resolution (2) — changing the traceability
validator to skip fenced code blocks — is a separate-scope decision the user may defer.

### Execution Steps

**Step 1 — Fix the rauf npm-publish targeting across tech-spec, 01, and 06 alignment (V-001, V-005).**
Files: `tech-spec.md` §3.13 and §2 (line 104), `01-architecture-layout.md` §1.2 (line 87).
- §3.13: remove the false "(the unscoped `rauf` package — bin `rauf`)" parenthetical; replace with the OQ-A deferral note (root `rauf` has no bin; `@rauf/cli` has `bin: rauf` but is scoped/private; target deferred — see 06 §7.1/§7.4).
- 01 §1.2 line 87 + tech-spec §2 line 104: narrow `packages/*/package.json` / `package.json (per package)` to a single-target line (chosen publish target only, metadata fields only, NO version change, per 06 §7.1).
Do these together so both reference the OQ-A deferral consistently.

**Step 2 — Fix the traceability-gate wiring in 02 §4.6 (V-002).**
File: `02-ci-blocking-gates.md` §4.6. Replace the `python3 "$TRACE" "$TRACE_PRD"/*/PRD.md "$TRACE_PRD" 2>/dev/null` invocation with the per-suite loop from V-002 (one call per matched `*/PRD.md` with its `dirname` as `specs_dir`; `[ -e "$prd" ] || continue` guard; `case` branch on exit code separating gaps/orphans (1) from config error (2); drop `2>/dev/null`). Update the "run once per spec suite" prose to match.

**Step 3 — State the eval coverage target / non-goal (V-003).**
Files: `04-trigger-accuracy-eval.md` (new short subsection after §4.1), optionally `07-testing-strategy.md` §4. Add the explicit bar: SC-06 satisfied by the two discriminating fixtures; all-11-skills broadening is out-of-scope follow-up.

**Step 4 — Require pytest in CI so the anti-drift gate cannot soft-skip (V-004).**
File: `07-testing-strategy.md` §2.2 + §1 taxonomy pytest row + Verification checklist. State the feature-forge CI composite MUST install pytest so `validate.sh` step 7 is a hard CI gate; note local soft-skip is a known affordance; add the checklist line.

**Step 5 — Reconcile the `EvalReport` wire-key casing (V-006).**
File: `04-trigger-accuracy-eval.md` §5 + §6. Pick one canonical casing (preferred: snake_case to match `asdict()`); make §5 interfaces and §6 emission agree; remove the false parity claim or add the serializer.

**Step 6 — Fix the local ruff recipe and eval/ guard ambiguity (V-007).**
File: `07-testing-strategy.md` §2 (line 49) + §2.5 "Ordering" bullet. Use a guarded local form; state the CI composite owns the `[ -d eval ]` guard so ordering is irrelevant.

**Step 7 — Cosmetic / parity edits (V-008, V-009, V-010, V-011).**
- V-008: add `docs.yml` to tech-spec §2 rauf inventory.
- V-009: add the clarifying note in 02 §4.2 that `REQ-FM-01`/`REQ-VND-01` are quoted foreign-feature IDs; leave the quoted code byte-for-byte unchanged.
- V-010: split the `RAUF_PIN` (`:30`) / `preflightRauf` (`:84–104`) citations in 03 §3.4.
- V-011: tighten the `release.yml` citation in 06 §7.4.
These are independent and may be applied in any order.

## Fix Progress

- Step 1: [APPLIED] 2026-06-17 — V-001 tech-spec §3.13 rewritten to defer the publish target to OQ-A (root `rauf` has no bin; `@rauf/cli` scoped/private); V-005 narrowed `packages/*/package.json` → single chosen target in 01 §1.2 + tech-spec §2; V-008 added `docs.yml` to tech-spec §2 rauf inventory.
- Step 2: [APPLIED] 2026-06-17 — V-002 02 §4.6 traceability wiring replaced glob invocation with a per-suite loop (one PRD.md + its dirname), `case` branch separating exit 1 (gaps) from exit 2 (config error), dropped `2>/dev/null`; updated the comment prose.
- Step 3: [APPLIED] 2026-06-17 — V-003 added 04 §4.2 "Coverage target (SC-06)" stating the ≥2 discriminating-fixture floor and the all-11-skills out-of-scope follow-up.
- Step 4: [APPLIED] 2026-06-17 — V-004 07 §2.2 + §1 taxonomy + Verification checklist now require the feature-forge CI composite to `pip install pytest` so `validate.sh` step 7 is a hard gate (cannot soft-skip).
- Step 5: [APPLIED] 2026-06-17 — V-006 04 §5 `EvalReport` fields changed to snake_case (`total_cases`/`total_correct`/`skip_reason`) to match `asdict()` wire output; parity prose corrected to state snake_case wire keys.
- Step 6: [APPLIED] 2026-06-17 — V-007 07 §2 local ruff recipe now guards eval/ with `$( [ -d eval ] && echo eval )`; §2.5 Ordering bullet rewritten to state the CI composite owns the `[ -d eval ]` guard and ordering is irrelevant.
- Step 7: [APPLIED] 2026-06-17 — V-009 02 §4.2 note that `REQ-FM-01`/`REQ-VND-01` are quoted foreign-feature IDs (code left byte-accurate); V-010 03 §3.4 split `RAUF_PIN` (`:30`) / `preflightRauf` (`:84-104`) citations; V-011 06 §7.4 tightened `release.yml` citation to step `:65` + compile `:73-77`.
