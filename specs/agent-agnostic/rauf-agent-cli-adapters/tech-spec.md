# rauf-agent-cli-adapters — Technical Specification

> Epic: `agent-agnostic` (member). Target repo: **rauf** (this repo). Based on PRD v2.
> Charter obligations (`epic-manifest.json`): expose `AgentAdapter`, `agent-cli-registry`,
> `loop-agent-selection`. This feature **consumes nothing** (foundation node).

## 1. Overview

The decisive finding from codebase research reframes this feature: **the provider seam already
exists and is tested — it is simply not wired into the runner.** `packages/loop/src/providers/`
already ships:

- `LLMProvider` (interface), `ExecuteOptions`, `ExecutionResult`, `ProviderFactory`
  (`providers/types.ts`).
- A factory registry — `registerProvider` / `createProvider` / `getAvailableProviders` /
  `clearProviders` (`providers/registry.ts`), with tests.
- A complete, tested `claude-cli` adapter wrapping `spawnClaude` + the Anthropic usage checks
  (`providers/claude-cli.ts`), registered via a side-effect import (`providers/index.ts`).
- All committed schema fields: `BacklogItem.provider`/`.model`, `LoopStartOptions.provider`,
  `ToolConfig.defaultProvider`/`.providers`, `MarkerOptions.provider`/`.providerConfig`
  (`packages/core/src/schemas.ts`).
- Renamed lifecycle events `llm_spawned` / `llm_exited` (the CLI already prints `event.provider`).

What is missing — the real scope here — is: (a) **wire** the runner to drive iterations through a
resolved provider instead of calling `spawnClaude` directly at two sites; (b) **extend** the seam
with availability **detection** and an **agent-selection resolver**; (c) **add** a config-driven
CLI engine plus the `codex`/`gemini`/`copilot`/`cursor` presets and the `generic-cli` adapter; and
(d) **prove** it with mock agents in `test-sandbox/`.

### Key architectural decisions (settled in interview)

1. **Naming = alias over `provider`** (OQ-1). Internal `provider` / `LLMProvider` and all committed
   schema fields are unchanged. `--agent` / `agent` is the user-facing surface that maps onto
   `provider`. `AgentAdapter` is exported as a type alias of `LLMProvider` to satisfy the charter.
   Lowest risk to the claude path (SC-2); matches PRD REQ-SEL-01 note.
2. **Adapter shape = config-driven engine + presets** (OQ-3). One `CliAgent` engine (binary, args
   template, prompt delivery, model-flag, non-interactive flag, env) backs `generic-cli` and the
   named presets `codex`/`gemini`/`copilot`/`cursor`. `claude-cli` stays its own bespoke adapter.
3. **Detection = registry descriptors.** Registration carries `{ id, displayName, binaryName,
   factory, detect }`, so agents are enumerable and probable without instantiating a provider or
   reading config.
4. **Test mocks = per-agent plain-text mocks + generic via config.** Generalize the sandbox driver
   env, add plain-text mock agents reusing the scenario scripts, exercise the plain-text signal
   path, and drive `generic-cli` at a standalone mock script.

## 2. Module Structure

All work is in `packages/loop` (CLAUDE.md rule: adapter layer lives in `packages/loop`;
`packages/core` keeps zero imports from cli/web). CLI surface additions are in `packages/cli`.

```
packages/loop/src/
├── providers/                      # EXISTING seam — extended in place
│   ├── types.ts                    # + AgentDescriptor, + DetectionResult; AgentAdapter alias
│   ├── registry.ts                 # descriptor-based registration + detection enumeration
│   ├── index.ts                    # register all built-in adapters (side-effect)
│   ├── claude-cli.ts               # UNCHANGED behavior; migrated to descriptor registration
│   ├── cli-agent.ts                # NEW — config-driven CLI engine (CliAgent)
│   ├── presets.ts                  # NEW — codex/gemini/copilot/cursor preset configs
│   ├── generic-cli.ts              # NEW — CliAgent driven by providerConfig
│   └── *.test.ts                   # colocated tests (existing + new)
├── agent-selection.ts             # NEW — loop-agent-selection precedence resolver
├── runner.ts                       # WIRE: route both exec paths + usage through provider
├── claude-process.ts              # UNCHANGED (claude-cli internals)
├── signal-parser.ts               # UNCHANGED parse logic
├── signal-redactor.ts             # extended: add neutralizeForDetection() + RAUF_REVIEW
└── index.ts                        # public exports: AgentAdapter, registry, selection

packages/cli/src/
└── loop-commands.ts                # + --agent flag; + `rauf agents` discovery command

test-sandbox/
├── codex | gemini | copilot | cursor   # NEW plain-text mock agents
├── mock-generic-agent.sh               # NEW generic-cli target
├── scenarios/*.sh                      # reused (plain-text emission added)
├── run.sh | verify.sh                  # generalized driver + per-agent assertions
```

### Public API surface (`packages/loop/src/index.ts`, REQ-ADP-05, charter)

The charter contract names are satisfied at the export surface without renaming internals:

```ts
// AgentAdapter (type) — charter contract name for the adapter abstraction
export type { LLMProvider as AgentAdapter, LLMProvider } from "./providers/index.js";
export type { AgentDescriptor, DetectionResult, ExecuteOptions, ExecutionResult } from "./providers/index.js";

// agent-cli-registry (module) — charter contract
export {
  registerProvider, createProvider, getAvailableProviders, clearProviders,
  registerAgent,          // descriptor-form alias of registerProvider
  getAgentDescriptors,    // [{ id, displayName, available, binaryName }]
  detectAgent,            // (id) => Promise<DetectionResult>
} from "./providers/index.js";

// loop-agent-selection (module) — charter contract
export { resolveAgentId } from "./agent-selection.js";
```

## 3. Technical Decisions

### 3.1 Naming reconciliation — alias over `provider` (REQ-SEL-01, OQ-1, PRD §5)

- **Internal**: `provider` field, `LLMProvider` interface, `providerConfig`, `defaultProvider`,
  `llm_spawned`/`llm_exited` events — all **unchanged**. The committed `claude-cli` adapter and its
  tests continue to compile and pass untouched.
- **User-facing**: the CLI flag is `--agent <id>`; the config key is `agent`; backlog items may use
  `agent`. Each maps onto the internal `provider` value.
- **Charter export**: `export type AgentAdapter = LLMProvider`. Downstream features
  (`cross-agent-installer`, `forge-rauf-loop-default`) bind to the exported registry/selection
  functions and the `AgentAdapter` type — the contract names resolve to real exports.
- **Backlog key**: the canonical persisted key remains `provider` (already committed). For
  authoring ergonomics, `agent` is accepted as an **input alias** normalized to `provider` at load
  (see §4.1). This adds no breaking schema change (PRD §6: schema changes limited to what selection
  requires; an additive optional alias key qualifies).

> *Alternative considered (rejected):* full rename `provider → agent` / `LLMProvider → AgentAdapter`.
> Cleaner single vocabulary and the project carries no back-compat obligation, but it churns
> committed schema fields the PRD flagged as not-to-rename-without-reconciliation, and forces the
> already-green claude adapter + tests + event emitters to change — needless risk against SC-2 for a
> surface that an alias satisfies.

### 3.2 Provider resolution & wiring into the runner (REQ-ADP-01, REQ-ADP-06)

The runner stops calling `spawnClaude` directly. Both execution paths drive a resolved
`LLMProvider` via `provider.execute(prompt, options)`:

- **Work iteration** — `runner.ts:609` `spawnClaude(...)` → `provider.execute(...)` with
  `outputFormat: "stream-json"`, `onStreamEvent`, `signal`, resolved `model`, `timeoutMinutes`.
- **Review pass** — `runner.ts:969` `spawnClaude(...)` → `provider.execute(...)`. (The review pass
  currently omits `outputFormat`; it will pass the same options object so stream-capable adapters
  behave consistently. claude-cli defaults to text when unset, preserving today's review behavior.)

Because a backlog item may select its own agent (REQ-SEL-04), the resolved agent id can vary per
iteration. The runner therefore resolves and constructs the provider **per iteration** from the
selection precedence (§3.3), caching one instance per distinct agent id within a run to avoid
rebuild churn (REQ-PERF-01). `provider.dispose?.()` is called for each cached instance on loop end.

Event emission: replace the hardcoded `provider: "claude-cli"` at `runner.ts:512` (`llm_spawned`)
and `:633` (`llm_exited`) with `provider: provider.id` (REQ-OBS-01). No event-shape change — the
CLI already renders `event.provider` (`loop-commands.ts:1184`).

> Neither path may bypass the abstraction (REQ-ADP-06). After this change the only *runtime caller*
> of `spawnClaude` is `providers/claude-cli.ts`; `runner.ts:47` drops the `spawnClaude` import. The
> public re-export at `packages/loop/src/index.ts:12` (`export { spawnClaude } from
> "./claude-process.js"`) is **retained** — it is part of the package's external surface and is left
> unchanged. The test guard therefore greps **`runner.ts` only** for a direct `spawnClaude(` call
> site (not the whole package), so it does not false-positive on `index.ts:12` or `claude-process.ts`.

### 3.3 Agent-selection precedence — `loop-agent-selection` (REQ-SEL-02/03/04)

New pure module `agent-selection.ts`:

```ts
export function resolveAgentId(input: {
  itemProvider?: string;      // BacklogItem.provider (per-item, highest)
  runProvider?: string;       // LoopStartOptions.provider  (from --agent / server body)
  projectProvider?: string;   // .rauf.json  -> options.provider
  globalProvider?: string;    // ~/.rauf/config.json -> defaultProvider (ToolConfig)
}): string;                   // falls through to "claude-cli"
```

Precedence (highest wins, REQ-SEL-02): `itemProvider → runProvider → projectProvider →
globalProvider → "claude-cli"`. When nothing is set at any layer the result is `"claude-cli"`,
producing behavior identical to today (REQ-SEL-03). This deliberately parallels the existing model
precedence at `runner.ts:494` (`item.model ?? this.options.model ?? projectModel`), which is left
intact (REQ-MODEL-01).

`projectProvider`/`globalProvider` reads reuse existing config loaders (`ToolConfig.defaultProvider`
already exists in schema); no new file formats. Path reads stay within ROOT_DIRECTORY / `~/.rauf/`
(CLAUDE.md sandboxing).

### 3.4 Config-driven CLI engine + presets (REQ-ADP-02/03/04, REQ-SCALE-01, OQ-3)

`cli-agent.ts` exposes a single engine used by every non-claude CLI adapter:

```ts
export interface CliAgentConfig {
  id: string;
  displayName: string;
  binary: string;                       // e.g. "codex"
  buildArgs: (ctx: { model?: string; promptFile?: string }) => string[];
  promptDelivery: "stdin" | "arg" | "file";   // generic-cli configurable; presets fixed
  nonInteractive: string[];             // auto-approve / yolo flags (REQ-EXEC-01)
  modelFlag?: (model: string) => string[];     // omitted => agent default model (REQ-MODEL-02)
  env?: Record<string, string>;
  parsesStream?: false;                 // non-claude agents are plain-text (REQ-SIG-02)
}
export class CliAgent implements LLMProvider { /* execute/validateCredentials; no checkUsage */ }
```

`CliAgent.execute` reuses the existing process plumbing pattern from `claude-process.ts`
(`spawn` with `detached:true`, process-group SIGTERM→30s→SIGKILL kill, AbortSignal cancel,
per-iteration timeout) so lifecycle is uniform across agents (REQ-EXEC-02). It always uses
plain-text output (no stream parsing) and returns `ExecutionResult` with `reconstructedText`
unset — token/tool telemetry is therefore gracefully absent (REQ-OBS-02). The shared spawn helper
is factored so claude-process and CliAgent share kill/timeout/group logic without duplication.

**Presets** (`presets.ts`) are `CliAgentConfig` literals; **best-known invocations, recorded as
correctable config** (OQ-2 — exact flags verified at implementation against each installed CLI; the
mechanism, not the literals, is what SC-1 proves):

| id      | binary        | prompt via | non-interactive (best-known) | model flag      |
|---------|---------------|------------|------------------------------|-----------------|
| codex   | `codex`       | arg        | `--full-auto` / `exec`       | `--model <m>`   |
| gemini  | `gemini`      | stdin      | `--yolo`                     | `-m <m>`        |
| copilot | `copilot`     | stdin      | `--allow-all-tools` (tbd)    | `--model <m>`   |
| cursor  | `cursor-agent`| arg        | `--force` / non-interactive  | `--model <m>`   |

`generic-cli.ts` is the same `CliAgent` engine driven by config — any other command-line agent is
reachable with **no new code** (REQ-ADP-04, REQ-SCALE-01). **Two ways to reach a config-driven
agent, with one resolution rule:**

1. **Arbitrary named agent** — `--agent <id>` where `<id>` matches a key in
   `ToolConfig.providers[<id>]` (project/global config). The selection layer builds a `CliAgent`
   from that config entry. Because the entry carries its own `binary`, the descriptor for such an
   agent **does** have a `binaryName` (taken from the config), so `detectAgent` PATH-probes it
   normally (this is the path that satisfies REQ-DET-01 for config-driven agents). This is the
   primary "add an agent without code" path (REQ-SCALE-01).
2. **Reserved `generic-cli` id** — the literal id `generic-cli` is a single built-in adapter whose
   `CliAgentConfig` comes from `MarkerOptions.providerConfig` (the per-run marker). Because its
   binary is not known until the marker config is read, its descriptor **omits** `binaryName` and
   supplies a custom `detect` that resolves the binary from the supplied `providerConfig` at probe
   time (falling back to "unknown/available" when no config is present rather than failing
   enumeration).

So §3.5's "omitted `binaryName`" applies **only** to the reserved `generic-cli` descriptor; named
config agents (case 1) keep a `binaryName` from their config and probe via the default detector.

Adding an agent = a preset literal, a `ToolConfig.providers` entry, or marker `providerConfig`; the
runner orchestration never changes.

### 3.5 Detection & availability — registry descriptors (REQ-DET-01/02, REQ-DISC-01/02)

`registry.ts` gains a descriptor model layered over the existing factory map (back-compatible:
`registerProvider(id, factory)` keeps working by wrapping into a descriptor with a default
`detect`):

```ts
export interface AgentDescriptor {
  id: string;
  displayName: string;
  binaryName?: string;                 // omitted for adapters with no single binary
  factory: ProviderFactory;
  detect?: () => Promise<DetectionResult>;   // default: PATH probe of binaryName
}
export interface DetectionResult { available: boolean; detail?: string; }
export function registerAgent(d: AgentDescriptor): void;
export function getAgentDescriptors(): AgentDescriptor[];
export function detectAgent(id: string): Promise<DetectionResult>;
```

- Default `detect` is a PATH `which`-style probe of `binaryName` (no subprocess execution of the
  agent itself — just resolution). claude-cli overrides with its credential check. Named
  config-driven agents (`ToolConfig.providers[id]`) carry a `binaryName` from their config and use
  the default probe; only the reserved `generic-cli` descriptor omits `binaryName` and supplies a
  custom `detect` resolving the binary from the supplied `providerConfig` (see §3.4 for the full
  resolution rule).
- **Pre-loop fail-fast** (REQ-DET-02): before any iteration runs or any state is written, the
  runner collects the **set of all agent ids that could run this loop** — the run-level resolved id
  plus every distinct per-item `provider` in the pending backlog — and calls `detectAgent` on each.
  If any is unavailable, it errors with a message naming the agent and remediation (install / PATH
  guidance) and returns before writing state. **No silent fallback to claude.** This sits alongside
  the existing usage preflight at `runner.ts:252`, but runs first.
- **REQ-DISC-01**: `getAgentDescriptors()` feeds the `--agent` enumeration in CLI help and the
  agent list embedded in selection-error messages.
- **REQ-DISC-02 (P1)**: new `rauf agents` command lists each descriptor with `displayName`, id, and
  live `available` status (and configured generic agents). Status derivation is a pure read + PATH
  probe — no agent subprocess (consistent with CLAUDE.md "status reads files, not subprocesses";
  PATH resolution is a stat, not an agent invocation).

### 3.6 Usage / limit preflight isolation (REQ-USAGE-01/02)

The Anthropic usage logic (`usage-checker.ts checkUsageLimit`, `readClaudeOAuthToken`, the
banner-scan/pause/resume in `runner.ts`) currently lives partly in the runner and partly in
`claude-cli.ts` (`checkUsage()`). Wiring rule:

- All usage handling becomes **provider-gated** on `provider.checkUsage` being defined. The three
  runner usage touchpoints — pre-loop preflight (`runner.ts:252`/`:1393`), between-iterations
  (`:1577`), mid-iteration banner handling (`:651`, `:1471`) — execute only when the active
  provider exposes `checkUsage` (i.e. claude-cli today). For agents without it, **every usage path
  is skipped cleanly** — no crash, no spurious limit detection (REQ-USAGE-02).
- For claude-cli, the behavior is **preserved unchanged** (REQ-USAGE-01): same OAuth read, same
  banner detection (`hasUsageLimitInText` over stderr + reconstructed stream), same pause/resume.
  The mid-iteration banner scan is conceptually claude-specific; gating it on `checkUsage`
  availability keeps it claude-only without a hard `id === "claude-cli"` check.
- **`hasUsageLimitInText` substring risk (REQ-USAGE-02, SC-1):** this check (`exit-classifier.ts:16`, matching the `USAGE_LIMIT_PATTERNS` at `:4-10`)
  substring-matches phrases like "rate limit" / "usage limit" in arbitrary output. The
  mid-iteration scan at `runner.ts:651` that calls it MUST sit **inside** the `checkUsage`-gated
  block, so a non-claude plain-text agent that merely prints such a phrase in normal output is
  **not** misclassified as `usage_limited` ("no spurious limit detection"; SC-1 "no error raised").
  For non-claude adapters the scan is skipped entirely and exit classification proceeds via the
  normal signal/exit-code path.
- An adapter MAY provide its own `checkUsage`; none is required for codex/gemini/copilot/cursor here.

### 3.7 Signal contract & neutralization (REQ-SIG-01/02, REQ-SEC-02, SC-6)

- `parseSignal` (`signal-parser.ts:27`) already runs on a plain `signalText` string and is fully
  agent-agnostic — it becomes the uniform completion contract for every adapter (REQ-SIG-01).
- **Plain-text path** (REQ-SIG-02): for non-claude adapters `reconstructedText` is unset, so the
  runner's existing fallback `signalText = reconstructedText?.length ? reconstructedText : stdout`
  (`runner.ts:644`) naturally uses raw stdout. No new code path — the fallback already exists.
- **Neutralization (REQ-SEC-02) — net-new, made uniform.** Today `redactSignalTokens`
  (`signal-redactor.ts`) is applied **only to debug log previews** (`runner.ts:680`), not before
  detection; the sole guard against a quoted token is `parseSignal`'s whole-line strictness. To
  honor REQ-SEC-02 literally and pass SC-6, add `neutralizeForDetection(text)` that rewrites signal
  tokens **only where they are not a standalone trimmed line** (i.e. quoted/inline occurrences),
  leaving a genuine final-line signal intact, and apply it uniformly to **every** adapter's output
  immediately before `parseSignal`, in **both** execution paths. Extend the token set to include
  `RAUF_REVIEW` (currently absent from the redactor). The existing log-preview redaction is kept.
  - **Two distinct insertion sites** (the paths parse different variables): the **work iteration**
    applies `neutralizeForDetection(signalText)` before `parseSignal` at `runner.ts:670` (where
    `signalText` is the reconstructed-or-stdout value from `:644`); the **review pass** parses the
    signal directly from raw `stdout` at `runner.ts:986` (no `reconstructedText` fallback), so apply
    `neutralizeForDetection(stdout)` there before `parseSignal`. Both sites are required to satisfy
    REQ-SEC-02 ("uniformly across all adapters") and REQ-ADP-06 ("both runner execution paths").

### 3.8 Model interplay (REQ-MODEL-01/02)

Model resolution stays independent of agent selection: `runner.ts:494`
(`item.model ?? options.model ?? projectModel`) is untouched. The resolved model string is handed
to `provider.execute({ model })`; each adapter translates it via its `modelFlag` (claude →
`--model`; presets per table) or, if no model is resolved, omits the flag so the agent uses its own
default (REQ-MODEL-02).

## 4. Data Model

No new persistent schemas. Existing committed fields cover everything:

| Field | Location (`packages/core/src/schemas.ts`) | Use |
|---|---|---|
| `BacklogItem.provider` | `:72` | per-item agent (REQ-SEL-04) |
| `BacklogItem.model` | `:69` | per-item model (unchanged) |
| `LoopStartOptions.provider` | `:377` | run-level `--agent` lands here |
| `ToolConfig.defaultProvider` | `:222` | global default agent |
| `ToolConfig.providers` | `:223` | generic-cli per-agent config map |
| `MarkerOptions.provider` / `.providerConfig` | `:148`/`:149` | marker + generic config |

### 4.1 `agent` input-alias normalization

When loading backlog items / config, accept an optional `agent` key and normalize it to `provider`
before validation (if both present, `provider` wins and a warning is logged). This is an additive,
non-breaking convenience; the persisted/canonical key stays `provider`. New in-memory types:
`CliAgentConfig`, `AgentDescriptor`, `DetectionResult` (§3.4–3.5) — not persisted.

## 5. API Design

### 5.1 Library exports — see §2 "Public API surface" (charter contracts).

### 5.2 CLI (`packages/cli/src/loop-commands.ts`)

- `rauf loop run [path] --agent <id>` — `extractStringFlag(ctx.flags, "agent")` →
  `options.provider` in the `LoopStartOptionsSchema.parse({...})` assembly (`:813`). Detached path
  sends `body.provider = agent` (mirrors `body.model` at `:385`).
- `rauf loop run --help` enumerates supported agent ids from `getAgentDescriptors()` (REQ-DISC-01).
- `rauf agents` (new) — lists id, displayName, and live availability for each descriptor +
  configured generic agents (REQ-DISC-02).
- No change to `llm_spawned`/`llm_exited` formatting (`:1184`) — already prints `event.provider`.

## 6. Integration Points

| Package/module | Direction | Contract / signature | Notes |
|---|---|---|---|
| `providers/types.ts` `LLMProvider` | extend (alias `AgentAdapter`) | `execute`, `checkUsage?`, `validateCredentials`, `dispose?` (verbatim, `types.ts:12-33`) | interface unchanged; descriptor types added |
| `providers/registry.ts` | extend | `registerProvider/createProvider/getAvailableProviders/clearProviders` (`:6-29`) + `registerAgent/getAgentDescriptors/detectAgent` | factory map kept; descriptor layer added back-compatibly |
| `providers/claude-cli.ts` | re-register only | `createClaudeCliProvider()` (`:50`) unchanged; registration migrates to `registerAgent` with `binaryName:"claude"` + credential `detect` | behavior preserved (SC-2) |
| `claude-process.ts` | reuse/refactor | `spawnClaude(prompt, SpawnClaudeOptions): Promise<Result<SpawnClaudeResult>>` (`:11-32`, spawn `:87`, stdin `:217`, kill `:162-173`) | extract shared kill/timeout/group helper for `CliAgent` |
| `runner.ts` | rewire | exec sites `:609`/`:969`; event provider `:512`/`:633`; model `:494`; usage `:252/:651/:1471/:1577`; signalText `:644` | route through provider; gate usage on `checkUsage` |
| `signal-parser.ts` `parseSignal` | reuse | `parseSignal(stdout: string): ParsedSignal` (`:27`); `SignalType` (`:4`) | agent-agnostic already |
| `signal-redactor.ts` | extend | add `neutralizeForDetection`; add `RAUF_REVIEW` to token set | applied pre-detection, all adapters, at **both** sites: `runner.ts:670` (work, on `signalText`) and `runner.ts:986` (review, on `stdout`) |
| `exit-classifier.ts` `ExitClass` | reuse | `done/blocked/needs_human/usage_limited/timeout/infra_error/genuine_retry` (`:22-29`) | outcome vocabulary unchanged, agent-agnostic (REQ-EXEC-03); see PRD→ExitClass mapping below; `hasUsageLimitInText` (`:16`, patterns at `:4-10`) gated claude-only per §3.6 |
| `core/schemas.ts` | reuse + `agent` alias normalization | fields per §4 | no breaking change |
| `cli/loop-commands.ts` | extend | `handleLoopRun` (`:688`), options assembly (`:813`), detached body (`:385`), new `rauf agents` | `--agent` flag + discovery |
| `events.ts` / `LoopEvent` | reuse | `llm_spawned`/`llm_exited` (`schemas.ts:448-463`) | only the `provider` *value* changes |

**PRD outcome vocabulary → `ExitClass` mapping** (REQ-EXEC-03). The PRD names five outcomes; the
implemented `ExitClass` is a richer superset (`exit-classifier.ts:22-29`). "Unchanged" means the
runner keeps classifying every agent's exit through the existing `ExitClass` exactly as it does for
claude today — the PRD terms map onto it as:

| PRD term (REQ-EXEC-03) | `ExitClass` value(s) |
|---|---|
| done | `done` |
| blocked | `blocked` |
| needs-human | `needs_human` |
| limit | `usage_limited` (claude-only; gated per §3.6) |
| error | `timeout`, `infra_error`, `genuine_retry` |

**No conflicts with in-progress features**: this feature is purely additive within `packages/loop`
+ `packages/cli`; sibling epic features live in `../feature-forge` and do not touch these files.
The downstream consumers (`cross-agent-installer` → `agent-cli-registry`; `forge-rauf-loop-default`
→ `loop-agent-selection`) bind to the §2 exports.

**WARNING — verify at implementation:** exact non-interactive/model flags for
`codex`/`gemini`/`copilot`/`cursor` (§3.4 table) are best-known and MUST be confirmed against each
installed CLI's actual version (OQ-2). They are config literals, correctable without code changes.

## 7. Error Handling

`Result<T,E>` everywhere (CLAUDE.md); no throwing for expected errors. Exceptions:

- **Unknown agent id**: `createProvider` already throws listing available ids (`registry.ts:14`);
  the selection layer surfaces this as a `Result` error with `getAgentDescriptors()` ids
  (REQ-DISC-01).
- **Agent CLI absent**: pre-loop `detectAgent` → fail-fast `Result` error naming the agent +
  remediation, before any state write; no fallback (REQ-DET-02, SC-3).
- **Process exit**: mapped into `ExitClass` (`exit-classifier.ts`) uniformly regardless of agent
  (REQ-EXEC-03). Timeout → SIGTERM→SIGKILL group kill (REQ-EXEC-02).
- **Missing telemetry** (plain-text agents): not an error — `reconstructedText` unset,
  token/tool events simply absent (REQ-OBS-02).
- **Usage check unsupported**: `provider.checkUsage` undefined → usage paths skipped, no error
  (REQ-USAGE-02).
- **Provider lifecycle on early exit**: the per-iteration resolve wraps `createProvider` in a
  try/catch and returns a `Result` error (listing `getAgentDescriptors()` ids) rather than throwing,
  so an unknown/mistyped per-item `provider` surfaced mid-run is an expected error, not a crash
  (CLAUDE.md "no throw for expected errors"). The §3.5 pre-loop detection collects all candidate
  ids up front, so this case is normally caught before iteration 1; the per-iteration guard is the
  backstop. All cached provider instances are disposed via `provider.dispose?.()` in a `finally`
  that runs on **every** loop-exit path — normal completion, fail-fast detection error (REQ-DET-02),
  abort/cancel, and thrown error — so no instance leaks regardless of how the run ends.

## 8. Testing Approach

Vitest unit tests colocated; sandbox integration via `test-sandbox/`. Gate = `pnpm gate` (SC-7).

- **Unit**: `agent-selection.test.ts` (full precedence matrix incl. per-item override, default
  claude); `registry.test.ts` (descriptor registration, enumeration, detect default/override);
  `cli-agent.test.ts` (arg/stdin/file prompt delivery, model-flag on/off, non-interactive flags,
  timeout/kill, plain-text result with telemetry absent); `generic-cli.test.ts` (config-driven
  invocation); `signal-redactor.test.ts` (quoted/inline neutralized, final-line preserved,
  RAUF_REVIEW covered — SC-6). Existing `claude-cli.test.ts` must stay green unchanged (SC-2).
- **Sandbox (SC-1/SC-4)**: generalize the driver env (`MOCK_CLAUDE_SCENARIO` →
  `MOCK_AGENT_SCENARIO`, old kept working); add plain-text mock agents
  `test-sandbox/{codex,gemini,copilot,cursor}` reusing `scenarios/*.sh` (plain-text emission) and a
  `mock-generic-agent.sh` targeted via `providerConfig`. `verify.sh` asserts each agent reaches
  `RAUF_DONE`, commits as today, emits the **real** agent id in events (not `claude-cli`), and skips
  the Anthropic preflight without error (telemetry gracefully absent).
- **Regression (SC-2)**: all existing claude sandbox scenarios (stream-done, stream-blocked,
  usage-limit, review) pass exactly as before; `bash test-sandbox/verify.sh` green.
- **Fail-fast (SC-3)**: selecting an absent agent yields the pre-iteration error with no state
  written.

## 9. Dependencies

No new external dependencies. Internal: `@rauf/core` (`Result`, `ErrorCodes`, config readers,
schemas), existing `packages/loop` modules (`claude-process`, `signal-parser`, `signal-redactor`,
`exit-classifier`, `usage-checker`, `stream-parser`). PATH probe uses Node built-ins (`node:` —
`which`-style resolution via `node:fs`/`PATH`), no new package.

## 10. Open Technical Questions

- **OQ-2 (residual)**: exact non-interactive/model flags per named CLI — recorded as best-known
  config (§3.4) and confirmed against installed versions during implementation; correctable without
  code change. Not a blocker (SC-1 proves the mechanism with mocks).
- **`rauf agents` command surface**: name/placement (`rauf agents` vs `rauf loop agents`) — defaulted
  to `rauf agents`; minor, settle in forge-3-specs.
- **Shared spawn helper extraction**: whether `CliAgent` and `claude-process` share a single
  `spawnProcessGroup` helper or `CliAgent` re-implements the kill/timeout pattern — leaning shared
  to avoid duplication (REQ-PERF-01 / maintainability); finalize in specs.
