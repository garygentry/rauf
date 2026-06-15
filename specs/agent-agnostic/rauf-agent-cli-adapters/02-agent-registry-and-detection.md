# 02 — Agent Registry & Detection

> Feature: `rauf-agent-cli-adapters` (epic `agent-agnostic`, repo **rauf**). Based on `PRD.md` v2,
> `tech-spec.md` v2 (esp. §3.4–§3.5). Depends on `00-core-definitions.md` for all shared type and
> constant names — this document does NOT redefine them. Cross-references use exact filenames.
>
> This document specifies the **`agent-cli-registry`** charter contract: the descriptor layer
> over the existing factory map (`packages/loop/src/providers/registry.ts`), the availability
> **detection** primitive, and the discovery enumeration that feeds CLI help and the `rauf agents`
> surface. The *orchestration* that consumes detection — pre-loop fail-fast, per-iteration provider
> resolution — lives in `04-agent-selection.md` and `05-runner-wiring.md`; this document specifies
> the primitives those documents call.

## Requirement Coverage

| REQ ID | Requirement | Section |
|--------|-------------|---------|
| REQ-ADP-05 | Adapters discoverable/selectable through a registry keyed by stable agent id | 3.1, 3.2, 4 |
| REQ-DET-01 | Detect whether the selected agent's CLI is available | 4 (`detectAgent`), 5 (default probe) |
| REQ-DET-02 | `detectAgent` primitive used by pre-loop fail-fast (orchestration in `05`) | 4 (`detectAgent`), 7 (error semantics) |
| REQ-DISC-01 | Supported agent ids enumerable for CLI help / selection-error messages | 4 (`getAgentDescriptors`), 6 |
| REQ-DISC-02 | Discovery surface lists agents + live availability (data source for `rauf agents`) | 4 (`listAgents`), 6 |

> Cross-cutting requirements touched but **owned elsewhere**: REQ-USAGE-01 (claude credential
> `detect` override, behavior preserved — `08`/runner usage gating in `05`), REQ-SCALE-01
> (named config agents probe via the default detector — selection in `04`), REQ-ADP-04
> (`generic-cli` config shape — `03-cli-agent-engine-and-presets.md`).

## 1. Purpose & scope

The provider seam already ships a working factory registry — `registerProvider` / `createProvider`
/ `getAvailableProviders` / `clearProviders` (`providers/registry.ts:6/11/23/28`) — backed by a
`Map<string, ProviderFactory>`. That registry can construct a provider by id, but it cannot answer
two questions this feature requires:

1. **What agents exist, and what are their human-readable names / binaries?** (REQ-DISC-01/02)
2. **Is a given agent's CLI actually available on this machine, without instantiating it or running
   it as a subprocess?** (REQ-DET-01/02)

This document specifies a **descriptor layer** layered *over* the existing factory map. The factory
map and its four functions keep working **unchanged** (SC-2, REQ-COMPAT). A parallel descriptor map
adds enumerable metadata (`AgentDescriptor`) and an availability probe (`detectAgent` →
`DetectionResult`). All new types are defined in `00-core-definitions.md §3.3` and imported here —
**this document does not redefine `AgentDescriptor` or `DetectionResult`.**

**In scope:**
- The descriptor map and its relationship to the existing factory map (back-compatible wrapping).
- `registerAgent`, `getAgentDescriptors`, `listAgents`, `detectAgent` — signatures, semantics, error
  handling.
- The default PATH-probe detector algorithm (no agent subprocess).
- The `claude-cli` detector override (credential check) and the migration of its registration.
- The reserved `generic-cli` descriptor's custom `detect`.

**Out of scope (referenced, not specified here):**
- Pre-loop fail-fast orchestration and the `AgentUnavailableError` message assembly →
  `05-runner-wiring.md` (this doc provides the `detectAgent` primitive and `00 §5` provides the
  message template).
- The `CliAgent` engine, presets, and `generic-cli` config shape →
  `03-cli-agent-engine-and-presets.md`.
- Agent-selection precedence and named-config-agent resolution → `04-agent-selection.md`.
- The `rauf agents` command UI and `--agent` help enumeration formatting → `06-cli-surface.md`
  (this doc provides `getAgentDescriptors` / `listAgents` as the data source).

## 2. Design summary — descriptor layer over the factory map

```
                        providers/registry.ts (module state)
   ┌──────────────────────────────────┐   ┌──────────────────────────────────────┐
   │ factories: Map<string,           │   │ descriptors: Map<string,             │
   │            ProviderFactory>       │   │             AgentDescriptor>          │
   │  (EXISTING — unchanged behavior)  │   │  (NEW — parallel, enumerable+probe)   │
   └──────────────────────────────────┘   └──────────────────────────────────────┘
            ▲              ▲                          ▲              ▲
            │              │                          │              │
   registerProvider   createProvider          registerAgent   detectAgent /
   (existing)         (existing, throws       (new)           getAgentDescriptors /
            │          on unknown id)                          listAgents (new)
            │
            └── ALSO writes a wrapped descriptor (back-compat, §3.1)
```

Two module-level maps coexist in `registry.ts`:

- **`factories`** — the existing `Map<string, ProviderFactory>` (`registry.ts:3`). `createProvider`
  reads from it. **Unchanged.**
- **`descriptors`** — a new `Map<string, AgentDescriptor>`. `getAgentDescriptors` / `listAgents` /
  `detectAgent` read from it.

`registerAgent` is the canonical write path: it writes **both** maps (the factory into `factories`,
the full descriptor into `descriptors`). `registerProvider` remains the legacy write path and is
made to ALSO populate `descriptors` with a synthesized descriptor (§3.1), so any caller still using
`registerProvider` remains enumerable and probeable. This is what makes the layer back-compatible:
nothing that calls `registerProvider`/`createProvider` today breaks, and everything registered
becomes discoverable.

Sync-vs-async reconciliation (the tech-spec §2 note shows `getAgentDescriptors() // [{ id,
displayName, available, binaryName }]` while descriptors are inherently static): we resolve this by
splitting into **two functions** (§4):

- **`getAgentDescriptors(): AgentDescriptor[]`** — synchronous, returns the **static** descriptors
  exactly as registered (no `available` field). This is the cheap enumeration used by `--agent`
  help and selection-error messages (REQ-DISC-01), which must not block on PATH I/O.
- **`listAgents(): Promise<AgentAvailability[]>`** — asynchronous, awaits each descriptor's `detect`
  and returns `{ id, displayName, binaryName, available, detail }`. This is the live-availability
  data source for the `rauf agents` command (REQ-DISC-02).

This split is justified because the two callers have different needs: help enumeration is on a
synchronous, hot path and must never do filesystem I/O; the discovery command is explicitly about
live availability and can await. Bundling availability into a synchronous `getAgentDescriptors`
would force a blocking probe on the help path; making the help path async would ripple `await`
through CLI help assembly for no benefit. The tech-spec §2 `// [{ id, displayName, available,
binaryName }]` note describes the **shape returned by `listAgents`**; `getAgentDescriptors` returns
the static descriptors. Both are exported (`01-architecture-layout.md §4`).

## 3. Internal implementation

### 3.1 Back-compatible `registerProvider` wrapping (REQ-ADP-05, REQ-COMPAT, SC-2)

`registerProvider(id, factory)` keeps its existing one-line behavior (write the factory into
`factories`) **and** additionally synthesizes a default descriptor into `descriptors` so the agent
is enumerable/probeable. Precise wrap behavior:

```ts
// providers/registry.ts  (EDIT — back-compat wrap)
import type { LLMProvider, ProviderFactory } from "./types.js";
import type { AgentDescriptor, DetectionResult } from "./types.js"; // 00 §3.3

const factories = new Map<string, ProviderFactory>();          // EXISTING
const descriptors = new Map<string, AgentDescriptor>();        // NEW (parallel)

/**
 * Register a provider factory by id (EXISTING surface — unchanged signature).
 * Back-compat behavior added by this feature: in addition to populating the factory map,
 * this synthesizes a default {@link AgentDescriptor} so any provider registered the legacy
 * way remains enumerable (REQ-DISC-01) and probeable (REQ-DET-01) without the caller
 * adopting `registerAgent`. The synthesized descriptor uses:
 *   - `id`         : the given id
 *   - `displayName`: the given id (no friendly name is available from a bare factory)
 *   - `binaryName` : the id itself (best-effort PATH-probe target; see note)
 *   - `factory`    : the given factory
 *   - `detect`     : omitted ⇒ the default PATH probe of `binaryName` (§5)
 * An explicit later `registerAgent({ id, ... })` for the same id OVERWRITES this synthesized
 * descriptor with the richer one (last write wins, same as the factory map).
 *
 * @param id       Stable agent id (registry key / provider id).
 * @param factory  Factory constructing the provider instance.
 */
export function registerProvider(id: string, factory: ProviderFactory): void {
  factories.set(id, factory);
  // Only synthesize if no richer descriptor already registered for this id.
  if (!descriptors.has(id)) {
    descriptors.set(id, { id, displayName: id, binaryName: id, factory });
  }
}
```

Notes on the synthesized `binaryName`:

- A bare `ProviderFactory` carries no binary name, so we cannot know the real executable. We default
  `binaryName` to the **id** as a best-effort PATH-probe target. For the legacy `claude-cli`
  registration this would be wrong (`claude-cli` is not a binary; the binary is `claude`), which is
  exactly why this feature **migrates `claude-cli` to `registerAgent`** with an explicit
  `binaryName: "claude"` and a credential `detect` override (§3.3) — the migration removes reliance
  on the synthesized default for the one shipped legacy registrant.
- Any *future* third-party caller still using `registerProvider("foo", ...)` gets a descriptor that
  PATH-probes `foo`. If that is wrong, they should call `registerAgent` instead. This is documented
  back-compat, not a guarantee that `id === binary`.

`createProvider` (`registry.ts:11`) is **unchanged**: it reads `factories`, and still **throws** on
an unknown id with the available-ids message (`registry.ts:15`). `getAvailableProviders`
(`registry.ts:23`) and `clearProviders` (`registry.ts:28`) are unchanged, except `clearProviders`
MUST also clear `descriptors` (§3.4).

### 3.2 `registerAgent` — descriptor write path (REQ-ADP-05)

`registerAgent` is the canonical, descriptor-aware registration. It writes the factory into
`factories` (so `createProvider(id)` works) and the full descriptor into `descriptors` (so
enumeration/detection work). It is the descriptor-form sibling of `registerProvider`
(`01-architecture-layout.md §4` calls it "descriptor-form alias of `registerProvider`").

### 3.3 `claude-cli` migration — registration only, behavior preserved (REQ-USAGE-01, SC-2)

`providers/claude-cli.ts` migrates its **registration** from `registerProvider("claude-cli",
createClaudeCliProvider)` (`claude-cli.ts:55`) to a `registerAgent({...})` call. The adapter class
(`ClaudeCliProvider`) and its `execute` / `validateCredentials` / `checkUsage`
(`claude-cli.ts:13/30/41`) are **unchanged** — only the bottom-of-file registration line changes:

```ts
// providers/claude-cli.ts  (EDIT — registration line ONLY; class body unchanged)
import { registerAgent } from "./registry.js";          // was: registerProvider
import { ok } from "@rauf/core";                          // for the detect override result
import type { DetectionResult } from "./types.js";       // 00 §3.3

// ... ClaudeCliProvider class and createClaudeCliProvider() UNCHANGED (claude-cli.ts:9-52) ...

/**
 * Availability probe for claude-cli. Overrides the default PATH probe (§5): claude availability
 * is gated on its OAuth credential being readable, not on the `claude` binary being on PATH —
 * this preserves today's pre-loop credential semantics (REQ-USAGE-01, SC-2). Reuses the exact
 * credential check `createClaudeCliProvider().validateCredentials()` (claude-cli.ts:30-39),
 * which calls `readClaudeOAuthToken()`.
 */
async function detectClaudeCli(): Promise<DetectionResult> {
  const provider = createClaudeCliProvider();
  const result = provider.validateCredentials();
  if (result.ok) {
    return { available: true, detail: "Claude OAuth credentials present" };
  }
  return { available: false, detail: result.error.message };
}

// Register as the default agent (migrated from registerProvider — behavior preserved).
registerAgent({
  id: "claude-cli",                 // === DEFAULT_AGENT_ID (00 §6)
  displayName: "Claude Code (CLI)", // matches ClaudeCliProvider.displayName (claude-cli.ts:11)
  binaryName: "claude",             // real executable name (NOT "claude-cli")
  factory: createClaudeCliProvider, // unchanged factory (claude-cli.ts:50)
  detect: detectClaudeCli,          // credential check, NOT a PATH probe
});
```

`detect` is `async` and returns `DetectionResult` (never throws) — a missing credential is
`{ available: false }`, not an exception. The `validateCredentials` call is synchronous and already
returns a `Result` (`claude-cli.ts:30`); wrapping it in an `async` function gives the uniform
`Promise<DetectionResult>` detector signature. This keeps the claude path's "credentials present?"
check as its availability definition, exactly as the pre-loop preflight expects (REQ-USAGE-01;
the *usage banner / pause-resume* logic is unchanged and gated in `05-runner-wiring.md §4.3`).

### 3.4 `clearProviders` clears both maps (testability)

`clearProviders` (`registry.ts:28`, "for testing") MUST clear **both** `factories` and
`descriptors` so tests start from a clean registry. This is the only behavioral addition to an
existing function:

```ts
/** Clear all registered providers AND descriptors (for testing). */
export function clearProviders(): void {
  factories.clear();
  descriptors.clear();
}
```

`registry.test.ts` (and any test calling `clearProviders` before re-registering, including the
existing `claude-cli` side-effect tests) relies on both maps being reset together.

### 3.5 Descriptor / factory-map invariants

- Every id in `descriptors` has a corresponding entry in `factories` (both write paths populate the
  factory). The converse also holds after this feature (back-compat wrap §3.1), so the two maps have
  identical key sets at all times. `getAgentDescriptors().map(d => d.id)` and
  `getAvailableProviders()` therefore return the same id set (ordering follows `Map` insertion).
- `detectAgent(id)` and `getAgentDescriptors()` read `descriptors` only; they never call
  `createProvider` or instantiate the factory (except the `claude-cli` / `generic-cli` `detect`
  overrides, which construct a lightweight provider/config solely to run their own probe — never to
  execute an iteration).

## 4. Public API (full signatures)

All defined in `providers/registry.ts`, re-exported through `providers/index.ts` and the package
barrel `packages/loop/src/index.ts` (`01-architecture-layout.md §4`). Types `AgentDescriptor` and
`DetectionResult` are imported from `./types.js` (`00-core-definitions.md §3.3`) and NOT redefined.

```ts
// providers/registry.ts
import type { AgentDescriptor, DetectionResult } from "./types.js"; // 00 §3.3
import type { LLMProvider, ProviderFactory } from "./types.js";

/**
 * Register an agent via its full descriptor (REQ-ADP-05). Canonical descriptor-aware write path
 * and the descriptor-form sibling of {@link registerProvider}. Populates BOTH the factory map
 * (so {@link createProvider} can construct it) and the descriptor map (so {@link detectAgent},
 * {@link getAgentDescriptors}, and {@link listAgents} can enumerate/probe it). Last write wins
 * per id (overwrites any prior descriptor, including one synthesized by {@link registerProvider}).
 *
 * @param d Full {@link AgentDescriptor} (00 §3.3). `d.detect` omitted ⇒ the default PATH probe
 *          of `d.binaryName` is used (§5). `d.binaryName` omitted is valid ONLY when `d.detect`
 *          is supplied (e.g. the reserved `generic-cli` descriptor, §3.6 of tech-spec / §5.4 here).
 */
export function registerAgent(d: AgentDescriptor): void;

/**
 * Return the STATIC descriptors for every registered agent (REQ-DISC-01), synchronously and
 * without any PATH/credential I/O. Used by `--agent` help enumeration and by selection-error
 * messages (the "Supported agents: <ids>" list, 00 §5). Does NOT include live `available` —
 * for availability use {@link listAgents}.
 *
 * @returns Array of {@link AgentDescriptor} in registration (Map insertion) order.
 */
export function getAgentDescriptors(): AgentDescriptor[];

/**
 * Resolve LIVE availability for every registered agent (REQ-DISC-02). Awaits each descriptor's
 * `detect` (default PATH probe, or the agent's override) and flattens the result into a discovery
 * row. This is the data source for the `rauf agents` command (UI in `06-cli-surface.md`).
 * Never throws: a detector that rejects is reported as `available: false` with the error message
 * as `detail` (§7).
 *
 * @returns Array of {@link AgentAvailability} in registration order, availability resolved.
 */
export function listAgents(): Promise<AgentAvailability[]>;

/**
 * Probe whether one agent's CLI is available on the current machine (REQ-DET-01). This is the
 * detection PRIMITIVE consumed by the pre-loop fail-fast orchestration (REQ-DET-02), which is
 * specified in `05-runner-wiring.md` (it calls `detectAgent` for the run-level id and every
 * distinct per-item provider, then builds the `AgentUnavailableError` message from 00 §5).
 *
 * Runs the descriptor's `detect` if present, else the default PATH probe of `binaryName` (§5).
 * NEVER throws and never spawns the agent as a subprocess (CLAUDE.md "status reads files, not
 * subprocesses"; PATH resolution is a stat, not an invocation). An absent binary / missing
 * credential is a normal `{ available: false, detail }` result — NOT an error (§7).
 *
 * @param id Stable agent id (registry key).
 * @returns A {@link DetectionResult}. For an UNKNOWN/unregistered id, resolves to
 *          `{ available: false, detail: 'Unknown agent "<id>". Supported agents: <ids>.' }`
 *          (it does NOT throw — unlike `createProvider`; see §7).
 */
export function detectAgent(id: string): Promise<DetectionResult>;
```

`AgentAvailability` is the only net-new type introduced by this document (a thin discovery DTO,
not persisted, not a shared core type — it belongs to the registry's discovery surface). It is
defined in `providers/registry.ts` and re-exported alongside the registry functions:

```ts
// providers/registry.ts
/**
 * One row of the discovery surface (REQ-DISC-02): a static descriptor flattened with its
 * resolved live availability. Returned by {@link listAgents}; rendered by `rauf agents`
 * (`06-cli-surface.md`). Not persisted; no schema impact.
 */
export interface AgentAvailability {
  /** Stable agent id (registry key). */
  id: string;
  /** Human-readable name (from the descriptor's `displayName`). */
  displayName: string;
  /** Executable probed on PATH, or undefined for binary-less descriptors (e.g. generic-cli). */
  binaryName?: string;
  /** Whether the agent's CLI / credentials are currently available (from `detect`). */
  available: boolean;
  /** Human-readable detail (PATH location, "not found", or credential status). */
  detail?: string;
}
```

> The existing factory-map functions — `registerProvider(id, factory): void`,
> `createProvider(providerId, config?): LLMProvider` (throws on unknown id), `getAvailableProviders():
> string[]`, `clearProviders(): void` — keep their **exact** signatures (`registry.ts:6/11/23/28`).
> Only `registerProvider` (back-compat wrap, §3.1) and `clearProviders` (clear both maps, §3.4) gain
> internal behavior; their signatures are untouched.

## 5. Internal implementation — default PATH-probe detector (REQ-DET-01)

When a descriptor supplies no `detect`, `detectAgent` uses a default detector that resolves
`binaryName` on `PATH` using Node built-ins only — **no agent subprocess** (CLAUDE.md rule 6 /
`01-architecture-layout.md §1`). This is a `which`-style stat probe.

### 5.1 Algorithm

```ts
// providers/registry.ts (internal helper — not exported)
import { access, constants } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import { delimiter } from "node:path";

/**
 * Default availability probe: resolve `binaryName` on PATH without executing it (REQ-DET-01).
 * Algorithm (which-style):
 *   1. If `binaryName` is an absolute path, probe it directly for executable access.
 *   2. Otherwise split `process.env.PATH` on the platform path delimiter (node:path `delimiter`);
 *      for each non-empty entry, join `entry + binaryName` and probe for executable access.
 *      On win32, also try the `PATHEXT` extensions (`.exe`, `.cmd`, ...) — but rauf's runtime
 *      target is Bun on POSIX, so the base case (no extension) is the primary path.
 *   3. The FIRST entry granting `fs.constants.X_OK` resolves `{ available: true, detail: "found
 *      at <fullpath>" }`.
 *   4. If no entry resolves, `{ available: false, detail: 'binary "<binaryName>" not found on
 *      PATH' }`.
 * No subprocess is ever spawned; this is `access()` (a stat), consistent with CLAUDE.md
 * "status reads files, not subprocesses".
 *
 * @param binaryName Executable to resolve (e.g. "codex", "cursor-agent").
 * @returns DetectionResult; never throws (an unreadable/missing PATH entry is skipped).
 */
async function probeBinaryOnPath(binaryName: string): Promise<DetectionResult> {
  if (isAbsolute(binaryName)) {
    try {
      await access(binaryName, constants.X_OK);
      return { available: true, detail: `found at ${binaryName}` };
    } catch {
      return { available: false, detail: `binary "${binaryName}" not found on PATH` };
    }
  }

  const pathEnv = process.env.PATH ?? "";
  const dirs = pathEnv.split(delimiter).filter((d) => d.length > 0);
  for (const dir of dirs) {
    const candidate = join(dir, binaryName);
    try {
      await access(candidate, constants.X_OK);
      return { available: true, detail: `found at ${candidate}` };
    } catch {
      // not here / not executable — try next PATH entry
    }
  }
  return { available: false, detail: `binary "${binaryName}" not found on PATH` };
}
```

### 5.2 `detectAgent` dispatch

```ts
export async function detectAgent(id: string): Promise<DetectionResult> {
  const descriptor = descriptors.get(id);
  if (!descriptor) {
    const ids = getAgentDescriptors()
      .map((d) => d.id)
      .join(", ");
    return {
      available: false,
      detail: `Unknown agent "${id}". Supported agents: ${ids || "(none)"}.`,
    };
  }

  // 1. Explicit override (claude-cli credential check, generic-cli config probe).
  if (descriptor.detect) {
    try {
      return await descriptor.detect();
    } catch (e) {
      // A detector that throws is reported as unavailable, never propagated (§7).
      return { available: false, detail: e instanceof Error ? e.message : String(e) };
    }
  }

  // 2. Default PATH probe — requires a binaryName.
  if (!descriptor.binaryName) {
    // Only valid when a detect was supplied; a binary-less descriptor with no detect is a
    // registration bug. Report unavailable with a diagnostic rather than throwing.
    return {
      available: false,
      detail: `agent "${id}" has no binaryName and no detect override (registration bug)`,
    };
  }
  return probeBinaryOnPath(descriptor.binaryName);
}
```

### 5.3 `getAgentDescriptors` / `listAgents`

```ts
export function getAgentDescriptors(): AgentDescriptor[] {
  return [...descriptors.values()];
}

export async function listAgents(): Promise<AgentAvailability[]> {
  const out: AgentAvailability[] = [];
  for (const d of descriptors.values()) {
    const result = await detectAgent(d.id); // never throws (§5.2)
    out.push({
      id: d.id,
      displayName: d.displayName,
      binaryName: d.binaryName,
      available: result.available,
      detail: result.detail,
    });
  }
  return out;
}
```

> `listAgents` awaits detectors sequentially for deterministic output ordering and trivial PATH
> cost. If a future profiling pass shows it matters, the loop may be parallelized with
> `Promise.all` while preserving registration order — behavior (the returned rows) is identical
> either way; this is an implementation detail, not a contract.

### 5.4 The reserved `generic-cli` descriptor (REQ-DET-01, cross-ref `03`)

The reserved `generic-cli` id (`GENERIC_AGENT_ID`, `00 §6`) is registered by `generic-cli.ts`
(specified in `03-cli-agent-engine-and-presets.md`) via `registerAgent` with **no `binaryName`** and
a **custom `detect`**. Its binary is unknown until the per-run `MarkerOptions.providerConfig` is read
(tech-spec §3.4 case 2), so it cannot use the default PATH probe at registration time. This document
specifies how its descriptor plugs into the registry; the config shape and the `CliAgent` engine are
in `03`.

Required `detect` semantics for the `generic-cli` descriptor (so enumeration never fails — `listAgents`
must always be able to report it):

- If no `providerConfig` is available at probe time (the common discovery case — `rauf agents` with
  no run context), resolve `{ available: true, detail: "configurable; binary resolved from
  providerConfig at run time" }`. It is reported as **available/unknown** rather than failing
  enumeration, because absence of a binary name is expected for this reserved adapter, not an error.
- When a `providerConfig` with a `binary` IS supplied to the detector (e.g. the runner's pre-loop
  detection for a `generic-cli` run, `05`), the detector PATH-probes that binary via the shared
  `probeBinaryOnPath` helper (§5.1) and returns its real result.

```ts
// providers/generic-cli.ts (descriptor registration — full detector spec in 03; binding shown here)
// import { registerAgent } from "./registry.js";
// import { GENERIC_AGENT_ID } from "...";  // 00 §6
// registerAgent({
//   id: GENERIC_AGENT_ID,                  // "generic-cli"
//   displayName: "Generic CLI agent (configurable)",
//   // binaryName intentionally OMITTED (00 §3.3: omitted ONLY for generic-cli)
//   factory: createGenericCliProvider,     // specified in 03
//   detect: detectGenericCli,              // resolves binary from providerConfig, else available/unknown
// });
```

> **Named config agents are NOT this case.** An `--agent <id>` matching a `ToolConfig.providers[<id>]`
> entry (tech-spec §3.4 case 1) carries its own `binary` in config, so its descriptor (built by the
> selection layer, `04-agent-selection.md`) DOES have a `binaryName` and probes via the default
> detector (§5). The "omitted `binaryName`" rule from `00 §3.3` applies **only** to the single
> reserved `generic-cli` descriptor.

## 6. `providers/index.ts` — register all built-ins (side-effect)

`providers/index.ts` extends its side-effect registration to register **all** built-in adapters
(claude-cli + the four presets + generic-cli) rather than claude-cli alone (tech-spec §2,
`01-architecture-layout.md §4`), and re-exports the new registry symbols:

```ts
// providers/index.ts (EDIT)
export type {
  ProviderId, LLMProvider, ExecuteOptions, ExecutionResult,
  ProviderProgressEvent, UsageLimitResult, ProviderFactory, ProgressCallback,
} from "./types.js";                                   // EXISTING
export type { AgentAdapter, AgentDescriptor, DetectionResult } from "./types.js";   // NEW (AgentAdapter = LLMProvider alias, 00 §2; descriptor types 00 §3.3)

export {
  registerProvider, createProvider, getAvailableProviders, clearProviders, // EXISTING
  registerAgent, getAgentDescriptors, listAgents, detectAgent,             // NEW
} from "./registry.js";
export type { AgentAvailability } from "./registry.js";                    // NEW (§4)

export { createClaudeCliProvider } from "./claude-cli.js";                 // EXISTING

// CliAgent engine + its config types (defined in cli-agent.ts, 00 §3.2, 03 §3.1).
// Re-exported here so the package barrel (01 §4) resolves them via ./providers/index.js.
export { CliAgent } from "./cli-agent.js";                                 // NEW (03)
export type { CliAgentConfig, PromptDelivery, BuildArgsContext } from "./cli-agent.js"; // NEW (00 §3.2)

// Side-effect imports: register ALL built-in adapters
import "./claude-cli.js";   // registers "claude-cli" via registerAgent (§3.3)
import "./presets.js";      // registers codex/gemini/copilot/cursor (03)
import "./generic-cli.js";  // registers reserved "generic-cli" descriptor (§5.4; 03 §7)
```

> The preset and `generic-cli` registration calls themselves are specified in
> `03-cli-agent-engine-and-presets.md`; this document requires only that they register via
> `registerAgent` so they appear in `descriptors`.

## 7. Configuration

This module is **stateless w.r.t. files** — it reads no config files itself. Its only environment
input is `process.env.PATH` (read by the default detector, §5.1). No new config keys, no schema
change (`00 §4`, tech-spec §4). The named-config-agent path that *does* read `ToolConfig.providers`
to synthesize a descriptor with a `binaryName` is owned by `04-agent-selection.md`; this module just
probes whatever `binaryName` that descriptor carries.

PATH probing touches the filesystem only via `fs.access` (a stat) on PATH directories — it does not
write, does not invoke any binary, and stays within the OS PATH (no `ROOT_DIRECTORY` / `~/.rauf/`
sandbox concern, since it reads no project files; CLAUDE.md sandboxing applies to *writes* and
*project reads*, neither of which occurs here).

## 8. Error handling

Per CLAUDE.md, core functions return `Result<T, E>` and never throw for expected errors. The
detection surface deliberately models "not available" as **data, not an error**:

| Situation | Behavior | REQ |
|---|---|---|
| Binary not on PATH (default probe) | `detectAgent` resolves `{ available: false, detail: 'binary "<b>" not found on PATH' }` — NOT a throw, NOT a rejected Promise | REQ-DET-01 |
| Binary found on PATH | `{ available: true, detail: "found at <fullpath>" }` | REQ-DET-01 |
| Claude credentials missing (`claude-cli` override) | `{ available: false, detail: <validateCredentials error message> }` (reuses `claude-cli.ts:30-39`) | REQ-USAGE-01 |
| `generic-cli` probed with no providerConfig | `{ available: true, detail: "configurable; binary resolved at run time" }` — enumeration never fails | REQ-DISC-02 |
| Descriptor's `detect` throws/rejects | caught in `detectAgent`; reported as `{ available: false, detail: <message> }` | REQ-DET-02 |
| Unknown / unregistered id passed to `detectAgent` | `{ available: false, detail: 'Unknown agent "<id>". Supported agents: <ids>.' }` — resolves, does NOT throw | REQ-DET-02, REQ-DISC-01 |
| Unknown / mistyped id passed to `createProvider` | **THROWS** (existing behavior, `registry.ts:15`), listing available ids. The selection/runner layers wrap it into a `Result` error (`04-agent-selection.md`, `05-runner-wiring.md`; `00 §5`) | REQ-DISC-01 |

Key distinctions:

- **`detectAgent` never throws.** It is a primitive the runner calls during pre-loop fail-fast; the
  runner inspects `result.available` and, when false, constructs the `AgentUnavailableError`-shaped
  `Result` error (the semantic label from `00 §5`, message owned by `05-runner-wiring.md`) **before
  any iteration runs or any state is written** (REQ-DET-02, SC-3). This document provides the probe;
  `05` owns the fail-fast decision and message. There is **no silent fallback to claude** anywhere in
  this module.
- **`createProvider` still throws** on an unknown id (unchanged, `registry.ts:15`). That throw is the
  existing contract for *construction*; detection is a separate, non-throwing path. The two coexist:
  `detectAgent` answers "is it available?" without constructing; `createProvider` constructs and
  rejects unknown ids loudly. The per-iteration resolve in `05` wraps `createProvider` in try/catch
  to convert the throw into a `Result` error (`00 §5`).
- **A detector throwing is defensive-only.** The shipped detectors (default PATH probe, claude
  credential check, generic-cli config probe) are written not to throw; the `try/catch` in `§5.2` is
  a backstop so a buggy third-party `detect` cannot crash discovery or pre-loop detection.

## 9. Example usage

```ts
import {
  registerAgent, getAgentDescriptors, listAgents, detectAgent,
} from "@rauf/loop"; // barrel; or "./providers/index.js" within the package

// 1. Register a first-class agent with a default PATH probe (preset, see 03).
registerAgent({
  id: "codex",
  displayName: "OpenAI Codex (CLI)",
  binaryName: "codex",
  factory: createCodexProvider, // from presets.ts (03)
  // detect omitted ⇒ default PATH probe of "codex" (§5)
});

// 2. Enumerate for --agent help / selection-error messages (sync, no I/O — REQ-DISC-01).
const ids = getAgentDescriptors().map((d) => d.id);
// e.g. ["claude-cli", "codex", "gemini", "copilot", "cursor", "generic-cli"]

// 3. Live availability for `rauf agents` (async — REQ-DISC-02).
const rows = await listAgents();
// e.g. [{ id: "claude-cli", displayName: "Claude Code (CLI)", binaryName: "claude",
//         available: true,  detail: "Claude OAuth credentials present" },
//       { id: "codex", displayName: "OpenAI Codex (CLI)", binaryName: "codex",
//         available: false, detail: 'binary "codex" not found on PATH' }, ... ]

// 4. The pre-loop fail-fast primitive (orchestration in 05-runner-wiring.md — REQ-DET-01/02).
const probe = await detectAgent("codex");
if (!probe.available) {
  // 05 builds the AgentUnavailableError-shaped Result error from probe.detail + 00 §5 template,
  // names the agent + remediation + getAgentDescriptors() ids, and returns BEFORE writing state.
}
```

## Dependencies

Implement **after**:

- `00-core-definitions.md` — provides `AgentDescriptor`, `DetectionResult` (§3.3), `ProviderFactory`
  / `LLMProvider` (§7 reused contracts), `DEFAULT_AGENT_ID` / `GENERIC_AGENT_ID` (§6). These types
  MUST already exist in `providers/types.ts` (added per `00`).
- `01-architecture-layout.md` — the barrel export surface (`packages/loop/src/index.ts §4`) and the
  module tree (`providers/registry.ts` EDIT, `providers/index.ts` EDIT).

Existing source this document edits / reuses (verified against source):

- `packages/loop/src/providers/registry.ts` — factory map + `registerProvider` (`:6`),
  `createProvider` (`:11`, throws `:14`), `getAvailableProviders` (`:23`), `clearProviders` (`:28`).
  EDIT: add `descriptors` map, `registerAgent`, `getAgentDescriptors`, `listAgents`, `detectAgent`,
  `AgentAvailability`, `probeBinaryOnPath`; back-compat wrap `registerProvider`; clear both maps in
  `clearProviders`.
- `packages/loop/src/providers/claude-cli.ts` — `createClaudeCliProvider` (`:50`), the
  `validateCredentials` credential check (`:30-39`), `checkUsage` (`:41-47`), registration line
  (`:55`). EDIT: registration migrates from `registerProvider` (`:55`) to `registerAgent` + add
  `detectClaudeCli`. Class body UNCHANGED.
- `packages/loop/src/providers/types.ts` — `ProviderFactory` (`:81-82`), `LLMProvider` (`:12-33`).
  Read-only from this doc's perspective (the new types live here but are specified by `00`).
- `packages/loop/src/providers/index.ts` — EDIT: register all built-ins (side-effect), re-export new
  symbols.
- `@rauf/core` — `ok` / `err` / `ErrorCodes` (`FILE_NOT_FOUND`, `VALIDATION_ERROR`), `Result`
  (verified: `packages/core/src/errors.ts`). Used by the `claude-cli` `detect` override result and
  (in `05`) the fail-fast error.

Node built-ins (no new package — tech-spec §9): `node:fs/promises` (`access`, `constants`),
`node:path` (`join`, `isAbsolute`, `delimiter`).

Depended on **by**: `03-cli-agent-engine-and-presets.md` (presets + `generic-cli` register via
`registerAgent`), `04-agent-selection.md` (builds descriptors for named config agents; surfaces the
`createProvider` throw as a `Result`), `05-runner-wiring.md` (pre-loop `detectAgent` fail-fast,
`getAgentDescriptors` ids in error messages), `06-cli-surface.md` (`getAgentDescriptors` for
`--agent` help; `listAgents` for `rauf agents`).

## Verification

- [ ] `registry.ts` holds two module-level maps — the existing `factories` and a new `descriptors`
  — and `registerProvider`, `createProvider`, `getAvailableProviders` keep their exact signatures
  (`:6/11/23`).
- [ ] `registerProvider(id, factory)` still works unchanged AND now also populates `descriptors`
  with a synthesized descriptor (`displayName: id`, `binaryName: id`, no `detect`); an unknown id
  passed to `createProvider` still **throws** (`:14`).
- [ ] `registerAgent(d)` populates BOTH maps; a later `registerAgent` for the same id overwrites the
  prior (synthesized or explicit) descriptor.
- [ ] `clearProviders()` clears BOTH `factories` and `descriptors`.
- [ ] `getAgentDescriptors()` is synchronous, returns `AgentDescriptor[]` in registration order, with
  NO `available` field; its id set equals `getAvailableProviders()`.
- [ ] `listAgents()` is `async`, returns `AgentAvailability[]` with `available` resolved per
  descriptor's `detect`; never rejects even if a detector throws.
- [ ] `detectAgent(id)` returns a `Promise<DetectionResult>`; never throws; never spawns a subprocess;
  PATH probe uses `fs.access(..., X_OK)` over `process.env.PATH`.
- [ ] Default probe returns `{ available: true, detail: "found at <path>" }` when the binary resolves
  and `{ available: false, detail: 'binary "<b>" not found on PATH' }` when it does not.
- [ ] `detectAgent("<unknown id>")` resolves `{ available: false, detail: 'Unknown agent ... Supported
  agents: <ids>.' }` (does not throw).
- [ ] `claude-cli` is registered via `registerAgent` with `binaryName: "claude"` and a `detect` that
  reuses `validateCredentials` (credential present ⇒ available); the `ClaudeCliProvider` class body and
  `createClaudeCliProvider` are byte-for-byte unchanged (SC-2).
- [ ] The reserved `generic-cli` descriptor omits `binaryName` and supplies a `detect` that resolves
  `{ available: true }` when no `providerConfig` is present (enumeration never fails), and PATH-probes
  the configured binary when one is supplied (full spec in `03`).
- [ ] Named config agents (case 1) carry a `binaryName` and use the default probe (no special-casing
  in `detectAgent`).
- [ ] `providers/index.ts` registers all built-ins and re-exports `registerAgent`,
  `getAgentDescriptors`, `listAgents`, `detectAgent`, `AgentAvailability`, `AgentDescriptor`,
  `DetectionResult`; the package barrel re-exports them (`01 §4`).
- [ ] `registry.test.ts` covers: back-compat `registerProvider` enumeration, `registerAgent`
  overwrite, default PATH probe found/not-found, claude credential override, generic-cli no-config
  available, unknown-id non-throwing `detectAgent`, `clearProviders` clearing both maps.
- [ ] `pnpm build && pnpm typecheck && pnpm test` green for `@rauf/loop`; `pnpm gate` green (SC-7).
