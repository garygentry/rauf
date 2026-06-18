# 00 — Core Definitions

> Feature: `cross-agent-installer` (epic `agent-agnostic`, member 4 of 6). Target repo:
> **feature-forge** (`/home/gary/workspace/feature-forge`); specs/backlog/loop driven from **rauf**.
> Source of truth: `PRD.md` (v2) + `tech-spec.md` (v1). This document defines the shared type
> system, error hierarchy, and constants for the installer's `src/types.ts` (plus the
> `AGENT_TARGETS` constant table). **Every other numbered spec references the types defined here and
> does not redefine them.**
>
> **Stack [D2]:** TypeScript, strict (`strict: true`, `noUncheckedIndexedAccess: true`), **zero runtime
> dependencies** (only `node:` built-ins), compiled with `tsc`, tested with `node:test`. Named exports
> only. Core functions return `Result<T, E>` and never throw for expected errors (project convention).
> All code below is exact TypeScript, not pseudocode.

## Requirement Coverage

| REQ ID | Requirement | Section |
|--------|-------------|---------|
| REQ-DET-01 | Per-agent detection map (5 agents) | §2 `AgentTarget`, §6 `AGENT_TARGETS` |
| REQ-DET-05 | Detection map a single typed surface | §2 `AgentTarget`, §3 `DetectionResult` |
| REQ-OPS-05 | Dry-run plan model (per-agent/per-skill actions) | §4 `PlannedAction` / `FileAction` |
| REQ-SAFE-01 | Per-agent install manifest (inventory + mode) | §3 `InstallManifest`, `ManifestFile` |
| REQ-SAFE-03 | Manifest sufficient for list/update drift | §3 `InstallManifest` (`sourceHash`, `files[].sha256`) |
| REQ-OBS-01 | Per-agent/per-skill outcome summary | §5 `AgentReport`, `RunReport` |
| REQ-OBS-02 | Actionable errors (agent + path + remedy) | §7 `InstallerError`, `ErrorCode` |
| REQ-OBS-03 | Per-agent partial-failure result | §5 `AgentReport.ok`, `RunReport.exitCode` |
| REQ-RAUF-03 | Pinned rauf coordinate recorded | §3 `InstallManifest.raufPin`, §6 note on `RAUF_PIN` |
| REQ-IDEM-02 | skip-modified action | §4 `FileActionKind` |
| REQ-FLAG-01/02/03 | agent / scope / mode model | §1 `AgentId`, `Scope`, `Mode` |

> Foundation doc: it underpins coverage everywhere but **implements** no behavior. Behavioral REQ
> coverage lives in `02`–`08`; this table lists the requirements whose *contracts* are fixed here.

## 1. Primitive aliases and enumerations

```typescript
/**
 * The five coding agents this installer targets (REQ-DET-01). Order is the canonical
 * iteration order used by detection, planning, and reporting so output is deterministic.
 */
export const AGENT_IDS = ["claude", "codex", "copilot", "cursor", "gemini"] as const;

/** A supported coding-agent identifier. */
export type AgentId = (typeof AGENT_IDS)[number];

/**
 * Install scope (REQ-FLAG-02). `"project"` (default) installs into the current project's
 * agent dir (e.g. `./.claude/skills/feature-forge/`); `"global"` installs into the
 * user-level dir (e.g. `~/.claude/skills/feature-forge/`).
 */
export type Scope = "project" | "global";

/**
 * Materialization mode (REQ-FLAG-03). `"copy"` is the default and the only mode on Windows;
 * `"symlink"` links the whole namespace dir to the source bundle (opt-in via `--symlink`).
 */
export type Mode = "copy" | "symlink";

/** The four invocable subcommands (aliases resolved before this type, §07). */
export type Subcommand = "install" | "update" | "uninstall" | "list";

/** Process exit codes (REQ-OBS-01/03, §07). */
export const EXIT = { SUCCESS: 0, FAILURE: 1, USAGE: 2 } as const;
export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/** Manifest schema version; bumped only on a breaking manifest-shape change. */
export const SCHEMA_VERSION = 1 as const;

/** The single namespace directory name written inside each agent's install location [D5]. */
export const FEATURE_FORGE_NS = "feature-forge" as const;

/** Filename prefix for the hidden parent-sibling manifest, completed by the scope (§3, §05). */
export const MANIFEST_PREFIX = ".feature-forge." as const;
```

## 2. The agent detection map contract (`AgentTarget`)

```typescript
/**
 * One row of the static per-agent detection map (REQ-DET-01, REQ-DET-05). Adding a new
 * agent is exactly adding one entry to `AGENT_TARGETS` (§6) — no logic change (REQ-SCALE-01).
 *
 * The on-disk destination for an agent under a given scope is derived, not stored:
 *   <scopeRoot>/<configDirName>/<installSubdir>/<FEATURE_FORGE_NS>/
 * where scopeRoot is the resolved home (global) or cwd (project) — see `02-agent-detection-map.md`.
 */
export interface AgentTarget {
  /** Stable agent identifier. */
  readonly id: AgentId;
  /**
   * Basename of the agent's config directory, probed for detection (REQ-DET-02),
   * e.g. ".claude", ".codex", ".cursor". Detection is `stat` on this dir, never a subprocess.
   */
  readonly configDirName: string;
  /**
   * Sub-path under the config dir that holds the namespaced install dir, e.g.
   * "skills" (claude/codex/copilot), "rules" (cursor), "extensions" (gemini).
   */
  readonly installSubdir: string;
  /**
   * Informational: the skill-file form this agent's bundle uses — "SKILL.md" (claude),
   * "<name>.md" (codex/copilot/gemini), "<name>.mdc" (cursor). The installer copies the
   * bundle verbatim (REQ-SCALE-02) and does not parse skill files, so this is documentation.
   */
  readonly skillFileForm: string;
  /**
   * Confidence in this row's paths. "confirmed" = source-verified (claude). "best-known"
   * = the TQ-1 paths (codex/copilot/cursor/gemini) to re-verify against each agent's current
   * docs at implementation (REQ-SCALE-01 — isolated, localized correction).
   */
  readonly confidence: "confirmed" | "best-known";
}

/** Options for path resolution, injectable so tests never touch the real `~` (§02, §08). */
export interface ResolveOpts {
  /** Home dir for global scope. Default: `os.homedir()`. */
  readonly home?: string;
  /** Working dir for project scope. Default: `process.cwd()`. */
  readonly cwd?: string;
  /** Active scope. Default: `"project"`. */
  readonly scope?: Scope;
}
```

## 3. Detection result and install manifest

```typescript
/**
 * One agent's detection outcome (REQ-DET-02/04). Returned by `detectAgent`/`detectAgents`
 * (§02) and the data half of the `agent-detection-map` surface (REQ-DET-05).
 */
export interface DetectionResult {
  readonly agent: AgentId;
  /** True iff the agent's config dir is present (primary signal, REQ-DET-02). */
  readonly detected: boolean;
  /** Every config dir probed — named verbatim in the zero-detection report (REQ-DET-04). */
  readonly configDirsProbed: string[];
  /** Secondary, advisory only: whether the agent's CLI is on PATH (never the detection signal). */
  readonly cliOnPath?: boolean;
  /** Resolved absolute install destination for the active scope (the `feature-forge/` namespace dir). */
  readonly destination: string;
}

/** One file recorded in the manifest inventory (REQ-SAFE-01). */
export interface ManifestFile {
  /** Path relative to the manifest's `destination`. */
  readonly path: string;
  /** SHA-256 of the written bytes. Omitted for symlink mode (no per-file copy exists). */
  readonly sha256?: string;
}

/**
 * The persisted per-install manifest (REQ-SAFE-01/03), written as the hidden parent-sibling
 * `<installSubdir>/.feature-forge.<scope>.json` (§05). It is the sole record `list`/`update`/
 * `uninstall` use to tell installer-written content from user content and to detect drift.
 */
export interface InstallManifest {
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly agent: AgentId;
  readonly scope: Scope;
  readonly mode: Mode;
  /** Absolute path of the `feature-forge/` namespace dir this manifest governs. */
  readonly destination: string;
  /**
   * Bundle version coordinate. **`null` today** — the consumed `adapters/` bundles carry no
   * version (no plugin.json / version header; gemini's `gemini-extension.json` version is a
   * `0.0.0` placeholder). Recording a real value is deferred to the generator under OQ-A/IR-1;
   * C-3 forbids the installer reading outside `adapters/` to synthesize one (tech-spec §4, §10).
   */
  readonly featureForgeVersion: string | null;
  /** SHA-256 over the source bundle's canonical (sorted-path) file set — drift anchor (OQ-4, §03). */
  readonly sourceHash: string;
  /** Pinned rauf coordinate recorded at install, e.g. "rauf@0.6.0"; `null` if `--skip-rauf` (§06). */
  readonly raufPin: string | null;
  /** ISO-8601 timestamps. */
  readonly installedAt: string;
  readonly updatedAt: string;
  /** Installed skill ids (the bundle's `skills/*` dir names). */
  readonly skills: string[];
  /** Per-file inventory (copy mode); `sha256` omitted in symlink mode. */
  readonly files: ManifestFile[];
  /** Symlink mode only: the source bundle the namespace dir links to (REQ-SAFE-02). */
  readonly link?: { readonly target: string };
}
```

## 4. The plan model (dry-run engine output)

```typescript
/**
 * The per-file action the planner assigns by diffing source ⇆ destination ⇆ manifest (§04).
 * - "create": destination file absent → will be written.
 * - "overwrite": clean prior file whose source bytes changed → will be refreshed.
 * - "skip-modified": destination locally modified (≠ recorded hash AND ≠ what we'd write)
 *   → left untouched and reported, unless `--force` (REQ-IDEM-02, REQ-FLAG-04).
 * - "unchanged": destination matches source → no write (REQ-IDEM-01).
 * - "remove": manifest records it but canon no longer has it → removed by `update` (REQ-OPS-02).
 */
export type FileActionKind =
  | "create"
  | "overwrite"
  | "skip-modified"
  | "unchanged"
  | "remove";

/** A single planned file action (REQ-OPS-05). */
export interface FileAction {
  /** Path relative to the agent's install destination. */
  readonly relpath: string;
  readonly action: FileActionKind;
}

/**
 * One agent's complete plan (REQ-OPS-05). `--dry-run` prints exactly this; a real run hands
 * the *same* `PlannedAction` to `apply` (§04), guaranteeing "dry-run = real run".
 */
export interface PlannedAction {
  readonly agent: AgentId;
  readonly scope: Scope;
  readonly mode: Mode;
  readonly files: FileAction[];
  /** Surfaced in the plan/report for visibility (§06); not a file action. */
  readonly raufPin?: string | null;
}
```

## 5. Reporting types

```typescript
/** One agent's outcome in a run summary (REQ-OBS-01/03). */
export interface AgentReport {
  readonly agent: AgentId;
  readonly detected: boolean;
  /** False iff this agent's operation failed (others still proceed — REQ-OBS-03). */
  readonly ok: boolean;
  /** The actions performed (or planned, under `--dry-run`). */
  readonly actions: FileAction[];
  /** Present iff `ok` is false. */
  readonly error?: InstallerError;
  readonly raufPin?: string | null;
}

/** The whole-run summary, rendered human-readable or as `--json` (REQ-OBS-01, REQ-DET-05). */
export interface RunReport {
  readonly subcommand: Subcommand;
  readonly scope: Scope;
  readonly mode: Mode;
  readonly dryRun: boolean;
  readonly agents: AgentReport[];
  /** EXIT.SUCCESS unless any agent failed (FAILURE) or args were invalid (USAGE). */
  readonly exitCode: ExitCode;
}
```

## 6. Constants — the `AGENT_TARGETS` table

```typescript
/**
 * The static detection map (REQ-DET-01, REQ-SCALE-01). Keyed by AgentId; iteration order
 * follows `AGENT_IDS`. Paths for non-claude agents are "best-known" (TQ-1) — re-verify each
 * against the agent's current config-dir/skills-dir convention at implementation (OQ-B).
 *
 * Verified ground truth (tech-spec §3.2/§6, codebase research): every bundle has `skills/`
 * (11 skills), `references/`, `scripts/forge-root.sh`, `agents/`; gemini adds a root
 * `gemini-extension.json`, codex adds `agents/openai.yaml`, cursor uses `.mdc` files.
 */
export const AGENT_TARGETS: Readonly<Record<AgentId, AgentTarget>> = {
  claude: { id: "claude", configDirName: ".claude", installSubdir: "skills", skillFileForm: "SKILL.md", confidence: "confirmed" },
  codex: { id: "codex", configDirName: ".codex", installSubdir: "skills", skillFileForm: "<name>.md", confidence: "best-known" },
  copilot: { id: "copilot", configDirName: ".copilot", installSubdir: "skills", skillFileForm: "<name>.md", confidence: "best-known" },
  cursor: { id: "cursor", configDirName: ".cursor", installSubdir: "rules", skillFileForm: "<name>.mdc", confidence: "best-known" },
  gemini: { id: "gemini", configDirName: ".gemini", installSubdir: "extensions", skillFileForm: "<name>.md", confidence: "best-known" },
} as const;

/**
 * Minimal integrity check (REQ-OPS-06, §03): a located bundle is valid iff `skills/` is a
 * non-empty dir, `scripts/forge-root.sh` exists, and — for gemini only — `gemini-extension.json`
 * exists at the bundle root. Defined here as data so the check is a localized table read.
 */
export const BUNDLE_REQUIRED_PATHS = {
  /** Required of every agent bundle. */
  common: ["skills", "scripts/forge-root.sh"] as const,
  /** Additional per-agent requirements. */
  perAgent: { gemini: ["gemini-extension.json"] } as Partial<Record<AgentId, readonly string[]>>,
} as const;
```

> **`RAUF_PIN` is defined in `src/rauf.ts`, not here.** The single source of truth for the pinned
> rauf coordinate is `RAUF_PIN: string` in the rauf module (`06-rauf-provisioning.md`), advanced on
> each feature-forge release (REQ-RAUF-03). `InstallManifest.raufPin` (§3) stores the recorded value.

## 7. Error hierarchy and `Result`

The project convention is **no throw for expected errors** — core functions return a `Result`. A
single structured `InstallerError` carries an enum `code` plus the actionable fields REQ-OBS-02
demands (agent, path, remedy). Unexpected exceptions are caught at the CLI boundary (§07) and
surfaced as `EXIT.FAILURE` with the message (never a bare stack as the only output).

```typescript
/**
 * Stable error codes. Each maps to an actionable message form (REQ-OBS-02) and, at the CLI
 * boundary, an exit code (§07): USAGE → EXIT.USAGE (2); everything else → EXIT.FAILURE (1).
 */
export type ErrorCode =
  | "USAGE"            // unknown subcommand/flag/agent (REQ-DIST-03) → exit 2
  | "SOURCE_MISSING"   // detected agent but adapters/<agent>/ absent (REQ-OPS-06)
  | "SOURCE_INVALID"   // bundle fails the minimal integrity check (REQ-OPS-06)
  | "LOCALLY_MODIFIED" // destination drifted; needs --force (REQ-IDEM-02, REQ-FLAG-04)
  | "WRITE_DENIED"     // no write permission to a destination path (REQ-OBS-02)
  | "PATH_ESCAPE"      // a resolved destination escaped the agent root (REQ-SEC-02)
  | "RAUF_UNRESOLVABLE"// pinned rauf not resolvable from the registry (REQ-RAUF, §06)
  | "MANIFEST_CORRUPT" // existing manifest is unreadable/invalid JSON (§05)
  | "UNEXPECTED";      // caught exception fallback

/**
 * A structured, actionable installer error (REQ-OBS-02). `message` must name the agent, the
 * path, and the remedy where applicable; `remedy` optionally carries the suggested fix verbatim.
 */
export interface InstallerError {
  readonly code: ErrorCode;
  readonly message: string;
  readonly agent?: AgentId;
  readonly path?: string;
  readonly remedy?: string;
}

/** Result<T,E> — success carries a value; failure carries a structured error. */
export type Result<T, E = InstallerError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/** Constructors (kept tiny; live in `src/types.ts`, matching the 13-module map in `01` §1/§3). */
export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });
```

## 8. CLI flag model

```typescript
/**
 * Parsed, normalized CLI flags (REQ-FLAG-01..05, REQ-DIST-02). Produced by `cli.ts` from
 * `node:util.parseArgs` (§07). `agent` undefined ⇒ all detected agents (REQ-DET-03).
 */
export interface CliFlags {
  readonly agent?: AgentId;
  readonly global: boolean;    // --global/-g (REQ-FLAG-02); false ⇒ project scope
  readonly symlink: boolean;   // --symlink (REQ-FLAG-03); ignored ⇒ copy on Windows
  readonly force: boolean;     // --force (REQ-FLAG-04)
  readonly dryRun: boolean;    // --dry-run (REQ-OPS-05)
  readonly yes: boolean;       // -y/--yes (REQ-DIST-02, REQ-FLAG-05)
  readonly json: boolean;      // --json (REQ-DET-05, REQ-OBS-01)
  readonly skipRauf: boolean;  // --skip-rauf (§06)
  readonly source?: string;    // hidden --source <dir> for tests (D7, §03)
}
```

## Dependencies

None — this is the foundation. Every other spec doc (`01`–`08`) depends on the types, constants, and
`Result` defined here and MUST import them rather than redefine.

## Verification

An implementation matches this spec iff:

- [ ] `src/types.ts` exports every type/alias in §1–§8 with these exact names and shapes.
- [ ] `AgentId` is derived from `AGENT_IDS` (the const tuple is the single source of the five ids).
- [ ] `AGENT_TARGETS` has exactly the five rows in §6 with the listed `configDirName`/`installSubdir`.
- [ ] `InstallManifest.featureForgeVersion` is `string | null` and `ManifestFile.sha256` is optional.
- [ ] `Result<T,E>`, `ok`, `err`, and `EXIT` are exported and used by core functions (no throw for
      expected errors).
- [ ] `tsc --noEmit` passes under `strict` + `noUncheckedIndexedAccess` with these definitions.
