# 02 — Shared Library (`scripts/release/lib.ts`)

Pure, side-effect-free logic shared by the prep helper (`03-prepare-helper.md`) and the CI preflight (`04-ci-preflight-and-workflow.md`). No `process.exit`, no `@rauf/core` import, no git/network I/O. Filesystem reads are confined to `readVersionLocations` (which takes an explicit `repoRoot` and reads known files) so every other function is a deterministic string transform and trivially unit-testable.

## Requirement Coverage

| REQ ID       | Requirement                                            | Section            |
| ------------ | ------------------------------------------------------ | ------------------ |
| REQ-VER-01   | Read/write all six package.json versions               | 3.1, 3.4           |
| REQ-VER-03   | Parse/write canonical `version.ts`                     | 3.2, 3.3           |
| REQ-VER-04   | Validate semver                                        | 4.1                |
| REQ-VER-05   | docs package.json in the location set                  | 3.1                |
| REQ-PREP-04  | Strictly-greater version comparison                    | 4.2                |
| REQ-BUILD-05 | Prerelease classification                              | 4.3                |
| REQ-PREP-05  | Non-empty `## Unreleased` detection                    | 5.1                |
| REQ-NOTES-01 | Roll `## Unreleased` → `## X.Y.Z`                       | 5.2                |
| REQ-NOTES-02 | Extract `## X.Y.Z` body verbatim                        | 5.3                |

## 1. Module contract

```typescript
// scripts/release/lib.ts
import * as fs from "node:fs";
import * as path from "node:path";
```

All functions are exported. Pure functions **throw typed `Error`s** on malformed input (callers route them through `fail()` from `00-core-definitions.md` §5). They never call `process.exit`.

## 2. Re-exported constants

`lib.ts` is the single definition site for the constants in `00-core-definitions.md` §2–3 (`VERSION_TS_PATH`, `PACKAGE_JSON_PATHS`, `RELEASE_TARGETS`, `CHECKSUMS_FILE`, `REPO_SLUG`, `PINNED_BUN_VERSION`, `SEMVER_RE`) and the `fail()` helper. They are listed there; not repeated here.

## 3. Version locations

### 3.1 `readVersionLocations` (REQ-VER-01, REQ-VER-05)

```typescript
/**
 * Read the canonical version (version.ts, index 0) and all six package.json
 * versions, in the order of PACKAGE_JSON_PATHS. Throws if any expected file
 * is missing or unparseable — a malformed repo must not silently pass the
 * drift guard. `repoRoot` is an absolute path to the rauf repo root.
 */
export function readVersionLocations(repoRoot: string): VersionLocation[] {
  const out: VersionLocation[] = [];

  const versionTs = fs.readFileSync(path.join(repoRoot, VERSION_TS_PATH), "utf8");
  out.push({ file: VERSION_TS_PATH, version: parseVersionTs(versionTs), canonical: true });

  for (const rel of PACKAGE_JSON_PATHS) {
    const raw = fs.readFileSync(path.join(repoRoot, rel), "utf8");
    let parsed: { version?: unknown };
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new Error(`${rel}: invalid JSON (${e instanceof Error ? e.message : String(e)})`);
    }
    if (typeof parsed.version !== "string") {
      throw new Error(`${rel}: missing or non-string "version" field`);
    }
    out.push({ file: rel, version: parsed.version, canonical: false });
  }
  return out;
}
```

### 3.2 `parseVersionTs` (REQ-VER-03)

```typescript
/**
 * Extract the VERSION string from a version.ts file body. Matches
 * `export const VERSION = "X.Y.Z"`. Throws if not found (the canonical
 * source must always be present and well-formed).
 */
export function parseVersionTs(content: string): string {
  const m = content.match(/export const VERSION = "([^"]*)"/);
  if (!m) throw new Error(`${VERSION_TS_PATH}: could not find 'export const VERSION = "..."'`);
  return m[1]!;
}
```

### 3.3 `setVersionTs` (REQ-VER-03)

```typescript
/**
 * Return `content` with the VERSION constant replaced by `v`. Idempotent and
 * formatting-preserving (only the quoted value changes). Throws if no VERSION
 * line is present, so a silent no-op write is impossible.
 */
export function setVersionTs(content: string, v: string): string {
  if (!/export const VERSION = "[^"]*"/.test(content)) {
    throw new Error(`${VERSION_TS_PATH}: no VERSION constant to replace`);
  }
  return content.replace(/export const VERSION = "[^"]*"/, `export const VERSION = "${v}"`);
}
```

### 3.4 `setPackageJsonVersion` (REQ-VER-01)

```typescript
/**
 * Return a package.json `content` with `.version` set to `v`, preserving the
 * file's original indentation and trailing newline (mirrors the technique the
 * removed bump-version.sh used via `node -e`). Throws on invalid JSON.
 */
export function setPackageJsonVersion(content: string, v: string): string {
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(content);
  } catch (e) {
    throw new Error(`invalid package.json: ${e instanceof Error ? e.message : String(e)}`);
  }
  pkg.version = v;
  // Preserve original indentation; default to two spaces.
  const indentMatch = content.match(/^([ \t]+)"/m);
  const indent = indentMatch ? indentMatch[1] : "  ";
  const trailingNewline = content.endsWith("\n") ? "\n" : "";
  return JSON.stringify(pkg, null, indent) + trailingNewline;
}
```

> **Note on key order.** `JSON.parse`→`JSON.stringify` preserves insertion order, and `version` already exists in every target, so reassigning it keeps its position. This matches `bump-version.sh`'s prior behavior.

## 4. Semver

### 4.1 `isValidVersion` (REQ-VER-04)

```typescript
/** True iff `v` matches SEMVER_RE — the sole input gate (00-core-definitions.md §3.1). */
export function isValidVersion(v: string): boolean {
  return SEMVER_RE.test(v);
}
```

### 4.2 `compareVersions` (REQ-PREP-04)

```typescript
/**
 * -1 if a < b, 0 if equal, 1 if a > b. Wraps Bun.semver.order (Bun ≥ 1.1).
 * PRECONDITION: both inputs already passed isValidVersion — this is only ever
 * called on validated strings, so Bun.semver's broader grammar is never reached
 * (keeps the regex and the comparator consistent by construction, tech-spec §3.1).
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  return Bun.semver.order(a, b) as -1 | 0 | 1;
}
```

### 4.3 `isPrerelease` (REQ-BUILD-05)

```typescript
/**
 * True iff the version carries a prerelease suffix (e.g. "0.3.0-rc.1").
 * PRECONDITION: validated by isValidVersion, so a "-" can only be the
 * prerelease separator (build-metadata "+" is rejected by SEMVER_RE).
 */
export function isPrerelease(v: string): boolean {
  return v.includes("-");
}
```

## 5. Changelog

These operate on the grammar fixed in `00-core-definitions.md` §4. The "## " section delimiter is an H2 heading at line start.

### 5.1 `getUnreleasedBody` (REQ-PREP-05)

```typescript
/**
 * Return the trimmed body of the `## Unreleased` section: every line after the
 * `## Unreleased` heading up to (but excluding) the next line starting "## "
 * or EOF. Returns "" if the section is absent or empty. The REQ-PREP-05 guard
 * refuses to proceed when this is "".
 */
export function getUnreleasedBody(content: string): string {
  const lines = content.split("\n");
  const start = lines.findIndex((l) => /^## Unreleased\s*$/.test(l));
  if (start === -1) return "";
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i]!)) { end = i; break; }
  }
  return lines.slice(start + 1, end).join("\n").trim();
}
```

### 5.2 `rollChangelog` (REQ-NOTES-01)

```typescript
/**
 * Move the `## Unreleased` body into a new `## X.Y.Z` section directly under a
 * fresh empty `## Unreleased`, and return both the updated file content and the
 * rolled section body (for the dry-run preview / sanity checks).
 *
 * Throws if there is no `## Unreleased` section, or if its body is empty
 * (callers SHOULD have already run the REQ-PREP-05 guard, but rolling an empty
 * section is a hard error regardless).
 *
 * Greenfield (no prior `## X.Y.Z` sections) and with-existing-sections inputs
 * both produce: `# Changelog` → empty `## Unreleased` → `## X.Y.Z` (new) →
 * any prior versioned sections, newest first.
 */
export function rollChangelog(
  content: string,
  v: string,
): { updated: string; sectionBody: string } {
  const body = getUnreleasedBody(content);
  if (body === "") throw new Error("cannot roll changelog: `## Unreleased` section is empty");

  const lines = content.split("\n");
  const uIdx = lines.findIndex((l) => /^## Unreleased\s*$/.test(l));
  // End of the Unreleased section (next "## " or EOF).
  let uEnd = lines.length;
  for (let i = uIdx + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i]!)) { uEnd = i; break; }
  }

  const before = lines.slice(0, uIdx);                 // up to & incl. "# Changelog" + blank
  const sectionLines = lines.slice(uIdx + 1, uEnd);     // the Unreleased body (raw, untrimmed)
  const after = lines.slice(uEnd);                      // prior versioned sections (may be empty)

  const rebuilt = [
    ...before,
    "## Unreleased",
    "",
    `## ${v}`,
    ...sectionLines,
    ...after,
  ].join("\n");

  return { updated: rebuilt, sectionBody: body };
}
```

> **Implementation note.** Preserve the original `before`/`after` slices verbatim so unrelated whitespace and prior sections are untouched. The only structural change is the renamed heading plus the inserted empty `## Unreleased`. `lib.test.ts` asserts byte-for-byte output for both greenfield and with-prior-sections fixtures.

### 5.3 `extractSection` (REQ-NOTES-02)

```typescript
/**
 * Return the verbatim body of the `## X.Y.Z` section (lines between that
 * heading and the next "## " or EOF), trimmed of leading/trailing blank lines.
 * Used by the workflow notes step to build NOTES.md. Throws if the section is
 * absent — the release notes MUST come from a real changelog section
 * (REQ-NOTES-02), never silently empty.
 */
export function extractSection(content: string, v: string): string {
  const lines = content.split("\n");
  const headingRe = new RegExp(`^## ${v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`);
  const start = lines.findIndex((l) => headingRe.test(l));
  if (start === -1) throw new Error(`changelog has no "## ${v}" section`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i]!)) { end = i; break; }
  }
  return lines.slice(start + 1, end).join("\n").trim();
}
```

> The "Full Changelog" compare link (REQ-NOTES-03) is appended by the **workflow notes step**, not here, because it depends on `git describe` output (see `04-ci-preflight-and-workflow.md` §3, step 9). `extractSection` returns only the curated body.

## Dependencies

- `00-core-definitions.md` — types (`VersionLocation`), constants, `SEMVER_RE`, `fail()`.

## Verification

- `lib.test.ts` (see `07-testing-strategy.md`) covers: `rollChangelog` (greenfield + with prior sections, byte-exact), `extractSection` (present/absent), `getUnreleasedBody` (empty/non-empty/absent), `compareVersions`/`isValidVersion`/`isPrerelease` (including rejection of build-metadata `+`), `setPackageJsonVersion` (2-space, 4-space, tab indent; with/without trailing newline), `parseVersionTs`/`setVersionTs` (present/absent VERSION line).
- `pnpm typecheck` passes; no import of `@rauf/*` or `node:child_process` appears in `lib.ts`.
- Running `bun run -e 'import("./scripts/release/lib.ts")'` has no side effects (no output, no exit).
