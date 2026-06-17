# Verification Report: cross-agent-installer (impl)

- **Date:** 2026-06-17
- **Mode:** impl
- **Pipeline stage:** forge-verify-impl
- **Dispatch:** 4 parallel `forge-verifier` instances (requirement-coverage, integration, testing, code-quality+docs)
- **Cross-repo note:** specs/backlog live in `rauf` (`specs/agent-agnostic/cross-agent-installer/`); implementation lives in `feature-forge` (`installer/`), committed on branch `forge/cross-agent-installer`.

## Summary

The implementation is **sound and substantially complete**. The installer builds clean (`tsc -p tsconfig.json`, EXIT 0, `strict` + `noUncheckedIndexedAccess`), and the full suite is **136 tests / 136 pass / 0 fail / 0 skip**. The integration-correctness dimension returned **zero findings**: the library barrel (`src/index.ts`) re-exports exactly the spec-§4 public surface, the historically-contested `RegistryQuery`/`preflightRauf` contract is consistently **synchronous** across `rauf.ts`/`cli.ts`/tests (no `await`/positional mismatch), the planner→apply→report data shapes are coherent, `validate.sh` step 8 wires the gate correctly (hard-fail on missing node/npm), path sandboxing is real (`resolveWithin` containment, `lstat`+`unlink` never follows symlinks), manifest writes are atomic (`.tmp`→rename), and the `adapters/` source tree is consumed strictly read-only (C-3).

Total findings: **10** — 1 error, 1 inconsistency, 5 gaps, 3 improvements. **None block core install/update/uninstall/list functionality.** The most material are V-001 (an advisory `cliOnPath` probe that can never succeed on POSIX) and V-003 (the §6 `UNEXPECTED` ErrorCode floor is under-enforced, so a regression in the CLI boundary catch would not fail the gate).

| ID | Severity | Check | Location (repo) | One-line |
|----|----------|-------|-----------------|----------|
| V-001 | error | I14,I15 | feature-forge `src/detect.ts:51` | `cliOnPath` runs the shell builtin `command` via `execFileSync` → always `false` on POSIX |
| V-002 | inconsistency | I04,I05,I07 | rauf `07` §1038 vs `04` §738 | `LOCALLY_MODIFIED` never emitted by production; spec 07 error-table row contradicts spec 04 skip-modified behavior |
| V-003 | gap | I17 | feature-forge tests | `UNEXPECTED` ErrorCode boundary test missing AND omitted from `coverage.test.ts` `required` set (8/9 enforced) |
| V-004 | gap | I17 | feature-forge `test/e2e-rauf-list-scale.test.ts` | §5.13 "Drift present" `list` row untested (the destination-drift detection half of REQ-SAFE-03) |
| V-005 | gap | I17 | feature-forge tests | §5.1 DET-04 (zero detected ⇒ exit SUCCESS, no dirs created) not exercised through a full CLI run |
| V-006 | gap | I17 | feature-forge tests | §5.12 `-y` non-interactivity (no stdin seam / REQ-DIST-02) not explicitly asserted |
| V-007 | gap | I17 | feature-forge `test/cli.test.ts` | §5.12 exit-code **2** (USAGE) not asserted as part of the 0/1/2 triad through an assembled run (thin — `main(["frobnicate"])→2` unit exists) |
| V-008 | improvement | I17 | feature-forge tests | §5.1 DET-03 default-scope-all-detected only covered indirectly (only via the partial-failure test) |
| V-009 | improvement | I13,I15 | feature-forge `src/cli.ts:290` | `rawParse` duplicates the `parseArgs` options builder; argv re-parsed up to 3×/invocation |
| V-010 | improvement | I14,I20 | feature-forge `src/cli.ts:353` | spec-07 §3.2 `attachRaufError` hook elided for the (sanctioned) run-level `RunReport.raufError` field — doc-only |

## Findings

### V-001: `cliOnPath` invokes the shell builtin `command` via `execFileSync`, so it can never succeed on POSIX
- **Severity:** error (advisory-only impact — never gates `detected`)
- **Location:** feature-forge `installer/src/detect.ts:51-63`
- **What's wrong:** On non-Windows, `cliOnPath` runs `execFileSync("command", ["-v", bin], …)`. `command` is a POSIX shell **builtin**, not an executable on `PATH`, so `execFileSync` (no shell) throws ENOENT for every agent and the catch returns `false`. The advisory `cliOnPath` field is therefore hardwired to `false` on macOS/Linux, contradicting its documented purpose ("is the agent's CLI resolvable on PATH", spec 02 §5.3 / REQ-DET-02). It does **not** affect install/list correctness because it never gates `detected`.
- **Suggested fix:** Replace the POSIX branch with a real resolver — `execFileSync("which", [bin], { stdio: "ignore" })` (POSIX) / `execFileSync("where", [bin])` (Windows), or `execFileSync("/bin/sh", ["-c", \`command -v ${bin}\`], { stdio: "ignore" })` so the builtin runs in a shell. Keep catch-returns-false. Add a `detect.test.ts` case asserting a known-present binary resolves `true` and an absent one `false` (inject the exec seam).
- **References:** spec `02-agent-detection-map.md` §5.3; PRD REQ-DET-02; `detect.ts:51`.
- **Checklist:** CHECK-I14, CHECK-I15

### V-002: `LOCALLY_MODIFIED` ErrorCode is never produced by production code; spec 07 error table contradicts spec 04 behavior
- **Severity:** inconsistency
- **Location:** feature-forge `src/types.ts:281`, `src/report.ts:128`, `test/coverage.test.ts:179-194`; specs `07-cli-and-reporting.md:1038` vs `04-plan-and-apply.md:738`
- **What's wrong:** `LOCALLY_MODIFIED` is in the `ErrorCode` union with a `DEFAULT_REMEDY`, but **no production path emits** `InstallerError{ code: "LOCALLY_MODIFIED" }` (grep-confirmed; the other 8 codes are genuinely produced). The drift-without-`--force` case is implemented per spec 04 §738 as a `skip-modified` *FileAction* (agent stays `ok:true`, exit SUCCESS) — never an error. Spec 07 §1038's error-table row ("Destination locally modified → `LOCALLY_MODIFIED` → exit 1") is the inaccurate one. Compounding: `coverage.test.ts` hand-constructs the literal to satisfy item 011 AC #3 ("every ErrorCode produced by ≥1 test"), masking that production never produces it.
- **Suggested fix:** Resolve in favor of the implemented spec-04 behavior. Edit `07-cli-and-reporting.md:1038` so a locally-modified destination is a per-file `skip-modified` outcome (agent `ok:true`, exit SUCCESS, remedy "re-run with `--force`"), not an emitted error; keep `LOCALLY_MODIFIED` listed as a remedy/vocabulary code in §356 but mark it non-failure. Add a comment at `types.ts:281` that it is report-vocabulary-only (never emitted as an `InstallerError`). Optionally de-synthesize the `coverage.test.ts` assertion to reach the remedy via the real skip-modified→render path. **No behavioral code change.**
- **References:** `04-plan-and-apply.md` §738 (authoritative), `07-cli-and-reporting.md` §1038/§356, `08-testing-strategy.md` §432/§585, backlog item 011 AC #3.
- **Checklist:** CHECK-I04, CHECK-I05, CHECK-I07

### V-003: `UNEXPECTED` ErrorCode — `cli.ts` boundary throwing-seam test missing and omitted from the §6 `required` floor
- **Severity:** gap
- **Location:** feature-forge `test/coverage.test.ts` §6.3 (`required` array, lines 270-279) and `test/cli.test.ts` (no boundary test)
- **What's wrong:** §6 (and §2/§9 "never soft skip") require **every** `ErrorCode` to be produced by ≥1 test, and §6 explicitly names `UNEXPECTED`: "a `cli.ts` boundary test injects a throwing seam and asserts exit 1 with the message, never a bare stack." The `required` array enforces only **8** codes, omitting `UNEXPECTED`; no test injects a throwing seam at the `main()`/`runCli` boundary. So a regression in the boundary catch (bare stack instead of one-line message, or wrong exit) would not fail the gate.
- **Suggested fix:** Add a `main(...)` boundary test (via a `CliEnv` hook / monkeypatched dependency that throws) asserting return `=== EXIT.FAILURE` and a single-line stderr message (assert no `"\n    at "` stack frame). Append `"UNEXPECTED"` to the `required: ErrorCode[]` array in `coverage.test.ts` §6.3 and produce it in-test.
- **References:** `08-testing-strategy.md` §6 + §5.12, backlog item 011 AC.
- **Checklist:** CHECK-I17

### V-004: §5.13 "Drift present" `list` row is not tested
- **Severity:** gap
- **Location:** feature-forge `test/e2e-rauf-list-scale.test.ts` (list section, lines 177-239)
- **What's wrong:** §5.13 specifies four `list` derivation states. Three are tested (not-installed, up-to-date, out-of-date via source mutation). The fourth — "Drift present: hand-edit a destination file ⇒ `list` flags drift" — is untested (`grep drift` hits only `plan.test.ts`'s unit `classifyFile` row, never an integration `list` assertion). This is the `list` state proving *locally-modified destination* detection (REQ-SAFE-03's list half).
- **Suggested fix:** Add a test: install claude clean, hand-edit `<dest>/skills/forge-1-prd/SKILL.md` to bytes differing from both the recorded `sha256` and the source, run `list --json`, assert the claude row flags drift (`up-to-date:false` and/or a drift status row). Distinguish from the existing source-mutation "out of date" test so both REQ-SAFE-03 halves are proven. Reuse the `claudeDest`/`listStatus` helpers already in the file.
- **References:** `08-testing-strategy.md` §5.13 (bullet 4 + SAFE-03), item 011 AC.
- **Checklist:** CHECK-I17

### V-005: §5.1 DET-04 (zero detected ⇒ SUCCESS) is not exercised through a full CLI run
- **Severity:** gap
- **Location:** feature-forge `test/agent-targets.test.ts:84-104` (unit-only)
- **What's wrong:** §5.1 DET-04 is an **integration** behavior: `runCli2(["install","--source",…])` with nothing seeded ⇒ every `DetectionResult.detected===false`, `configDirsProbed` non-empty, **no config dir created**, and **`Exit === EXIT.SUCCESS`** ("nothing to do is not a failure"). The unit test proves all-false detection + no-dir, but never drives the full `install` dispatch to assert the SUCCESS exit code + "no agents detected" report on the zero path.
- **Suggested fix:** Add a test (`e2e-install.test.ts`): `withSandbox` nothing seeded, `runCli2(["install","-y","--source",sb.source], sb, {registry: neverCalledRegistry})`, assert `exitCode===EXIT.SUCCESS`, all `detected:false`, no namespace dir under HOME/cwd, registry never queried.
- **References:** `08-testing-strategy.md` §5.1 DET-04.
- **Checklist:** CHECK-I17

### V-006: §5.12 `-y` non-interactivity (no stdin seam, REQ-DIST-02) not explicitly asserted
- **Severity:** gap
- **Location:** feature-forge e2e suite (uses `-y` everywhere) + `test/cli.test.ts:129` (help-only)
- **What's wrong:** §5.12 final bullet: "a test asserts that with `-y` no prompt is awaited (the run completes without an input seam)." The suite relies on the *implicit* fact that tests don't hang; there is no explicit assertion of non-interactivity (item 010's "No stdin read anywhere" is verified only indirectly).
- **Suggested fix:** Add a source-guard test asserting the built CLI (`dist/cli.js` / `dist/*.js`) contains no `process.stdin`/`readline` reference (most direct proof of "no input seam"); or run a mutating command **without** `-y` and assert it still completes without awaiting input.
- **References:** `08-testing-strategy.md` §5.12 (REQ-DIST-02), item 010 design note.
- **Checklist:** CHECK-I17

### V-007: §5.12 exit-code **2** (USAGE) not asserted as part of the assembled 0/1/2 triad
- **Severity:** gap (thin)
- **Location:** feature-forge `test/cli.test.ts:73-98,147-169`
- **What's wrong:** §5.12 frames exit codes 0/1/2 as one integration row. 0 and 1 are exercised end-to-end; 2 is proven at unit level (`parseCliArgs(["frobnicate"]).error.code==="USAGE"`, `mapErrorToExit→2`, and `main(["frobnicate"])→2`). There's no single assembled-run assertion of all three legs together. The `main` path is covered, so this is thin.
- **Suggested fix:** Either (a) accept `main(["frobnicate"])→2` as satisfying the leg and annotate §5.12 traceability, or (b) add one consolidated test driving `main(...)` for success→0, partial-failure→1, unknown-subcommand→2.
- **References:** `08-testing-strategy.md` §5.12.
- **Checklist:** CHECK-I17

### V-008: §5.1 DET-03 (default scope = all detected) only covered indirectly
- **Severity:** improvement
- **Location:** feature-forge `test/e2e-symlink-source.test.ts:130` (the only no-`-a` run is the *partial-failure* case with gemini broken)
- **What's wrong:** §5.1 DET-03's happy path (seed claude+gemini, no `--agent` ⇒ both detected agents acted on, both succeed, exit SUCCESS) is never asserted as a clean success — the only default-scope integration run deliberately breaks gemini. Near-miss, hence improvement.
- **Suggested fix:** Add a test: seed claude+gemini with valid bundles, `runCli2(["install","-y","--source",…])` no `-a`; assert both in `report.agents`, both `ok===true`, both dirs on disk, exit SUCCESS.
- **References:** `08-testing-strategy.md` §5.1 DET-03.
- **Checklist:** CHECK-I17

### V-009: `rawParse` duplicates the `parseArgs` options builder
- **Severity:** improvement
- **Location:** feature-forge `src/cli.ts:290-298` (`rawParse`) vs `cli.ts:113-117` (in `parseCliArgs`)
- **What's wrong:** The `parseArgs` `options` object is built identically in two places, and `parseMetaFlags`/`hadSubcommand` re-parse argv via `rawParse` (up to 3× per invocation) purely to read `--help`/`--version`/positional-count that `parseCliArgs` already computes. Benign (FLADS is single-source so content can't drift) but duplicative.
- **Suggested fix:** Extract a private `buildParseOptions()` used by both; better, surface `wantsHelp`/`wantsVersion`/positional-presence (e.g. a `hadSubcommand` boolean) from the single `parseCliArgs` result so `main` no longer re-parses. Preserve §3.1 precedence (help/version before "no subcommand"); keep the help/version/no-subcommand exit tests green.
- **References:** spec `07-cli-and-reporting.md` §3.1; `cli.ts:260,270,289-311`.
- **Checklist:** CHECK-I13, CHECK-I15

### V-010: spec-07 §3.2 `attachRaufError` hook elided for the run-level `RunReport.raufError` field (doc-only)
- **Severity:** improvement
- **Location:** feature-forge `src/cli.ts:353-361`, `src/report.ts:51-55`, `src/types.ts` (`RunReport`)
- **What's wrong:** Spec 07 §3.2 describes an `attachRaufError(reports, raufError)` hook; the impl instead uses the optional run-level `RunReport.raufError` field (which §3.2's "Rauf preflight reporting note" sanctions as a MAY) and prints it in `renderReport`. This is the cleaner spec-allowed option and is correct + tested — but a reader cross-referencing spec→code won't find `attachRaufError`.
- **Suggested fix:** No code change. Optionally add a one-line comment near `cli.ts:360` noting the hook was elided in favor of the sanctioned run-level field, and ensure `types.ts` `RunReport.raufError?` carries a JSDoc marking it part of the `--json` REQ-DET-05 surface.
- **References:** spec `07-cli-and-reporting.md` §3.2; `types.ts` `RunReport`; `report.ts:51`.
- **Checklist:** CHECK-I14, CHECK-I20

## Fix Execution Plan

> **Cross-repo:** code/test fixes land in **feature-forge** (`installer/`, branch `forge/cross-agent-installer`); spec-text fixes land in **rauf** (`specs/agent-agnostic/cross-agent-installer/`). After feature-forge test edits, re-run `cd installer && npm run build && npm test` (currently 136 green).

### User Decisions Required
- **V-001:** Confirm whether the always-false `cliOnPath` on POSIX should be fixed (recommended — the field is documented/meaningful and part of the `DetectionResult` machine surface) or accepted as advisory-only.
- **V-002:** Confirm the intended drift-without-`--force` behavior is "skip the file, agent ok, exit SUCCESS" (the implemented + spec-04 reading; recommended — nothing in the REQ set supports failing on skip). If so the fix is spec-text alignment only.
- **V-007:** (b) add a consolidated triad test, or (a) accept `main(["frobnicate"])→2` + annotate traceability.
- **V-008:** improvement — may be skipped if the partial-failure test is deemed adequate default-scope coverage.

### Execution Steps

#### Step 1 — Fix the `cliOnPath` PATH resolver (V-001)
- **Files (feature-forge):** `installer/src/detect.ts`, `installer/test/detect.test.ts`
- Replace the `execFileSync("command", ["-v", bin])` POSIX branch with `which`/`where` (or `/bin/sh -c "command -v …"`); keep catch-returns-false; add a unit test for present/absent binaries via the exec seam.

#### Step 2 — Close the testing-matrix gaps (V-003, V-004, V-005, V-006; optionally V-007, V-008)
- **Files (feature-forge):** `installer/test/cli.test.ts`, `installer/test/coverage.test.ts`, `installer/test/e2e-rauf-list-scale.test.ts`, `installer/test/e2e-install.test.ts`
- V-003: add the `UNEXPECTED` boundary test + append `"UNEXPECTED"` to `coverage.test.ts` §6.3 `required`. V-004: add the `list` destination-drift test. V-005: add the zero-detected full-CLI test. V-006: add the no-stdin-seam source-guard test. (V-007/V-008 per the decisions above.)
- Re-run `cd installer && npm run build && npm test`; confirm still green with the new cases.

#### Step 3 — Align spec text and annotate code (V-002, V-010)
- **Files (rauf):** `specs/agent-agnostic/cross-agent-installer/07-cli-and-reporting.md` (V-002: fix the §1038 table row to skip-modified/SUCCESS; keep §356 vocabulary note).
- **Files (feature-forge):** `installer/src/types.ts` (V-002 comment that `LOCALLY_MODIFIED` is report-vocabulary-only; V-010 JSDoc on `RunReport.raufError?`), `installer/src/cli.ts` (V-010 one-line comment near 360). Optional: de-synthesize the `coverage.test.ts` LOCALLY_MODIFIED assertion.

#### Step 4 — Code-quality cleanup (V-009)
- **Files (feature-forge):** `installer/src/cli.ts`
- Extract `buildParseOptions()` / surface meta-flags from `parseCliArgs` to remove the `rawParse` duplication and repeated argv parsing; keep §3.1 precedence and the help/version/no-subcommand tests green.
