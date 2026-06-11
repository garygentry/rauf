---
name: rauf-version-locations
description: Where the rauf version lives, the canonical source, and the lockstep drift gotcha with the docs package
metadata:
  type: project
---

The rauf version is supposed to be lockstep across all workspace packages + root.

**Canonical source of truth:** `packages/core/src/version.ts` (`export const VERSION`).

**All version locations:** root `package.json`, plus `packages/{core,cli,loop,web,docs}/package.json`.

**Gotcha (load-bearing for release-automation feature):**
- As of 2026-06, `@rauf/docs` is at `0.1.0` while everything else is `0.2.0` — lockstep is already broken in practice.
- `scripts/bump-version.sh` updates `version.ts` + 5 package.json files but its PACKAGE_FILES array OMITS `packages/docs/package.json` entirely. So docs has never been bumped by the tool.

**Why:** matters because the release-automation PRD asserts docs is part of lockstep (REQ-VER-01) and that the prep helper "evolves from bump-version.sh". A naive evolution inherits the docs omission and the drift guard (tag == committed version) has an ambiguous notion of "the committed version" when packages disagree.

**How to apply:** When verifying release/version specs, check that the docs package is explicitly included or explicitly excluded — do not assume lockstep holds just because the PRD says so.
