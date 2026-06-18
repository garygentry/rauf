# 04 — Plan & Apply (the operations engine)

> Feature: `cross-agent-installer` (epic `agent-agnostic`, member 4 of 6). Target repo:
> **feature-forge** (`/home/gary/workspace/feature-forge`); specs/backlog/loop driven from **rauf**.
> Source of truth: `PRD.md` (v2) + `tech-spec.md` (v1) — esp. §3.3 (ops engine), §3.4
> (idempotency/conflict), §3.7 (security/sandboxing), §3.8 (cross-platform), D8 (symlink), D9 (gemini).
> Shared types come from `00-core-definitions.md` and are **never redefined here** — this doc imports
> `PlannedAction`, `FileAction`, `FileActionKind`, `Mode`, `Scope`, `AgentId`, `InstallManifest`,
> `ManifestFile`, `AgentReport`, `Result`, `InstallerError`, `ok`/`err`, and the constants
> `FEATURE_FORGE_NS` / `SCHEMA_VERSION`.
>
> This document owns three modules: the **pure planner** (`src/plan.ts`), the **apply engine**
> (`src/apply.ts`), and the **sandboxed filesystem primitives** (`src/fsutil.ts`). It is the heart of
> "dry-run = real run": the planner is a pure function that reads source/destination/manifest and emits
> a `PlannedAction`; `--dry-run` prints exactly that and stops; a real run hands the **identical**
> `PlannedAction` to `apply`.

## Requirement Coverage

| REQ ID | Requirement | Section |
|--------|-------------|---------|
| REQ-OPS-01 | install/add copies or symlinks the bundle into `<dest>/feature-forge/` | §4.1 `planInstall`, §5.1 copy flow, §5.2 symlink flow |
| REQ-OPS-02 | update reconciles: create new / overwrite changed / remove orphans (no `--force`; manifest-scoped) | §4.2 `planUpdate`, §6 action-decision table |
| REQ-OPS-03 | uninstall removes exactly manifest-recorded files/dir (apply mechanics; plan owned by 05) | §4.3 (plan cross-ref to 05), §5.3 remove flow |
| REQ-OPS-05 | `--dry-run` prints the exact plan, changes nothing; real run = same `PlannedAction` | §3 purity contract, §4 planner, §5 `apply` |
| REQ-OPS-07 | gemini: plain bundle copy lands a valid `gemini-extension.json` (D9, no gemini-only path) | §5.4 gemini outcome |
| REQ-IDEM-01 | no change ⇒ all `unchanged`, zero writes, "up to date" | §6 action table, §5 apply no-op |
| REQ-IDEM-02 | locally modified dest ⇒ `skip-modified` + report; never overwrite unless `--force`; untracked = skip | §6 action table rows 4–6 |
| REQ-IDEM-03 | clean-but-stale ⇒ refreshed by update, no `--force` | §6 action table row 2, §4.2 |
| REQ-FLAG-03 | `--symlink` links the whole namespace dir; copy default; Windows ALWAYS copies | §5.2, §7.2 `symlinkDir`, §4 mode resolution |
| REQ-FLAG-04 | `--force` overwrites skip-modified | §6 action table, §4 force handling |
| REQ-SEC-01 | write only within agent config dirs + manifest location; no elevation | §7.1 `resolveWithin`, §5 (all writes routed through fsutil) |
| REQ-SEC-02 | every destination `path.resolve`d + asserted within the agent root before ANY write | §7.1 `resolveWithin` (containment algorithm) |
| REQ-SEC-03 | symlink ops never follow a link to write/delete outside target (`lstat`+`unlink`, never `rm -rf` through a link) | §7.3 `removePath`, §5.3 remove flow |

## 1. Purpose & scope

`plan.ts` + `apply.ts` are the **operations engine** (tech-spec §3.3): a pure planner computes a
per-agent, per-file `PlannedAction`; an executor applies it. `fsutil.ts` supplies the only
filesystem primitives either touches — every one sandboxed (`path.resolve` + containment) so a
malformed agent id or a `..` segment cannot escape the agent root (REQ-SEC-02). The split exists so
that:

- **`--dry-run` is exactly the planner** (no writes). The plan it prints is the *same object* a real
  run executes (REQ-OPS-05). There is no second "dry-run code path" to drift.
- All idempotency/conflict decisions (REQ-IDEM-01/02/03, REQ-FLAG-04) are made **once**, in the
  planner, by diffing three inputs: source bytes, destination bytes, and the prior manifest's
  recorded `sha256` (tech-spec §3.4, OQ-4 → hashing not mtime).
- All mutation is funnelled through three primitives (`copyDir`, `symlinkDir`, `removePath`), each
  containment-checked, so REQ-SEC-01/02/03 are enforced in one place.

**Out of scope for this doc (owned elsewhere, cross-referenced):**

- The shared type definitions → `00-core-definitions.md`.
- Locating + integrity-checking the source bundle and `sha256File`/`sha256Tree` → `03-source-and-hashing.md`.
- Reading/writing the manifest JSON file (this doc *calls* it; the schema, file location, and
  parse/serialize live in `05-manifest-and-uninstall.md`). Uninstall **planning** (`planUninstall`,
  the all-`"remove"` plan) is owned by `05`; **this doc owns the apply mechanics** (`removePath`
  semantics, symlink unlink-not-recurse, empty-dir prune) that EXECUTE that plan (§5.3, §4.3).
- Detection (`detectAgent`) and `AGENT_TARGETS` path derivation → `02-agent-detection-map.md`.
- Rauf pin preflight → `06-rauf-provisioning.md`. The planner only *surfaces* `raufPin` on the plan.
- CLI dispatch, exit-code mapping, and rendering the `RunReport` → `07-cli-and-reporting.md`.

## 2. Imports

```typescript
// src/plan.ts and src/apply.ts both pull shared types from 00-core-definitions.md:
import type {
  AgentId, Scope, Mode, FileAction, FileActionKind, PlannedAction,
  InstallManifest, ManifestFile, AgentReport, InstallerError, Result,
} from "./types.js";
import { ok, err, FEATURE_FORGE_NS, SCHEMA_VERSION } from "./types.js";

// from 03-source-and-hashing.md:
import { sha256File, sha256Tree, listBundleFiles } from "./hash.js";
import { locateSource, type LocatedSource } from "./source.js";

// from 05-manifest-and-uninstall.md (planUninstall is the manifest-driven uninstall planner; §4.3):
import { readManifest, writeManifest, manifestPath, planUninstall } from "./manifest.js";

// this doc's own primitives:
import { resolveWithin, copyDir, symlinkDir, removePath, isWindows } from "./fsutil.js";
```

> If any of these expected exports is absent at implementation time, the implementer MUST surface it
> rather than guess. (At spec-authoring time the sibling docs `03`/`05` are being written in parallel;
> the names above are the contract this doc assumes from them — see **Warnings** in the manifest.)

## 3. The purity contract (REQ-OPS-05)

**`plan.ts` performs ZERO filesystem writes and ZERO network calls.** It is permitted to *read*:
source bundle bytes (via `03`), destination bytes (`fs.readFile`/`fs.lstat`), and the prior manifest
(via `05`'s `readManifest`, which is a read). It returns a `Result<PlannedAction>`. Every mutation
lives in `apply.ts` and goes through `fsutil.ts`.

This is the load-bearing guarantee behind Success Criterion "`--dry-run` prints the exact planned
actions and changes nothing; a real run then performs exactly those actions": the CLI (`07`) calls
`plan*(…)` for both modes; under `--dry-run` it renders the plan and returns; otherwise it passes the
*same* `PlannedAction` to `apply`.

```typescript
// Conceptual call shape in cli.ts (full version in 07-cli-and-reporting.md):
const planned = planInstall(ctx);                 // pure
if (!planned.ok) return reportError(planned.error);
if (flags.dryRun) return renderPlan(planned.value); // prints; writes nothing
const report = await apply(planned.value, applyCtx); // executes the SAME object
```

## 4. Public API — the planner

The planner exposes three entry points (one per mutating subcommand). They share a planning context
type. A unified `plan(subcommand, ctx)` dispatcher is provided for the CLI but the three typed
functions are the canonical surface.

### Planning context

```typescript
/**
 * Everything the pure planner needs to diff source ⇆ destination ⇆ manifest for ONE agent.
 * Built by cli.ts (07) from CliFlags + the agent's resolved destination (02) + the located
 * source (03) + the prior manifest (05). The planner reads these; it writes nothing.
 */
export interface PlanContext {
  /** The agent being planned (REQ-FLAG-01 scopes to one; the CLI loops over all detected). */
  readonly agent: AgentId;
  /** Active scope (REQ-FLAG-02). Encoded in the manifest filename (05) and copied onto the plan. */
  readonly scope: Scope;
  /**
   * Resolved materialization mode (REQ-FLAG-03). MUST already account for Windows: the CLI sets
   * this to "copy" on Windows even when --symlink was passed (see resolveMode, below). The planner
   * trusts it; the Windows override is not re-decided here.
   */
  readonly mode: Mode;
  /**
   * Absolute path of the namespace dir to be governed: `<installSubdir>/feature-forge/`.
   * Derived by 02 from AGENT_TARGETS + scope roots; the manifest's `destination` field.
   */
  readonly destination: string;
  /**
   * The located, integrity-checked source bundle for this agent (03). `null` means the bundle is
   * absent/invalid — the planner returns a SOURCE_MISSING/SOURCE_INVALID error (REQ-OPS-06) so the
   * CLI reports it and proceeds with other agents (REQ-OBS-03). 03 owns the integrity check; the
   * planner only reacts to its absence.
   */
  readonly source: LocatedSource | null;
  /** The prior manifest for this destination, or `null` if none exists (fresh install). From 05. */
  readonly priorManifest: InstallManifest | null;
  /** `--force` (REQ-FLAG-04): overwrite `skip-modified` destinations instead of skipping. */
  readonly force: boolean;
  /** The pinned rauf coordinate to surface on the plan (06); the planner only echoes it. */
  readonly raufPin?: string | null;
}
```

`LocatedSource` (defined in `03`) is assumed to expose at least:

```typescript
// Provided by 03-source-and-hashing.md — referenced, NOT defined here.
export interface LocatedSource {
  /** Absolute path to the agent bundle root (e.g. .../adapters/claude). */
  readonly root: string;
  /** sha256 over the bundle's sorted-path file set — the drift anchor (manifest.sourceHash). */
  readonly sourceHash: string;
  /** Installed skill ids (the bundle's `skills/*` dir names) for manifest.skills. */
  readonly skills: readonly string[];
  /** Bundle-relative file inventory: POSIX relpath + content sha256, sorted — the set the planner walks. */
  readonly files: ReadonlyArray<{ readonly relpath: string; readonly sha256: string }>;
}
```

### 4.1 `planInstall` (REQ-OPS-01, REQ-OPS-05, REQ-IDEM-01/02)

```typescript
/**
 * PURE. Compute the install plan for one agent by diffing the source bundle against the
 * destination and the prior manifest. Writes nothing.
 *
 * Decision summary (full table in §6):
 *  - destination file absent           → "create"
 *  - dest matches what we'd write       → "unchanged" (REQ-IDEM-01)
 *  - dest is a clean prior file but src changed → "overwrite" (treated like update; REQ-IDEM-03)
 *  - dest drifted from recorded hash    → "skip-modified" (REQ-IDEM-02) unless `force` → "overwrite"
 *  - dest exists but no manifest tracks it (user content) → "skip-modified" unless `force`
 *
 * Symlink mode produces a single synthetic FileAction for the namespace dir (see §6 note).
 *
 * @param ctx - the per-agent planning context
 * @returns ok(PlannedAction) on success; err(InstallerError) for SOURCE_MISSING/SOURCE_INVALID
 *          (REQ-OPS-06) — the CLI reports and continues with other agents (REQ-OBS-03).
 */
export function planInstall(ctx: PlanContext): Result<PlannedAction>;
```

### 4.2 `planUpdate` (REQ-OPS-02, REQ-IDEM-03)

```typescript
/**
 * PURE. Compute the update/reconcile plan for one agent. Identical to planInstall for the
 * create/overwrite/unchanged/skip-modified decisions, PLUS orphan removal:
 *
 *  - any path in `priorManifest.files` that the current source no longer contains → "remove"
 *    (REQ-OPS-02). Orphan removal is MANIFEST-SCOPED: only installer-written paths (those in the
 *    manifest) are ever removed; untracked user files are never planned for removal.
 *  - a clean-but-stale install (manifest.sourceHash ≠ current sourceHash, all dest files clean)
 *    refreshes WITHOUT --force (REQ-IDEM-03): changed files become "overwrite", new ones "create".
 *
 * If there is no prior manifest, planUpdate behaves exactly like planInstall (an update of a
 * not-yet-installed agent is a first install).
 *
 * @returns ok(PlannedAction); err for SOURCE_MISSING/SOURCE_INVALID (REQ-OPS-06).
 */
export function planUpdate(ctx: PlanContext): Result<PlannedAction>;
```

### 4.3 Uninstall — planning in `05`, execution here (REQ-OPS-03)

Uninstall **planning** is NOT defined here. `planUninstall(manifest)` — pure, manifest-driven,
returning an all-`"remove"` `PlannedAction` — is owned by `05-manifest-and-uninstall.md` (§6): one
`"remove"` per recorded `files[].path` in copy mode, the single synthetic `{ relpath: ".", action:
"remove" }` in symlink mode, an empty-files plan for a `null`/empty manifest. This doc owns only the
**execution** side: the all-`"remove"` plan `05` produces is handed to `apply()` here (§5.3), which is
link-safe — copy mode removes exactly the recorded files (each containment-checked) and prunes empty
dirs; symlink mode `lstat`+`unlink`s the link and never recurses into the repo `adapters/` target
(REQ-SAFE-02/REQ-SEC-03). So `05` owns the removal POLICY (which paths); this doc owns the safe
EXECUTION.

### Unified dispatcher

```typescript
/**
 * Convenience dispatcher used by cli.ts (07). Routes install/update to the typed planner above;
 * `uninstall` delegates to `planUninstall`, which is IMPORTED from 05 (it is manifest-driven — it
 * takes the prior manifest, not the PlanContext — so this case reads `ctx.priorManifest`). The
 * de-facto orchestration in 07 calls `planUninstall(manifest)` directly; this dispatcher exists only
 * for symmetry.
 */
export function plan(
  subcommand: "install" | "update" | "uninstall",
  ctx: PlanContext,
): Result<PlannedAction> {
  switch (subcommand) {
    case "install": return planInstall(ctx);
    case "update": return planUpdate(ctx);
    case "uninstall":
      // planUninstall (05) is manifest-only; an absent prior manifest ⇒ empty-files plan (no-op).
      return ctx.priorManifest === null
        ? ok({ agent: ctx.agent, scope: ctx.scope, mode: ctx.mode, destination: ctx.destination, files: [] })
        : planUninstall(ctx.priorManifest);
  }
}
```

### Mode resolution (Windows override — REQ-FLAG-03)

The Windows-always-copies rule is applied **before** building `PlanContext.mode`, so the planner and
apply never re-decide it. A tiny helper makes the rule explicit and testable:

```typescript
/**
 * Resolve the effective materialization mode (REQ-FLAG-03, D8). `--symlink` requests symlink, but
 * Windows ALWAYS copies (symlink is not assumed available). Called by cli.ts (07) when assembling
 * each PlanContext. Pure.
 *
 * @param wantSymlink - whether `--symlink` was passed
 * @param windows - platform check (defaults to isWindows(); injectable for tests)
 */
export function resolveMode(wantSymlink: boolean, windows = isWindows()): Mode {
  return wantSymlink && !windows ? "symlink" : "copy";
}
```

## 5. Public API — `apply`

```typescript
/**
 * Execute one agent's PlannedAction against the filesystem, then write the manifest. Returns an
 * AgentReport instead of throwing: a failure (write denied, path escape) yields { ok:false, error }
 * WITHOUT throwing, so the caller can continue with the other agents (REQ-OBS-03; the per-agent
 * partial-failure rule lives in 07).
 *
 * Behavior by mode:
 *  - "copy":    for each non-"unchanged"/non-"skip-modified" FileAction, copy or remove the file via
 *               fsutil; record a per-file sha256; then write the manifest (05) with files[] inventory.
 *  - "symlink": link the whole namespace dir → source bundle (D8) via symlinkDir; record
 *               manifest.link.target = source root and files[] with NO sha256 (00 §3 ManifestFile);
 *               on uninstall, removePath unlinks the dir (never recurses — REQ-SAFE-02/REQ-SEC-03).
 *
 * A plan whose actions are ALL "unchanged" performs ZERO writes and still reports "up to date"
 * (REQ-IDEM-01) — the manifest is NOT rewritten when nothing changed (updatedAt is preserved).
 *
 * @param planned - the EXACT PlannedAction the planner produced (REQ-OPS-05 — dry-run = real run)
 * @param ctx - apply-time context (resolved roots for containment, the source, timestamps)
 * @returns AgentReport — ok:true with the actions performed, or ok:false + InstallerError.
 */
export async function apply(planned: PlannedAction, ctx: ApplyContext): Promise<AgentReport>;

/**
 * Apply-time context for ONE agent. The agentRoot is the containment boundary every write is checked
 * against (REQ-SEC-02): the resolved `<scopeRoot>/<configDirName>` (from 02). `destination` is the
 * namespace dir; `manifestPath` is the parent-sibling hidden file (05). `source` supplies bytes
 * (copy mode) / the link target (symlink mode).
 */
export interface ApplyContext {
  readonly agent: AgentId;
  readonly scope: Scope;
  readonly mode: Mode;
  /** Containment boundary for REQ-SEC-02: the agent's config root (e.g. <home>/.claude). */
  readonly agentRoot: string;
  /** The `feature-forge/` namespace dir (manifest.destination). */
  readonly destination: string;
  /** Hidden parent-sibling manifest path, from 05 `manifestPath`. */
  readonly manifestPath: string;
  /** Located source bundle (copy bytes / symlink target). null only for uninstall. */
  readonly source: LocatedSource | null;
  /** Pinned rauf coordinate to record in the manifest (06); null under --skip-rauf. */
  readonly raufPin: string | null;
  /** ISO-8601 "now" (injectable for deterministic tests). */
  readonly now: string;
  /** Prior manifest (for preserving installedAt across updates). */
  readonly priorManifest: InstallManifest | null;
}
```

### 5.1 Copy flow (REQ-OPS-01, REQ-OPS-02, REQ-IDEM-01) [D5]

For `mode === "copy"`, `apply` walks `planned.files` in order:

1. **Resolve + contain** each `relpath` against `agentRoot` via `resolveWithin(agentRoot, destination, relpath)` (§7.1). A `PATH_ESCAPE` aborts *this agent only* with an error (REQ-SEC-02).
2. Dispatch by `action`:
   - `"create"` / `"overwrite"` → ensure parent dir, copy the source file's bytes to the resolved dest, compute `sha256File(dest)`, push `{ path: relpath, sha256 }` to the inventory.
   - `"remove"` → `removePath(resolvedDest)` (a real file — `unlink`); do **not** add to inventory.
   - `"unchanged"` → no write; carry the existing `{ path, sha256 }` from `priorManifest` into the new inventory (so re-writing the manifest is faithful — but see no-op short-circuit below).
   - `"skip-modified"` → no write; record nothing new; the file is reported (REQ-IDEM-02). It stays in the inventory only if it was already a tracked file.
3. After the file loop, write the manifest (§5.5) — **unless** every action was `"unchanged"` (no-op short-circuit; REQ-IDEM-01: zero writes, manifest untouched).

> **Per-file copy granularity.** Copy mode copies file-by-file (not a blind `copyDir`) precisely so
> `skip-modified` files can be left in place while siblings are refreshed, and so each written file
> gets a recorded `sha256`. `copyDir` (§7.2) is used only for the bulk first-install fast path where
> the destination namespace dir does not yet exist (all actions `"create"`), after which the inventory
> is built by hashing the copied tree. Either way the recorded inventory matches the plan.

### 5.2 Symlink flow (REQ-FLAG-03, D8)

For `mode === "symlink"` (never reached on Windows — `resolveMode` already forced copy):

1. `resolveWithin(agentRoot, destination)` — the link path must be inside the agent root (REQ-SEC-02).
2. If a prior namespace dir/link exists, `removePath` it first (`lstat` → unlink-link / rm-real-dir; §7.3) — never follow a link to delete its target (REQ-SAFE-02/REQ-SEC-03).
3. `symlinkDir(source.root, destination)` (§7.2) — link the **whole** namespace dir to the source bundle root (D8). On any platform where the symlink syscall fails (EPERM/ENOSYS/EEXIST-after-clean), `symlinkDir` falls back to a recursive copy and signals copy-fallback so `apply` records `mode: "copy"` in the manifest (truthful record).
4. Manifest: `files` lists the bundle-relative paths with `sha256` **omitted** (no per-file copy exists — `00` §3 `ManifestFile.sha256` is optional); `link: { target: source.root }`; `mode: "symlink"` (or `"copy"` if the fallback fired).

### 5.3 Remove flow (uninstall — REQ-OPS-03, REQ-SAFE-02, REQ-SEC-03)

Uninstall is `apply` over a plan whose actions are all `"remove"`:

- **Copy install:** for each `relpath`, `resolveWithin(agentRoot, destination, relpath)` then `removePath` (real file → `unlink`). After the recorded files are gone, `removeEmptyDirsWithin(destination, agentRoot)` (§7) prunes any now-empty intermediate dirs upward and drops the namespace dir **only if it ends up empty** — a surviving untracked user file keeps its parent (and ancestors) alive (REQ-SAFE-01). Then delete the manifest file via `05` (`writeManifest` deletion path / a `removeManifest` call). Untracked user files in the skills root are never touched (only manifest paths were planned).
- **Symlink install:** the plan is a single `"remove"` of the namespace dir. `removePath` does `lstat`; seeing a symlink it calls `fs.unlink` on the **link itself** and returns — it MUST NOT recurse into or `rm -rf` through the link (REQ-SAFE-02: the link's target is the repo's read-only `adapters/` source). Then delete the manifest.

### 5.4 Gemini outcome (REQ-OPS-07, D9 — no gemini-only code path)

There is **no gemini-specific branch** in `plan` or `apply`. Gemini's bundle carries
`gemini-extension.json` at its root (verified: `adapters/gemini/gemini-extension.json`), and the
agent's `installSubdir` is `extensions` (`00` §6 `AGENT_TARGETS`), so the namespace dir
`<...>/.gemini/extensions/feature-forge/` **is** the extension dir. A plain bundle copy (or symlink)
therefore lands a valid, loadable `gemini-extension.json` at the destination — REQ-OPS-07 is
satisfied by the generic copy flow (§5.1) treating `gemini-extension.json` as just another file in
`source.files`. The integrity check that the manifest is present is `03`'s
`BUNDLE_REQUIRED_PATHS.perAgent.gemini` (`00` §6), enforced before planning; apply does not re-check.

### 5.5 Manifest write (delegates to `05`)

```typescript
// apply builds the manifest object then delegates serialization/atomic-write to 05:
const manifest: InstallManifest = {
  schemaVersion: SCHEMA_VERSION,
  agent: ctx.agent,
  scope: ctx.scope,
  mode: effectiveMode,                 // "copy" if symlink fell back
  destination: ctx.destination,
  featureForgeVersion: null,           // null today — bundles carry no version (00 §3, OQ-A/IR-1)
  sourceHash: ctx.source!.sourceHash,  // copied from LocatedSource (03)
  raufPin: ctx.raufPin,
  installedAt: ctx.priorManifest?.installedAt ?? ctx.now,
  updatedAt: ctx.now,
  skills: ctx.source!.skills,
  files: inventory,                    // built above; sha256 omitted in symlink mode
  ...(effectiveMode === "symlink" ? { link: { target: ctx.source!.root } } : {}),
};
const wrote = await writeManifest(ctx.manifestPath, manifest); // 05 owns atomic write
if (!wrote.ok) return { agent: ctx.agent, detected: true, ok: false,
                        actions: planned.files, error: wrote.error };
```

`writeManifest` (owned by `05`) is responsible for the atomic write (`.tmp` → rename) and JSON
serialization; this doc only constructs the object and reacts to its `Result`.

## 6. Internal implementation — the action-decision table

The planner assigns each `FileActionKind` by comparing three facts per bundle-relative path:

- **S** = the source file's content hash — read directly from `source.files[].sha256` (the
  `{ relpath, sha256 }` inventory `03` already computed), so the planner need not re-hash the bundle.
- **D** = the destination file's current content hash (`sha256File` on the dest, or *absent*).
- **M** = the `sha256` recorded for this path in `priorManifest.files` (or *absent*).

| # | Source (S) | Dest (D) | Manifest (M) | Action | Rationale (REQ) |
|---|-----------|---------|-------------|--------|-----------------|
| 1 | present | absent | — | `create` | new file to write (REQ-OPS-01/02) |
| 2 | S ≠ M | present, **D = M** | present | `overwrite` | clean prior file, source changed → refresh; no `--force` (REQ-IDEM-03) |
| 3 | S = D | present | present (D = M or not) | `unchanged` | dest already equals source → no write (REQ-IDEM-01) |
| 4 | S ≠ D | present, **D ≠ M** | present | `skip-modified` (→ `overwrite` if `--force`) | locally modified tracked file (REQ-IDEM-02/REQ-FLAG-04) |
| 5 | S ≠ D | present | **absent** | `skip-modified` (→ `overwrite` if `--force`) | untracked = user content; never clobber (REQ-IDEM-02) |
| 6 | absent | present | present | `remove` | orphan: manifest tracked it, canon dropped it (REQ-OPS-02, update only) |
| 7 | absent | present | absent | *(not planned)* | untracked user file unrelated to us → never touched (REQ-IDEM-02) |

Notes:

- **Row 3 wins over rows 2/4** when `S = D`: a destination that already matches the source is
  `unchanged` regardless of what the manifest records (idempotent re-run with a hand-edit that happens
  to reproduce canon). This is why the planner computes `D` and compares to `S` first.
- **Row 2 vs row 4** turns on `D = M`: a *clean* prior file (`D = M`) whose source moved on is a safe
  `overwrite` (REQ-IDEM-03 — update refreshes without `--force`); a *drifted* file (`D ≠ M`) is
  `skip-modified` (REQ-IDEM-02) unless `--force` promotes it to `overwrite`.
- **Row 6 (`remove`) is emitted only by `planUpdate`** (and the all-remove `planUninstall`), never by
  `planInstall`. It is **manifest-scoped**: the candidate `remove` set is exactly
  `priorManifest.files` minus the current `source.files` — untracked files (row 7) are unreachable.
- **`planUninstall`** ignores S entirely: every `M` path → `remove` (REQ-OPS-03).

### Symlink-mode plan shape

In symlink mode the per-file diff is **not** performed. The plan is a single synthetic `FileAction`
for the namespace dir:

```typescript
// symlink-mode planInstall/planUpdate produces:
const files: FileAction[] = [{
  relpath: ".",                       // the namespace dir itself
  action: priorIsLiveSymlinkToSameTarget ? "unchanged"
        : priorExists ? (force ? "overwrite" : "skip-modified")
        : "create",
}];
```

`priorIsLiveSymlinkToSameTarget` is decided from `priorManifest.link?.target === source.root` (the
`05` manifest read) — no `readlink` is needed for the plan, keeping the planner pure and instant
(REQ-PERF-01). Symlink uninstall is `[{ relpath: ".", action: "remove" }]`.

### Decision implementation (per-file, copy mode)

```typescript
/**
 * Classify one bundle-relative path. PURE: hashes are read, nothing is written.
 * @param relpath   bundle-relative POSIX path
 * @param srcHash   sha256 of the source file (S)
 * @param destHash  sha256 of the destination file, or undefined if absent (D)
 * @param manifestHash sha256 recorded for this path in the prior manifest, or undefined (M)
 * @param force     whether --force promotes skip-modified → overwrite
 */
export function classifyFile(
  relpath: string,
  srcHash: string,
  destHash: string | undefined,
  manifestHash: string | undefined,
  force: boolean,
): FileActionKind {
  if (destHash === undefined) return "create";          // row 1
  if (destHash === srcHash) return "unchanged";          // row 3
  // dest exists and differs from source:
  const clean = manifestHash !== undefined && destHash === manifestHash;
  if (clean) return "overwrite";                         // row 2 (REQ-IDEM-03)
  return force ? "overwrite" : "skip-modified";          // rows 4/5 (REQ-IDEM-02/REQ-FLAG-04)
}
```

Orphan detection (update only) is computed separately, over the set difference:

```typescript
/** Paths in the prior manifest that the current source no longer contains → "remove" (row 6). */
function orphanRemovals(
  priorFiles: ManifestFile[],
  sourceFiles: ReadonlyArray<{ relpath: string; sha256: string }>, // LocatedSource["files"]
): FileAction[] {
  const inSource = new Set(sourceFiles.map((f) => f.relpath));
  return priorFiles
    .filter((f) => !inSource.has(f.path))
    .map((f) => ({ relpath: f.path, action: "remove" as const }));
}
```

## 7. Public API — `fsutil.ts` (sandboxed primitives)

Every filesystem mutation in `apply` goes through these primitives. They are the single place
REQ-SEC-01/02/03 are enforced. All use `node:fs/promises`, `node:path`, `node:os` (REQ-FLAG-03/C-6
cross-platform — no shelling out). `fsutil.ts` exports `resolveWithin`, `copyDir`, `symlinkDir`,
`removePath`, `isWindows` (§7.1–7.4) for `apply`'s own flow, plus `removeEmptyDirsWithin` (§7.5) which
`apply`'s copy-mode uninstall (§5.3) uses to prune empty dirs after removing the recorded files.

```typescript
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import type { Result } from "./types.js";
import { ok, err } from "./types.js";
```

### 7.1 `resolveWithin` — containment (REQ-SEC-02)

```typescript
/**
 * Resolve `segs` against `root` and assert the result lies WITHIN `root` (REQ-SEC-02). Returns the
 * resolved absolute path on success, or a PATH_ESCAPE InstallerError if a `..` segment or a
 * malformed agent id would escape the agent config root. MUST be called before ANY write/delete.
 *
 * Algorithm:
 *   1. const base = path.resolve(root);
 *   2. const target = path.resolve(base, ...segs);   // collapses `..`/`.`
 *   3. const rel = path.relative(base, target);
 *   4. inside iff rel === "" OR (!rel.startsWith("..") AND !path.isAbsolute(rel));
 *      (path.relative + the ".." prefix test is the robust boundary check — a bare startsWith on the
 *       string prefix would false-pass `/root-evil`; using path.relative avoids that.)
 *
 * @param root - the containment boundary (the agent config root, e.g. <home>/.claude)
 * @param segs - path segments to join under root (destination, then a bundle-relative path)
 * @returns ok(absolutePath) if inside; err(PATH_ESCAPE) otherwise.
 *
 * @example
 *   resolveWithin("/home/u/.claude", "skills/feature-forge", "forge/SKILL.md")  // ok
 *   resolveWithin("/home/u/.claude", "skills/feature-forge", "../../etc/x")      // err PATH_ESCAPE
 */
export function resolveWithin(root: string, ...segs: string[]): Result<string> {
  const base = path.resolve(root);
  const target = path.resolve(base, ...segs);
  const rel = path.relative(base, target);
  const inside = rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  if (!inside) {
    return err({
      code: "PATH_ESCAPE",
      message: `refusing to write outside the agent config root: resolved "${target}" escapes "${base}"`,
      path: target,
      remedy: "this indicates a malformed agent id or path segment; report it as a bug",
    });
  }
  return ok(target);
}
```

### 7.2 `copyDir` & `symlinkDir`

```typescript
/**
 * Recursively copy `src` → `dest` (REQ-OPS-01 copy mode, C-6). Uses node:fs cp (recursive). The
 * CALLER is responsible for having containment-checked `dest` via resolveWithin first (REQ-SEC-02);
 * copyDir does not re-derive paths from untrusted input — it copies an already-validated dest.
 *
 * @returns ok(undefined) on success; err(WRITE_DENIED) on EACCES/EPERM (REQ-OBS-02), naming `dest`.
 */
export async function copyDir(src: string, dest: string): Promise<Result<void>> {
  try {
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.cp(src, dest, { recursive: true, force: true, dereference: false });
    return ok(undefined);
  } catch (e) {
    return err(toWriteError(e, dest));
  }
}

/**
 * Link the whole namespace dir `linkPath` → `target` (D8, REQ-FLAG-03). On Windows, OR if the
 * symlink syscall fails for any reason (EPERM/ENOSYS/UnsupportedOperation), FALL BACK to copyDir and
 * report it via the `mode` in the returned value so apply records the truthful mode.
 *
 * `target` is the read-only source bundle; the link points INTO it. Uninstall later unlinks the link
 * (never the target) — see removePath (REQ-SAFE-02/REQ-SEC-03).
 *
 * @returns ok({ mode }) where mode is "symlink" (link created) or "copy" (fallback fired);
 *          err(WRITE_DENIED) if even the copy fallback fails.
 */
export async function symlinkDir(
  target: string,
  linkPath: string,
): Promise<Result<{ mode: "symlink" | "copy" }>> {
  if (isWindows()) {
    const copied = await copyDir(target, linkPath);
    return copied.ok ? ok({ mode: "copy" }) : err(copied.error);
  }
  try {
    await fsp.mkdir(path.dirname(linkPath), { recursive: true });
    // "dir" junction type matters on Windows; harmless elsewhere (only reached off-Windows here).
    await fsp.symlink(target, linkPath, "dir");
    return ok({ mode: "symlink" });
  } catch {
    // symlink unsupported / not permitted → copy fallback (REQ-FLAG-03: never assume symlink).
    const copied = await copyDir(target, linkPath);
    return copied.ok ? ok({ mode: "copy" }) : err(copied.error);
  }
}
```

### 7.3 `removePath` — link-safe deletion (REQ-SEC-03, REQ-SAFE-02)

```typescript
/**
 * Remove `p` safely (REQ-SEC-03/REQ-SAFE-02). The KEY rule: NEVER follow a symlink to delete its
 * target. Uses `lstat` (which does not dereference) to distinguish:
 *   - a symbolic link        → fs.unlink(p)            (removes the LINK only; target untouched)
 *   - a real directory       → fs.rm(p, {recursive})   (removes the real tree)
 *   - a real file            → fs.unlink(p)
 *   - ENOENT (already gone)  → ok (idempotent removal)
 *
 * The CALLER must have containment-checked `p` via resolveWithin first (REQ-SEC-02). removePath
 * never recurses THROUGH a link, so a symlinked namespace dir pointing at the repo `adapters/` source
 * can never cause deletion of the source (REQ-SAFE-02).
 *
 * @returns ok(undefined) on success or already-absent; err(WRITE_DENIED) on EACCES/EPERM.
 */
export async function removePath(p: string): Promise<Result<void>> {
  let st;
  try {
    st = await fsp.lstat(p);          // lstat: does NOT dereference the link
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return ok(undefined);
    return err(toWriteError(e, p));
  }
  try {
    if (st.isSymbolicLink()) {
      await fsp.unlink(p);            // remove the LINK only — never the target (REQ-SAFE-02)
    } else if (st.isDirectory()) {
      await fsp.rm(p, { recursive: true, force: true });
    } else {
      await fsp.unlink(p);
    }
    return ok(undefined);
  } catch (e) {
    return err(toWriteError(e, p));
  }
}
```

### 7.4 `isWindows` & error mapping

```typescript
/** Platform check (REQ-FLAG-03, C-6). Centralized so resolveMode/symlinkDir share one decision. */
export function isWindows(): boolean {
  return os.platform() === "win32";
}

/**
 * Map a caught fs exception to an actionable InstallerError (REQ-OBS-02). EACCES/EPERM → WRITE_DENIED
 * with a "no write permission to <path>" remedy; anything else → UNEXPECTED carrying the message.
 * Internal helper (not exported as public surface).
 */
function toWriteError(e: unknown, p: string): InstallerError {
  const code = (e as NodeJS.ErrnoException)?.code;
  if (code === "EACCES" || code === "EPERM") {
    return {
      code: "WRITE_DENIED",
      message: `no write permission to ${p}`,
      path: p,
      remedy: "check directory permissions, or choose a different scope (--global vs project)",
    };
  }
  return {
    code: "UNEXPECTED",
    message: `filesystem error at ${p}: ${(e as Error)?.message ?? String(e)}`,
    path: p,
  };
}
```

### 7.5 Empty-dir prune (used by `apply`'s copy-mode uninstall)

`apply`'s copy-mode uninstall (§5.3) uses one extra primitive on top of `resolveWithin`/`removePath`:
`removeEmptyDirsWithin`, which prunes the now-empty dirs left after the manifest-recorded files are
removed. It asserts containment within the supplied `stopRoot` before touching the filesystem
(REQ-SEC-02) and never removes a non-empty dir (REQ-SAFE-01).

```typescript
/**
 * Prune now-empty directories from `startDir` UPWARD, stopping before `stopRoot` (exclusive). Used by
 * `apply`'s copy-mode uninstall (§5.3) after the recorded files are removed, to drop the (now-empty)
 * namespace dir and any empty intermediate dirs — but NEVER a non-empty dir. Any untracked user file left in the
 * tree keeps its parent (and all surviving ancestors) alive and untouched (REQ-SAFE-01). `startDir`
 * itself must lie within `stopRoot`'s subtree (containment is asserted).
 *
 * Algorithm: from `cur = startDir`, while `cur` is within `stopRoot` and `cur !== stopRoot`: if
 * `readdir(cur)` is empty, `rmdir(cur)` and ascend to `path.dirname(cur)`; otherwise stop (a
 * non-empty dir halts the prune). A non-existent `cur` is treated as already-removed and the ascent
 * continues.
 *
 * @param startDir - the deepest dir to consider pruning (e.g. the namespace dir).
 * @param stopRoot - the boundary; pruning never removes `stopRoot` itself nor anything outside it.
 * @returns ok(undefined) when the upward prune completes (or halts on a non-empty dir);
 *          err(PATH_ESCAPE) if `startDir` is not within `stopRoot`; err(WRITE_DENIED) on EACCES/EPERM.
 */
export async function removeEmptyDirsWithin(
  startDir: string,
  stopRoot: string,
): Promise<Result<void>> {
  const contained = resolveWithin(stopRoot, startDir);
  if (!contained.ok) return contained;
  const stop = path.resolve(stopRoot);
  let cur = contained.value;
  while (cur !== stop && cur.startsWith(stop)) {
    let entries: string[];
    try {
      entries = await fsp.readdir(cur);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") { cur = path.dirname(cur); continue; }
      return err(toWriteError(e, cur));
    }
    if (entries.length > 0) break;          // non-empty ⇒ MUST NOT remove (REQ-SAFE-01) — halt
    try {
      await fsp.rmdir(cur);                  // remove this now-empty dir only
    } catch (e) {
      return err(toWriteError(e, cur));
    }
    cur = path.dirname(cur);                 // ascend
  }
  return ok(undefined);
}
```

> **`removeEmptyDirsWithin` complements, it does not replace, `removePath`.** `apply.ts`'s
> install/uninstall flow uses `copyDir`/`symlinkDir`/`removePath` (§5); the copy-mode uninstall (§5.3)
> additionally calls `removeEmptyDirsWithin` to prune the dirs left empty after the recorded files are
> removed. The manifest-driven removal POLICY (which paths) lives in `05`'s `planUninstall`; the
> link-safe unlink of a symlink-mode namespace dir is handled by `removePath` (§7.3, `lstat`+`unlink`),
> not a separate wrapper.

## 8. Error handling

Every operation returns a `Result`/`AgentReport` — **no throw for expected errors** (project
convention, `00` §7). Mapping of failure → code → behavior:

| Situation | Code (`00` §7) | Where raised | Behavior |
|-----------|----------------|--------------|----------|
| Source bundle absent | `SOURCE_MISSING` | planner (via `ctx.source === null`, classified by `03`) | plan returns `err`; CLI reports agent+expected path, continues others (REQ-OPS-06/REQ-OBS-03) |
| Bundle fails integrity | `SOURCE_INVALID` | `03` (before planning); planner reacts to null source | same as above |
| Dest drifted, no `--force` | `LOCALLY_MODIFIED` | reported per-file as `skip-modified`; the *agent* report is still `ok:true` unless the whole install was blocked. The CLI surfaces the remedy "re-run with --force" (REQ-IDEM-02/REQ-FLAG-04) | files skipped; agent not failed |
| Write/delete permission | `WRITE_DENIED` | `fsutil` (`toWriteError`) | `apply` returns `AgentReport{ ok:false, error }`; other agents proceed (REQ-OBS-03) |
| Path escapes agent root | `PATH_ESCAPE` | `resolveWithin` | aborts THIS agent's write with `err`; never partially writes; reported (REQ-SEC-02) |
| Manifest unwritable/corrupt | `MANIFEST_CORRUPT` / `WRITE_DENIED` | `05` (`readManifest`/`writeManifest`) | surfaced through the plan/apply `Result`; this doc forwards it |
| Caught fs exception (other) | `UNEXPECTED` | `fsutil` (`toWriteError`) | `apply` returns `ok:false`; never a bare stack |

**Per-agent partial failure (REQ-OBS-03):** `apply` is invoked once per agent and *returns* an
`AgentReport` (never throws), so the CLI loop (`07`) can record one agent's `ok:false` and continue.
The overall non-zero exit when any agent failed is the CLI's concern (`07`), driven by
`AgentReport.ok`.

**Atomicity within an agent:** the file loop writes per-file. If a write fails mid-loop, the agent's
report is `ok:false` and the manifest is **not** written (so a half-written install is not recorded as
clean — a subsequent run re-plans the remaining `create`/`overwrite` actions, which is safe because
already-written files hash-match and become `unchanged`). This is the intended recovery posture
(idempotent re-run heals a partial failure), not a transactional rollback.

## 9. Example usage

```typescript
// install --agent claude (copy), driven by cli.ts (07). Abbreviated; full wiring in 07.
import { planInstall, resolveMode } from "./plan.js";
import { apply } from "./apply.js";
import { locateSource } from "./source.js";
import { readManifest, manifestPath } from "./manifest.js";
import { RAUF_PIN } from "./rauf.js";

const agent = "claude" as const;
const scope = "project" as const;
const home = "/home/u";                               // from 02 resolveRoots (injectable in tests)
const cwd = "/home/u/proj";                           // from 02 resolveRoots (injectable in tests)
const mode = resolveMode(flags.symlink);             // "copy" on Windows regardless (REQ-FLAG-03)

const located = locateSource(agent, { source: flags.source });        // 03
const destination = "/home/u/proj/.claude/skills/feature-forge";       // from 02
const agentRoot = "/home/u/proj/.claude";                              // containment boundary
const manifestFile = manifestPath(agent, scope, { home, cwd });        // 05
const prior = await readManifest(manifestFile);                        // 05 (null if none)

const planned = planInstall({
  agent, scope, mode, destination,
  source: located.ok ? located.value : null,
  priorManifest: prior.ok ? prior.value : null,
  force: flags.force,
  raufPin: flags.skipRauf ? null : RAUF_PIN,
});
if (!planned.ok) { /* report SOURCE_MISSING etc.; continue other agents */ }

if (flags.dryRun) {
  renderPlan(planned.value);            // prints EXACTLY what a real run would do; writes nothing
} else if (planned.ok) {
  const report = await apply(planned.value, {
    agent, scope, mode, agentRoot, destination, manifestPath: manifestFile,
    source: located.ok ? located.value : null,
    raufPin: flags.skipRauf ? null : RAUF_PIN,
    now: new Date().toISOString(),
    priorManifest: prior.ok ? prior.value : null,
  });
  // report.ok === false ⇒ record + continue with the next agent (REQ-OBS-03)
}
```

## Dependencies

Must be implemented (or at least have stable exports) before this doc:

- **`00-core-definitions.md`** — all shared types/constants (`PlannedAction`, `FileAction`,
  `FileActionKind`, `Mode`, `Scope`, `AgentId`, `InstallManifest`, `ManifestFile`, `AgentReport`,
  `Result`, `InstallerError`, `ok`/`err`, `FEATURE_FORGE_NS`, `SCHEMA_VERSION`).
- **`03-source-and-hashing.md`** — `locateSource`/`LocatedSource`, `sha256File`, `sha256Tree`,
  `listBundleFiles`, and the REQ-OPS-06 integrity check that yields `source: null` on a bad bundle.
- **`05-manifest-and-uninstall.md`** — `readManifest`, `writeManifest`, `manifestPath`,
  `planUninstall` (and the manifest-deletion path used by uninstall). `05` owns the uninstall
  POLICY: the pure, manifest-driven `planUninstall` that returns the all-`"remove"` plan; this doc
  owns the safe EXECUTION (`apply()` §5.3 / `removePath` / `removeEmptyDirsWithin`).

Consumed by (downstream within the package):

- **`07-cli-and-reporting.md`** — builds `PlanContext`/`ApplyContext`, calls `plan*`/`apply` per
  agent, renders the plan under `--dry-run`, and maps `AgentReport.ok` to exit codes (REQ-OBS-03).
- **`02-agent-detection-map.md`** — supplies `destination`/`agentRoot` (resolved from
  `AGENT_TARGETS` + scope roots) that this doc treats as inputs.
- **`06-rauf-provisioning.md`** — supplies `RAUF_PIN`, surfaced (not acted on) by the planner.

## Verification

An implementation matches this spec iff:

- [ ] `plan.ts` performs **zero** writes and **zero** network calls (REQ-OPS-05); a `--dry-run` run
      leaves the temp tree byte-identical (assert with a recursive hash before/after).
- [ ] The `PlannedAction` returned by `planInstall`/`planUpdate` is the **same object** handed to
      `apply` on a real run (dry-run = real run) — assert the recorded actions equal the plan.
- [ ] `classifyFile` returns each row of the §6 table: absent dest → `create`; `D=S` → `unchanged`;
      clean prior + changed source → `overwrite` (no `--force`, REQ-IDEM-03); drifted tracked file →
      `skip-modified`, and `overwrite` under `force` (REQ-IDEM-02/REQ-FLAG-04); untracked differing
      file → `skip-modified` (never clobbered).
- [ ] `planUpdate` emits `remove` only for paths in the prior manifest absent from the current source
      (manifest-scoped orphan removal, REQ-OPS-02); an untracked file is never planned for removal.
- [ ] A no-change re-run yields all `unchanged`, **zero** writes, and does **not** rewrite the
      manifest (REQ-IDEM-01).
- [ ] `--symlink` (off Windows) produces a single namespace-dir action, `symlinkDir` creates a link,
      and the manifest records `mode:"symlink"` + `link.target`; on Windows `resolveMode` forces
      `copy` and no link is created (REQ-FLAG-03).
- [ ] `resolveWithin` rejects `..`/absolute escapes with `PATH_ESCAPE` and accepts in-root paths;
      a crafted agent id cannot resolve a write outside the agent root (REQ-SEC-02).
- [ ] `removePath` on a symlinked namespace dir `unlink`s the link and leaves the target
      (`adapters/` source) fully intact (REQ-SAFE-02/REQ-SEC-03); on a real dir it recursively removes
      it; on a missing path it succeeds (idempotent).
- [ ] A Gemini copy/symlink install lands a valid, parseable `gemini-extension.json` at the
      destination with **no** gemini-specific branch in `plan`/`apply` (REQ-OPS-07/D9).
- [ ] A write-denied destination yields `AgentReport{ ok:false, error: WRITE_DENIED }` **without
      throwing**, the manifest is not written, and the run can proceed to other agents (REQ-OBS-03).
- [ ] All filesystem mutation goes through `fsutil` (`copyDir`/`symlinkDir`/`removePath`), each
      preceded by a `resolveWithin` containment check (REQ-SEC-01/02).
- [ ] `fsutil` also exports `removeEmptyDirsWithin` (prune empty dirs up to but not including a
      stop-root; never removes a non-empty dir — REQ-SAFE-01), containment-checked, used by `apply`'s
      copy-mode uninstall (§5.3) after removing the manifest-recorded files (§7.5).
- [ ] `apply` executes the all-`"remove"` `PlannedAction` from `05`'s `planUninstall` (§5.3): copy
      mode removes the recorded files + prunes empty dirs; symlink mode `lstat`+`unlink`s the link
      only (REQ-OPS-03/REQ-SAFE-02/REQ-SEC-03) — there is no `applyUninstall`.
- [ ] `tsc --noEmit` passes under `strict` + `noUncheckedIndexedAccess` with these signatures.
