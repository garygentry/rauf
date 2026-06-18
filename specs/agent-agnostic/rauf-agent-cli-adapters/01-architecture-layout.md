# 01 — Architecture & Layout

> Feature: `rauf-agent-cli-adapters` (epic `agent-agnostic`, repo **rauf**). Based on `PRD.md` v2,
> `tech-spec.md` v2. Depends on `00-core-definitions.md` for all type names. Cross-references use
> exact filenames.

## Requirement Coverage

| REQ ID | Requirement | Section |
|--------|-------------|---------|
| REQ-ADP-05 | Registry of adapters by stable id | 2, 4 |
| REQ-ADP-06 | Seam wired through both runner paths | 2 (`runner.ts`), 5 |
| REQ-SEL-01 | `--agent` user surface | 3 (`packages/cli`) |
| REQ-DISC-02 | `rauf agents` discovery command | 3 (`packages/cli`) |
| REQ-PERF-01 | No measurable claude-path degradation | 6 (build/dep notes) |
| REQ-SCALE-01 | Add agent without changing runner | 2, 4 |
| REQ-COMPAT (epic) | Additive, claude-path unchanged | 1, 6 |

## 1. Scope & guiding rules

All implementation is **additive** inside two existing packages — no new package is created
(tech-spec §2). `CLAUDE.md` architecture rules that bound the layout:

- The adapter layer lives in **`packages/loop`**; `packages/core` keeps **zero** imports from
  `cli`/`web` and gains no new logic (only the existing schema fields are reused).
- Atomic writes, path sandboxing to `ROOT_DIRECTORY` / `~/.rauf/`, and "status reads files, not
  subprocesses" are preserved — the only new filesystem touch is PATH resolution for detection
  (a stat-style probe, not an agent invocation; `02-agent-registry-and-detection.md`).
- The claude path stays first-class and behaviorally unchanged (SC-2): `claude-process.ts`,
  `signal-parser.ts`, `usage-checker.ts`, `exit-classifier.ts`, and the committed
  `claude-cli.ts` adapter keep their behavior.

## 2. Directory tree (full)

`NEW` = file created by this feature; `EDIT` = existing file modified; unmarked = unchanged but
referenced. Tests are colocated as `*.test.ts`.

```
packages/loop/src/
├── providers/
│   ├── types.ts                 EDIT  + AgentAdapter alias, AgentDescriptor, DetectionResult
│   │                                    (00 §2,3.3); + ExecuteOptions.env? extension (00 §3.4)
│   ├── registry.ts              EDIT  + registerAgent / getAgentDescriptors / detectAgent,
│   │                                    descriptor layer over the factory map  (02)
│   ├── index.ts                 EDIT  register all built-in adapters; re-export new symbols
│   ├── claude-cli.ts            EDIT  behavior UNCHANGED; registration migrates to a descriptor
│   │                                    (binaryName:"claude" + credential detect)  (02)
│   ├── cli-agent.ts             NEW   CliAgent engine + CliAgentConfig, PromptDelivery,
│   │                                    BuildArgsContext  (00 §3.2; implements LLMProvider) (03)
│   ├── presets.ts               NEW   codex / gemini / copilot / cursor CliAgentConfig literals  (03)
│   ├── generic-cli.ts           NEW   reserved generic-cli descriptor (providerConfig-driven)    (03)
│   ├── types.test.ts            (n/a — types only)
│   ├── registry.test.ts         EDIT  descriptor registration / enumeration / detect            (07)
│   ├── claude-cli.test.ts       —     must stay green unchanged (SC-2)
│   ├── cli-agent.test.ts        NEW   prompt delivery, model flag, non-interactive, kill/timeout (07)
│   └── generic-cli.test.ts      NEW   config-driven invocation                                  (07)
├── constants.ts                 NEW   DEFAULT_AGENT_ID / GENERIC_AGENT_ID (00 §6 home)            (04)
├── agent-selection.ts           NEW   resolveAgentId + normalizeAgentAlias; re-exports constants (04)
├── agent-selection.test.ts      NEW   full precedence matrix                                     (07)
├── process-group.ts             NEW   shared spawn/kill/timeout/group helper (extracted)         (03)
├── runner.ts                    EDIT  route both exec paths + events + usage gating + neutralize (05)
├── runner.test.ts               EDIT  wiring / per-iteration resolve / dispose / fail-fast       (07)
├── claude-process.ts            EDIT  (refactor only) delegate kill/timeout to process-group.ts  (03)
├── signal-parser.ts             —     parseSignal reused unchanged
├── signal-redactor.ts           EDIT  + neutralizeForDetection(); + RAUF_REVIEW token            (05)
├── signal-redactor.test.ts      EDIT  neutralization cases incl. RAUF_REVIEW (SC-6)              (07)
├── exit-classifier.ts           —     ExitClass / classifyExit / hasUsageLimitInText reused
├── usage-checker.ts             —     checkUsageLimit reused (claude-only path)
└── index.ts                     EDIT  public exports: AgentAdapter, registry, selection          (4)

packages/cli/src/
├── loop-commands.ts             EDIT  + --agent flag; + `rauf agents` command; help enumeration  (06)
└── loop-commands.test.ts        EDIT  flag plumbing, agents listing                              (07)

test-sandbox/
├── claude                       —     existing mock claude (unchanged behavior)
├── codex                        NEW   plain-text mock agent (reuses scenarios)                   (07)
├── gemini                       NEW   plain-text mock agent                                      (07)
├── copilot                      NEW   plain-text mock agent                                      (07)
├── cursor                       NEW   plain-text mock agent (binary name cursor-agent)           (07)
├── mock-generic-agent.sh        NEW   generic-cli target driven via providerConfig               (07)
├── scenarios/*.sh               EDIT  add plain-text emission alongside stream emission          (07)
├── run.sh                       EDIT  generalized driver env (MOCK_AGENT_SCENARIO)               (07)
└── verify.sh                    EDIT  per-agent assertions (RAUF_DONE, real id, no preflight)    (07)
```

> The shared kill/timeout/group logic **is extracted** into a new `process-group.ts` — resolved in
> `03-cli-agent-engine-and-presets.md §5` (tech-spec §10's open "shared spawn helper" question,
> settled in favor of extraction to avoid duplication, SC-2). `claude-process.ts` delegates to it.
> The tree's `process-group.ts NEW` marking is therefore unconditional.

## 3. Affected packages

| Package | Role | Changes |
|---|---|---|
| `@rauf/loop` (`packages/loop`) | adapter layer + runner | all adapter/registry/selection code; runner rewiring; signal-redactor extension |
| `@rauf/cli` (`packages/cli`) | user surface | `--agent` flag, `rauf agents` command, help enumeration (REQ-SEL-01, REQ-DISC) |
| `@rauf/core` (`packages/core`) | schemas/types | **no code change** — only reuses committed fields + the `agent` input-alias normalization at load (`04-agent-selection.md §Data Model`); core keeps zero cli/web imports |
| `@rauf/web` (`packages/web`) | server/UI | **no change** in this feature (the detached server `body.provider` path already exists; `06-cli-surface.md` notes it) |

## 4. Public API surface (`packages/loop/src/index.ts`) — charter contracts

The charter contract names (`AgentAdapter`, `agent-cli-registry`, `loop-agent-selection`) resolve
to real exports without renaming internals (tech-spec §2, §3.1). Added to the existing barrel
(which already re-exports `registerProvider`/`createProvider`/`getAvailableProviders`/
`clearProviders` and the provider types at `index.ts:38-54`, and `spawnClaude` at `:12`):

```ts
// --- AgentAdapter (charter: the adapter abstraction) ---
export type { AgentAdapter } from "./providers/index.js";          // = LLMProvider (00 §2)
export type { AgentDescriptor, DetectionResult } from "./providers/index.js";

// --- agent-cli-registry (charter: registry + detection) ---
export {
  registerAgent,        // descriptor-form registration (wraps registerProvider)
  getAgentDescriptors,  // () => AgentDescriptor[] — static descriptors, synchronous, no I/O (02 §4)
  listAgents,           // () => Promise<AgentAvailability[]> — live availability (awaits detect) (02 §4)
  detectAgent,          // (id: string) => Promise<DetectionResult>
} from "./providers/index.js";
export type { AgentAvailability } from "./providers/index.js";  // listAgents DTO (02 §4)

// --- loop-agent-selection (charter: selection surface) ---
export { resolveAgentId } from "./agent-selection.js";
export { DEFAULT_AGENT_ID, GENERIC_AGENT_ID } from "./agent-selection.js"; // re-export of 00 §6 constants

// CliAgent engine + config are exported for generic-cli configuration & tests
export { CliAgent } from "./providers/index.js";
export type { CliAgentConfig, PromptDelivery, BuildArgsContext } from "./providers/index.js";
```

- The pre-existing `spawnClaude` re-export (`index.ts:12`) is **retained** unchanged (external
  surface stable; tech-spec §3.2). The runner stops importing it, but the package keeps exporting
  it.
- `providers/index.ts` continues its side-effect registration; it now registers **all** built-in
  adapters (claude-cli + presets + generic-cli) rather than claude-cli alone (tech-spec §2).

Downstream epic consumers bind here: `cross-agent-installer` → `agent-cli-registry`
(`registerAgent`/`getAgentDescriptors`/`detectAgent` + `AgentDescriptor`);
`forge-rauf-loop-default` → `loop-agent-selection` (`resolveAgentId`) and `AgentAdapter`.

## 5. Dependency graph (intra-feature)

```
00-core-definitions  ──────────────┐ (types/constants used by all)
                                    ▼
providers/cli-agent.ts ──► process-group.ts ◄── claude-process.ts (refactor)
        │                                  
        ├──► providers/presets.ts          
        └──► providers/generic-cli.ts      
providers/registry.ts (descriptor layer) ◄── claude-cli.ts (re-register)
        ▲                                  
agent-selection.ts ──────────────► (reads ToolConfig.providers for named config agents)
        ▲                                  
runner.ts ──► resolveAgentId + createProvider + detectAgent + neutralizeForDetection
        ▲
packages/cli/loop-commands.ts ──► getAgentDescriptors + LoopStartOptions.provider
```

Spec implementation order (also the dependency order for `04-backlog`): `00` → `01` →
`02-agent-registry-and-detection` (descriptor layer) → `03-cli-agent-engine-and-presets`
(engine/presets/generic) → `04-agent-selection` → `05-runner-wiring` → `06-cli-surface` →
`07-testing-strategy`. No circular dependencies.

## 6. Build, manifest & performance notes

- **Manifest:** `packages/loop/package.json` (`@rauf/loop`) needs **no change** — `name`, `main`
  (`dist/index.js`), `types` (`dist/index.d.ts`), and its single runtime dep `@rauf/core` are
  unchanged. New modules are additional `.ts` files under the existing `src/`; the barrel
  (`src/index.ts`) is the single entry point. No `exports` map exists today and none is added.
- **No new dependencies** (tech-spec §9): PATH probing uses Node built-ins (`node:fs`, `PATH`);
  process spawning reuses the `node:child_process` pattern already in `claude-process.ts`.
- **Project references:** the monorepo is a TS project-references build (`packages/loop` →
  `core`); new files are picked up by the existing `tsconfig`. Run `pnpm build` then verify per
  `CLAUDE.md` ("trust `pnpm gate`, not the editor"). The acceptance gate is `pnpm gate` (SC-7).
- **Performance (REQ-PERF-01):** the claude path gains only one indirection —
  `provider.execute(...)` instead of a direct `spawnClaude(...)` — plus a per-run, per-id provider
  cache (one instance per distinct agent id). No added per-iteration latency beyond negligible
  dispatch; the claude adapter still calls `spawnClaude` internally (`claude-cli.ts:14`).

## Dependencies

Depends on `00-core-definitions.md` (all type/constant names). Depended on by every subsystem doc
(`02`–`07`) for the directory layout and export surface.

## Verification

- [ ] Every `NEW`/`EDIT` file in §2 exists / is modified after implementation; no other files in
  `packages/loop`/`packages/cli` are touched (additive — REQ-COMPAT).
- [ ] `packages/loop/src/index.ts` exports `AgentAdapter`, `AgentDescriptor`, `DetectionResult`,
  `registerAgent`, `getAgentDescriptors`, `detectAgent`, `resolveAgentId`, `CliAgent`,
  `CliAgentConfig` (charter contracts resolve).
- [ ] `spawnClaude` is still re-exported from `index.ts` but no longer imported by `runner.ts`.
- [ ] `packages/core` has no new imports from `cli`/`web`; no schema field renamed.
- [ ] `pnpm build && pnpm gate` is green (SC-7).
