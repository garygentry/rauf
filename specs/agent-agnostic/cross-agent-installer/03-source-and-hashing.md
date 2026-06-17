# 03 — Source Location & Content Hashing

> Feature: `cross-agent-installer` (epic `agent-agnostic`, member 4 of 6). Target repo:
> **feature-forge** (`/home/gary/workspace/feature-forge`); specs/backlog/loop driven from **rauf**.
> Source of truth: `PRD.md` (v2) + `tech-spec.md` (v1, esp. §3.3 missing/invalid source, §3.4
> `sourceHash`/drift, **D7** adapters source). This document specifies the two modules that sit at the
> bottom of the dependency graph: `src/source.ts` (locating + integrity-checking the read-only adapter
> bundle) and `src/hash.ts` (SHA-256 content hashing for drift detection). All shared types,
> constants, and the error hierarchy come from **`00-core-definitions.md`** and are **referenced, not
> redefined**.
>
> **Stack:** TypeScript, strict (`strict: true`, `noUncheckedIndexedAccess: true`), **zero runtime
> dependencies** (only `node:` built-ins — here `node:fs`, `node:path`, `node:crypto`, `node:url`),
> compiled with `tsc`, tested with `node:test`. Named exports only. Fallible operations return
> `Result<T, E>` and never throw for expected errors (project convention). All code below is exact
> TypeScript, not pseudocode.

## Requirement Coverage

| REQ ID | Requirement | Section |
|--------|-------------|---------|
| REQ-OPS-06 | Detected agent but `adapters/<agent>/` absent or fails minimal integrity check ⇒ report (naming agent + expected path), write **no** partial install, continue with others | §3.1 `locateBundle` (`SOURCE_MISSING`), §3.2 `checkIntegrity` (`SOURCE_INVALID`), §5 Error handling |
| REQ-SCALE-02 | Installer copies whatever skills the bundle contains — no per-skill logic | §3.5 `listBundleSkills`, §4.2 (dir-name enumeration only; skill files never parsed) |
| OQ-4 | Drift detection uses SHA-256 content hashing, **never** mtime | §3.3 `sha256File` / `sha256Tree`, §3.4 `computeSourceHash`, §4.3 canonical hashing |

> This document **implements** the source-location and hashing behavior that REQ-OPS-06 / OQ-4 require.
> The `sourceHash` it produces is the drift anchor stored in `InstallManifest.sourceHash`
> (`00-core-definitions.md` §3) and is the basis for the no-op idempotency rule REQ-IDEM-01 (decided
> and consumed in `04-plan-and-apply.md` / `05-manifest-and-uninstall.md`).

## 1. Purpose & scope

`src/source.ts` and `src/hash.ts` are the two leaf modules of the installer
(`01-architecture-layout.md` §3: dependency direction terminates at `{hash, fsutil, agent-targets} →
types`). They answer two questions for everything above them:

1. **Where is the read-only bundle for this agent, and is it valid?** — `source.ts`. Per **D7** the
   bundle is resolved from one of three locations (explicit `--source`, the packaged copy, or the
   in-repo `../adapters/`), then subjected to the **minimal integrity check** of REQ-OPS-06 before any
   planning or writing happens. A detected agent whose bundle is missing or invalid yields a
   structured error (`SOURCE_MISSING` / `SOURCE_INVALID`) so the caller can skip just that agent and
   continue with the rest (REQ-OBS-03, decided in `04-plan-and-apply.md`).

2. **What does this bundle hash to, deterministically?** — `hash.ts`. Per **OQ-4** drift is decided
   by **SHA-256 content hashing, never mtime**. `computeSourceHash` produces the single `sourceHash`
   string stored in the manifest; identical bundle contents (even materialized in different
   directories at different times) hash identically, which is the mechanical basis for "re-running
   with no change does nothing" (REQ-IDEM-01).

**Out of scope here** (owned elsewhere, cross-referenced where relevant):

- The plan/diff that *consumes* hashes (`create`/`overwrite`/`skip-modified`/`unchanged`/`remove`) —
  `04-plan-and-apply.md`.
- Reading/writing the manifest and the per-file `sha256` inventory — `05-manifest-and-uninstall.md`.
- Path-sandbox containment for *destinations* — `fsutil.ts` (`04-plan-and-apply.md`). This module only
  reads the source bundle; it performs no writes.
- Parsing skill files. Per **REQ-SCALE-02** the installer copies the bundle verbatim and never opens a
  `SKILL.md` / `<name>.md` / `<name>.mdc` — `listBundleSkills` enumerates `skills/*` **directory
  names** only (§4.2).

## 2. Imports from the foundation

This module imports the following from `src/types.ts` (defined in `00-core-definitions.md`) and **does
not redefine any of them**:

```typescript
import {
  type AgentId,
  type Result,
  type InstallerError,
  ok,
  err,
  BUNDLE_REQUIRED_PATHS,
} from "./types.js";
```

- `AgentId` — `00-core-definitions.md` §1.
- `Result<T, E>`, `ok`, `err`, `InstallerError`, and the `ErrorCode` members `SOURCE_MISSING` /
  `SOURCE_INVALID` — `00-core-definitions.md` §7.
- `BUNDLE_REQUIRED_PATHS` — `00-core-definitions.md` §6 (the integrity-check table:
  `common: ["skills", "scripts/forge-root.sh"]` plus `perAgent: { gemini: ["gemini-extension.json"] }`).

`hash.ts` imports only `node:` built-ins (it returns plain `string` hashes and throws nothing for
expected inputs — see §3.3 for the one unexpected-IO caveat).

## 3. Public API

### 3.1 `locateBundle` — resolve the read-only source bundle (REQ-OPS-06, D7)

```typescript
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/** Options for bundle resolution. */
export interface LocateBundleOpts {
  /**
   * Hidden test hook (`--source <dir>`, D7 / tech-spec §3.5). When set, the bundle is resolved as
   * `<source>/<agent>` and the packaged / in-repo locations are NOT consulted. Tests point this at a
   * fixture adapters tree so no real `adapters/` is required (08, tech-spec §8).
   */
  source?: string;
}

/**
 * Locate the read-only adapter bundle directory for `agent` (D7, REQ-OPS-06).
 *
 * Resolution order (first existing directory wins):
 *   1. Explicit `opts.source` → `<source>/<agent>` (hidden `--source <dir>` test hook).
 *   2. Packaged copy → `<installerPkgRoot>/adapters/<agent>` (present when running from the published
 *      npm tarball, where `files: ["dist","adapters"]` bundles a copy of the repo adapters — D7).
 *   3. In-repo dev → `<repoRoot>/adapters/<agent>` (the committed source, resolved relative to the
 *      compiled module: `dist/source.js` → `installer/` → repo root `../adapters/<agent>`).
 *
 * This function ONLY resolves the directory; it does NOT validate bundle contents — call
 * `checkIntegrity` (§3.2) on the returned path before planning or writing.
 *
 * @param agent - The agent whose bundle to locate.
 * @param opts  - Resolution options (the `--source` test hook).
 * @returns ok(absolutePath) when a bundle directory exists at one of the candidates;
 *          err(SOURCE_MISSING) — naming the agent, the expected path, and the remedy — when none do.
 *
 * @example
 *   const r = locateBundle("claude");
 *   if (!r.ok) reportError(r.error);     // SOURCE_MISSING: names agent + expected path + remedy
 *   else checkIntegrity(r.value, "claude");
 */
export function locateBundle(
  agent: AgentId,
  opts: LocateBundleOpts = {},
): Result<string> {
  for (const candidate of bundleCandidates(agent, opts)) {
    if (isDirectory(candidate)) return ok(candidate);
  }
  // None found: the error names the *most actionable* expected path (the first non-test candidate,
  // i.e. the in-repo / packaged adapters path) and the remedy, per REQ-OBS-02.
  const expected = primaryExpectedPath(agent, opts);
  return err<InstallerError>({
    code: "SOURCE_MISSING",
    agent,
    path: expected,
    message:
      `no source bundle for agent "${agent}" — expected an adapters directory at ${expected}. ` +
      `The bundle is generated by the adapters build; run it (or pass --source <dir>) before installing.`,
    remedy: "run the adapters build to generate adapters/<agent>/, or pass --source <dir>",
  });
}
```

**Resolution-order rationale (D7).** The three candidates mirror the three runtime contexts the
installer runs in (tech-spec §3.5 / `01-architecture-layout.md` §5):

| Order | Candidate | When it exists |
|-------|-----------|----------------|
| 1 | `<opts.source>/<agent>` | Tests pass `--source <fixtureDir>`; takes precedence so a test never falls through to a real tree. |
| 2 | `<installerPkgRoot>/adapters/<agent>` | Running from the published npm package; `files: ["dist","adapters"]` ships the copy (D7). |
| 3 | `<repoRoot>/adapters/<agent>` | In-repo development; the committed `adapters/` tree (C-3, read-only). |

Candidates 2 and 3 are both **absolute** paths derived from the compiled module's own location
(`import.meta.url`), so resolution is independent of `process.cwd()` (REQ-PERF-01 — no probing of the
working dir) and works identically from any cwd. The first candidate that resolves to an **existing
directory** wins; a candidate that is a file or absent is skipped.

### 3.2 `checkIntegrity` — minimal bundle validity check (REQ-OPS-06)

```typescript
/**
 * Minimal integrity check for a located bundle (REQ-OPS-06, tech-spec §3.3). The bundle is valid iff
 * the paths in `BUNDLE_REQUIRED_PATHS` (00-core-definitions.md §6) are present:
 *   - common:  `skills/` is a NON-EMPTY directory, and `scripts/forge-root.sh` exists (a file).
 *   - gemini:  additionally `gemini-extension.json` exists at the bundle root (a file).
 *
 * This is deliberately minimal — it confirms there is *something valid to install*, not that every
 * skill is well-formed (REQ-SCALE-02: skills are copied verbatim, never parsed). It does NOT check
 * for `.claude-plugin/plugin.json` or `epic-manifest.py`: per IR-1 / OQ-A those are NOT present in
 * the generated bundles and are NOT integrity requirements (tech-spec §6, §10).
 *
 * @param bundlePath - Absolute path to the agent's bundle dir (the value from `locateBundle`).
 * @param agent      - The agent whose required-path set to apply (gemini adds one entry).
 * @returns ok(undefined) when every required path is present; err(SOURCE_INVALID) naming the FIRST
 *          missing/invalid required path (and the agent), otherwise.
 *
 * @example
 *   const loc = locateBundle("gemini");
 *   if (loc.ok) {
 *     const ok_ = checkIntegrity(loc.value, "gemini");
 *     if (!ok_.ok) reportError(ok_.error);   // SOURCE_INVALID: "...gemini-extension.json"
 *   }
 */
export function checkIntegrity(
  bundlePath: string,
  agent: AgentId,
): Result<void> {
  // `skills/` must be a non-empty directory — checked specially (existence is not enough).
  const skillsDir = path.join(bundlePath, "skills");
  if (!isDirectory(skillsDir) || !hasEntries(skillsDir)) {
    return invalid(agent, skillsDir, "skills/ is missing or empty");
  }

  // Remaining common requirements + per-agent requirements: each must exist (file or dir).
  const required = requiredPathsFor(agent).filter((rel) => rel !== "skills");
  for (const rel of required) {
    const abs = path.join(bundlePath, rel);
    if (!fs.existsSync(abs)) {
      return invalid(agent, abs, `required path "${rel}" is missing`);
    }
  }
  return ok(undefined);
}
```

**The required-path set (from `BUNDLE_REQUIRED_PATHS`, §6 of `00`).** `requiredPathsFor` (§4.1)
concatenates `BUNDLE_REQUIRED_PATHS.common` with `BUNDLE_REQUIRED_PATHS.perAgent[agent] ?? []`. For
the verified ground truth (tech-spec §6) this means:

| Agent | Required paths checked |
|-------|------------------------|
| claude / codex / copilot / cursor | `skills/` (non-empty dir), `scripts/forge-root.sh` |
| gemini | `skills/` (non-empty dir), `scripts/forge-root.sh`, `gemini-extension.json` |

> **Verified ground truth (do not re-derive):** every `adapters/<agent>/` bundle contains `skills/`
> (11 skill dirs), `references/`, `scripts/forge-root.sh`, `agents/`; gemini adds a root
> `gemini-extension.json` (4631 B). Only the subset in `BUNDLE_REQUIRED_PATHS` is *required* for
> validity — `references/` and `agents/` are present but not gated (a bundle can install usefully
> without the integrity check enumerating every directory). `skills/` non-empty + the resolver script
> + (gemini) the extension manifest are the minimal "there is something valid to install" signal.

### 3.3 `sha256File` & `sha256Tree` — content hashing (OQ-4)

```typescript
import { createHash } from "node:crypto";

/**
 * SHA-256 of a single file's bytes, hex-encoded (OQ-4 — content hash, never mtime).
 *
 * @param filePath - Absolute path to a regular file.
 * @returns 64-char lowercase hex digest of the file's bytes.
 * @throws Propagates the underlying node:fs error (ENOENT/EACCES) — this is an *unexpected*
 *         IO failure for an already-located, integrity-checked bundle, so it is NOT modeled as a
 *         Result here; callers (apply/manifest) wrap bundle traversal in try/catch and surface it
 *         as an InstallerError at the operation boundary (07 CLI, tech-spec §7).
 */
export function sha256File(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Deterministic SHA-256 over a directory tree's file set (OQ-4). The digest is a function of the set
 * of `{ relativePosixPath, fileContentHash }` pairs ONLY — never of mtime, inode, or traversal order.
 *
 * Canonical form (so two materializations of the same bundle hash identically — REQ-IDEM-01 basis):
 *   1. Walk `dir` recursively, collecting every *regular file* (symlinks/dirs excluded as entries;
 *      directories contribute only through the files they contain).
 *   2. Compute each file's relative path from `dir`, normalized to POSIX separators ("/").
 *   3. Sort the relative paths with a stable byte-wise (code-unit) comparison.
 *   4. Fold a single hash over, for each file in sorted order:
 *        update(relPosixPath); update("\0"); update(sha256File(absPath)); update("\n");
 *      The "\0" separates path from content hash unambiguously; the trailing "\n" delimits entries so
 *      no concatenation collision is possible across different path/hash splits.
 *
 * @param dir - Absolute path to the directory whose tree to hash.
 * @returns 64-char lowercase hex digest, invariant under directory relocation and traversal order.
 */
export function sha256Tree(dir: string): string {
  const files = walkFiles(dir); // absolute paths, see §4.2
  const entries = files
    .map((abs) => ({
      rel: toPosix(path.relative(dir, abs)),
      contentHash: sha256File(abs),
    }))
    .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));

  const h = createHash("sha256");
  for (const e of entries) {
    h.update(e.rel);
    h.update("\0");
    h.update(e.contentHash);
    h.update("\n");
  }
  return h.digest("hex");
}
```

### 3.4 `computeSourceHash` — the manifest drift anchor (OQ-4, REQ-IDEM-01 basis)

```typescript
/**
 * Compute the `sourceHash` stored in InstallManifest (00-core-definitions.md §3, tech-spec §3.4).
 * It is exactly `sha256Tree(bundlePath)` — the sorted-path canonical digest over the bundle's file
 * set. Because the canonical form excludes the directory's own location and all timestamps, two
 * materializations of the same bundle (e.g. the in-repo `../adapters/<agent>` and the packaged
 * `installer/adapters/<agent>` copy) produce the SAME hash. This is what lets the planner declare
 * "up to date" when `manifest.sourceHash === computeSourceHash(currentBundle)` (REQ-IDEM-01),
 * regardless of where either was materialized.
 *
 * @param bundlePath - Absolute path to a *located, integrity-checked* bundle dir.
 * @returns 64-char lowercase hex digest — store verbatim in `InstallManifest.sourceHash`.
 *
 * @example
 *   const loc = locateBundle("claude");
 *   if (loc.ok && checkIntegrity(loc.value, "claude").ok) {
 *     const sourceHash = computeSourceHash(loc.value);  // → manifest.sourceHash
 *   }
 */
export function computeSourceHash(bundlePath: string): string {
  return sha256Tree(bundlePath);
}
```

> **Why `computeSourceHash` is a named wrapper, not a bare `sha256Tree` call at the call site.** It
> pins the *contract* — "the manifest drift anchor is the sorted-path tree hash of the bundle" — in
> one place. If a future change ever needs to exclude a path from the drift anchor (e.g. a generated
> `.installed-at` marker), it changes here without touching the generic `sha256Tree` primitive that
> the per-file inventory in `05-manifest-and-uninstall.md` also relies on.

### 3.5 `listBundleSkills` — enumerate installed skill ids (REQ-SCALE-02)

```typescript
/**
 * List the skill ids a bundle contains: the directory names directly under `<bundlePath>/skills/`
 * (REQ-SCALE-02). The result populates `InstallManifest.skills` (00-core-definitions.md §3) and is
 * surfaced per-skill in the report (07). Returned sorted (byte-wise) for deterministic output.
 *
 * Per REQ-SCALE-02 this enumerates DIRECTORY NAMES ONLY and never opens a skill file: a skill is a
 * directory regardless of its inner file form (claude `SKILL.md`, codex/copilot/gemini `<name>.md`,
 * cursor `<name>.mdc`). Adding a skill to canon needs no installer change — it just appears here.
 *
 * @param bundlePath - Absolute path to a located, integrity-checked bundle dir.
 * @returns Sorted skill-directory names. Empty array if `skills/` has no subdirectories (should not
 *          happen after `checkIntegrity`, which requires `skills/` non-empty).
 *
 * @example
 *   listBundleSkills("/.../adapters/claude")
 *   // → ["forge","forge-0-epic","forge-1-prd","forge-2-tech","forge-3-specs","forge-4-backlog",
 *   //    "forge-5-loop","forge-6-docs","forge-fix","forge-init","forge-verify"]  (11 dirs)
 */
export function listBundleSkills(bundlePath: string): string[] {
  const skillsDir = path.join(bundlePath, "skills");
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
```

### 3.6 `listBundleFiles` — the per-file inventory (OQ-4, consumed by 04/05)

```typescript
/**
 * The bundle's per-file inventory: every regular file under `bundlePath`, each as its bundle-relative
 * POSIX path plus the content `sha256` of that file (`sha256File`). Sorted by relative POSIX path
 * (byte-wise) for a deterministic, diff-stable list — the SAME sorted walk `sha256Tree` (§3.3) folds
 * over, so the inventory and the `sourceHash` always agree on the file set and per-file hashes.
 *
 * This is the planner's (04) input for per-file `create`/`overwrite`/`unchanged`/`skip-modified`
 * decisions (it compares each `sha256` against the destination + the prior manifest), and it is what
 * `buildManifest` (05) records as `files[]` in copy mode. It opens files only to hash their bytes
 * (REQ-SCALE-02: skill files are never parsed).
 *
 * @param bundlePath - Absolute path to a located, integrity-checked bundle dir.
 * @returns Array of `{ relpath, sha256 }`, sorted by `relpath` (POSIX `/` separators). Empty only for
 *          an empty tree (should not happen after `checkIntegrity`).
 *
 * @example
 *   listBundleFiles("/.../adapters/claude")
 *   // → [ { relpath: "scripts/forge-root.sh", sha256: "…" },
 *   //     { relpath: "skills/forge-1-prd/SKILL.md", sha256: "…" }, … ]   (sorted by relpath)
 */
export function listBundleFiles(
  bundlePath: string,
): Array<{ relpath: string; sha256: string }> {
  const files = walkFiles(bundlePath); // absolute paths, see §4.2 (same walk as sha256Tree)
  return files
    .map((abs) => ({
      relpath: toPosix(path.relative(bundlePath, abs)),
      sha256: sha256File(abs),
    }))
    .sort((a, b) => (a.relpath < b.relpath ? -1 : a.relpath > b.relpath ? 1 : 0));
}
```

> **Why `listBundleFiles` mirrors `sha256Tree`'s walk.** Both consume `walkFiles` + `toPosix` and sort
> on the relative POSIX path, so the inventory's `{relpath, sha256}` set is exactly the set folded into
> `computeSourceHash`. A planner (04) that diffs `listBundleFiles` against the destination can never
> disagree with the bundle-level `sourceHash` about which files exist or what they hash to.

### 3.7 `locateSource` — resolve + validate + fingerprint in one call (REQ-OPS-06, OQ-4)

```typescript
/**
 * Aggregate the located, integrity-checked bundle plus everything the planner/manifest layers need in
 * one value. `locateSource` runs the §3 primitives in order:
 *   1. `locateBundle(agent, opts)`  → the bundle root (or err SOURCE_MISSING);
 *   2. `checkIntegrity(root, agent)` → validity gate (or err SOURCE_INVALID);
 *   3. fills `sourceHash` = `computeSourceHash(root)`, `skills` = `listBundleSkills(root)`,
 *      `files` = `listBundleFiles(root)`.
 *
 * It returns the SAME `SOURCE_MISSING` / `SOURCE_INVALID` errors as its constituents (no new error
 * codes), so callers (04 planner via `ctx.source`, 07 install/update path) can skip just that agent
 * and continue with the rest (REQ-OPS-06, REQ-OBS-03).
 */
export interface LocatedSource {
  /** Absolute path to the agent bundle root (e.g. `.../adapters/claude`). */
  readonly root: string;
  /** sha256 over the bundle's sorted-path file set — the drift anchor (`manifest.sourceHash`). */
  readonly sourceHash: string;
  /** Installed skill ids (the bundle's `skills/*` dir names) for `manifest.skills`. */
  readonly skills: readonly string[];
  /** Per-file inventory (`{ relpath, sha256 }`, sorted by POSIX relpath) — the set the planner walks. */
  readonly files: ReadonlyArray<{ readonly relpath: string; readonly sha256: string }>;
}

/**
 * Locate, integrity-check, and fingerprint one agent's bundle in a single call.
 *
 * @param agent - The agent whose bundle to resolve.
 * @param opts  - `{ source }`: the hidden `--source <dir>` test hook (forwarded to `locateBundle`).
 * @returns ok(LocatedSource) when the bundle exists and passes the minimal integrity check;
 *          err(SOURCE_MISSING) when no bundle directory exists, or err(SOURCE_INVALID) when it is
 *          present but incomplete — the exact errors returned by `locateBundle`/`checkIntegrity`.
 *
 * @example
 *   const r = locateSource("claude", { source: flags.source });
 *   if (!r.ok) reportError(r.error);     // SOURCE_MISSING / SOURCE_INVALID — skip this agent
 *   else planInstall({ ...ctx, source: r.value });
 */
export function locateSource(
  agent: AgentId,
  opts?: { source?: string },
): Result<LocatedSource> {
  const located = locateBundle(agent, opts);
  if (!located.ok) return located;                 // SOURCE_MISSING

  const integrity = checkIntegrity(located.value, agent);
  if (!integrity.ok) return integrity;             // SOURCE_INVALID

  return ok({
    root: located.value,
    sourceHash: computeSourceHash(located.value),  // → InstallManifest.sourceHash (drift anchor)
    skills: listBundleSkills(located.value),       // → InstallManifest.skills
    files: listBundleFiles(located.value),         // → planner diff input / manifest.files[]
  });
}
```

## 4. Internal implementation

These helpers are **not exported** (module-private). They are specified so the behavior above is
fully determined.

### 4.1 Candidate construction & required-path resolution

```typescript
/** Repo/package roots derived from the compiled module's own location (cwd-independent). */
function moduleDir(): string {
  // dist/source.js at runtime → its dir is <installerPkgRoot>/dist
  return path.dirname(fileURLToPath(import.meta.url));
}

/** <installerPkgRoot> = parent of dist/. */
function installerPkgRoot(): string {
  return path.resolve(moduleDir(), "..");
}

/** <repoRoot> = parent of installer/ (in-repo dev layout: feature-forge/installer/dist/source.js). */
function repoRoot(): string {
  return path.resolve(installerPkgRoot(), "..");
}

/** The ordered candidate bundle dirs for an agent (see §3.1 table). */
function bundleCandidates(agent: AgentId, opts: LocateBundleOpts): string[] {
  const candidates: string[] = [];
  if (opts.source) candidates.push(path.resolve(opts.source, agent));
  candidates.push(path.join(installerPkgRoot(), "adapters", agent)); // packaged copy (D7)
  candidates.push(path.join(repoRoot(), "adapters", agent));         // in-repo dev (C-3)
  return candidates;
}

/** The most actionable expected path to name in a SOURCE_MISSING error (REQ-OBS-02). */
function primaryExpectedPath(agent: AgentId, opts: LocateBundleOpts): string {
  // Prefer the explicit --source path if given; else the in-repo adapters path (the dev remedy site).
  return opts.source
    ? path.resolve(opts.source, agent)
    : path.join(repoRoot(), "adapters", agent);
}

/** common + per-agent required paths (from BUNDLE_REQUIRED_PATHS, 00 §6). */
function requiredPathsFor(agent: AgentId): string[] {
  const perAgent = BUNDLE_REQUIRED_PATHS.perAgent[agent] ?? [];
  return [...BUNDLE_REQUIRED_PATHS.common, ...perAgent];
}

/** Construct the SOURCE_INVALID error naming the offending path (REQ-OBS-02). */
function invalid(agent: AgentId, badPath: string, why: string): Result<never> {
  return err<InstallerError>({
    code: "SOURCE_INVALID",
    agent,
    path: badPath,
    message: `source bundle for agent "${agent}" is invalid: ${why} (at ${badPath}).`,
    remedy: "re-run the adapters build to regenerate a complete bundle",
  });
}
```

### 4.2 Directory walking & POSIX normalization (REQ-SCALE-02, OQ-4)

```typescript
/** True iff `p` exists and is a directory. */
function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** True iff directory `p` has at least one entry (used for the non-empty `skills/` check). */
function hasEntries(p: string): boolean {
  try {
    return fs.readdirSync(p).length > 0;
  } catch {
    return false;
  }
}

/**
 * Recursively collect every REGULAR FILE under `dir` (absolute paths). Directories contribute only
 * via their files; symlink entries are NOT followed and NOT included as files (the source bundle is
 * a plain copied tree — D7 — so it contains no symlinks; excluding them keeps the hash a pure
 * function of file content). Order is unspecified here — `sha256Tree` sorts by relative path (§3.3),
 * so traversal order never affects the digest.
 */
function walkFiles(dir: string): string[] {
  const out: string[] = [];
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const cur = stack.pop() as string;
    for (const ent of fs.readdirSync(cur, { withFileTypes: true })) {
      const abs = path.join(cur, ent.name);
      if (ent.isDirectory()) stack.push(abs);
      else if (ent.isFile()) out.push(abs);
      // symlinks / sockets / fifos: ignored (not expected in a copied bundle)
    }
  }
  return out;
}

/** Normalize an OS-relative path to POSIX separators so hashes match across Windows and POSIX. */
function toPosix(rel: string): string {
  return rel.split(path.sep).join("/");
}
```

> **Why POSIX-normalized relative paths (cross-platform determinism, C-6).** On Windows
> `path.relative` yields `skills\forge-init\SKILL.md`; on POSIX it yields `skills/forge-init/SKILL.md`.
> Folding the raw separator into the hash would make the *same bundle* hash differently on Windows vs.
> Linux, breaking REQ-IDEM-01 across platforms and the OS-matrix CI dry-runs (`packaging-docs-ci`).
> Normalizing to `/` before hashing makes `sourceHash` platform-invariant.

### 4.3 Why sorted-path canonical hashing (OQ-4)

`sha256Tree` is built so the digest depends **only** on the *set* of `(relPosixPath, contentHash)`
pairs:

- **Sort before folding** — filesystem traversal order is not guaranteed across platforms or runs;
  sorting the relative paths makes the input sequence canonical, so the same file set always folds in
  the same order.
- **Content hash, never mtime (OQ-4 mandate)** — each file contributes `sha256File(abs)`, i.e. its
  bytes. A `touch` that changes mtime but not content does **not** change `sourceHash`; a one-byte
  content edit does. This is the explicit OQ-4 decision: drift is content-defined.
- **Unambiguous framing** — `update(rel); update("\0"); update(hash); update("\n")` prevents
  concatenation collisions (e.g. path `a` + hash `bc` vs. path `ab` + hash `c`). The NUL separator
  cannot appear in a POSIX path component and the newline delimits entries.
- **Location-invariant** — only paths *relative to the bundle root* are hashed, so the packaged copy
  (`installer/adapters/<agent>`) and the in-repo source (`../adapters/<agent>`) hash identically
  (REQ-IDEM-01 / `computeSourceHash` contract, §3.4).

## 5. Error handling

`source.ts` returns `Result<T, InstallerError>` for every fallible operation (no throw for expected
errors — project convention, `00-core-definitions.md` §7). `hash.ts` returns plain strings; the only
failure it can surface is an *unexpected* IO error on an already-located, integrity-checked bundle,
which propagates and is caught at the operation boundary (07 CLI → exit 1, tech-spec §7).

| Operation | Condition | Result |
|-----------|-----------|--------|
| `locateBundle` | No candidate directory exists | `err(SOURCE_MISSING)` — names agent + expected path + remedy ("run the adapters build"). The caller (planner, `04`) skips this agent and continues with others; overall exit non-zero (REQ-OPS-06, REQ-OBS-03). |
| `locateBundle` | A candidate exists | `ok(absolutePath)` — the first existing dir in resolution order. |
| `checkIntegrity` | `skills/` missing or empty | `err(SOURCE_INVALID)` naming the `skills/` path. |
| `checkIntegrity` | `scripts/forge-root.sh` (or, gemini, `gemini-extension.json`) missing | `err(SOURCE_INVALID)` naming that exact path. |
| `checkIntegrity` | All required paths present | `ok(undefined)`. |
| `sha256File` | File unreadable (ENOENT/EACCES) | Throws the underlying `node:fs` error — *unexpected* for a checked bundle; caught at the CLI boundary and surfaced as exit 1 with the message (tech-spec §7). |
| `sha256Tree` / `computeSourceHash` | A traversed file becomes unreadable mid-walk | Propagates as above (unexpected IO). |
| `listBundleSkills` | `skills/` unreadable | Returns `[]` (defensive; `checkIntegrity` should already have rejected such a bundle). |

**Actionability (REQ-OBS-02).** Both `SOURCE_MISSING` and `SOURCE_INVALID` set `agent`, `path`, and a
`remedy` so the report layer (07) renders, e.g.:

```
gemini: SKIPPED — source bundle is invalid: required path "gemini-extension.json" is missing
        (at /.../adapters/gemini/gemini-extension.json).
        remedy: re-run the adapters build to regenerate a complete bundle
```

The caller writes **no partial install** for that agent (REQ-OPS-06): integrity is checked *before*
the planner runs, so a failing agent never reaches `apply.ts`.

## 6. Example usage (end-to-end, one agent)

```typescript
import { locateBundle, checkIntegrity, computeSourceHash, listBundleSkills } from "./source.js";

/** Resolve + validate + fingerprint one agent's bundle (the planner's preamble, 04). */
function resolveBundle(agent: AgentId, source?: string):
  Result<{ path: string; sourceHash: string; skills: string[] }> {
  const located = locateBundle(agent, { source });
  if (!located.ok) return located;                 // SOURCE_MISSING — skip this agent (REQ-OPS-06)

  const integrity = checkIntegrity(located.value, agent);
  if (!integrity.ok) return integrity;             // SOURCE_INVALID — skip this agent (REQ-OPS-06)

  return ok({
    path: located.value,
    sourceHash: computeSourceHash(located.value),  // → InstallManifest.sourceHash (drift anchor)
    skills: listBundleSkills(located.value),       // → InstallManifest.skills
  });
}
```

## Dependencies

**Must be implemented first:**

- **`00-core-definitions.md`** — `AgentId`, `Result`/`ok`/`err`, `InstallerError` + the `ErrorCode`
  members `SOURCE_MISSING` / `SOURCE_INVALID`, and the `BUNDLE_REQUIRED_PATHS` table. All imported,
  none redefined here.

**Consumed by (downstream, this module must exist first):**

- **`04-plan-and-apply.md`** — the planner calls `locateBundle` + `checkIntegrity` before diffing, and
  `computeSourceHash` + `listBundleSkills` to populate the plan/manifest; `apply.ts` re-uses
  `sha256File` for the per-file inventory.
- **`05-manifest-and-uninstall.md`** — `InstallManifest.sourceHash` is `computeSourceHash`'s output;
  `InstallManifest.skills` is `listBundleSkills`'s output; the per-file `sha256` inventory uses
  `sha256File`. `list`/`update` compare `manifest.sourceHash` against a fresh `computeSourceHash` to
  decide "up to date" (REQ-IDEM-01) and "out of date" (REQ-IDEM-03).

**External:** none — `node:fs`, `node:path`, `node:crypto`, `node:url` only (zero runtime deps,
tech-spec §9).

## Verification

An implementation matches this spec iff:

- [ ] `src/source.ts` exports `locateBundle`, `checkIntegrity`, `listBundleSkills`, `LocateBundleOpts`,
      `locateSource`, and the `LocatedSource` interface; `src/hash.ts` exports `sha256File`,
      `sha256Tree`, `computeSourceHash`, `listBundleFiles` — all with the exact signatures in §3.
- [ ] `listBundleFiles` returns `{ relpath, sha256 }` entries sorted by POSIX `relpath`, where the
      set + per-file hashes equal what `sha256Tree`/`computeSourceHash` fold over the same bundle
      (inventory ⇄ `sourceHash` agreement, §3.6).
- [ ] `locateSource` returns `ok(LocatedSource{ root, sourceHash, skills, files })` for a valid bundle
      (with `sourceHash === computeSourceHash(root)`, `skills === listBundleSkills(root)`,
      `files === listBundleFiles(root)`), and returns the **same** `err(SOURCE_MISSING)` /
      `err(SOURCE_INVALID)` as `locateBundle`/`checkIntegrity` for a missing/invalid one (§3.7).
- [ ] `locateBundle("claude", { source: fixtureDir })` returns `ok(<fixtureDir>/claude)` when that dir
      exists, and resolves `--source` **before** the packaged / in-repo candidates.
- [ ] `locateBundle` for an agent with no bundle returns `err` with `code === "SOURCE_MISSING"`,
      `agent` set, and a `path`/`message` naming the expected adapters path and the build remedy
      (REQ-OPS-06, REQ-OBS-02).
- [ ] `checkIntegrity` returns `ok(undefined)` for a fixture bundle with a non-empty `skills/` and
      `scripts/forge-root.sh`; returns `err(SOURCE_INVALID)` naming the missing path when `skills/` is
      empty, when `scripts/forge-root.sh` is removed, and (gemini only) when `gemini-extension.json`
      is removed.
- [ ] `checkIntegrity` does **not** require `.claude-plugin/plugin.json` or `epic-manifest.py` (IR-1 /
      OQ-A): a bundle lacking those but otherwise complete passes.
- [ ] `sha256File` returns a 64-char lowercase hex digest equal to an independent `sha256sum` of the
      same bytes.
- [ ] `sha256Tree` / `computeSourceHash` return the **same** digest for two copies of an identical
      tree placed at different absolute paths, and the same digest regardless of file-creation order;
      a content edit to any file changes the digest; a pure `touch` (mtime-only) does **not** (OQ-4).
- [ ] `sha256Tree` yields the same digest on Windows and POSIX for the same logical tree (POSIX-path
      normalization, C-6) — assertable by comparing a tree hashed with backslash- vs slash-relative
      paths, or by golden value in CI's OS matrix.
- [ ] `listBundleSkills` returns the sorted `skills/*` directory names (11 for the verified bundles)
      and never reads inside a skill dir (REQ-SCALE-02) — adding/removing a skill dir changes the list
      with no code change.
- [ ] `tsc --noEmit` passes under `strict` + `noUncheckedIndexedAccess`; both modules import only
      `node:` built-ins and the foundation types (zero runtime deps).
