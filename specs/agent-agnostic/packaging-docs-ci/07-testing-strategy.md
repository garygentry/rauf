# 07 — Testing Strategy

> **Feature:** `packaging-docs-ci` (epic `agent-agnostic`, capstone 6 of 6).
> **Status:** final document. Depends on all prior docs (00–06).

This capstone introduces **no new test framework** and ships almost no runtime code — so "testing" here
means **exercising the gates and authored artifacts locally** to the PRD §8 done bar:
**"authored + locally validated," NOT "confirmed green on real GitHub."** Observing a live matrix run
is a post-merge confirmation, explicitly out of scope (PRD §6, SC-05). This document defines what to
run, what counts as pass, and how each Success Criterion maps to a concrete local check.

## Requirement Coverage

| REQ ID | Requirement | Section |
|--------|-------------|---------|
| REQ-CI-01..06 | Deterministic blocking gates pass locally | §2 |
| REQ-CI-07, -08 | OS-matrix installer leg runs locally | §3 |
| REQ-CI-05 / REQ-VER-02 | Version-sync fails-before / passes-after | §2.4 |
| REQ-CI-04 / REQ-CONST-04 | Adapters regen-diff clean (SC-04) | §2.3 |
| REQ-CI-02 / REQ-CONST-03 | Schema-driven checker + anti-drift pytest | §2.2 |
| REQ-EVAL-01, -02 | Eval runs + emits a score, non-blocking (SC-06) | §4 |
| REQ-README-03 / REQ-DOCS-* | Docs accuracy dry-run (SC-08) | §5 |
| REQ-OS-01, -02 | `.gitattributes` + exec-bit checks | §6 |
| REQ-PERF-01 | Fast gate completes in minutes | §2.6 |

## 1. Test Taxonomy & Tooling (no new framework)

| Layer | Tool | What it covers | Provisioning |
|---|---|---|---|
| Aggregate gate (feature-forge) | `bash scripts/validate.sh` | plugin/marketplace JSON, frontmatter, spec-purity, regen-diff, traceability, installer build+test | python3 stdlib + `.venv-adapters` (PyYAML) |
| Schema anti-drift | `pytest` (existing `tests/`) | `check-spec-purity.py` loaded key-set == schema `properties` | pytest — **CI MUST `pip install pytest`** so `validate.sh` step 7 cannot soft-skip (§2.2) |
| Shell lint | `shellcheck scripts/*.sh` | 4 shell scripts at error+warning floor | shellcheck (CI/local) |
| Python lint | `ruff check scripts/ eval/` | scripts + eval harness at E/F/W floor | ruff (CI pip) |
| Version-sync | `python3 scripts/check-version-sync.py` | 3 feature-forge version fields byte-equal | stdlib |
| OS-matrix | `node installer/dist/cli.js …` | install `--dry-run` + uninstall per OS | Node ≥18, `npm ci && npm run build` |
| Advisory eval | `python3 eval/run-eval.py` | trigger-accuracy score | `anthropic` SDK (CI pip), `ANTHROPIC_API_KEY` |
| rauf gate | `pnpm gate` | build/schema/version/typecheck/lint/format/test/check:docs | Bun + pnpm |

All tools are run **inside the composite actions** so a local invocation reproduces CI exactly
(see `02-ci-blocking-gates.md`, `01-architecture-layout.md` §3).

## 2. Deterministic Blocking Gate — local validation (REQ-CI-01..06)

Run from `feature-forge/`:

```bash
bash scripts/validate.sh                 # the aggregate gate (REQ-CI-01,-02,-04,-06)
shellcheck scripts/*.sh                   # REQ-CI-03 (shell)
ruff check scripts/ $( [ -d eval ] && echo eval )   # REQ-CI-03 (python; eval/ optional until authored, §2.5)
python3 scripts/check-version-sync.py      # REQ-CI-05
```

**Pass bar:** `validate.sh` prints `All checks passed!` (exit 0); shellcheck/ruff exit 0;
`check-version-sync.py` behavior is conditional (§2.4).

### 2.1 `claude plugin validate --strict` (REQ-CI-01)

- **With CLI present:** `claude plugin validate --strict` exits 0 against the repo.
- **Without CLI:** the documented-equivalent JSON validation (already in `validate.sh`) plus the
  SKILL.md schema gate runs and the fallback is **logged, not silently skipped** (tech-spec §3.1.1).
- **Test:** confirm `validate.sh` contains the step and that the fallback path emits a visible log line.

### 2.2 SKILL.md schema + anti-drift pytest (REQ-CI-02, REQ-CONST-03)

- `validate.sh` step 6a (`check-spec-purity.py`) passes for all 11 skills (`name==dir`, keys ⊆ the
  6-key allowed set loaded from `references/skill-frontmatter.schema.json`, no residual
  `${CLAUDE_PLUGIN_ROOT}`, body-size within budget).
- **Anti-drift unit test** (extends existing `tests/test_check_spec_purity.py`): asserts the checker's
  loaded `ALLOWED` set equals the schema's `properties` keys and `REQUIRED` equals the schema's
  `required`. Run via `python3 -m pytest tests -q` (also driven by `validate.sh` step 7).
- **CI must install pytest — this is the capstone's one net-new test.** `validate.sh` step 7
  **soft-skips non-fatally when pytest is absent** (`SKIP: pytest not installed … (non-fatal)`) and
  still reports "All checks passed!". So the feature-forge CI composite **MUST `pip install pytest`**
  (alongside the existing `ruff`/`anthropic` pip steps) to make step 7 a **hard** gate in CI;
  otherwise the sole schema↔checker drift guard silently no-ops on a runner without pytest. Locally
  the assertion is enforced only when pytest is present — a documented local-only affordance, not a
  CI gap (cross-ref `02-ci-blocking-gates.md` step-7 row).
- **Negative test:** temporarily add a `version:` key to a SKILL.md → `check-spec-purity.py` MUST fail
  (`additionalProperties:false` ⇒ disallowed-key violation), proving REQ-VER-03/REQ-CONST-03 are
  mechanically enforced. Revert after.

### 2.3 Adapters regenerate-and-diff (REQ-CI-04, REQ-CONST-04, SC-04)

- `validate.sh` step 6b runs `build-adapters.py --check` in `.venv-adapters`: regenerate to a temp dir,
  `diff -r` vs committed `adapters/`. **Pass = no diff** after the gemini version bump (§2.4).
- **SC-04 check:** `python3 scripts/build-adapters.py --check` exits 0 with no diff once
  `GEMINI_EXTENSION_VERSION` is `0.10.0` and `adapters/gemini/gemini-extension.json` is regenerated
  (see `06-packaging-versioning-hygiene.md`).

### 2.4 Version-sync — fails-before, passes-after (REQ-CI-05, REQ-VER-02, SC-03)

This is the one gate with **two expected states**:

1. **Before reconciliation:** `check-version-sync.py` MUST **fail**, printing the conflicting files +
   values (`plugin.json 0.10.0` / `marketplace.json 0.9.0` / `gemini-extension.json 0.0.0`) — REQ-OBS-01.
2. **After reconciliation** (all three → `0.10.0`, per `06-packaging-versioning-hygiene.md`): MUST
   **pass** (exit 0).

Test both states explicitly: assert the failure on the pre-reconciliation tree (or by reverting one
field) and the pass on the reconciled tree. `installer/package.json` (`0.1.0`) MUST NOT trip the gate.

### 2.5 Lint floors & the `eval/` ordering carve-out (REQ-CI-03, OQ-04)

- **shellcheck:** error+warning fail; per-line `# shellcheck disable=SCxxxx` permitted for justified
  exceptions. Validate against all 4 `scripts/*.sh`.
- **ruff:** `E`/`F`/`W` floor, line-length 100; per-line `# noqa: <rule>` permitted. Validate against
  `scripts/*.py` (incl. sibling-owned `epic-manifest.py`, `validate-traceability.py`) and `eval/*.py`.
  Pre-existing violations are fixed minimally or scoped — never by weakening the floor.
- **Ordering / absent `eval/`:** `ruff` errors (non-zero) when a path argument does not exist, so the
  bare `ruff check scripts/ eval/` is **not** self-tolerant of an absent `eval/`. Tolerance is owned by
  the **CI composite action**, which guards the eval target with `[ -d eval ]` (see
  `02-ci-blocking-gates.md` §lint); the local recipe above mirrors that guard
  (`$( [ -d eval ] && echo eval )`). Because the guard makes the gate pass whether or not `eval/`
  exists yet, **lint-gate ordering relative to the eval-harness item is irrelevant** — there is no
  forge-4 sequencing constraint here.

### 2.6 Performance (REQ-PERF-01)

The deterministic gate (`validate.sh` + lint + version-sync) SHOULD complete within a few minutes on a
standard runner. The matrix (§3) and eval (§4) are off this fast path. No hard timing assertion; spot-
check wall-clock locally.

## 3. OS-Matrix Installer — local leg validation (REQ-CI-07, -08, SC-05)

Run on the locally available leg (Linux):

```bash
cd installer && npm ci && npm run build
cd ..
node installer/dist/cli.js install --dry-run --skip-rauf --json   # assert exit 0 + valid JSON
node installer/dist/cli.js uninstall -y --skip-rauf               # exercise uninstall path
```

- **Pass:** both commands exit 0; the `--json` output parses (`node -e 'JSON.parse(require("fs")...)'`
  — cross-platform, works on Windows runners).
- **SC-05:** the local leg completes without error AND `os-matrix.yml` **declares all three** legs
  (`ubuntu-latest`, `macos-latest`, `windows-latest`). The Windows leg uses copy-by-default (never
  `--symlink`) — verified in the installer's `resolveMode` (copy when Windows). Confirm the workflow
  declares all three even though only one is exercisable locally.
- `--skip-rauf` is mandatory: rauf is unpublished, so the registry preflight would otherwise fail for
  an out-of-scope reason (IR-2). See `03-os-matrix-installer-gate.md`.

## 4. Advisory Eval — runs + emits a score (REQ-EVAL-01, -02, SC-06)

```bash
# With a key:
ANTHROPIC_API_KEY=sk-... python3 eval/run-eval.py     # prints aggregate + per-skill score, exits 0
# Without a key:
python3 eval/run-eval.py                               # prints "skipped (no key)", exits 0
```

- **SC-06:** the harness runs against the fixtures and emits a trigger-accuracy score, wired as a
  **non-blocking** job (`eval.yml` on `workflow_dispatch` + weekly `schedule`, never `pull_request`).
- **Always exit 0** (advisory): a low score does NOT fail; an absent key reports "skipped" and exits 0
  (REQ-SEC-02). The pinned model + low `max_tokens` (see `04-trigger-accuracy-eval.md`) bound cost;
  non-determinism is acceptable for an advisory signal.
- Verify `eval.yml` has **no** `pull_request` trigger (it must never block a PR).

## 5. Docs Accuracy — dry-run every instruction (REQ-README-03, REQ-DOCS-*, SC-08)

Every install command, agent name, and file path in either README and the five per-agent docs MUST
resolve to a real artifact:

```bash
# feature-forge
node installer/dist/cli.js install --dry-run --skip-rauf --json   # the universal one-liner resolves
ls docs/agents/{claude,codex,copilot,cursor,gemini}.md            # all five per-agent docs exist
ls -d adapters/{claude,codex,copilot,cursor,gemini}               # all five adapter dirs exist
grep -n "rauf@0.6.0" README.md docs/agents/*.md                   # each occurrence labeled "available once published"
```

- **SC-08:** zero stale or failing instructions. The marketplace coordinate is real; per-agent docs
  derive non-Claude install paths from `--dry-run --json` (not unverified config conventions —
  OQ-E / tech-spec §6.1).
- **SC-01:** feature-forge README presents (a)→(b)→(c) before its first non-install `##`; **SC-02:**
  every agent doc is linked from the per-surface table and the default forge↔rauf loop path is
  documented (REQ-DOCS-04).
- **rauf README:** `pnpm check:docs` stays green after the cross-agent section is added (no stale
  grammar / `ralph` branding / version-tag pins / CLI drift) — part of `pnpm gate` below.

## 6. Cross-OS Hygiene checks (REQ-OS-01, -02, SC-07)

```bash
test -f feature-forge/.gitattributes && test -f .gitattributes    # both repos (rauf = this repo)
git check-attr text eol -- scripts/validate.sh                     # text=auto eol=lf applied
git ls-files -s scripts/validate.sh | grep -q '^100755'           # exec bit preserved (mode 755)
```

- **SC-07:** both repos have a `.gitattributes` (LF + export-ignore) and an MIT `LICENSE`; within-repo
  version fields agree (§2.4); CHANGELOGs reflect this feature. `validate.sh` step 6 already asserts
  `scripts/*.sh` are executable (REQ-OS-02). No `* -text` blanket that would corrupt mode bits.

## 7. rauf-side validation

```bash
pnpm gate     # build + schema:check + version:check + typecheck + lint + format:check + test + check:docs
```

- Stays green after the README cross-agent edit, the `.gitattributes` add, and the npm-publishability
  metadata prep. **The npm-prep MUST NOT change any `version` field** (would break `version:check`) —
  see `06-packaging-versioning-hygiene.md` §7. rauf's `version:check` already satisfies REQ-CI-05's
  rauf half (unchanged).

## 8. Success-Criteria → Test Map

| SC | Local check |
|---|---|
| SC-01 | README (a)→(b)→(c) ordering before first non-install `##` (§5) |
| SC-02 | five agent docs linked from table + REQ-DOCS-04 documented (§5) |
| SC-03 | all blocking gates pass locally; version-sync fails-before/passes-after (§2) |
| SC-04 | `build-adapters.py --check` → no diff after gemini bump (§2.3) |
| SC-05 | installer dry-run+uninstall on the local leg; 3 legs declared (§3) |
| SC-06 | `run-eval.py` emits a score, wired non-blocking (§4) |
| SC-07 | `.gitattributes` + MIT LICENSE both repos; versions agree; CHANGELOGs updated (§2.4, §6) |
| SC-08 | every README/doc command+path dry-run-resolved (§5) |

## Dependencies

- All prior docs: `00-core-definitions.md` … `06-packaging-versioning-hygiene.md`. This document tests
  what they define; it adds no new artifacts beyond the anti-drift pytest case (§2.2), which lives with
  the schema integration in `02-ci-blocking-gates.md`.

## Verification

- [ ] `bash scripts/validate.sh` exits 0 on the reconciled feature-forge tree.
- [ ] `shellcheck scripts/*.sh` and `ruff check scripts/ eval/` exit 0.
- [ ] `check-version-sync.py` fails on the desynced tree and passes on the reconciled tree.
- [ ] The anti-drift pytest asserts checker-loaded keys == schema `properties`.
- [ ] The feature-forge CI workflow installs pytest so `validate.sh` step 7 cannot soft-skip the anti-drift assertion in CI (§2.2).
- [ ] Installer `--dry-run --skip-rauf --json` + `uninstall -y --skip-rauf` exit 0 locally; 3 legs declared.
- [ ] `run-eval.py` emits a score with a key and "skipped (no key)" + exit 0 without one.
- [ ] Every README/per-agent-doc command and path resolves (SC-08 recipe).
- [ ] `pnpm gate` green on rauf after its edits.
