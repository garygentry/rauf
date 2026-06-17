# 06 — Packaging, Versioning, Licensing & Cross-OS Hygiene

> **Feature:** `packaging-docs-ci` (epic `agent-agnostic`, capstone 6 of 6).
> **Status:** domain spec. Depends on `00-core-definitions.md` and `01-architecture-layout.md`.

This document specifies the **execution** of the non-CI packaging deliverables across both repos:
the within-repo version reconciliation (the *edits/commands*, not the enforcing gate), MIT licensing,
CHANGELOG entries, `.gitattributes` (LF + export-ignore), executable-bit preservation, generated-file
marking, and the rauf npm-publishability prep (machinery only — no publish). Every shape it touches is
fixed in `00-core-definitions.md §5` (version-sync contract) and inventoried in
`01-architecture-layout.md §1` (per-repo file disposition); this doc supplies the concrete file
contents and command sequences an engineer runs.

> **Boundary with `02-ci-blocking-gates.md`:** this doc *performs* the version reconciliation
> (REQ-VER-02). The **gate** that enforces the three fields stay byte-equal (REQ-CI-05) is authored in
> `02-ci-blocking-gates.md`. The contract between them is "fail-before / pass-after" (SC-03): with this
> doc's reconciliation **not yet applied**, the gate from 02 MUST fail on the live desync; once applied,
> it MUST pass. Do not author the gate here; do not author the reconciliation in 02.

## Requirement Coverage

| REQ ID | Requirement | Section |
|--------|-------------|---------|
| REQ-VER-01 | Independent semver per repo (rauf `version:check` unchanged) | §1 |
| REQ-VER-02 | Reconcile the three feature-forge fields to `0.10.0` (exact edits/commands) | §2 |
| REQ-VER-03 / REQ-CONS-02 | SKILL.md carries no version field (manifests only) | §2.4 |
| REQ-MAINT-01 | Generated artifacts marked; gemini reconciled only via generator | §2.3 |
| REQ-LIC-01 / REQ-CONS-03 | MIT `LICENSE` in feature-forge; rauf stays MIT | §3 |
| REQ-LIC-02 | Docs share the code's MIT license (no separate docs license, no SPDX sweep) | §3.3 |
| REQ-CHANGELOG-01 | CHANGELOG entry in each repo | §4 |
| REQ-OS-01 | `.gitattributes` for both repos (LF + export-ignore) | §5 |
| REQ-OS-02 | Executable bits preserved (no `* -text` blanket) | §6 |
| (tech-spec §3.13, decision 1) | rauf npm-publishability prep + optional `npm-publish.yml` | §7 |

---

## 1. Independent Semver Per Repo (REQ-VER-01)

`rauf` and `feature-forge` keep **separate version lines**; there is no requirement that they match
(`00-core-definitions.md §5`). This document changes **only feature-forge's** version fields. rauf's
version state is untouched here.

**rauf's half of REQ-CI-05 is UNCHANGED.** rauf already enforces a single source of truth via
`pnpm version:check` → `scripts/check-versions.ts`, which parses the authoritative
`export const VERSION = "0.6.0"` from `packages/core/src/version.ts`
(`packages/core/src/version.ts:4`) and asserts every workspace manifest agrees:

```
# scripts/check-versions.ts:27-34 — the 6 manifests it checks
package.json
packages/core/package.json
packages/cli/package.json
packages/loop/package.json
packages/web/package.json
packages/docs/package.json
```

> Verified: `scripts/check-versions.ts:1-40` parses `VERSION` from `version.ts` and compares all six
> package.jsons; all are currently `0.6.0`. **No new rauf version gate, no rauf version bump** is part of
> this feature. The npm-prep edits in §7 add `publishConfig`/`files`/`bin` fields but MUST NOT change any
> `version` field (doing so would break `version:check`).

---

## 2. feature-forge Version Reconciliation → `0.10.0` (REQ-VER-02)

**Reconciled value: `0.10.0`** — the highest of the three desynced files (settles PRD OQ-02, per
tech-spec §3.5 and `00-core-definitions.md §5`). The trio and their current/target values
(`00-core-definitions.md §5` table):

| Field | Current (verified) | Disposition | Reconcile by |
|---|---|---|---|
| `.claude-plugin/plugin.json` → `version` | `0.10.0` | UNCHANGED (confirm) | §2.1 |
| `.claude-plugin/marketplace.json` → `plugins[0].version` | `0.9.0` | EDIT (hand) | §2.2 |
| `adapters/gemini/gemini-extension.json` → `version` | `0.0.0` | REGENERATED | §2.3 |

> **EXCLUDED:** `installer/package.json` (`version: "0.1.0"`, verified at
> `installer/package.json:3`) is a **separately npm-published sub-package with an independent release
> cadence** (tech-spec decision 2). It MUST NOT be touched by the reconciliation and MUST NOT be added to
> the version-sync gate's field set (`00-core-definitions.md §5`, `VERSION_SYNC_EXCLUDED`).

### 2.1 plugin.json — confirm (no edit)

`feature-forge/.claude-plugin/plugin.json:3` already reads `"version": "0.10.0"` (verified). No change
is required. The reconciliation step is a **confirmation**: assert the field equals `0.10.0` before
proceeding. If a future state has it differing, set it to `0.10.0` by hand-edit (it is not generated).

```jsonc
// feature-forge/.claude-plugin/plugin.json (current — confirm only)
{
  "name": "feature-forge",
  "version": "0.10.0",   // ← already correct; the gate confirms it
  ...
}
```

### 2.2 marketplace.json — hand-edit `0.9.0` → `0.10.0`

`feature-forge/.claude-plugin/marketplace.json` is **not generated** (no `_generated` provenance block;
verified), so it is reconciled by a direct hand-edit. The version lives at `plugins[0].version`
(verified at the marketplace JSON `plugins[0].version` field, currently `"0.9.0"`).

**Exact edit** — change the single line inside `plugins[0]`:

```diff
   "plugins": [
     {
       "name": "feature-forge",
       "source": ".",
       "description": "End-to-end feature development pipeline: PRD → tech spec → implementation specs → backlog → documentation, with verification gates, pipeline state tracking, and specialized subagents for verification and confirmation.",
-      "version": "0.9.0"
+      "version": "0.10.0"
     }
   ]
```

> Only the `version` value changes. Do not touch `name`, `source`, or `description`. The top-level
> `name`/`owner` keys are unaffected.

### 2.3 gemini-extension.json — reconcile AT THE GENERATOR (REQ-MAINT-01)

`adapters/gemini/gemini-extension.json` carries a `_generated` provenance block at the top of the file
(verified — `adapters/gemini/gemini-extension.json:2`):

```jsonc
{
  "_generated": {
    "source": "skills/",
    "regenerate": "python3 scripts/build-adapters.py"
  },
  "name": "feature-forge",
  "version": "0.0.0",   // ← current; MUST become 0.10.0 via the generator, NEVER by hand
  ...
}
```

This file is **REGENERATED**, never hand-edited (REQ-MAINT-01, REQ-CONST-04). The version value is
sourced from a single constant in the generator (verified):

```python
# feature-forge/scripts/build-adapters.py:298
GEMINI_EXTENSION_VERSION: str = "0.0.0"
```

> The constant is consumed at `build-adapters.py:1033`:
> `"version": GEMINI_EXTENSION_VERSION,  # fixed constant, 00 §7 (V-002)` — confirming the
> `gemini-extension.json` `version` field derives solely from this constant.

**Exact reconciliation — two steps, in order:**

**Step 1 — bump the constant** at `scripts/build-adapters.py:298`:

```diff
-GEMINI_EXTENSION_VERSION: str = "0.0.0"
+GEMINI_EXTENSION_VERSION: str = "0.10.0"
```

**Step 2 — regenerate** (rewrites `adapters/gemini/gemini-extension.json` and any other gemini
artifacts deterministically):

```bash
cd ../feature-forge
python3 scripts/build-adapters.py
```

After regeneration, `adapters/gemini/gemini-extension.json` `version` reads `0.10.0` and the
`_generated` header is preserved (the generator re-emits it). **Do not hand-edit the JSON** — a manual
edit would be reverted by the next `build-adapters.py --check` (the regen-diff gate in
`02-ci-blocking-gates.md`, REQ-CI-04) and is forbidden by REQ-MAINT-01.

> **Drift check (REQ-CI-04, SC-04):** after the two steps, `python3 scripts/build-adapters.py --check`
> MUST produce **no diff** against the committed `adapters/`. A non-empty diff means the regeneration was
> not committed, or a hand-edit slipped in. The `--check` mechanism is owned by `forge-agent-adapters-build`
> (consumed contract, tech-spec §6.3) — this feature only invokes it.

### 2.4 No `version` field in SKILL.md (REQ-VER-03 / REQ-CONS-02)

Version numbers live in the per-repo **manifests only** (`plugin.json`, `marketplace.json`,
`gemini-extension.json`) — **never** in `SKILL.md` frontmatter. This is the deliberate charter deviation
recorded as REQ-CONS-02. The mechanical enforcement is the JSON Schema in `00-core-definitions.md §3`:
`skill-frontmatter.schema.json` has `additionalProperties: false` and no `version` property, so any
`version:` key in a SKILL.md fails validation. **This doc adds no version field to any SKILL.md** when
reconciling; the reconciliation touches manifests only. See `00-core-definitions.md §3` for the schema
and `02-ci-blocking-gates.md` for the schema-driven checker.

---

## 3. Licensing (REQ-LIC-01, REQ-LIC-02, REQ-CONS-03)

Both repos carry an **MIT** `LICENSE`. This is the deliberate divergence from the charter's Apache-2.0
mandate (REQ-CONS-03): MIT for both repos, docs share the code license, no per-file SPDX sweep
(PRD §6).

### 3.1 feature-forge — add `LICENSE` (NEW)

feature-forge currently has **no** `LICENSE` file (verified). Add `feature-forge/LICENSE` with the full
MIT text, copyright holder **Gary Gentry**, year **2026** (matching the `author.name` in
`plugin.json` and the `owner.name` in `marketplace.json`, both `"Gary Gentry"`).

**Exact file contents — `feature-forge/LICENSE`:**

```
MIT License

Copyright (c) 2026 Gary Gentry

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### 3.2 rauf — already MIT (no change)

rauf already ships an MIT `LICENSE` (verified at `rauf/LICENSE:1` = `MIT License`). **No change** to
rauf's license is part of this feature. Note rauf's existing copyright line reads
`Copyright (c) 2026 Ralph Contributors` (`rauf/LICENSE:3`) — this feature does **not** rewrite it
(out of scope: relicensing churn beyond adding/aligning MIT, PRD §6). rauf's README MIT badge stays
accurate because the license remains MIT.

> The two repos intentionally use **different copyright holder strings** (feature-forge: "Gary Gentry";
> rauf: "Ralph Contributors") — both are MIT, satisfying REQ-LIC-01 ("both repos MUST carry an MIT
> LICENSE"). Independent repos, independent attribution lines.

### 3.3 Docs share the code license (REQ-LIC-02)

Documentation (READMEs, `docs/agents/*.md`) is covered by the same MIT `LICENSE` at each repo root. **No
separate docs license file is introduced, and no per-file SPDX header sweep is performed** (PRD §6
out-of-scope). A single top-level `LICENSE` per repo suffices for both code and docs.

---

## 4. CHANGELOG Entries (REQ-CHANGELOG-01)

Both repos already maintain Keep-a-Changelog CHANGELOGs (verified: both open with the Keep-a-Changelog
preamble / semver-heading convention). Add one entry per repo recording this feature's changes (CI
gates, docs, hygiene, licensing, version reconciliation), preserving each file's existing format.

### 4.1 feature-forge — under `## [0.10.0]`

The reconciled feature-forge version is `0.10.0`, and the existing `CHANGELOG.md` already has a
`## [0.10.0] — 2026-06-13` heading (verified at the top of `feature-forge/CHANGELOG.md`). **Add the
capstone's changes under that existing `[0.10.0]` heading** (do not introduce a new version heading —
the reconciled value is `0.10.0`). Append the new subsections to the existing `[0.10.0]` block:

```markdown
## [0.10.0] — 2026-06-13

### Added

- **CI gates (GitHub Actions, net-new).** `ci.yml` (per-PR blocking deterministic
  gate via the `quality-gate` composite action), `os-matrix.yml` (installer
  `--dry-run` + `uninstall` on Ubuntu/macOS/Windows), and `eval.yml` (advisory
  trigger-accuracy, `workflow_dispatch` + weekly schedule, non-blocking).
- **SKILL.md frontmatter JSON Schema** (`references/skill-frontmatter.schema.json`)
  as the single source of truth for the spec-pure key set; `check-spec-purity.py`
  now loads its allowed/required keys from it.
- **Shell + Python lint gates** — `shellcheck` over `scripts/*.sh` (`.shellcheckrc`)
  and `ruff` over `scripts/*.py` + `eval/*.py` (`ruff.toml`).
- **Trigger-accuracy eval harness** (`eval/run-eval.py` + `eval/fixtures/<skill>.json`).
- **Per-agent setup docs** (`docs/agents/{claude,codex,copilot,cursor,gemini}.md`).
- **MIT `LICENSE`** (previously none).
- **`.gitattributes`** — LF normalization (`* text=auto eol=lf`) + `export-ignore`
  for dev-only trees.

### Changed

- **README rewritten install-first** — Claude marketplace install, universal
  `npx feature-forge install` one-liner, and a per-surface agent table.
- **Version fields reconciled to `0.10.0`** — `marketplace.json` `0.9.0` → `0.10.0`
  (hand-edit) and `adapters/gemini/gemini-extension.json` `0.0.0` → `0.10.0`
  (via the `GEMINI_EXTENSION_VERSION` generator constant). `plugin.json` was
  already `0.10.0`. `installer/package.json` keeps its independent line.
```

> If a backlog item adds CHANGELOG content before the README/CI items land, include only the
> already-landed subsections and append the rest as those items complete. The format (`### Added` /
> `### Changed` under a semver heading) matches the file's existing Keep-a-Changelog style.

### 4.2 rauf — under `## Unreleased`

rauf's `CHANGELOG.md` opens with an empty `## Unreleased` heading directly under the title (verified at
`rauf/CHANGELOG.md:3`). **Add the rauf-side changes under `## Unreleased`** (rauf's version is not bumped
by this feature — REQ-VER-01; its independent semver line stays at `0.6.0`):

```markdown
## Unreleased

### Added

- **`.gitattributes`** — LF normalization (`* text=auto eol=lf`) + `export-ignore`
  for dev-only trees (`specs/`, `tests/`, `.github/`, `test-sandbox/`).
- **npm-publishability prep** on the packages the installer's `rauf@0.6.0` pin
  targets (`publishConfig` / `files` / `bin`) — machinery only; **no publish** is
  executed (the `npx rauf@0.6.0` path is documented as "available once rauf 0.6.0
  is published").
- **Optional `npm-publish.yml`** — `workflow_dispatch`-only publish machinery,
  outside the PR gate (not run by this feature).

### Changed

- **README** — added a labeled cross-agent section linking feature-forge's
  cross-agent install story (loop-runner framing retained).
```

> Inserting under `## Unreleased` MUST NOT disturb the following `## 0.6.0` block. **Validation hazard
> (cross-repo loop note):** appending to a structured doc can drop trailing braces in adjacent JSON state
> files — that does not apply to Markdown, but the editor MUST leave the `## 0.6.0` heading and all later
> content byte-intact. The new section is plain Markdown that MUST pass rauf's `check:docs` gate (no
> `ralph` branding, no stale version-tag pins, no CLI drift — see `05-readme-and-agent-docs.md`).

---

## 5. `.gitattributes` for Both Repos (REQ-OS-01)

Neither repo has a `.gitattributes` today (verified). Each gets one enforcing **LF normalization** for
text and **`export-ignore`** for dev-only trees that should not appear in release archives
(`git archive`). The shape follows `00`/`01` and tech-spec §3.10; the per-repo export-ignore trees differ
(feature-forge: `specs/ tests/ .github/ eval/ plans/`; rauf: `specs/ tests/ .github/ test-sandbox/`).

### 5.1 feature-forge — `feature-forge/.gitattributes` (NEW)

```gitattributes
# Normalize line endings for all text files; commit LF, check out LF.
* text=auto eol=lf

# Binary assets — never normalize.
*.png binary
*.jpg binary

# export-ignore: keep dev-only trees out of `git archive` release tarballs.
specs/      export-ignore
tests/      export-ignore
.github/    export-ignore
eval/       export-ignore
plans/      export-ignore
```

### 5.2 rauf — `rauf/.gitattributes` (NEW)

```gitattributes
# Normalize line endings for all text files; commit LF, check out LF.
* text=auto eol=lf

# Binary assets — never normalize.
*.png binary
*.jpg binary

# export-ignore: keep dev-only trees out of `git archive` release tarballs.
specs/         export-ignore
tests/         export-ignore
.github/       export-ignore
test-sandbox/  export-ignore
```

**Notes (both files):**

- `* text=auto eol=lf` lets git auto-detect text vs binary and forces **LF** on checkout/commit for the
  text files — cross-OS hygiene (REQ-OS-01). It does **not** force-mark binaries as text (git's auto
  detection plus the explicit `*.png/*.jpg binary` lines keep binaries safe).
- `export-ignore` only affects `git archive` output (release tarballs / GitHub source archives); it has
  no effect on the working tree or on `git clone`. It keeps spec/test/CI/dev trees out of consumer
  archives without removing them from the repo.
- **No `* -text` blanket** appears anywhere — that would disable normalization and, more importantly, is
  unrelated to (and must not be confused with) the executable-bit handling in §6.

---

## 6. Executable-Bit Preservation (REQ-OS-02)

Scripts intended to be executable MUST keep their `+x` mode bit across platforms; the `.gitattributes`
LF normalization MUST NOT strip it.

**Why the two concerns are independent.** Git tracks the executable bit in the **tree object mode**
(`100644` vs `100755`), entirely separate from content/EOL attributes. `* text=auto eol=lf` rewrites
*line endings*; it never touches the mode bit. The only attribute that could interfere is a `* -text`
blanket (which we do **not** use, §5) — and even that affects content normalization, not the mode. So
the chosen `.gitattributes` is mode-bit-safe by construction.

**feature-forge already enforces this.** `validate.sh` checks that every shell script carries `+x`
(verified at `scripts/validate.sh:109-115`):

```bash
# feature-forge/scripts/validate.sh:109-115 (verified)
for SCRIPT in "$REPO_ROOT"/scripts/*.sh; do
  ...
  if [ -x "$SCRIPT" ]; then
    echo "PASS: $REL_PATH is executable"
  else
    echo "FAIL: $REL_PATH is not executable (run: chmod +x $REL_PATH)"
```

It also checks the adapters generator is executable (`scripts/validate.sh:150`, `if [ ! -x "$ADAPTERS_PY" ]`).
This script-permission check is one of the existing validators wired into CI via REQ-CI-06
(`02-ci-blocking-gates.md`) — so a stripped `+x` bit **fails the per-PR gate**, giving REQ-OS-02 a real
enforcement point without new tooling.

**Obligations:**

- feature-forge `scripts/*.sh` (`validate.sh`, `forge-init.sh`, `forge-root.sh`, `session-check.sh`)
  and `scripts/build-adapters.py` keep their `+x` bit; the existing `validate.sh` check guards it.
- The `.gitattributes` added in §5 uses no `* -text` and no mode-altering attribute, so it cannot
  silently strip `+x`.
- No new chmod automation is introduced; if a file ever loses its bit, the remedy is the message
  `validate.sh` already prints: `chmod +x <path>`.

> rauf's 18 shell scripts are **out of REQ-CI-03 lint scope** (tech-spec decision 4), but rauf's
> `.gitattributes` is equally mode-bit-safe (no `* -text`), so its scripts' `+x` bits are unaffected.

---

## 7. rauf npm-Publishability Machinery (tech-spec §3.13, decision 1)

Goal: make rauf **publishable** so a maintainer *can* later cut `rauf@0.6.0`, **without executing any
publish** in this feature (honors PRD §6: ship the machinery, not the release). The installer's default
provisioning path pins `RAUF_PIN = "rauf@0.6.0"` (verified at
`feature-forge/installer/src/rauf.ts:30`) via lazy `npx`, but rauf is currently unpublished. CI never
depends on this path — the OS-matrix legs pass `--skip-rauf` (`00-core-definitions.md §7`).

### 7.1 The packaging-prep edits (NO publish)

The installer pin targets an **unscoped `rauf` package with bin `rauf`**. In the rauf monorepo the
distributable CLI lives in `@rauf/cli` (verified: `packages/cli/package.json` — `"name": "@rauf/cli"`,
`"private": true`, `"bin": { "rauf": "dist/index.js" }`), and the root manifest is
`"name": "rauf"`, `"private": true` with **no `bin`** (verified `package.json:2-4`). See **OQ-A**
(§7.4) — which package becomes the published `rauf` is a deliberately-deferred decision.

The prep makes the chosen target publishable by adding standard npm-publish metadata. For the package
that will become the published `rauf` (the unscoped name the pin resolves), set:

```jsonc
{
  // remove "private": true  (a private package cannot be published)
  "publishConfig": { "access": "public" },
  "files": ["dist"],            // ship only built output; exclude src/tests
  "bin": { "rauf": "dist/index.js" }  // the bin the pin expects (already present on @rauf/cli)
}
```

**Hard constraints on these edits (REQ-VER-01):**

- **Do NOT change any `version` field.** Every workspace package.json is `0.6.0` and must stay `0.6.0`
  to keep `pnpm version:check` green (`scripts/check-versions.ts`, §1). The prep adds *metadata fields*
  only.
- **Do NOT run `npm publish`** (PRD §6). The prep is package.json metadata + (optionally) the workflow
  in §7.2.
- Removing `private: true` on a workspace package is acceptable as packaging-prep, but the maintainer
  publishes manually later; nothing in the PR gate publishes.

### 7.2 Optional `npm-publish.yml` — publish machinery only

Optionally add `rauf/.github/workflows/npm-publish.yml` (inventoried NEW in
`01-architecture-layout.md §1.2`) as **`workflow_dispatch`-only** machinery a maintainer triggers by
hand. It is **outside the PR gate** and **not run by this feature**. Skeleton (third-party actions
pinned per REQ-SEC-01, least-privilege per `01 §4`):

```yaml
name: npm Publish (manual)
on:
  workflow_dispatch:
    inputs:
      tag:
        description: "Existing vX.Y.Z tag to publish to npm"
        required: true
permissions:
  contents: read   # least-privilege; NPM_TOKEN injected as a secret at publish time
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: oven-sh/setup-bun@v2
      - uses: pnpm/action-setup@v6
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      # NOTE: npm publish is intentionally NOT wired by this feature (PRD §6).
      # A maintainer fills in the publish step + NPM_TOKEN secret when cutting the release.
      # - run: npm publish --access public --provenance
      #   env: { NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }} }
```

> The publish step is left **commented** deliberately — authoring the machinery satisfies decision 1;
> wiring a live `npm publish` is the separate manual maintainer step excluded by PRD §6.

### 7.3 Docs state the gap, CI never depends on it

The READMEs and per-agent docs (authored in `05-readme-and-agent-docs.md`) state the `npx rauf@0.6.0`
install path is **"available once rauf 0.6.0 is published"** — never presented as working today
(REQ-README-03 accuracy). CI's OS-matrix legs use `--skip-rauf` so the unpublished pin never fails a
gate for an out-of-scope reason (`00-core-definitions.md §7`; the installer's own non-silent
`RAUF_UNRESOLVABLE` message — see `installer/src/rauf.ts:69-97` — is documented as expected until
publish).

### 7.4 OQ-A — rauf distribution form (FLAG, do not force-decide)

> **OPEN QUESTION OQ-A (tech-spec §10).** rauf's CLI uses a **Bun shebang** —
> `#!/usr/bin/env bun` (verified `packages/cli/src/index.ts:1`). A plain `npm install`/`npx` of a
> Bun-shebanged package requires **Bun to be present on the consumer's machine**. The repo's *current*
> shipped distribution form is a **compiled binary**, not an npm tarball: `release.yml` cross-compiles
> five targets via `bun build --compile … scripts/binary-entry.ts --outfile dist/rauf-*`
> (verified `release.yml:65-77`, e.g.
> `bun build --compile --target=bun-linux-x64-baseline scripts/binary-entry.ts --outfile dist/rauf-linux-x64`)
> and publishes them as GitHub release assets — there is **no npm package** in the publish path today.
>
> So `npx rauf@0.6.0` (the installer's pin) is **not yet satisfiable by any artifact** — there is no
> unscoped `rauf` npm package (only the private scoped `@rauf/cli`), and the released form is a binary,
> not an npm tarball. The two candidate resolutions are:
> 1. **Bun-required npm package** — publish `@rauf/cli` (or a thin unscoped `rauf` wrapper) to npm; `npx`
>    works only where Bun is installed. Simple to publish, but breaks for non-Bun consumers.
> 2. **Compiled-binary via a thin npm wrapper** — publish a tiny `rauf` npm package whose `postinstall`
>    downloads the matching `release.yml` binary asset for the platform. Works without Bun, but adds a
>    download-on-install wrapper to author.
>
> **This feature does NOT decide between them** (tech-spec §10 OQ-A: "resolve when the publish machinery
> is authored; does not block CI"). The prep in §7.1–7.2 is authored to be compatible with *either*
> outcome; the per-agent/README docs label the `npx` path as not-yet-published (§7.3). The engineer
> implementing §7 MUST surface this choice to the maintainer rather than silently picking one.

---

## Dependencies

- **`00-core-definitions.md`** — `RECONCILED_VERSION` (`0.10.0`), the `VersionSyncContract` three-field
  set, `VERSION_SYNC_EXCLUDED` (`installer/package.json`), the SKILL.md schema (no `version` key,
  §2.4), the supported-agent set, and the `FileDisposition` codes used throughout.
- **`01-architecture-layout.md`** — the per-repo file inventory (§1.1 feature-forge, §1.2 rauf) that
  classifies every file this doc edits (`LICENSE` NEW, `.gitattributes` NEW, `marketplace.json` EDIT,
  `gemini-extension.json` REGENERATED, `CHANGELOG.md` EDIT, `npm-publish.yml` NEW-optional,
  `packages/*/package.json` EDIT) and the workflow topology for §7.2.
- **`02-ci-blocking-gates.md`** — **owns the enforcing gates** this doc's edits are checked by: the
  version-sync gate (REQ-CI-05; must fail-before / pass-after this doc's reconciliation, SC-03), the
  adapters regen-diff gate (REQ-CI-04; clean after the gemini bump, SC-04), the schema-driven SKILL.md
  checker (REQ-VER-03 enforcement), and the script-permission check that guards REQ-OS-02. **Implement
  the reconciliation here; implement those gates in 02.**
- **`05-readme-and-agent-docs.md`** — consumes the "available once rauf 0.6.0 is published" wording
  (§7.3) and the MIT badge accuracy (§3.2).

> **Implementation ordering:** §2's reconciliation and 02's version-sync gate are coupled by the
> fail-before/pass-after contract. To demonstrate SC-03 the gate (02) should exist first so it can be
> observed **failing** on the live desync; then this doc's reconciliation lands and the same gate
> **passes**. The licensing/CHANGELOG/`.gitattributes`/npm-prep edits have no inter-dependency and may
> land in any order.

## Verification

Maps to **SC-07** (`.gitattributes` + MIT `LICENSE` + within-repo version agreement + CHANGELOGs in both
repos), **SC-03** (version-sync gate fail-then-pass), and **SC-04** (adapters regen-diff clean after the
gemini bump).

**Version reconciliation (REQ-VER-02 → SC-03, SC-04):**
- [ ] `feature-forge/.claude-plugin/plugin.json` `version` == `0.10.0` (confirmed unchanged).
- [ ] `feature-forge/.claude-plugin/marketplace.json` `plugins[0].version` == `0.10.0` (hand-edited).
- [ ] `feature-forge/scripts/build-adapters.py:298` reads `GEMINI_EXTENSION_VERSION: str = "0.10.0"`.
- [ ] After `python3 scripts/build-adapters.py`, `adapters/gemini/gemini-extension.json` `version` ==
      `0.10.0` and its `_generated` header is intact.
- [ ] `python3 scripts/build-adapters.py --check` produces **no diff** (SC-04).
- [ ] The version-sync gate from `02-ci-blocking-gates.md` **fails** against the pre-reconciliation tree
      and **passes** after these edits (SC-03).
- [ ] `installer/package.json` `version` is **unchanged** (`0.1.0`) — excluded from the trio.
- [ ] No `SKILL.md` gained a `version` field (REQ-VER-03).

**rauf semver (REQ-VER-01):**
- [ ] `pnpm version:check` still passes (no rauf `version` field changed; all six manifests `0.6.0`).

**Licensing (REQ-LIC-01/02 → SC-07):**
- [ ] `feature-forge/LICENSE` exists, is MIT, copyright `2026 Gary Gentry`.
- [ ] `rauf/LICENSE` is unchanged (MIT); rauf README MIT badge still accurate.
- [ ] No separate docs-license file and no per-file SPDX headers were added.

**CHANGELOG (REQ-CHANGELOG-01 → SC-07):**
- [ ] feature-forge `CHANGELOG.md` `[0.10.0]` block records the capstone's added/changed items.
- [ ] rauf `CHANGELOG.md` `## Unreleased` records the rauf-side items; the `## 0.6.0` block is intact.
- [ ] rauf `pnpm check:docs` passes with the new Unreleased content.

**`.gitattributes` (REQ-OS-01 → SC-07):**
- [ ] `feature-forge/.gitattributes` exists with `* text=auto eol=lf`, `*.png/*.jpg binary`, and
      `export-ignore` for `specs/ tests/ .github/ eval/ plans/`.
- [ ] `rauf/.gitattributes` exists with `* text=auto eol=lf`, `*.png/*.jpg binary`, and `export-ignore`
      for `specs/ tests/ .github/ test-sandbox/`.
- [ ] Neither file contains a `* -text` blanket.

**Executable bits (REQ-OS-02):**
- [ ] `feature-forge/scripts/*.sh` and `build-adapters.py` retain `+x`; `validate.sh`'s permission check
      passes (it is wired into CI via REQ-CI-06).

**rauf npm-prep (tech-spec §3.13 / decision 1):**
- [ ] The package targeted by the `rauf@0.6.0` pin has `publishConfig`/`files`/`bin` set and is no longer
      `private` — **without** any `version` change and **without** any `npm publish` having run.
- [ ] If added, `npm-publish.yml` triggers on `workflow_dispatch` only and contains no active publish
      step.
- [ ] READMEs/per-agent docs label `npx rauf@0.6.0` as "available once rauf 0.6.0 is published"
      (cross-checked in `05-readme-and-agent-docs.md`).
- [ ] OQ-A (Bun-required npm package vs compiled-binary wrapper) is surfaced to the maintainer, not
      silently decided.
