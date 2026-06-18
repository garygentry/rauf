# 02 — Agent Detection Map

> Feature: `cross-agent-installer` (epic `agent-agnostic`, member 4 of 6). Target repo:
> **feature-forge** (`/home/gary/workspace/feature-forge`); specs/backlog/loop driven from **rauf**.
> Source of truth: `PRD.md` (v2) §3.2 + `tech-spec.md` (v1) §3.2/§5.2. This document specifies the
> **`agent-detection-map`** exposed contract — the static per-agent table applied to a host to yield
> per-agent detected/not-detected results and resolved install destinations. It covers modules
> `src/agent-targets.ts` (the exposed surface) and `src/detect.ts` (the internal config-dir probe).
>
> **Build on `00-core-definitions.md`.** Every shared type used here — `AgentId`, `AgentTarget`,
> `DetectionResult`, `ResolveOpts`, `Scope`, `AGENT_TARGETS`, `FEATURE_FORGE_NS`, `Result`/`ok`/`err`,
> `InstallerError` — is **defined in `00-core-definitions.md` and imported, never redefined here.** This
> document specifies only the *functions* that operate over those types.
>
> **Stack:** TypeScript, strict (`strict: true`, `noUncheckedIndexedAccess: true`), **zero runtime
> dependencies** (only `node:` built-ins: `node:os`, `node:fs`, `node:path`, `node:child_process` for
> the advisory PATH check). Named exports only. Pure derivations return plain values; fallible probes
> never throw for expected errors. All code below is exact TypeScript, not pseudocode.

## Requirement Coverage

| REQ ID | Requirement | Section |
|--------|-------------|---------|
| REQ-DET-01 | Per-agent detection map covering the five agents (config dir + install destination) | §2 `AGENT_TARGETS` re-export, §4.4 `destinationFor` |
| REQ-DET-02 | Config-dir presence is the **primary** signal (`stat`, never a subprocess); `cliOnPath` secondary/advisory | §4.5 `detectAgent`, §5.1 probe algorithm, §5.3 PATH check |
| REQ-DET-03 | No `--agent` ⇒ operate on **all detected** agents | §4.6 `detectAgents`, §5.4 default-scope note |
| REQ-DET-04 | Zero detected ⇒ report naming every probed dir; never create dirs speculatively; never opaque error | §4.7 `formatZeroDetection`, §5.5 zero-detection algorithm |
| REQ-DET-05 | Single surface, importable + `--json` | §3 surface overview, §4 public API, §7 `--json` note |
| REQ-FLAG-01 | `--agent` scoping to one of five | §4.6 `detectAgents` (`only`), §5.4 |
| REQ-FLAG-02 | `--global` user-level vs default project-local destination | §4.2 `resolveRoots`, §4.4 `destinationFor`, §6 scope→root mapping |
| REQ-SCALE-01 | New agent = one table row (no logic change) | §2, §5.6 scalability invariant |
| REQ-PERF-01 | Detection/list instant — no network/build | §5.7 performance contract |

## 1. Purpose & scope

`agent-detection-map` is **one exposed contract with two halves** (REQ-DET-05):

1. **Static half** — the per-agent table (`AGENT_TARGETS`, defined in `00-core-definitions.md` §6):
   for each of the five agents, the config-dir basename to probe and the install sub-path
   (`skills` / `rules` / `extensions`). This document does **not** redefine it; it specifies the
   pure functions that derive on-disk destinations from it.
2. **Behavioral half** — applying that table to a host: `stat` each config dir to decide
   *detected / not-detected* (REQ-DET-02), resolve each agent's install destination for the active
   scope (REQ-FLAG-02), and report clearly when nothing is detected (REQ-DET-04).

This document is the **single named surface** both halves are reached through (REQ-DET-05): importable
as `AGENT_TARGETS` + `detectAgent` / `detectAgents` / `resolveRoots` / `destinationFor`, and over the
shell as `feature-forge list --json` (the `--json` rendering is owned by `07-cli-and-reporting.md`,
which calls the functions here).

**In scope:** `src/agent-targets.ts` (exposed functions) and `src/detect.ts` (the internal
config-dir `stat` probe + the advisory PATH check). **Out of scope (other docs):** locating/validating
the *source* bundle (`03-source-and-hashing.md`), planning/applying writes (`04-*`), the manifest
(`05-*`), rauf provisioning (`06-rauf-provisioning.md`), CLI parsing and report rendering
(`07-cli-and-reporting.md`).

**Pure, read-only, instant.** Nothing in this document writes to the filesystem, touches the network,
spawns an agent subprocess, or creates a directory. The only filesystem call is `fs.statSync` on a
config dir; the only subprocess is the *optional, advisory* PATH check (§5.3), which is skippable and
never gates detection. This is what makes `list` / `--dry-run` effectively instant (REQ-PERF-01, §5.7).

## 2. Imported foundation (do not redefine)

All of the following come from `00-core-definitions.md` and are **imported**, not declared here:

```typescript
import {
  AGENT_IDS,            // readonly ["claude","codex","copilot","cursor","gemini"]
  AGENT_TARGETS,        // Readonly<Record<AgentId, AgentTarget>>  (the static table, REQ-DET-01)
  FEATURE_FORGE_NS,     // "feature-forge"  (the single namespace dir name)
  type AgentId,
  type AgentTarget,
  type DetectionResult,
  type ResolveOpts,     // { home?; cwd?; scope? }
  type Scope,           // "project" | "global"
} from "./types.js";
```

`AGENT_TARGETS` (REQ-DET-01) is **re-exported verbatim** from `src/agent-targets.ts` so importers can
reach the table and the behavior from the one module (REQ-DET-05). The static rows — `configDirName`
(`.claude`, `.codex`, `.copilot`, `.cursor`, `.gemini`) and `installSubdir` (`skills` for
claude/codex/copilot, `rules` for cursor, `extensions` for gemini) — are fixed in
`00-core-definitions.md` §6; adding a sixth agent is exactly one new row there with **no change to any
function in this document** (REQ-SCALE-01, §5.6).

## 3. Surface overview (one contract, two access modes)

```
                       agent-detection-map  (src/agent-targets.ts)
                       ┌──────────────────────────────────────────┐
  static half ───────▶ │ AGENT_TARGETS            (re-exported)    │
                       │ resolveRoots(opts?)      pure             │
                       │ destinationFor(t,scope,opts?)  pure       │
  behavioral half ───▶ │ detectAgent(id, opts?)   stat probe       │
                       │ detectAgents(opts?)      all/one          │
                       │ formatZeroDetection(...)  reporting       │
                       └──────────────────────────────────────────┘
                            ▲ uses                       ▲ shell
        src/detect.ts  ─────┘  (config-dir stat,         feature-forge list --json
        (internal)             advisory PATH check)      (07-cli-and-reporting.md)
```

Importers get the data via `detectAgents()` (returns `DetectionResult[]`) and the paths via
`AGENT_TARGETS` + `destinationFor`. Non-Node / shell consumers (e.g. `packaging-docs-ci`'s OS-matrix
dry-runs) get the **same `DetectionResult[]`** rendered as JSON by `feature-forge list --json`
(REQ-DET-05). The CLI layer never re-implements detection — it calls these functions (§7).

## 4. Public API (exact signatures)

All exported from `src/agent-targets.ts` unless noted. Re-exported through `src/index.ts` per
`01-architecture-layout.md` §4.

### 4.1 Re-export of the static table

```typescript
// src/agent-targets.ts
export { AGENT_TARGETS } from "./types.js"; // REQ-DET-01, REQ-DET-05 — table reachable from the one surface
```

### 4.2 `resolveRoots` — the single injection point for `~` and cwd

```typescript
/**
 * Resolve the two filesystem roots all destinations derive from, applying defaults.
 * This is the **single injection point** for the home and working directories, so tests
 * sandbox every path computation without ever touching the real `~` (tech-spec §3.2, §8).
 *
 * - `home` (global scope root) defaults to `os.homedir()`.
 * - `cwd`  (project scope root) defaults to `process.cwd()`.
 *
 * Both returned paths are absolute and `path.resolve`d. Pure: reads no files, spawns nothing.
 *
 * @param opts - Optional overrides; any field omitted falls back to the OS/process default.
 * @returns The resolved `{ home, cwd }` roots used by {@link destinationFor}.
 *
 * @example
 * resolveRoots();                          // { home: "/home/gary", cwd: "/home/gary/proj" }
 * resolveRoots({ home: "/tmp/fakehome" }); // { home: "/tmp/fakehome", cwd: process.cwd() }
 */
export function resolveRoots(opts?: ResolveOpts): { home: string; cwd: string };
```

**Implementation (exact):**

```typescript
import * as os from "node:os";
import * as path from "node:path";

export function resolveRoots(opts?: ResolveOpts): { home: string; cwd: string } {
  return {
    home: path.resolve(opts?.home ?? os.homedir()),
    cwd: path.resolve(opts?.cwd ?? process.cwd()),
  };
}
```

**Error handling:** none — pure, total. `os.homedir()` / `process.cwd()` are non-throwing for the
supported platforms; results are always absolute after `path.resolve`.

### 4.3 `scopeRootFor` — internal scope→root selection

```typescript
/**
 * Internal: select the root directory for a scope (REQ-FLAG-02).
 * `"global"` → the resolved home dir (user-level, e.g. `~/.claude/…`);
 * `"project"` → the resolved cwd (project-local, e.g. `./.claude/…`).
 * Not exported — used by {@link destinationFor} and {@link detectAgent}.
 */
function scopeRootFor(scope: Scope, roots: { home: string; cwd: string }): string {
  return scope === "global" ? roots.home : roots.cwd;
}
```

### 4.4 `destinationFor` — derive an agent's install destination

```typescript
/**
 * Derive the absolute install destination for one agent under a given scope (REQ-DET-01,
 * REQ-FLAG-02). The destination is the namespaced `feature-forge/` dir:
 *
 *     <scopeRoot>/<configDirName>/<installSubdir>/<FEATURE_FORGE_NS>/
 *
 * where `scopeRoot` is the home dir for `"global"` and the cwd for `"project"`. The path is
 * **derived, never stored** in the table, so a new agent is one `AGENT_TARGETS` row (REQ-SCALE-01).
 * Pure: builds a string via `node:path`, reads no files, creates nothing.
 *
 * @param target - The agent's static table row (from `AGENT_TARGETS`).
 * @param scope  - `"global"` (user-level) or `"project"` (project-local).
 * @param opts   - Optional root overrides (see {@link resolveRoots}); `opts.scope` is ignored
 *                 here because `scope` is passed explicitly.
 * @returns The absolute path of the `feature-forge/` namespace dir for this agent + scope.
 *
 * @example  // claude, global
 * destinationFor(AGENT_TARGETS.claude, "global", { home: "/home/gary" })
 *   // → "/home/gary/.claude/skills/feature-forge"
 *
 * @example  // cursor, project (cwd = /home/gary/proj)
 * destinationFor(AGENT_TARGETS.cursor, "project", { cwd: "/home/gary/proj" })
 *   // → "/home/gary/proj/.cursor/rules/feature-forge"
 */
export function destinationFor(
  target: AgentTarget,
  scope: Scope,
  opts?: ResolveOpts,
): string;
```

**Implementation (exact):**

```typescript
export function destinationFor(
  target: AgentTarget,
  scope: Scope,
  opts?: ResolveOpts,
): string {
  const roots = resolveRoots(opts);
  const root = scopeRootFor(scope, roots);
  return path.resolve(
    root,
    target.configDirName,   // ".claude" | ".codex" | ".copilot" | ".cursor" | ".gemini"
    target.installSubdir,   // "skills"  | "skills" | "skills"   | "rules"   | "extensions"
    FEATURE_FORGE_NS,       // "feature-forge"
  );
}
```

**Worked destinations (all five, both scopes)** — REQ-DET-01, REQ-FLAG-02 (`~` = resolved home,
`.` = resolved cwd):

| Agent | Global (`--global`) | Project-local (default) |
|---|---|---|
| claude  | `~/.claude/skills/feature-forge/`     | `./.claude/skills/feature-forge/`     |
| codex   | `~/.codex/skills/feature-forge/`      | `./.codex/skills/feature-forge/`      |
| copilot | `~/.copilot/skills/feature-forge/`    | `./.copilot/skills/feature-forge/`    |
| cursor  | `~/.cursor/rules/feature-forge/`      | `./.cursor/rules/feature-forge/`      |
| gemini  | `~/.gemini/extensions/feature-forge/` | `./.gemini/extensions/feature-forge/` |

> Non-claude rows are **best-known** (TQ-1 / OQ-B): the `installSubdir` values for
> codex/copilot/cursor/gemini are verified-at-implementation against each agent's current config-dir
> convention. Because they are isolated `AGENT_TARGETS` rows, a correction is a one-line table edit
> with no change to `destinationFor` (REQ-SCALE-01, §5.6).

**Error handling:** none — pure, total. The result is always within `<scopeRoot>/<configDirName>` by
construction (the table values are fixed literals with no `..`); the *write-time* containment assertion
that defends against a malformed agent id is `fsutil.ts`'s responsibility (`04-*`, REQ-SEC-02), not
this pure derivation.

### 4.5 `detectAgent` — probe one agent

```typescript
/**
 * Detect a single agent on the host (REQ-DET-02). Detection is decided **solely** by the
 * presence of the agent's config dir under the active scope root (a `stat`, never an agent
 * subprocess) — this also covers IDE/GUI agents (e.g. Cursor) that have a config dir but no CLI.
 *
 * Populates `configDirsProbed` (the exact paths probed — named in the zero-detection report,
 * REQ-DET-04), `destination` (the resolved install dest for the active scope), and the optional,
 * **advisory-only** `cliOnPath` (secondary info; never the detection signal, REQ-DET-02).
 *
 * The active scope is `opts.scope` (default `"project"`). Total: returns a `DetectionResult`
 * for any valid `AgentId` whether or not the agent is present; absence is `detected: false`,
 * never an error or a thrown exception.
 *
 * @param id   - One of the five `AgentId`s.
 * @param opts - Root/scope overrides (see {@link resolveRoots}).
 * @returns The agent's {@link DetectionResult}.
 *
 * @example
 * detectAgent("claude", { home: "/home/gary", scope: "global" });
 * // → { agent: "claude", detected: true,
 * //     configDirsProbed: ["/home/gary/.claude"],
 * //     destination: "/home/gary/.claude/skills/feature-forge",
 * //     cliOnPath: false }
 */
export function detectAgent(id: AgentId, opts?: ResolveOpts): DetectionResult;
```

**Implementation (exact):**

```typescript
import { probeConfigDir, cliOnPath } from "./detect.js";

export function detectAgent(id: AgentId, opts?: ResolveOpts): DetectionResult {
  const target = AGENT_TARGETS[id];
  const scope: Scope = opts?.scope ?? "project";
  const roots = resolveRoots(opts);
  const root = scopeRootFor(scope, roots);

  // Primary signal (REQ-DET-02): presence of the config dir under the active scope root.
  const configDir = path.resolve(root, target.configDirName);
  const detected = probeConfigDir(configDir); // pure fs.statSync, see §5.1

  return {
    agent: id,
    detected,
    configDirsProbed: [configDir],
    destination: destinationFor(target, scope, opts),
    cliOnPath: cliOnPath(id), // advisory only (§5.3); never gates `detected`
  };
}
```

**Error handling:** total and non-throwing.
- A missing/inaccessible config dir ⇒ `detected: false` (not an error) — `probeConfigDir` swallows
  `ENOENT`/`EACCES` and returns `false` (§5.1). Detection never throws for an expected absence.
- `id` is statically constrained to `AgentId`; an out-of-union value cannot reach here (the CLI maps an
  unknown `--agent` to a `USAGE` error before calling — `07-cli-and-reporting.md`).
- The advisory `cliOnPath` probe is wrapped so any failure (no `which`/`where`, spawn error) yields
  `false`, never propagating (§5.3).

### 4.6 `detectAgents` — probe all five (or scope to one)

```typescript
/**
 * Detect every supported agent in canonical order (REQ-DET-03 — the default scope of an
 * operation is "all detected agents"). Iterates `AGENT_IDS` so output is deterministic.
 *
 * Pass `opts.only` to scope to a single agent (REQ-FLAG-01 — the `--agent/-a` flag); the result
 * is then a one-element array. The default project/global scope comes from `opts.scope`.
 *
 * @param opts - Root/scope overrides plus optional `only` to scope to one agent.
 * @returns One {@link DetectionResult} per probed agent, in `AGENT_IDS` order. Callers select the
 *          *detected* subset for an operation (the un-detected entries still inform `list`/reports).
 *
 * @example  // all agents, project scope
 * detectAgents({ cwd: "/home/gary/proj" }).filter(r => r.detected);
 *
 * @example  // scoped to one agent (--agent codex)
 * detectAgents({ only: "codex", scope: "global" }); // → [ DetectionResult for codex ]
 */
export function detectAgents(opts?: DetectAgentsOpts): DetectionResult[];

/** Options for {@link detectAgents}: {@link ResolveOpts} plus a single-agent scope (REQ-FLAG-01). */
export interface DetectAgentsOpts extends ResolveOpts {
  /** Restrict detection to this one agent (`--agent/-a`). Absent ⇒ all five (REQ-DET-03). */
  readonly only?: AgentId;
}
```

**Implementation (exact):**

```typescript
export function detectAgents(opts?: DetectAgentsOpts): DetectionResult[] {
  const ids: readonly AgentId[] = opts?.only ? [opts.only] : AGENT_IDS;
  return ids.map((id) => detectAgent(id, opts));
}
```

**Error handling:** total — never throws. Each agent is probed independently via `detectAgent`; one
agent's missing config dir is simply `detected: false` and cannot affect the others (this read-side
isolation parallels the write-side per-agent partial-failure rule, REQ-OBS-03, owned by `04`/`07`).

> **`DetectAgentsOpts.only` vs `00-core-definitions.md`.** `ResolveOpts` (home/cwd/scope) is the shared
> type from `00`. `only` is the one detection-specific extension and is declared **here** (it is not a
> path-resolution concern), extending `ResolveOpts` so callers pass a single options object. This adds
> no new shared type to `00`.

### 4.7 `formatZeroDetection` — the zero-detection reporting helper

```typescript
/**
 * Build the clear, actionable message for the zero-agents-detected case (REQ-DET-04). Names
 * **every** config dir probed (drawn from the `configDirsProbed` of the supplied results) so the
 * user sees exactly where the installer looked. It **does not** create any directory and **does
 * not** produce an opaque error — it returns a structured, human-readable report string.
 *
 * Pure: derives text from already-computed {@link DetectionResult}s; no fs/network access.
 *
 * @param results - The full `detectAgents()` output for the active scope (typically all `false`).
 * @param scope   - The active scope, named in the message so the user knows which roots were used.
 * @returns A multi-line message listing every probed config dir and the remedy.
 *
 * @example
 * const results = detectAgents({ scope: "global", home: "/home/gary" });
 * if (results.every(r => !r.detected)) console.warn(formatZeroDetection(results, "global"));
 * // No supported coding agents detected (scope: global).
 * // Probed config directories (none present):
 * //   - /home/gary/.claude
 * //   - /home/gary/.codex
 * //   - /home/gary/.copilot
 * //   - /home/gary/.cursor
 * //   - /home/gary/.gemini
 * // No directories were created. Install an agent (or pass --global/project scope, or
 * // --source for tests) and re-run.
 */
export function formatZeroDetection(results: DetectionResult[], scope: Scope): string;
```

**Implementation (exact):**

```typescript
export function formatZeroDetection(results: DetectionResult[], scope: Scope): string {
  const probed = results.flatMap((r) => r.configDirsProbed);
  const lines = [
    `No supported coding agents detected (scope: ${scope}).`,
    `Probed config directories (none present):`,
    ...probed.map((p) => `  - ${p}`),
    `No directories were created. Install an agent (or pass --global/project scope, or`,
    `--source for tests) and re-run.`,
  ];
  return lines.join("\n");
}
```

**Error handling:** none — pure string assembly. The decision to *call* it (i.e. "are zero agents
detected?") is `detectAgents(...).every(r => !r.detected)` and is made by the caller in `cli.ts`
(`07-cli-and-reporting.md`), which also maps it to a non-opaque, non-fatal outcome (REQ-DET-04: report
clearly, never an opaque error, never speculative dir creation).

## 5. Internal implementation

### 5.1 Config-dir probe (`src/detect.ts`, the primary signal — REQ-DET-02)

```typescript
// src/detect.ts
import * as fs from "node:fs";

/**
 * The primary detection signal (REQ-DET-02): is `configDir` an existing directory?
 * Uses a single synchronous `fs.statSync` — **never** an agent subprocess (so detection stays
 * instant, REQ-PERF-01) and **never** creates the dir (REQ-DET-04). Any stat failure
 * (`ENOENT` not present, `EACCES` unreadable, or a non-directory at the path) ⇒ `false`.
 *
 * Synchronous by design: there is exactly one stat per agent (five total), so async adds
 * no throughput and would complicate the pure-derivation surface.
 */
export function probeConfigDir(configDir: string): boolean {
  try {
    return fs.statSync(configDir).isDirectory();
  } catch {
    return false; // ENOENT / EACCES / not-a-dir → not detected (never throws, REQ-DET-04)
  }
}
```

**Why `stat`, not a subprocess (REQ-DET-02):** skills install *into* the config dir, so the config
dir's presence is the signal that an install target actually exists. Probing by running the agent's CLI
would (a) be slow (spawns, process startup — violates REQ-PERF-01), (b) miss IDE/GUI agents like Cursor
that have a config dir but no CLI, and (c) couple detection to agent versions. A `stat` is correct,
fast, and host-version-independent.

### 5.2 What is probed for each agent

Exactly one directory per agent — `<scopeRoot>/<configDirName>` — derived from the table row:

| Agent | Probed dir (global) | Probed dir (project) |
|---|---|---|
| claude  | `~/.claude`  | `./.claude`  |
| codex   | `~/.codex`   | `./.codex`   |
| copilot | `~/.copilot` | `./.copilot` |
| cursor  | `~/.cursor`  | `./.cursor`  |
| gemini  | `~/.gemini`  | `./.gemini`  |

`configDirsProbed` on each `DetectionResult` records the *exact* probed path (post-`path.resolve`), so
the zero-detection report (§4.7) names real, scope-correct paths rather than the bare basenames.

### 5.3 Advisory CLI-on-PATH check (secondary only — REQ-DET-02)

```typescript
// src/detect.ts
import { execFileSync } from "node:child_process";

/** Per-agent CLI executable basename probed on PATH (advisory only). */
const CLI_NAMES: Partial<Record<AgentId, string>> = {
  claude: "claude",
  codex: "codex",
  copilot: "copilot",
  gemini: "gemini",
  // cursor: intentionally omitted — IDE/GUI agent, no canonical CLI on PATH (REQ-DET-02 rationale).
};

/**
 * Secondary, **advisory** info (REQ-DET-02): is the agent's CLI resolvable on PATH? This is
 * reported as `DetectionResult.cliOnPath` but **never** gates `detected`. Uses the platform's
 * resolver (`where` on Windows, `command -v` elsewhere) once per agent. Any failure — no resolver,
 * not found, spawn error — yields `false`; it never throws and never blocks detection.
 *
 * Agents without a canonical CLI (cursor) always report `false` here without spawning.
 */
export function cliOnPath(id: AgentId): boolean {
  const bin = CLI_NAMES[id];
  if (!bin) return false;
  const isWin = process.platform === "win32";
  try {
    execFileSync(isWin ? "where" : "command", isWin ? [bin] : ["-v", bin], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false; // advisory; absence is normal, never an error
  }
}
```

> `command -v` is a shell builtin; invoking it via `execFileSync("command", ["-v", bin])` works on
> POSIX shells. If a target environment lacks it, the `catch` yields `false` — the only consequence is
> a less-informative advisory field, which is acceptable (REQ-DET-02: secondary info). An
> implementation MAY substitute a pure PATH-scan (split `process.env.PATH`, `fs.statSync` each
> candidate) to avoid spawning entirely; that is an allowed optimization since `cliOnPath` is advisory.

### 5.4 Default scope = all detected; `--agent` scopes to one (REQ-DET-03, REQ-FLAG-01)

`detectAgents(opts)` returns **all five** results when `opts.only` is undefined (the `--agent` flag was
not passed), and the caller operates on the *detected* subset (`.filter(r => r.detected)`) — this is
the "default scope = all detected agents" rule (REQ-DET-03). When `--agent/-a <id>` is given, `cli.ts`
sets `opts.only = <id>` (after validating it is one of the five — an unknown id is a `USAGE` error in
`07-cli-and-reporting.md`), and `detectAgents` returns a single-element array (REQ-FLAG-01). The
project-vs-global scope of the probed roots is independent and comes from `opts.scope` (REQ-FLAG-02,
§6).

### 5.5 Zero-detection handling (REQ-DET-04)

The decision and reporting are split so detection stays pure:

1. `detectAgents(opts)` returns results for the active scope (with `--agent`, just that one).
2. The caller (`cli.ts`) computes `const none = results.every(r => !r.detected)`.
3. If `none`, it emits `formatZeroDetection(results, scope)` (§4.7) — a clear message naming **every**
   probed config dir — and finishes **non-opaquely**: for `list`, exit `0` with the message; for a
   mutating op with no `--agent`, a clear "nothing to do" (exit `0`) since there is no target (the
   exact exit mapping is `07-cli-and-reporting.md`'s).

Three invariants this guarantees (REQ-DET-04):
- **Names every probed dir** — sourced from `configDirsProbed`, not hardcoded.
- **Never creates a dir speculatively** — `probeConfigDir` only `stat`s; nothing in this document
  calls `mkdir`.
- **Never an opaque error** — the message is structured and actionable, not a bare exception or
  empty result.

### 5.6 Scalability invariant — new agent = one table row (REQ-SCALE-01)

Every function here is **data-driven over `AGENT_TARGETS` / `AGENT_IDS`** and contains no per-agent
branching except the advisory `CLI_NAMES` map (§5.3), which is itself a table and tolerates a missing
entry (returns `false`). Adding a sixth agent requires:
1. Append its `AgentId` to `AGENT_IDS` and its row to `AGENT_TARGETS` (both in `00-core-definitions.md`).
2. Optionally add its CLI basename to `CLI_NAMES` (advisory only).

No change to `resolveRoots`, `destinationFor`, `detectAgent`, `detectAgents`, or `formatZeroDetection`.
This is the REQ-SCALE-01 guarantee, and the TQ-1/OQ-B best-known path corrections for the four
non-claude agents are likewise localized single-row edits (§4.4 note).

### 5.7 Performance contract (REQ-PERF-01)

Detection and `list` are **instant**: per agent the cost is one `fs.statSync` (primary signal) plus at
most one cheap PATH resolution (advisory, skippable). For all five agents that is ≤5 stats + ≤4 PATH
checks — sub-millisecond filesystem work, **no network, no build, no agent subprocess, no `mkdir`**.
`destinationFor` / `resolveRoots` are pure string math. This is exactly the "`--dry-run`/`list` must be
effectively instant" requirement; nothing here can introduce network or build latency by construction.

## 6. Configuration — scope → root mapping (REQ-FLAG-02)

The only configuration this surface honors is **scope** and the **injected roots**:

| Input | Source | Effect |
|---|---|---|
| `--global` / `-g` | CLI flag → `opts.scope = "global"` (`07-cli-and-reporting.md`) | scope root = resolved **home** (`~`); destinations under `~/.<agent>/…` (REQ-FLAG-02) |
| (default, no flag) | `opts.scope = "project"` | scope root = resolved **cwd** (`.`); destinations under `./.<agent>/…` (REQ-FLAG-02) |
| `opts.home` | `ResolveOpts.home` (default `os.homedir()`) | overrides the global root — **the test injection point** so `~` is never touched (tech-spec §3.2/§8) |
| `opts.cwd` | `ResolveOpts.cwd` (default `process.cwd()`) | overrides the project root |
| `--agent <id>` | `DetectAgentsOpts.only` | restricts to one agent (REQ-FLAG-01) |

There is no config file and no environment variable read by this surface (the `--source` flag and
`RAUF_PIN` belong to `03`/`06`). `--global/-g` ⇄ `scope` is the entire scope mapping: the flag flips
`scopeRootFor` from cwd to home, and every probed dir and destination follows.

## 7. Error handling summary

This surface is **read-only and total** — it returns values, never throws for expected conditions
(project convention: no throw for expected errors, `00-core-definitions.md` §7):

| Condition | Behavior | REQ |
|---|---|---|
| Config dir absent / unreadable | `detected: false` (swallowed in `probeConfigDir`) | REQ-DET-02, REQ-DET-04 |
| Zero agents detected | `formatZeroDetection` message naming every probed dir; no dir created; non-opaque | REQ-DET-04 |
| CLI not on PATH / no resolver | `cliOnPath: false` (advisory; never gates detection) | REQ-DET-02 |
| Unknown `--agent` value | **Not handled here** — `cli.ts` validates against `AGENT_IDS` and returns a `USAGE` `InstallerError` (exit 2) before calling | REQ-FLAG-01, `07` |
| Path containment / `..` escape | **Not handled here** — `destinationFor` is a pure derivation from fixed table literals; the write-time containment assertion is `fsutil.ts` (`04`, REQ-SEC-02) | REQ-SEC-02 |

These functions return plain values (not `Result<T,E>`) because every operation is total — there is no
*expected error* to surface; absence is a valid `false`/`detected:false` value, and the only failure
modes (unknown agent, path escape) are handled by the layers that own them (`07`, `04`). The
`--json` rendering of `DetectionResult[]` is owned by `07-cli-and-reporting.md` (it serializes the
results returned here verbatim — REQ-DET-05).

## 8. Example usage

```typescript
import {
  AGENT_TARGETS,
  detectAgent,
  detectAgents,
  destinationFor,
  formatZeroDetection,
} from "./agent-targets.js";

// 1) Default operation scope = all detected agents (REQ-DET-03), project scope (REQ-FLAG-02).
const results = detectAgents();
const targets = results.filter((r) => r.detected);

if (targets.length === 0) {
  // Zero-detection: clear, names every probed dir, creates nothing (REQ-DET-04).
  console.warn(formatZeroDetection(results, "project"));
} else {
  for (const r of targets) {
    console.log(`${r.agent}: will install into ${r.destination}` +
      (r.cliOnPath ? " (CLI on PATH)" : ""));
  }
}

// 2) Scope to one agent, user-level (REQ-FLAG-01 + REQ-FLAG-02).
const [codex] = detectAgents({ only: "codex", scope: "global" });

// 3) Importer wanting just the path for an agent (no probe) — REQ-DET-01/05.
const claudeGlobalDest = destinationFor(AGENT_TARGETS.claude, "global");
//   → ~/.claude/skills/feature-forge

// 4) Test-sandboxed detection — never touches the real ~ (tech-spec §3.2/§8).
const sandboxed = detectAgent("claude", { home: "/tmp/fakehome", scope: "global" });
```

## Dependencies

Implement **after** these documents (they define what this one imports/relies on):

- **`00-core-definitions.md`** — REQUIRED first. Provides every type/constant used here:
  `AgentId`, `AgentTarget`, `DetectionResult`, `ResolveOpts`, `Scope`, `AGENT_IDS`, `AGENT_TARGETS`,
  `FEATURE_FORGE_NS`. This document redefines none of them.
- **`01-architecture-layout.md`** — REQUIRED first. Fixes the module layout (`src/agent-targets.ts`,
  `src/detect.ts`), the `package.json`/`tsconfig.json`, and that `src/index.ts` re-exports
  `AGENT_TARGETS`, `detectAgent`, `detectAgents`, `resolveRoots` (the agent-detection-map surface).

Downstream documents that **depend on this one** (implement after it):
- `03-source-and-hashing.md` — consumes `AGENT_TARGETS` rows to locate `adapters/<agent>/`.
- `04-*` (plan/apply) — consume `DetectionResult.destination` + `destinationFor` for write targets.
- `07-cli-and-reporting.md` — calls `detectAgents`/`formatZeroDetection`, renders `--json`, validates
  `--agent`, and maps `--global/-g` to `opts.scope`.

This document imports **no** runtime third-party dependency (zero-dep policy): only `node:os`,
`node:path`, `node:fs`, and `node:child_process` (advisory PATH check only).

## Verification

An implementation matches this spec iff:

- [ ] `src/agent-targets.ts` exports `AGENT_TARGETS` (re-exported from `types.js`), `resolveRoots`,
      `destinationFor`, `detectAgent`, `detectAgents`, `formatZeroDetection`, and the
      `DetectAgentsOpts` type, with the exact signatures in §4. `src/index.ts` re-exports the surface
      named in `01-architecture-layout.md` §4.
- [ ] `resolveRoots()` returns `{ home: os.homedir(), cwd: process.cwd() }` (resolved) by default and
      honors `home`/`cwd` overrides — verifiable with an injected sandbox HOME that never touches real `~`.
- [ ] `destinationFor(AGENT_TARGETS.claude, "global", { home: "/h" })` === `/h/.claude/skills/feature-forge`
      and `destinationFor(AGENT_TARGETS.cursor, "project", { cwd: "/c" })` === `/c/.cursor/rules/feature-forge`
      (all five rows × both scopes match the §4.4 table) — REQ-DET-01, REQ-FLAG-02.
- [ ] Detection is `stat`-based: with a sandbox HOME where `.claude` exists and the rest do not,
      `detectAgents({ scope: "global", home: <sandbox> })` returns `detected: true` only for `claude`;
      asserting **no agent subprocess** is spawned during detection (REQ-DET-02, REQ-PERF-01).
- [ ] `probeConfigDir` returns `false` (never throws) for a missing path, an unreadable path, and a
      non-directory at the path (REQ-DET-02/04).
- [ ] `cliOnPath` is populated as advisory info and does **not** affect `detected` (toggle PATH so the
      CLI is absent while the config dir exists ⇒ still `detected: true`) — REQ-DET-02.
- [ ] No-`--agent` call returns all five results in `AGENT_IDS` order; the caller's detected-subset is
      the default operation scope (REQ-DET-03). `detectAgents({ only: "codex" })` returns exactly one
      result for codex (REQ-FLAG-01).
- [ ] Zero-detection: with a sandbox HOME where no `.<agent>` dir exists,
      `formatZeroDetection(detectAgents({...}), scope)` names **every** probed dir, and the run creates
      **no** directory (assert the sandbox tree is unchanged) and produces no opaque error
      (REQ-DET-04).
- [ ] Adding a synthetic sixth row to `AGENT_TARGETS` + `AGENT_IDS` makes `detectAgents`/`destinationFor`
      cover it with **no edit** to any function in §4 (REQ-SCALE-01).
- [ ] Detection + `list` perform no network call and no build (assertable by injecting a failing
      `child_process`/network shim and confirming detection still succeeds) — REQ-PERF-01.
- [ ] `tsc --noEmit` passes under `strict` + `noUncheckedIndexedAccess` with these definitions, and the
      `node:test` detection suites in `01-architecture-layout.md` §3 (`test/`) pass via `node --test`.
