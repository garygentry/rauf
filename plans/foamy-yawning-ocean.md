# Plan: Add `--version` flag and version bump script

## Context

The CLI has a `ralph version` command but no `--version` / `-V` flag — the standard way users check tool versions. Additionally, the version `"0.1.0"` is defined in 7 separate locations with no automated way to keep them in sync when bumping.

## Changes

### 1. Add `--version` / `-V` flag to CLI

**File:** `packages/cli/src/main.ts`

Intercept `--version` or `-V` before command routing (after the preparse). If present, print `ralph v{VERSION}` (or JSON if `--json`) and exit 0. This mirrors the existing `ralph version` command behavior but as a flag.

No changes needed to `parser.ts` — the flag will be detected via raw `argv` check before parsing, same pattern tools like `git` use.

### 2. Consolidate TOOL_VERSION duplication

**File:** `packages/core/src/installer.ts` (line 28)

Replace the hardcoded `const TOOL_VERSION = "0.1.0"` with an import of `VERSION` from the index. The comment says "avoids circular import" — need to verify this is still true. If circular, extract VERSION to its own tiny `version.ts` module that both `index.ts` and `installer.ts` import from.

### 3. Create version bump script

**File:** `scripts/bump-version.sh` (new)

A simple bash script that:
- Takes a version string argument (e.g., `bash scripts/bump-version.sh 0.2.0`)
- Updates all locations:
  - `packages/core/src/index.ts` — VERSION constant
  - `package.json` (root)
  - `packages/core/package.json`
  - `packages/cli/package.json`
  - `packages/loop/package.json`
  - `packages/web/package.json`
- Uses `sed` for the TypeScript constant, `jq` (or sed) for package.json files
- Prints a summary of what was updated

### 4. Tests

**File:** `packages/cli/src/main.test.ts` or `commands.test.ts`

Add tests for `--version` and `-V` flags producing correct output.

## Key files

- `packages/cli/src/main.ts` — flag intercept
- `packages/core/src/index.ts:4` — VERSION constant (source of truth)
- `packages/core/src/installer.ts:28` — TOOL_VERSION duplicate
- `packages/cli/src/commands.test.ts` — existing version command tests

## Verification

```bash
# Unit tests
pnpm test

# Manual check
ralph --version        # → ralph v0.1.0
ralph -V               # → ralph v0.1.0
ralph --version --json # → {"version":"0.1.0"}

# Bump script
bash scripts/bump-version.sh 0.2.0
grep -r '"0.2.0"' packages/*/package.json package.json
grep 'VERSION' packages/core/src/index.ts
```
