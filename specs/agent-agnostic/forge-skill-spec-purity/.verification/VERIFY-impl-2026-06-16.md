# Verification Findings — forge-skill-spec-purity (impl)

> **Feature:** `forge-skill-spec-purity` · **Epic:** `agent-agnostic` · **Mode:** impl
> **Date:** 2026-06-16 · **Verifier:** forge-verify (4-way parallel fan-out: coverage / integration / testing / code-quality)
> **Implementation under review:** `feature-forge` @ branch `forge/skill-spec-purity` (9 commits `ae9c205..264507c`)
> **Specs (oracle):** `rauf` `specs/agent-agnostic/forge-skill-spec-purity/`

## Summary

- **Checks executed:** 51 across 4 dimensions (coverage 24, integration 6, testing 9, code-quality 12) — 44 pass, 5 fail, 2 n/a.
- **Findings:** 7 — **2 error**, 1 inconsistency, 1 gap, 3 improvement.
- **Gate status:** `check-spec-purity.py` exits 0 and `validate.sh` passes — but V-001 shows this is a **false PASS** for rules 3 & 5 over `references/` files. The canon is genuinely clean (verified by hand + by the files that *are* scanned), so no *current* impurity escapes; the defect is that the **checker does not enforce what REQ-VER-01 specifies**, which matters because `packaging-docs-ci` will wire this exact checker into CI.
- **Cross-repo note:** code fixes land in **feature-forge** (`scripts/check-spec-purity.py`, `tests/`); the same glob bug exists in the **rauf** spec text (`00-core-definitions.md §6`, `05 §3`) and must be corrected there too so spec and impl stay byte-aligned.
- **Confirmed NOT findings:** the ≤300-line body budget is a *tightening* of PRD's provisional 500 (tech-spec D1, explicitly permitted) — not a spec mismatch. All 11 `description` values are byte-identical to `main` (REQ-FM-03, which the checker cannot enforce — verified manually). No per-agent output produced (REQ-SOT-02 / C-3).

---

## Findings

### V-001 (error) — `CANONICAL_SURFACES` recursive globs match zero files; rules 3 & 5 skip ALL `references/` content
- **Location:** `feature-forge/scripts/check-spec-purity.py` — `CANONICAL_SURFACES` (lines 48–53), consumed by `iter_canonical_files` (lines 227–245); affects `check_no_residual_var` (rule 3) and `check_prelude_identity` (rule 5). Mirrored bug in spec `00-core-definitions.md §6` and `05-spec-purity-checker.md §3`.
- **Issue:** In Python `pathlib`, a glob ending in `**` matches **directories only**, not the files within. Verified empirically: `glob("references/**")` and `glob("skills/**/references/**")` each yield **0 files**. The checker therefore scans only **14 files** (11 `SKILL.md` + 3 `agents/*.md`) instead of the intended ~38. Every `references/*.md` and `skills/*/references/*.md` is invisible to rules 3 (residual `${CLAUDE_PLUGIN_ROOT}`) and 5 (prelude byte-identity) — including the prelude **canon home** `references/portable-root.md`, plus `references/shared-conventions.md` (2 preludes) and `skills/forge-verify/references/verification-checklists.md`, both named by spec 05 §3.3 as in-scope residual-var loci. A residual var or drifted prelude planted in any of those 24 files would pass the gate. Masked because every planted-violation test fixture lives at `tests/fixtures/*/skills/alpha/SKILL.md`, which *is* matched by `skills/**/SKILL.md`.
- **Fix:** Change `"skills/**/references/**"` → `"skills/**/references/**/*"` and `"references/**"` → `"references/**/*"` (keep `skills/**/SKILL.md` and `agents/*.md`). Verified this restores the 24 missing files. Apply the identical correction to the `CANONICAL_SURFACES` literal in spec `00 §6` and `05 §3`. **Must be applied together with V-002** (the glob fix alone red-lights the gate via the inventory file).
- **Refs:** spec 05 §3.3/§3.6, 05 line 507; spec 00 §6. **Checklists:** integration-cluster, code-quality (scan-scope/no-silent-under-coverage); REQ-RES-03, REQ-RES-05, REQ-VER-01, REQ-MAINT-01. *(Caught independently by integration [IG-001] and code-quality [CQ-001] — deduped.)*

### V-002 (error) — No `RESIDUAL_VAR_EXEMPT` mechanism; `vendor-construct-inventory.md` trips rule 3 once V-001 is fixed
- **Location:** `feature-forge/scripts/check-spec-purity.py` (`check_no_residual_var` — no exemption logic exists); spec `00-core-definitions.md §6` `RESIDUAL_VAR_EXEMPT`.
- **Issue:** `references/vendor-construct-inventory.md` contains 8 literal `${CLAUDE_PLUGIN_ROOT}` occurrences as intentional audit prose (it *inventories* the construct). It lives under `references/` — a canonical surface. The checker implements **no** `RESIDUAL_VAR_EXEMPT` at all; rule 3 passes today only because V-001's glob bug prevents the file from being scanned. The instant V-001 is fixed, rule 3 will scan it, emit a residual-var violation, and **fail the gate on an intentionally-documented construct.**
- **Fix:** Implement an exemption filter in the checker — add a `RESIDUAL_VAR_EXEMPT` tuple mirroring spec 00 §6 (`scripts/forge-root.sh`, `hooks/hooks.json`, `specs/**`, `plans/**`, `docs/**`) **plus** `references/vendor-construct-inventory.md`, and in `check_no_residual_var` `continue` past any path matching an exempt glob before the residual-var test. Add `references/vendor-construct-inventory.md` to the spec's `RESIDUAL_VAR_EXEMPT` list in 00 §6. Apply atomically with V-001.
- **Refs:** `references/vendor-construct-inventory.md`; spec 00 §6. **Checklist:** integration-cluster; REQ-RES-03, REQ-VER-01. *(IG-002.)*

### V-003 (inconsistency) — `check_no_residual_var` docstring misstates the exemption mechanism
- **Location:** `feature-forge/scripts/check-spec-purity.py` — `check_no_residual_var` docstring (lines 362–363) and `_RESIDUAL_VAR` comment (lines 64–65).
- **Issue:** The docstring claims exemption is achieved purely by exempt loci being "outside the canonical globs." Accurate for `forge-root.sh`/`hooks.json`/`specs`/`plans`/`docs`, but **false** for `references/vendor-construct-inventory.md`, which is inside a canonical surface and must be exempted by an explicit list (V-002). The stale comment is precisely what would lead a maintainer to fix the glob (V-001) and be ambushed by the resulting gate failure.
- **Fix:** When applying V-001/V-002, reword to state exemption is enforced by an explicit `RESIDUAL_VAR_EXEMPT` glob-skip (covering the in-surface inventory file) **plus** loci outside the canonical globs.
- **Refs:** spec 00 §6 line 290. **Checklist:** integration-cluster (checker contract consistency). *(IG-003.)*

### V-004 (gap) — No test pins checker output determinism (sorted / byte-identical repeated runs)
- **Location:** `feature-forge/tests/test_check_spec_purity.py` (no such test); behavior at `scripts/check-spec-purity.py:475` (`sorted(violations, key=lambda v:(v.path,v.rule.value,v.reason))`).
- **Issue:** The determinism contract (output sorted by `(path, rule, reason)`, byte-identical across runs — spec 05 §3.4) is implemented but **unguarded**. Single-violation fixtures and even `bad-oversized-both` (asserts token *membership*, not order) cannot detect a sort regression. A refactor to set-iteration order would pass all 19 current tests.
- **Fix:** Add `test_output_is_deterministic_and_sorted`: run the checker twice on a multi-violation tree, assert `r1.stdout == r2.stdout` and that `skills/...` violation lines equal their `sorted()` form. For a meaningful path-ordering limb, add a `bad-multi` fixture with one violation in `skills/alpha` and one in a later-sorting dir (e.g. `skills/zeta`).
- **Refs:** spec 06 §1.1/§2.2, 05 §3.4. **Checklist:** CHECK-I-TEST-determinism. *(TS-001.)*

### V-005 (improvement) — `Rule` enum diverges from spec's `enum.StrEnum`; reconcile the spec, not the code
- **Location:** `feature-forge/scripts/check-spec-purity.py` `class Rule(str, enum.Enum)` (lines 86–98); spec `00 §5` / `05 §3.5` specify `enum.StrEnum`.
- **Issue:** The impl correctly uses `(str, enum.Enum)` because `StrEnum` is 3.11+ and the repo/CI baseline (per `epic-manifest.py`) is Python 3.10 — a **justified** deviation, documented in a code docstring. But the spec still says `StrEnum`, so a future reader could "fix" the code back and break the 3.10 gate.
- **Fix:** No code change. Add a one-line note to spec `00 §5` / `05 §3.5` that the runnable form is `(str, enum.Enum)` for the 3.10 baseline. *(CQ-003.)*

### V-006 (improvement) — Unused `import sys` in check-spec-purity.py
- **Location:** `feature-forge/scripts/check-spec-purity.py:24`.
- **Issue:** `sys` is imported but never used (only appears inside a docstring string; the module uses `raise SystemExit(main())`). No linter is configured so it won't fail CI — cleanliness nit.
- **Fix:** Delete line 24. *(CQ-002.)*

### V-007 (improvement, optional) — Reduced bodies sit 3–4 lines under the 300-line cap
- **Location:** `feature-forge/skills/forge-0-epic/SKILL.md` (body 297 lines), `skills/forge-5-loop/SKILL.md` (body 296 lines).
- **Issue:** Both pass rule 4 but with thin margin (word counts are comfortable). Any future single-paragraph edit would trip the hard gate. Not a defect.
- **Fix (optional):** Relocate ~10–15 more lines per skill into their `references/`, or knowingly accept the tight margin. *(CQ-004.)*

---

## Fix Execution Plan

**Cross-repo:** Steps 1–4 touch **both** repos — code/tests in `feature-forge` (commit on branch `forge/skill-spec-purity`), spec text in `rauf`. Re-run the gate from the feature-forge root after each code change: `python3 scripts/check-spec-purity.py && bash scripts/validate.sh && python3 -m pytest tests -q`.

### User decisions required
- **V-002:** Confirm `references/vendor-construct-inventory.md` should be **exempt** (carry the literal as audit prose) rather than reworded to avoid the literal. *(Recommended: exempt — it is the REQ-VND-03 audit artifact and is designed to name the construct.)*
- **V-007:** Trim more now, or accept the thin margin. *(Optional.)*

### Steps
1. **Fix the recursive globs (V-001).** `scripts/check-spec-purity.py` `CANONICAL_SURFACES`: `references/**`→`references/**/*`, `skills/**/references/**`→`skills/**/references/**/*`. Apply the same change to spec `00 §6` and `05 §3`. *(Do not run the gate until Step 2 lands — V-002 is a trap.)*
2. **Add the exemption (V-002).** Introduce `RESIDUAL_VAR_EXEMPT` in the checker (mirroring spec 00 §6 + `references/vendor-construct-inventory.md`) and skip exempt paths in `check_no_residual_var`. Add the inventory file to the spec's exempt list. **Now** re-run the gate → expect exit 0.
3. **Correct the docstrings (V-003).** Reword the `check_no_residual_var` docstring / `_RESIDUAL_VAR` comment (and spec 00 §6 line 290) to describe the explicit-exempt-list + outside-globs mechanism.
4. **Add regression tests (V-004 + guard V-001/V-002).** Add: (a) a determinism/sorted test; (b) a fixture planting a residual-var **and** a prelude-drift under a `references/`-subdir path, asserting they are now detected (locks the glob fix); (c) a fixture where an exempt file carries the literal, asserting no violation (locks the exemption). Re-run `pytest tests` green.
5. **Cleanup (V-005, V-006).** Remove unused `import sys`; add the StrEnum-vs-3.10 note to spec 00 §5 / 05 §3.5.
6. **(Optional) V-007.** Relocate ~10–15 more lines from forge-0-epic / forge-5-loop bodies.

After fixes: re-run all three gates from the feature-forge root, commit the code fixes on `forge/skill-spec-purity`, commit the spec corrections in rauf, then re-verify (`/feature-forge:forge-verify forge-skill-spec-purity impl`) to confirm findings resolved.

---

## Fix Progress

- Step 1 (V-001): [APPLIED] 2026-06-16 — `CANONICAL_SURFACES` globs `/**`→`/**/*` in checker + spec 00 §6 + spec 05 §3. Scan scope 14→38 files; planted residual-var in references/ now caught.
- Step 2 (V-002): [APPLIED] 2026-06-16 — added `RESIDUAL_VAR_EXEMPT` + fnmatch skip in `check_no_residual_var`; added `references/vendor-construct-inventory.md` to the exempt set in checker + spec 00 §6.
- Step 3 (V-003): [APPLIED] 2026-06-16 — corrected `check_no_residual_var` docstring + `_RESIDUAL_VAR` comment (checker) and spec 05 §3.3 prose/code block to describe the explicit-exempt-list mechanism.
- Step 4 (V-004): [APPLIED] 2026-06-16 — added 4 tests + fixtures: `bad-residual-var-references`, `bad-prelude-drift-references` (lock the glob fix for rules 3 & 5), `exempt-inventory-residual-var` (locks the exemption), `bad-multi` (determinism: byte-identical + sorted). pytest 70→74.
- Step 5 (V-005, V-006): [APPLIED] 2026-06-16 — removed unused `import sys` (checker); added the StrEnum-vs-3.10 note to spec 00 §5 `Rule`.
- Step 6 (V-007): [ACCEPTED — deliberate, no change] 2026-06-16 — forge-0-epic (297) / forge-5-loop (296) bodies are within the hard ≤300 cap; on inspection the bodies are already thoroughly relocated (Error Handling reduced to a 4-line pointer; many references/ pointers in place) and the residual margin cannot be improved without disturbing freshly-balanced operational step-logic. The finding explicitly permits accepting the thin margin knowingly. Flagged to maintainer.

Re-verification: `check-spec-purity.py` exit 0 (38 files scanned), `pytest tests` 74 passed, `bash scripts/validate.sh` exit 0.

---

## Re-Verification (2026-06-16)

Independent 2-way re-verify (integration/checker + testing) against fix commits feature-forge `3db2fa8` / rauf `7c92e2a`:

- **V-001, V-002, V-003, V-005, V-006 — RESOLVED** (empirical: scan scope 14→38; planted residual-var in `references/` now caught; inventory exemption load-bearing; spec↔impl byte-exact on the corrected blocks; `import sys` gone + compiles).
- **V-004 — RESOLVED, tests proven NON-VACUOUS** via fix-revert simulation: with the pre-fix bare `/**` glob, `bad-residual-var-references` and `bad-prelude-drift-references` produce 0 violations → both tests fail. The fix is what makes them pass.
- **No new defects** from the wider globs / fnmatch exemption (no over-match, no decode errors on the 3 newly-scanned `.json` files).
- **RT-001** (re-verify, improvement) — determinism test asserted over rendered lines vs the `(path, rule.value, reason)` key; closed with a clarifying comment (feature-forge `d5c0ff1`).

Gates: `check-spec-purity.py` exit 0 (38 files), `pytest tests` 74 passed, `validate.sh` exit 0. **forge-verify-impl confirmed clean — 0 open findings.**
