---
name: release-automation-facts
description: Verified repo facts for the release-automation feature specs (version locations, quality gate, install script, tags)
metadata:
  type: project
---

Repo facts verified during specs-mode (2026-06-10) and backlog-mode (2026-06-10) verification of the `release-automation` feature.

**Why:** these are load-bearing invariants the specs depend on; re-verify before acting, but they were true at verification time.
**How to apply:** when verifying later stages (backlog/impl) of release-automation, these are the ground-truth anchors.

- `packages/core/src/version.ts`: `export const VERSION = "0.2.0";`
- Six PACKAGE_JSON version locations: root + core/cli/loop/web at `0.2.0`; `packages/docs/package.json` drifted to `0.1.0` (the documented drift the feature fixes). "Seven version locations" in the specs/backlog = 1 version.ts + 6 package.json — internally consistent, NOT a bug.
- `scripts/bump-version.sh` exists; `PACKAGE_FILES` = 5 (omits docs); semver regex `^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$` — byte-identical to spec's `SEMVER_RE`.
- The quality gate is **6 commands** (build, schema:check, typecheck, lint, format:check, test) — NOT 7. All six root scripts exist incl. `schema:check` ("bun run scripts/generate-json-schemas.ts --check").
- `ci.yml` `check` job has those 6 steps inline; `permissions: contents: read`. `.github/actions/` does NOT exist yet (composite action is NEW).
- Only git tag is `pre-rauf-rename` (no `v*` tags) — validates the `git describe --match 'v*'` first-release exclusion rationale.
- `dist/` is gitignored (build-notes writes `dist/NOTES.md`; compiled binaries land in `dist/`).
- `binary-entry.ts` imports only `packages/web/src/server/start.js` + `packages/cli/src/main.js` (product isolation claim is true).
- `checkLoopPreconditions` in `packages/loop/src/git-status.ts` uses async `execFile` (helper `execGit`, ~line 73); spec mirrors with sync `execFileSync` (deliberate).
- `extractSection` escape regex in spec 02 §5.3 is NOW the CORRECT form `/[.*+?^${}()|[\]\\]/g` (fixed during specs verification; was broken before). No longer a finding.
- CHANGELOG.md `## Unreleased` currently HAS real content (the rauf-rename notes), so REQ-PREP-05 guard + pre-release checklist item 4 are satisfiable today.
- Spec 07 §2.4 defines a shared test fixtures/factory module (`makeChangelog`, `makeRepoFixture`) under `scripts/release/` — but 01 §1 directory tree does NOT enumerate it as a file, and no backlog item names it as an explicit deliverable.

**Backlog-mode (v1) verification result (2026-06-10):** rauf-stable backlog validate → exit 0 (valid, 0 findings); validate-traceability.py → 40/40 covered, 0 uncovered, 0 orphaned. 10 items, schema/enum/DAG all clean. Findings were soft gaps only (fixtures-factory owner, manual e2e tracking, item 003 scope creep into packages/loop). No hard blockers. This pipeline (PRD→tech→specs→backlog) has been consistently high-quality — findings counts have been declining (prd 9, tech 9, specs 5, backlog ~3). Watch for under-flagging temptation; the soft gaps here are real.
