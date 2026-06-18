# 05 — Manifest & Uninstall

> Feature: `cross-agent-installer` (epic `agent-agnostic`, member 4 of 6). Target repo:
> **feature-forge** (`/home/gary/workspace/feature-forge`); specs/backlog/loop driven from **rauf**.
> Source of truth: `PRD.md` (v2) + `tech-spec.md` (v1, esp. §3.6 manifest & uninstall safety, D6
> manifest+drift, D8 symlink). This document specifies `installer/src/manifest.ts`: the persisted
> install manifest (read/write/build) and the manifest-driven uninstall-exactness policy.
>
> **Stack:** TypeScript, strict (`strict: true`, `noUncheckedIndexedAccess: true`), **zero runtime
> dependencies** (only `node:` built-ins), compiled with `tsc`, tested with `node:test`. Named exports
> only. `node:` prefix on every built-in (`node:fs`, `node:path`). Core functions return
> `Result<T, E>` and **never throw for expected errors**; `JSON.parse` is always wrapped in
> `try/catch` returning a structured error (project convention). All writes are **atomic**
> (`.tmp` → rename). All code below is exact TypeScript, not pseudocode.
>
> **Shared types come from `00-core-definitions.md` and MUST NOT be redefined here** — this doc
> imports `InstallManifest`, `ManifestFile`, `SCHEMA_VERSION`, `MANIFEST_PREFIX`, `Scope`, `Mode`,
> `AgentId`, `AGENT_TARGETS`, `Result`/`ok`/`err`, and `InstallerError`/`ErrorCode` (code
> `MANIFEST_CORRUPT`).

## Requirement Coverage

| REQ ID | Requirement | Section |
|--------|-------------|---------|
| REQ-SAFE-01 | Manifest records skill set + file inventory + copy/symlink mode; uninstall removes EXACTLY the recorded files/dir, leaving unrelated user files + untracked skills untouched | §3 `buildManifest`, §4 `manifestPath`, §5 read/write, §6 removal POLICY (`planUninstall`); execution (containment-checked removal + empty-dir prune) is `apply()` in `04` §5.3 |
| REQ-SAFE-02 | Symlinked uninstall removes the LINK (unlink) and never deletes the link target (repo `adapters/` source) | §6.2 symlink removal policy, §6.3 unlink safety; link-safe execution (`lstat`+`unlink`) is `apply()` in `04` §5.3 |
| REQ-SAFE-03 | Manifest sufficient for `list`/`update` to tell installer-written content from user content and detect drift | §3 `buildManifest` (`sourceHash`, per-file `sha256`, `mode`), §7 sufficiency contract |
| REQ-SEC-03 | Symlink unlink never follows the link to delete the target — `lstat` + `unlink` | §6.3 unlink-safety policy; enforced by `apply()`/`removePath` in `04` §5.3 |
| REQ-OPS-03 | Uninstall operation — manifest-driven removal policy here (which paths); execution is `apply()` in `04-plan-and-apply.md` §5.3 | §6 `planUninstall`, §6 Execution (delegated to 04) |

> Drift detection and the install/update plan/apply paths are owned by `04-plan-and-apply.md`. This
> doc owns the **manifest persistence** and the **uninstall removal policy** only; it references the
> fsutil primitives rather than redefining them.

## 1. Purpose & scope

`src/manifest.ts` is the single module that:

1. **Locates** the per-install manifest — the hidden parent-sibling
   `<installSubdir>/.feature-forge.<scope>.json` (§4) — uniformly for copy and symlink (D6/D8).
2. **Reads** a manifest (`null` if absent; `MANIFEST_CORRUPT` on invalid JSON / failed shape
   validation), and **writes** it atomically (`.tmp` → rename) with correct `installedAt`/`updatedAt`
   (§5).
3. **Builds** an `InstallManifest` from an agent/scope/mode/destination plus the apply result's file
   inventory, the bundle `sourceHash`, the installed skill ids, the recorded `raufPin`, and the
   `featureForgeVersion` (`null` today — §3.4) (§3).
4. Defines the **uninstall removal POLICY** (`planUninstall`): the set of paths to remove is
   **exactly** what the manifest records (copy: every `files[].path`; symlink: the single
   namespace-dir link) — **never** an untracked path. It emits an all-`"remove"` `PlannedAction`;
   the safe EXECUTION of that plan (containment-checked removal, empty-dir prune, link-safe unlink,
   then deleting the manifest file) is `apply()` in `04-plan-and-apply.md` §5.3 (§6).

**Out of scope here (owned elsewhere):**

- Computing `sourceHash` and per-file `sha256` values — `03-source-and-hashing.md` (`hash.ts`).
- The install/update planner and the copy/symlink/remove primitives — `04-plan-and-apply.md`
  (`plan.ts`, `apply.ts`, `fsutil.ts`). This doc **calls** fsutil's sandboxed remove/unlink; it does
  not implement them.
- `RAUF_PIN` and the rauf preflight — `06-rauf-provisioning.md` (`rauf.ts`). This doc only **stores**
  the recorded pin value in the manifest.

## 2. Manifest location rationale (parent-sibling; copy = symlink uniformity)

Per **D6/D8** (tech-spec §3.6), the manifest is a hidden file in the **parent** of the namespace dir,
named by scope:

```
~/.claude/skills/.feature-forge.global.json        ← governs ~/.claude/skills/feature-forge/   (global)
./.claude/skills/.feature-forge.project.json       ← governs ./.claude/skills/feature-forge/    (project)
~/.cursor/rules/.feature-forge.global.json         ← governs ~/.cursor/rules/feature-forge/     (global)
~/.gemini/extensions/.feature-forge.global.json    ← governs ~/.gemini/extensions/feature-forge/ (global)
```

It is the **parent-sibling** of the `feature-forge/` namespace dir (i.e. it sits in `installSubdir`,
*next to* the namespace dir), **not inside it**. The reason is symlink mode (D8): in `--symlink`
installs the namespace dir is itself a symlink pointing into the **read-only** source bundle, so it
**cannot** hold the manifest. Placing the manifest in the parent makes the location **identical for
copy and symlink**, so `readManifest`/`writeManifest`/uninstall need no mode-dependent path logic.

The scope (`global`/`project`) is encoded in the **filename suffix** (`MANIFEST_PREFIX` + scope +
`.json` — §00 `MANIFEST_PREFIX = ".feature-forge."`) and is also implied by the location (home root
vs. cwd root). Encoding scope in the name lets a global and a project install for the same agent
coexist without collision when (rarely) their `installSubdir` resolves to the same directory.

## 3. Public API — `buildManifest`

```typescript
import * as path from "node:path";
import {
  type AgentId,
  type InstallManifest,
  type ManifestFile,
  type Mode,
  type Scope,
  SCHEMA_VERSION,
} from "./types.js";

/**
 * Inputs to {@link buildManifest}. The caller (apply.ts, §04) assembles this from the resolved
 * detection target, the chosen scope/mode, and the apply result's per-file inventory.
 */
export interface BuildManifestArgs {
  readonly agent: AgentId;
  readonly scope: Scope;
  readonly mode: Mode;
  /** Absolute path of the `feature-forge/` namespace dir this manifest governs. */
  readonly destination: string;
  /**
   * Per-file inventory of what was written, paths **relative to `destination`**. In `"symlink"`
   * mode this is `[]` (no per-file copy exists) — see §3.3. In `"copy"` mode each entry MUST carry
   * its `sha256` (computed by `hash.ts`, §03).
   */
  readonly files: readonly ManifestFile[];
  /** Installed skill ids (the bundle's `skills/*` dir names). */
  readonly skills: readonly string[];
  /** SHA-256 over the source bundle's canonical (sorted-path) file set — drift anchor (§03). */
  readonly sourceHash: string;
  /** Recorded pinned rauf coordinate (e.g. "rauf@0.6.0"); `null` when `--skip-rauf` (§06). */
  readonly raufPin: string | null;
  /** Symlink mode only: the source bundle the namespace dir links to (REQ-SAFE-02). */
  readonly link?: { readonly target: string };
  /**
   * Prior manifest for this install, if any (read via {@link readManifest} before apply). When
   * present, its `installedAt` is preserved (this is an update, not a fresh install) — §3.2.
   */
  readonly previous?: InstallManifest | null;
  /** Injectable clock for deterministic tests. Default: `() => new Date()`. */
  readonly now?: () => Date;
}

/**
 * Assemble an {@link InstallManifest} from an apply result (REQ-SAFE-01/03). Pure — performs no I/O;
 * the caller persists it via {@link writeManifest}.
 *
 * Timestamp policy (§3.2): `updatedAt` is always "now". `installedAt` is `previous.installedAt`
 * when reconciling an existing install, else "now".
 *
 * `featureForgeVersion` is always `null` today (§3.4) — the consumed `adapters/` bundles carry no
 * version coordinate; recording a real value is deferred to the generator (OQ-A/IR-1), and C-3
 * forbids the installer reading outside `adapters/` to synthesize one.
 *
 * @example
 * const m = buildManifest({
 *   agent: "claude", scope: "global", mode: "copy",
 *   destination: "/home/u/.claude/skills/feature-forge",
 *   files: [{ path: "skills/forge-1-prd/SKILL.md", sha256: "ab…" }],
 *   skills: ["forge-1-prd", "forge-2-tech"],
 *   sourceHash: "deadbeef…", raufPin: "rauf@0.6.0",
 * });
 */
export function buildManifest(args: BuildManifestArgs): InstallManifest {
  const now = (args.now ?? (() => new Date()))().toISOString();
  const installedAt = args.previous?.installedAt ?? now;

  // Sort the inventory and skills for a deterministic, diff-stable manifest (REQ-SAFE-03 /
  // §03 canonical ordering). In symlink mode `files` is [].
  const files: ManifestFile[] = [...args.files]
    .map((f) => ({ path: f.path, ...(f.sha256 !== undefined ? { sha256: f.sha256 } : {}) }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const skills = [...args.skills].sort();

  return {
    schemaVersion: SCHEMA_VERSION,
    agent: args.agent,
    scope: args.scope,
    mode: args.mode,
    destination: args.destination,
    featureForgeVersion: null, // §3.4 — null today (OQ-A/IR-1); C-3 forbids synthesizing one.
    sourceHash: args.sourceHash,
    raufPin: args.raufPin,
    installedAt,
    updatedAt: now,
    skills,
    files,
    ...(args.link !== undefined ? { link: args.link } : {}),
  };
}
```

### 3.1 Field provenance

Every `InstallManifest` field traces to a source (REQ-SAFE-01/03):

| Field | Source | REQ |
|-------|--------|-----|
| `schemaVersion` | `SCHEMA_VERSION` (§00) | — |
| `agent` / `scope` / `mode` | resolved flags (`02`, `00` `CliFlags`) | REQ-FLAG-01/02/03 |
| `destination` | resolved via `destinationFor`/`AGENT_TARGETS` (§02) | REQ-SAFE-01 |
| `featureForgeVersion` | **`null`** today (§3.4) | OQ-A/IR-1 |
| `sourceHash` | `hash.ts` `sha256Tree` over the bundle (§03) | REQ-SAFE-03, REQ-IDEM-01 |
| `raufPin` | recorded pin (`06`); `null` if `--skip-rauf` | REQ-RAUF-03 |
| `installedAt` / `updatedAt` | clock (§3.2) | REQ-SAFE-01 |
| `skills` | bundle `skills/*` dir names (apply result) | REQ-SAFE-01 |
| `files[]` | apply result inventory; `sha256` from `hash.ts` (omitted in symlink) | REQ-SAFE-01/03 |
| `link.target` | symlink mode only — the linked bundle (§04) | REQ-SAFE-02 |

### 3.2 Timestamp policy

- **Fresh install** (no `previous`): `installedAt = updatedAt = now`.
- **Update** (`previous` present): `installedAt = previous.installedAt`; `updatedAt = now`.

The clock is injected via `args.now` so `node:test` suites assert exact ISO strings without time
flakiness (§08 testing approach).

### 3.3 Symlink-mode inventory

In `"symlink"` mode the whole namespace dir is one link into the read-only source (D8), so there is
**no** per-file copy to hash. `buildManifest` records `files: []` and (required) `link: { target }`.
The uninstall policy (§6.2) keys off `mode === "symlink"` / the presence of `link` to remove the
single link rather than enumerating `files`.

### 3.4 `featureForgeVersion` is `null` today

`featureForgeVersion` is `string | null` and **`null` today**. The consumed `adapters/<agent>/`
bundles carry **no** version coordinate (verified: no `plugin.json` / version header in the bundles;
gemini's `gemini-extension.json` version is a `0.0.0` placeholder). Recording a real value is
deferred to the **generator** under **OQ-A / IR-1**; constraint **C-3** forbids the installer reading
outside `adapters/` to synthesize one. `buildManifest` therefore hard-codes `featureForgeVersion:
null`. When the generator later emits a coordinate into each bundle, this module reads it from the
bundle (still inside `adapters/`, honoring C-3) and `BuildManifestArgs` gains a `featureForgeVersion`
input — a localized, additive change.

## 4. Public API — `manifestPath`

```typescript
import { type AgentId, type Scope, type ResolveOpts, MANIFEST_PREFIX, AGENT_TARGETS } from "./types.js";
import { destinationFor } from "./agent-targets.js"; // §02

/**
 * Absolute path of the hidden **parent-sibling** manifest for an agent + scope (§2, D6/D8):
 *   `<scopeRoot>/<configDirName>/<installSubdir>/.feature-forge.<scope>.json`
 * e.g. `~/.claude/skills/.feature-forge.global.json`.
 *
 * Identical for copy and symlink mode — the manifest lives **next to** the `feature-forge/`
 * namespace dir, never inside it (a symlinked namespace dir points into read-only source).
 *
 * Derived through `destinationFor`/`AGENT_TARGETS` (§02), so tests inject `home`/`cwd` and never touch
 * the real `~`. The `installSubdir` directory itself is the agent's skills/rules/extensions dir
 * (the parent of the namespace dir).
 *
 * @param agent one of the five supported agents
 * @param scope `"global"` (home root) or `"project"` (cwd root)
 * @param opts  injectable `home`/`cwd` for tests (defaults: `os.homedir()` / `process.cwd()`)
 *
 * @example
 * manifestPath("claude", "global", { home: "/home/u" });
 * // → "/home/u/.claude/skills/.feature-forge.global.json"
 */
export function manifestPath(
  agent: AgentId,
  scope: Scope,
  opts?: Omit<ResolveOpts, "scope">,
): string {
  // destinationFor (§02) returns the install destination (the `feature-forge/` namespace dir) for the
  // active scope. The manifest is its sibling: dirname(destination)/.feature-forge.<scope>.json.
  const destination = destinationFor(AGENT_TARGETS[agent], scope, opts);
  const installSubdirAbs = path.dirname(destination); // the skills/rules/extensions dir
  return path.join(installSubdirAbs, `${MANIFEST_PREFIX}${scope}.json`);
}
```

> **Dependency on `02`.** `destinationFor(AGENT_TARGETS[agent], scope, opts)` is specified in
> `02-agent-detection-map.md` and returns the resolved namespace-dir `destination` for the active
> scope. This module derives the manifest path from `path.dirname(destination)` so the two locations
> can never drift. If `destinationFor`'s return shape differs at implementation, derive the same
> `<installSubdir>` directory from `AGENT_TARGETS[agent]` + the scope root — see Warnings.

## 5. Public API — `readManifest` / `writeManifest`

```typescript
import * as fs from "node:fs";
import * as path from "node:path";
import {
  type InstallManifest,
  type Result,
  SCHEMA_VERSION,
  ok,
  err,
} from "./types.js";

/**
 * Read and validate the manifest at `path`.
 *
 * - **Absent** (`ENOENT`) → `ok(null)` — a not-yet-installed target is not an error (REQ-OPS-04
 *   `list` relies on this).
 * - **Present + valid** → `ok(manifest)`.
 * - **Unreadable / invalid JSON / failed shape validation** → `err(MANIFEST_CORRUPT)` with an
 *   actionable message naming the path and the remedy (REQ-OBS-02). `JSON.parse` is wrapped in
 *   `try/catch` per project convention.
 *
 * @example
 * const r = readManifest(manifestPath("claude", "global"));
 * if (!r.ok) report(r.error);          // MANIFEST_CORRUPT
 * else if (r.value === null) { ... }   // not installed
 * else { ... }                          // r.value: InstallManifest
 */
export function readManifest(p: string): Result<InstallManifest | null> {
  let raw: string;
  try {
    raw = fs.readFileSync(p, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return ok(null);
    return err({
      code: "MANIFEST_CORRUPT",
      message: `cannot read install manifest at ${p}: ${(e as Error).message}`,
      path: p,
      remedy: "check read permissions, or remove the file to force a fresh install",
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return err({
      code: "MANIFEST_CORRUPT",
      message: `install manifest at ${p} is not valid JSON: ${(e as Error).message}`,
      path: p,
      remedy: "the manifest is corrupt; remove it and re-run install to regenerate it",
    });
  }

  const v = validateManifest(parsed);
  if (!v.ok) {
    return err({
      code: "MANIFEST_CORRUPT",
      message: `install manifest at ${p} failed validation: ${v.reason}`,
      path: p,
      remedy: "the manifest is corrupt; remove it and re-run install to regenerate it",
    });
  }
  return ok(v.value);
}

/**
 * Atomically write the manifest to `path` (write `<path>.tmp` → `rename`), per the project's
 * atomic-write convention. The parent dir (the agent's `installSubdir`) is created if missing
 * (`recursive: true`) — it always exists post-apply, but creating it is idempotent and safe.
 *
 * Returns `err(WRITE_DENIED)` (REQ-OBS-02) on a permission failure, naming the path and remedy.
 *
 * @example
 * const w = writeManifest(manifestPath("claude", "global"), m);
 * if (!w.ok) report(w.error);
 */
export function writeManifest(p: string, m: InstallManifest): Result<void> {
  const tmp = `${p}.tmp`;
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(tmp, `${JSON.stringify(m, null, 2)}\n`, "utf8");
    fs.renameSync(tmp, p); // atomic on a single filesystem
    return ok(undefined);
  } catch (e) {
    // Best-effort cleanup of the temp file; ignore secondary failures.
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* ignore */
    }
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "EACCES" || code === "EPERM") {
      return err({
        code: "WRITE_DENIED",
        message: `no write permission for install manifest at ${p}`,
        path: p,
        remedy: `ensure you can write to ${path.dirname(p)} (do not use elevated privileges)`,
      });
    }
    return err({
      code: "UNEXPECTED",
      message: `failed to write install manifest at ${p}: ${(e as Error).message}`,
      path: p,
    });
  }
}
```

> **Why `writeManifest` does not set timestamps.** Timestamp policy lives in `buildManifest` (§3.2)
> so the persisted bytes are deterministic and the writer is a pure serializer. `writeManifest`
> serializes whatever `buildManifest` produced.

### 5.1 Shape validation — `validateManifest`

Internal, no I/O. Confirms the parsed value is structurally an `InstallManifest` for the **current**
`SCHEMA_VERSION` before any consumer (`list`/`update`/`uninstall`) trusts it. A version mismatch is
treated as corrupt for this feature (only `SCHEMA_VERSION === 1` exists; a future bump would add a
migration path here).

```typescript
type ValidateResult =
  | { readonly ok: true; readonly value: InstallManifest }
  | { readonly ok: false; readonly reason: string };

const AGENT_IDS_SET = new Set(["claude", "codex", "copilot", "cursor", "gemini"]);

/** Structural validation of a parsed manifest (internal to manifest.ts). */
function validateManifest(x: unknown): ValidateResult {
  if (typeof x !== "object" || x === null) return { ok: false, reason: "not an object" };
  const o = x as Record<string, unknown>;

  if (o.schemaVersion !== SCHEMA_VERSION) {
    return { ok: false, reason: `unsupported schemaVersion ${String(o.schemaVersion)}` };
  }
  if (typeof o.agent !== "string" || !AGENT_IDS_SET.has(o.agent)) {
    return { ok: false, reason: `invalid agent ${String(o.agent)}` };
  }
  if (o.scope !== "global" && o.scope !== "project") {
    return { ok: false, reason: `invalid scope ${String(o.scope)}` };
  }
  if (o.mode !== "copy" && o.mode !== "symlink") {
    return { ok: false, reason: `invalid mode ${String(o.mode)}` };
  }
  if (typeof o.destination !== "string" || o.destination.length === 0) {
    return { ok: false, reason: "missing destination" };
  }
  if (!(o.featureForgeVersion === null || typeof o.featureForgeVersion === "string")) {
    return { ok: false, reason: "invalid featureForgeVersion" };
  }
  if (typeof o.sourceHash !== "string") return { ok: false, reason: "missing sourceHash" };
  if (!(o.raufPin === null || typeof o.raufPin === "string")) {
    return { ok: false, reason: "invalid raufPin" };
  }
  if (typeof o.installedAt !== "string" || typeof o.updatedAt !== "string") {
    return { ok: false, reason: "missing timestamps" };
  }
  if (!Array.isArray(o.skills) || !o.skills.every((s) => typeof s === "string")) {
    return { ok: false, reason: "invalid skills[]" };
  }
  if (!Array.isArray(o.files)) return { ok: false, reason: "invalid files[]" };
  for (const f of o.files) {
    if (typeof f !== "object" || f === null) return { ok: false, reason: "invalid files[] entry" };
    const ff = f as Record<string, unknown>;
    if (typeof ff.path !== "string") return { ok: false, reason: "files[].path not a string" };
    if (ff.sha256 !== undefined && typeof ff.sha256 !== "string") {
      return { ok: false, reason: "files[].sha256 not a string" };
    }
  }
  if (o.link !== undefined) {
    const l = o.link as Record<string, unknown>;
    if (typeof l !== "object" || l === null || typeof l.target !== "string") {
      return { ok: false, reason: "invalid link" };
    }
  }
  // Cross-field: symlink ⇒ link present; copy ⇒ link absent (D8 invariant).
  if (o.mode === "symlink" && o.link === undefined) {
    return { ok: false, reason: "symlink mode manifest missing link.target" };
  }
  if (o.mode === "copy" && o.link !== undefined) {
    return { ok: false, reason: "copy mode manifest must not carry link" };
  }
  return { ok: true, value: x as InstallManifest };
}
```

## 6. Uninstall removal policy — `planUninstall`

This module **owns the policy** that decides *what* uninstall removes (REQ-OPS-03, REQ-SAFE-01/02):
**remove exactly what the manifest records, never an untracked path.** It expresses that policy as a
pure, manifest-only `planUninstall` that returns an all-`"remove"` `PlannedAction`. The **execution**
of that plan — the containment-checked filesystem removal, empty-dir pruning, link-safe unlink, and
deletion of the manifest file — is `apply()` in `04-plan-and-apply.md` §5.3. So **05 owns the removal
POLICY (which paths); 04 owns the safe EXECUTION.** There is no separate `applyUninstall`.

```typescript
import { type Result, type InstallManifest, type PlannedAction, ok } from "./types.js";

/**
 * Compute the uninstall plan from a manifest (REQ-OPS-03, REQ-SAFE-01/02). PURE — no I/O, manifest
 * only; it does NOT consult the source bundle and never enumerates the live destination. Returns an
 * all-`"remove"` {@link PlannedAction}:
 *
 * Copy mode: one `{ relpath, action: "remove" }` per `manifest.files[].path`, in the manifest's
 * recorded order. Only manifest-recorded files are listed; anything the user added to the namespace
 * dir after install is untracked and is NEVER planned for removal (REQ-SAFE-01).
 *
 * Symlink mode (`manifest.mode === "symlink"` / `manifest.link` present): the plan is the single
 * synthetic `{ relpath: ".", action: "remove" }` for the namespace-dir link. apply() unlinks the
 * link and never recurses into the target (the repo `adapters/` source) — REQ-SAFE-02/REQ-SEC-03.
 *
 * A `null`/empty manifest yields an empty-files plan: apply() is a no-op and the CLI (§07) phrases it
 * "nothing to uninstall" (§6.5). `--dry-run` (REQ-OPS-05) prints this plan; a real run hands the
 * **same** `PlannedAction` to apply() (§04 §5.3).
 *
 * @param manifest the manifest read via {@link readManifest} (or `null`/empty ⇒ empty-files plan).
 */
export function planUninstall(manifest: InstallManifest): Result<PlannedAction> {
  const isSymlink = manifest.mode === "symlink" || manifest.link !== undefined;
  const files = isSymlink
    ? [{ relpath: ".", action: "remove" as const }]
    : manifest.files.map((f) => ({ relpath: f.path, action: "remove" as const }));
  return ok({
    agent: manifest.agent,
    scope: manifest.scope,
    mode: manifest.mode,
    destination: manifest.destination,
    files,
  });
}
```

### Execution (delegated to 04)

The `PlannedAction` `planUninstall` returns is executed by `apply()` in `04-plan-and-apply.md` §5.3,
which is link-safe:

- **Symlink mode** (the single `{ relpath: ".", action: "remove" }`): apply `lstat`s the namespace
  dir and `unlink`s the **link only** — it never recurses into or `rm -rf`s through the link to the
  repo `adapters/` target (REQ-SAFE-02/REQ-SEC-03).
- **Copy mode**: apply removes exactly the recorded files (each `resolveWithin`-containment-checked),
  prunes now-empty dirs (`removeEmptyDirsWithin`), drops the now-empty namespace dir, then deletes
  the manifest file. Untracked user files keep their parent (and surviving ancestors) alive
  (REQ-SAFE-01).

So this module decides *which* paths are removed; `04` performs the *how* under the sandbox. Failures
are returned, not thrown (REQ-OBS-02/03); the CLI (§07) applies the per-agent partial-failure rule.

### 6.1 Copy-mode removal exactness (REQ-SAFE-01)

The plan's `"remove"` actions are built **solely** from `manifest.files[].path`. The installer never
enumerates the live destination to decide what to delete, so:

- A skill file the user **added** after install is not in `files[]` → not planned for removal.
- A file the installer wrote and the user later **deleted** → `apply()`'s `removePath` treats `ENOENT`
  as a no-op success (already gone), not an error.

After `apply()` removes the recorded files, only empty directories are pruned, and the namespace dir is
removed **only if it ends up empty**. If any untracked user file remains anywhere under the namespace
dir, that dir (and its surviving ancestors) are left in place. This is what satisfies "uninstall
removes EXACTLY the manifest-recorded files/dir, leaving unrelated user files + untracked skills
untouched."

### 6.2 Symlink-mode removal (REQ-SAFE-02)

When `mode === "symlink"`, the namespace dir *is* a symlink into the read-only source bundle (D8).
The plan's only action is the synthetic `{ relpath: ".", action: "remove" }` for the link itself, and
`apply()` (§04 §5.3) `unlink`s the **link** and never the **target**. There are no per-file entries
to iterate (`files: []`, §3.3).

### 6.3 Symlink unlink safety (REQ-SEC-03, REQ-SAFE-02)

The link-safe removal is `apply()`/`removePath` in `04-plan-and-apply.md` (§5.3, §7.3). On the
symlink-mode uninstall plan it MUST:

1. `lstat` the path (NOT `stat`) so it inspects the **link**, not the link's target.
2. Seeing a symbolic link, `fs.unlink` the **link only** — never follow it; if the path is a real
   directory (e.g. a copy install mislabeled, or a user replacement), it is removed per its actual
   mode rather than `rm -rf`'d through a link.
3. Never `fs.rm(path, { recursive: true })` *through* a symlink, because that would delete the link's
   *contents* (the repo `adapters/` source).

This module relies on that contract; the behavior is specified and tested in `04-plan-and-apply.md`,
and re-asserted by this module's test (§Verification) which checks the source bundle survives a
symlink uninstall.

### 6.4 Manifest removal ordering

`apply()` (§04 §5.3) removes the manifest file **last**, after the install content. If removal fails
partway (e.g. a permission error on one file), the manifest still exists and still describes the
install, so a re-run's `readManifest` → `planUninstall` → `apply()` retries exactly the remaining
work. Removing the manifest first would orphan any not-yet-removed install files (they would become
untracked and thus unremovable by a subsequent uninstall — REQ-SAFE-01 would then leave them
forever).

### 6.5 No manifest = nothing to uninstall

The uninstall caller (cli.ts/§07) calls `readManifest` first. `ok(null)` (no manifest) means the
agent is not installed for this scope: report "not installed — nothing to remove" (not an error;
REQ-OBS-01). `err(MANIFEST_CORRUPT)` is surfaced actionably (the user can remove the corrupt file
manually). `planUninstall` (and its `apply()` execution) is only reached with a valid manifest.

## 7. Sufficiency for `list` / `update` (REQ-SAFE-03)

The manifest is the **sole** record `list` and `update` use to tell installer-written content from
user content and to detect drift. This module guarantees it carries enough:

- **`sourceHash`** — `list`/`update` compare it against `hash.ts`'s current `sha256Tree` of the
  bundle to report up-to-date vs. out-of-date (drift at the bundle level).
- **per-file `sha256`** (copy mode) — `update`'s planner (§04) compares each destination file's
  current hash against the recorded one to classify `unchanged` / `overwrite` / `skip-modified`
  (local-modification detection, REQ-IDEM-02).
- **`mode`** + **`link.target`** — tells `list`/`update`/`uninstall` whether to reason per-file
  (copy) or per-link (symlink).
- **`files[]` / `skills[]`** — the authoritative inventory `update` uses for orphan removal (a skill
  recorded but no longer in canon is `remove`d — REQ-OPS-02) and `uninstall` uses for exact removal
  (§6).

This module only **produces and persists** that data; the comparison logic lives in `03` (hashing)
and `04` (planner). Cross-references: `03-source-and-hashing.md`, `04-plan-and-apply.md`.

## 8. Error handling summary

| Operation | Failure | Result |
|-----------|---------|--------|
| `readManifest` | file absent (`ENOENT`) | `ok(null)` — not an error |
| `readManifest` | unreadable (perm) | `err(MANIFEST_CORRUPT)` + path + remedy |
| `readManifest` | invalid JSON | `err(MANIFEST_CORRUPT)` (`JSON.parse` in `try/catch`) |
| `readManifest` | failed shape/version validation | `err(MANIFEST_CORRUPT)` + reason |
| `writeManifest` | permission denied (`EACCES`/`EPERM`) | `err(WRITE_DENIED)` + path + remedy |
| `writeManifest` | other I/O failure | `err(UNEXPECTED)` + path (temp file cleaned up) |
| `apply()` (§04, executes the plan) | per-file/link removal failure | propagated `err` (`WRITE_DENIED`/`PATH_ESCAPE`/…) |
| `apply()` (§04, executes the plan) | recorded file already gone | no-op success (`removePath` treats `ENOENT` as removed) |
| `apply()` (§04, executes the plan) | symlink path is not a link | removed per its actual mode, never `rm -rf` through a link (§6.3) |

All errors are structured `InstallerError` values (no throws for expected errors). `buildManifest`,
`planUninstall`, and `validateManifest` are pure and cannot fail with I/O errors. The execution of the
uninstall plan (and its error handling) lives in `apply()` (`04-plan-and-apply.md` §5.3).

## Dependencies

Implement these first:

- **`00-core-definitions.md`** — `InstallManifest`, `ManifestFile`, `SCHEMA_VERSION`,
  `MANIFEST_PREFIX`, `Scope`, `Mode`, `AgentId`, `AGENT_TARGETS`, `Result`/`ok`/`err`,
  `InstallerError`/`ErrorCode` (codes `MANIFEST_CORRUPT`, `WRITE_DENIED`, `PATH_ESCAPE`,
  `UNEXPECTED`). **Imported, not redefined.**
- **`02-agent-detection-map.md`** — `destinationFor(AGENT_TARGETS[agent], scope, opts)` and
  `ResolveOpts`; `manifestPath` derives the manifest location from the resolved namespace-dir
  `destination`.
- **`04-plan-and-apply.md`** — `apply()` executes the `planUninstall` plan (§5.3): containment-checked
  removal of the recorded files, empty-dir pruning (`removeEmptyDirsWithin`), link-safe unlink, then
  deletion of the manifest file. This module supplies the removal POLICY (the all-`"remove"` plan);
  `apply()` performs the safe EXECUTION. (`apply.ts` is also the **caller** of
  `buildManifest`/`writeManifest` on install/update.)

Soft references (data only; no import-order dependency):

- **`03-source-and-hashing.md`** — `sourceHash` and per-file `sha256` values are produced by `hash.ts`
  and passed in via `BuildManifestArgs`; this module stores them.
- **`06-rauf-provisioning.md`** — `raufPin` value is produced by `rauf.ts`; this module stores it.

## Verification

An implementation matches this spec iff:

- [ ] `src/manifest.ts` exports `manifestPath`, `readManifest`, `writeManifest`, `buildManifest`,
      `planUninstall`, and the `BuildManifestArgs` type — named exports only — and imports all shared
      types from `./types.js` (none redefined).
- [ ] `planUninstall(manifest)` returns an all-`"remove"` `PlannedAction` — one
      `{ relpath, action: "remove" }` per `manifest.files[].path` in recorded order (copy mode); a
      single `{ relpath: ".", action: "remove" }` for the link in symlink mode; an empty-files plan
      for a `null`/empty manifest (apply is a no-op). It is pure (manifest only, no I/O).
- [ ] The uninstall plan's **execution is delegated to `04`'s `apply()`** (§5.3): there is no
      `applyUninstall`/`UninstallPlan` in this module.
- [ ] `manifestPath("claude","global",{home})` → `<home>/.claude/skills/.feature-forge.global.json`
      (parent-sibling of the namespace dir; identical formula for copy and symlink) and
      `manifestPath(...,"project",{cwd})` uses the cwd root with the `.project.json` suffix.
- [ ] `readManifest` returns `ok(null)` for an absent file, `err(MANIFEST_CORRUPT)` for invalid JSON
      and for a shape/`schemaVersion`-mismatch (with `JSON.parse` inside `try/catch`), and
      `ok(manifest)` for a valid one.
- [ ] `writeManifest` writes atomically (a `.tmp` then `rename`; no partial file observable) and
      returns `err(WRITE_DENIED)` on a permission failure (assert via a read-only sandbox dir).
- [ ] `buildManifest` sets `featureForgeVersion: null` always; preserves `previous.installedAt` on
      update and stamps a fresh `installedAt` otherwise; sorts `files`/`skills`; records `link` only
      when provided; emits `files: []` in symlink mode.
- [ ] **Uninstall exactness (REQ-SAFE-01):** seed an unrelated user file in the skills root and an
      untracked file inside the namespace dir → after `planUninstall` → `apply()` (§04 §5.3), every
      `files[]` entry and the manifest are gone, but both untracked files survive and the namespace
      dir survives iff it still holds an untracked file.
- [ ] **Symlink uninstall (REQ-SAFE-02/REQ-SEC-03):** a `mode:"symlink"` install with
      `link.target` → `planUninstall` yields `[{ relpath: ".", action: "remove" }]` and `apply()`
      removes the link (`lstat` confirms it was a symlink); the target bundle directory and its
      contents are fully intact afterward.
- [ ] **Manifest-last ordering (§6.4):** if a recorded-file removal fails, the manifest file still
      exists so a retry re-plans the remaining files.
- [ ] `tsc --noEmit` passes under `strict` + `noUncheckedIndexedAccess`; `node --test` exercises the
      above; `bash scripts/validate.sh` (feature-forge, step 8) builds + tests the module (C-2).
