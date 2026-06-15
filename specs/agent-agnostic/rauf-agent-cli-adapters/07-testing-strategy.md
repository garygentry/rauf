# 07 — Testing Strategy

> Feature: `rauf-agent-cli-adapters` (epic `agent-agnostic`, target repo **rauf**). Based on
> `PRD.md` v2 (esp. §8 Success Criteria SC-1..SC-7) and `tech-spec.md` v2 (esp. §8 Testing
> Approach). Depends on `00-core-definitions.md` for the interface shapes mocks must match,
> `01-architecture-layout.md` for the test-file map + test-sandbox tree, and
> `02`/`03`/`04`/`05`/`06` for the units under test. Cross-references use exact filenames.
>
> This is the **last numbered document** in the suite: it maps every Success Criterion (SC-1..SC-7)
> to concrete tests, specifies the unit suites, the test-sandbox generalization, the regression and
> fail-fast checks, the mock/fixture strategy, and the coverage target. It writes no production
> code; it specifies what the test files and sandbox scripts (listed `NEW`/`EDIT` in
> `01-architecture-layout.md §2`) must assert.

## Success-Criterion / Requirement Coverage

Every Success Criterion from `PRD.md §8` maps to the tests that verify it. Requirement coverage is
inherited transitively (each SC lists the REQs it verifies, per the PRD); this table is keyed by SC.

| SC | Verifies (REQ) | Test surface | Section |
|----|----------------|--------------|---------|
| SC-1 | REQ-ADP-01/02/03/04, REQ-EXEC-01/02/03, REQ-SIG-01/02, REQ-OBS-02 | `cli-agent.test.ts`, `generic-cli.test.ts` (unit) + sandbox mock `codex`/`gemini`/`copilot`/`cursor`/`mock-generic-agent.sh` reaching `RAUF_DONE`, telemetry absent, no error | 3.3, 3.4, 4 |
| SC-2 | REQ-SEL-03, REQ-USAGE-01, REQ-PERF-01 | `claude-cli.test.ts` (UNCHANGED, green), existing claude sandbox scenarios pass exactly as before, **+ new child-env forwarding case** (`ExecuteOptions.env` → `SpawnClaudeOptions.env`) in `claude-cli.test.ts`/`runner.test.ts` (§5) | 3.2, 5 |
| SC-3 | REQ-DET-01, REQ-DET-02 | `runner.test.ts` fail-fast cases (no state written) + sandbox absent-agent assertion | 3.2 (`runner.test.ts`), 6 |
| SC-4 | REQ-OBS-01, REQ-USAGE-02 | `runner.test.ts` (event provider id, usage gating skip) + sandbox per-agent event-id + no-preflight assertion | 3.2 (`runner.test.ts`), 4 |
| SC-5 | REQ-SEL-01/02/04, REQ-DISC-01, REQ-DISC-02 | `agent-selection.test.ts` (precedence + alias), `registry.test.ts` (`getAgentDescriptors`/`listAgents`), `loop-commands.test.ts` (`--agent` flag, `rauf agents`) | 3.1, 3.2 (`registry.test.ts`, `loop-commands.test.ts`) |
| SC-6 | REQ-SEC-02 | `signal-redactor.test.ts` (quoted/inline neutralized, final-line preserved, `RAUF_REVIEW` covered) | 3.5 |
| SC-7 | acceptance gate | `pnpm gate` green (build + schema:check + version:check + typecheck + lint + format:check + test + check:docs) | 2, 8 |

> The per-REQ → section mapping is owned by `00`–`06` (each subsystem doc carries its own
> Requirement Coverage table); this document maps the **Success Criteria** to the tests that prove
> them, because SC-1..SC-7 are what `PRD.md §8` defines as "done" and what the gate enforces.

## 1. Purpose & scope

This document specifies the test plan that proves the feature satisfies SC-1..SC-7 without
regressing the claude path. It covers three test tiers, in increasing scope:

1. **Unit** (Vitest, colocated `*.test.ts`) — pure-function and class-level correctness for the new
   modules (`agent-selection.ts`, `providers/registry.ts`, `providers/cli-agent.ts`,
   `providers/generic-cli.ts`, `signal-redactor.ts`) and the runner-wiring additions
   (`runner.ts`).
2. **Integration (sandbox)** — the existing `test-sandbox/` harness, generalized to drive a loop
   end-to-end through each mock agent (claude + codex/gemini/copilot/cursor + generic-cli) and
   assert the cross-agent guarantees (real agent id in events, no Anthropic preflight, telemetry
   gracefully absent).
3. **Regression** — the unchanged claude sandbox scenarios and the unchanged `claude-cli.test.ts`,
   proving behavioral parity (SC-2).

In scope: which test files exist, what each asserts (as a case list, not full code), the sandbox
generalization (mock agents, driver env, `verify.sh` assertions), the mock/fixture strategy, and the
coverage target. Out of scope: the production behavior being tested (owned by `02`–`06`) and the
exact preset flags (OQ-2 — proven by *mechanism* with mocks, not real flags;
`03-cli-agent-engine-and-presets.md §6` WARNING).

## 2. Framework & tooling

- **Test runner:** Vitest `^3.0.0` (`package.json` devDependency; the root `test` script is
  `pnpm -r test && vitest run`). Tests are **colocated** with source as `*.test.ts` (CLAUDE.md
  "Tests: colocate with source as `*.test.ts`"), matching every existing loop test
  (`packages/loop/src/**/*.test.ts`, e.g. `providers/registry.test.ts`,
  `providers/claude-cli.test.ts`, `signal-redactor.test.ts`, `runner.test.ts`).
- **Assertion style:** `describe`/`it`/`expect` (Vitest), `vi.fn()` / `vi.mock()` for mocking, as in
  the existing `providers/claude-cli.test.ts` (which `vi.mock("../claude-process.js")` and
  `vi.mock("../usage-checker.js")`). New suites follow the same import-after-mock ordering.
- **Acceptance gate (SC-7):** `pnpm gate` — verified in `package.json:27` and `forge.config.json`
  (`"gateCommand": "pnpm gate"`):

  ```
  pnpm build && pnpm schema:check && pnpm version:check && pnpm typecheck
    && pnpm lint && pnpm format:check && pnpm test && pnpm check:docs
  ```

  This is the single source of truth for "is it green?" (CLAUDE.md). **All** new tests run under
  `pnpm test` (and thus the gate); the sandbox `verify.sh` is run as a manual integration check (it
  is not part of `pnpm gate` today — see §4.4). Per CLAUDE.md, trust `pnpm gate`, not the editor:
  run `pnpm build` first so cross-package `dist/*.d.ts` are fresh before typecheck.
- **No new test dependency.** Vitest, `vi` mocks, and Bash sandbox scripts cover everything; no
  coverage tool or new harness is added (§7).

## 3. Unit test approach

All paths below are under `packages/loop/src/` unless noted (`01-architecture-layout.md §2`). For
each file, the bulleted cases are *what to assert* — the implementer writes the `it(...)` bodies.

### 3.1 `agent-selection.test.ts` (NEW) — `loop-agent-selection` (SC-5: REQ-SEL-01/02/04)

Exercises the pure resolver + alias normalizer from `04-agent-selection.md`. Pure functions, no
mocks, no I/O.

`resolveAgentId` — the full precedence matrix (`04-agent-selection.md §3.1`, rows 1–9):
- Row 1: all four layers set (`itemProvider:"codex"`, `runProvider:"gemini"`,
  `projectProvider:"cursor"`, `globalProvider:"copilot"`) → `"codex"` (per-item override wins,
  REQ-SEL-04).
- Row 2: `itemProvider` unset, rest set → `"gemini"` (run-level `--agent`).
- Row 3: only `projectProvider`/`globalProvider` set → `"cursor"` (project `.rauf.json`).
- Row 4: only `globalProvider` set → `"copilot"` (global `~/.rauf/config.json`).
- **Row 5 (keystone, REQ-SEL-03):** all layers unset (`{}`) → exactly `"claude-cli"` — the
  no-selection path is identical to today. Assert it equals the imported `DEFAULT_AGENT_ID`
  (`00-core-definitions.md §6`), not a hardcoded literal.
- Row 6: `itemProvider`+`globalProvider` only → `"codex"` (per-item beats global).
- Row 7: `runProvider`+`globalProvider` only → `"gemini"` (run-level beats global).
- Row 8: `itemProvider:"  "` (whitespace) + `runProvider:"gemini"` → `"gemini"` (empty/whitespace
  layer skipped defensively — the `pick` trim guard).
- Row 9: all layers `"cursor"` → `"cursor"` (idempotent).
- Totality: for a representative sweep of input combinations, the return is always a non-empty
  string and the call never throws.

`normalizeAgentAlias` (REQ-SEL-01, alias normalization with both keys):
- `{ agent: "codex" }` → `{ provider: "codex" }`, no `agent` key remains.
- `{ provider: "codex" }` (no alias) → unchanged; `onWarn` NOT called (additive/non-breaking).
- `{}` (neither key) → unchanged; no `provider`/`agent` key added.
- **`{ provider: "codex", agent: "gemini" }` (both keys present) → `{ provider: "codex" }` AND
  `onWarn` is called once** (provider-wins + warn, tech-spec §4.1). Assert via a `vi.fn()` passed as
  `onWarn` that it received a message naming both values.
- Output never contains an `agent` key (canonical key stays `provider`); re-serializing yields a
  `provider`-only shape.

### 3.2 `registry.test.ts` (EDIT) — `agent-cli-registry` (SC-5: REQ-DISC-01/02; SC-2 back-compat)

Extends the existing `providers/registry.test.ts` (which already covers `registerProvider` /
`createProvider` / `getAvailableProviders` and `afterEach(clearProviders)`). New cases for the
descriptor layer (`02-agent-registry-and-detection.md §3,4,5`). Use a `createMockProvider` factory
matching the existing helper (returns an `LLMProvider` with `execute`/`validateCredentials`).

Descriptor registration & enumeration:
- `registerAgent({ id, displayName, binaryName, factory })` populates BOTH maps:
  `createProvider(id)` constructs it AND `getAgentDescriptors()` includes it; its id appears in
  `getAvailableProviders()` (identical id sets — invariant `02 §3.5`).
- `getAgentDescriptors()` is **synchronous**, returns `AgentDescriptor[]` in registration
  (Map-insertion) order, with **no** `available` field (REQ-DISC-01 — must not block on I/O).
- A later `registerAgent` for the same id **overwrites** the prior descriptor (last-write-wins).
- Back-compat `registerProvider(id, factory)` still works AND now also synthesizes a descriptor
  (`displayName: id`, `binaryName: id`, no `detect`); the synthesized agent is enumerable +
  probeable. (SC-2: nothing that used `registerProvider` breaks.)
- `clearProviders()` clears BOTH `factories` and `descriptors` (so `getAgentDescriptors()` is `[]`
  and `getAvailableProviders()` is `[]` after clear) — relied on by `afterEach`.

`detectAgent` (REQ-DET-01) — default PATH probe + overrides:
- Default probe **found**: register an agent whose `binaryName` resolves on a controlled `PATH`
  (point `process.env.PATH` at a tmp dir containing an executable file) → `{ available: true,
  detail: "found at <path>" }`. Restore `PATH` in `afterEach`.
- Default probe **not found**: a `binaryName` absent from `PATH` → `{ available: false, detail:
  'binary "<b>" not found on PATH' }`. Assert `detectAgent` **never throws** and never spawns a
  subprocess (no child-process side effects).
- **claude credential override**: a descriptor whose `detect` reuses `validateCredentials` returns
  `{ available: true }` when credentials are present and `{ available: false, detail }` when the
  credential read fails (mock `readClaudeOAuthToken` as `claude-cli.test.ts` does). Proves the
  claude availability definition is credential-gated, not PATH-gated (REQ-USAGE-01).
- **generic-cli custom detect**: the reserved `generic-cli` descriptor (no `binaryName`, custom
  `detect`) with **no** `providerConfig` resolves `{ available: true, detail: "configurable; …" }`
  (enumeration never fails); when a `providerConfig` carrying a `binary` is supplied, it PATH-probes
  that binary and returns the real result.
- **unknown id**: `detectAgent("nope")` resolves `{ available: false, detail: 'Unknown agent
  "nope". Supported agents: <ids>.' }` — resolves, does NOT throw (contrast `createProvider`, which
  throws on unknown id, `registry.ts:15`).

`listAgents` (REQ-DISC-02):
- Returns `Promise<AgentAvailability[]>` with `available` resolved per descriptor's `detect`, in
  registration order; the row shape is `{ id, displayName, binaryName?, available, detail? }`.
- Never rejects even when a detector throws (a deliberately-throwing `detect` is reported as
  `{ available: false, detail: <message> }`).

`registerProvider` back-compat / migration:
- The existing `claude-cli` registration (migrated to `registerAgent` with `binaryName:"claude"` +
  credential `detect`, `02 §3.3`) still yields a constructable provider via `createProvider(
  "claude-cli")` and an enumerable descriptor — proving the migration is registration-only (SC-2).

### 3.2b `cli-agent.test.ts` (NEW) — the `CliAgent` engine (SC-1: REQ-EXEC/ADP/MODEL/OBS/SIG)

Tests the config-driven engine from `03-cli-agent-engine-and-presets.md §3,4`. The cleanest seam is
to **mock the shared spawn helper** (`vi.mock("../process-group.js")` → a `vi.fn()` for
`spawnProcessGroup`) so argv/stdin/timeout assertions are made on the recorded call, without
spawning a real process. A small subset of cases MAY spawn a real trivial binary (e.g. `node -e`
echo) to exercise timeout/kill for real; prefer the mock for argv assertions.

Prompt delivery (`03 §4.3`) — assert the recorded `spawnProcessGroup(cmd, args, opts)` call:
- **`promptDelivery: "arg"`** (codex/cursor shape): prompt is the **final** argv element, after
  model flags; `opts.stdin` is `undefined`.
- **`promptDelivery: "stdin"`** (gemini/copilot shape): prompt passed as `opts.stdin`; prompt is NOT
  in argv.
- **`promptDelivery: "file"`**: a temp file is written **inside the cwd / `ROOT_DIRECTORY`**
  (REQ-SEC-01), its path is placed in argv via `buildArgs(ctx.promptFile)`, `opts.stdin` is
  `undefined`, and the temp file is **unlinked** after the call (assert it does not exist post-call,
  including on a simulated spawn error).

Model flag (REQ-MODEL-01/02):
- `options.model` set + `config.modelFlag` defined → model flag present in argv (`["--model", m]`
  appended after `nonInteractive`).
- `options.model` unset → **no** model flag in argv (agent default model, REQ-MODEL-02).
- `config.modelFlag` omitted (a config with no model flag) + `options.model` set → resolved model
  silently ignored, no model flag (REQ-MODEL-01 "may ignore if unsupported").

Non-interactive (REQ-EXEC-01):
- `config.nonInteractive` flags are **always** present in the assembled argv, regardless of model /
  prompt-delivery (auto-approve guaranteed for unattended runs).

Argv order (`03 §4.1`):
- Assembled argv is exactly `[...buildArgs(ctx), ...nonInteractive, ...(model? modelFlag : [])]`,
  with the prompt appended last only for `"arg"` delivery.

Timeout / kill (REQ-EXEC-02): assert `CliAgent.execute` forwards
- `timeoutMs === options.timeoutMinutes * 60 * 1000` and `signal === options.signal` to
  `spawnProcessGroup`. (The SIGTERM→30s→SIGKILL group-kill mechanics are owned and tested by
  `process-group.ts`; see the dedicated note below.)

Plain-text result (REQ-OBS-02, REQ-SIG-02): given `spawnProcessGroup` resolves
`ok({ exitCode, stdout, stderr, timedOut, durationMs })`:
- `execute` returns `ok(ExecutionResult)` with `stdout/stderr/exitCode/timedOut/durationMs` carried
  through and **`reconstructedText`, `parsedSignal`, `progressEvents` all UNSET** (telemetry
  gracefully absent — REQ-OBS-02). `parsesStream` is never `true`, so no `StreamParser` is
  constructed and `onStdout` is never passed.
- A **nonzero exitCode** and **`timedOut: true`** flow back as **data**, not errors (the runner
  classifies via `classifyExit`) — assert `execute` still returns `ok(...)` in those cases.
- A spawn failure (`spawnProcessGroup` → `err(FILE_NOT_FOUND)`) is propagated as `err(...)` by
  `execute` (REQ-EXEC-02 / `03 §8`).

`validateCredentials`:
- Returns `ok(undefined)` unconditionally and does NOT spawn the agent or probe PATH (availability
  is the registry's job — `03 §3.1`).
- `CliAgent` exposes **no** `checkUsage` and **no** `dispose` (assert the properties are absent) —
  load-bearing for the runner's usage gating (REQ-USAGE-02).

> **`process-group.ts` kill/timeout** — the SIGTERM→`GRACE_PERIOD_MS`→SIGKILL group escalation,
> detached-group spawn, EPIPE-tolerant stdin, and abort handling are the **shared** helper extracted
> from `claude-process.ts` (`03 §5`). These remain covered by the existing
> `claude-process.test.ts` (which must stay green — it exercises the same code path post-refactor,
> SC-2). `cli-agent.test.ts` may add one direct `process-group.test.ts`-style case (real `node -e`
> child that ignores SIGTERM, asserting SIGKILL after the grace window) if the helper is newly
> extracted; otherwise it relies on `claude-process.test.ts` for the kill mechanics since the helper
> is the same implementation.

### 3.2c `generic-cli.test.ts` (NEW) — generic-cli & named config agents (SC-1: REQ-ADP-04, REQ-SCALE-01)

Tests `providers/generic-cli.ts` from `03-cli-agent-engine-and-presets.md §7`.

`configToCliAgentConfig(id, raw)`:
- Valid record (`{ binary, args, promptDelivery, nonInteractive, modelFlagTemplate, env }`) →
  `ok(CliAgentConfig)` with `buildArgs()` returning the static `args`, `modelFlag` built from
  `modelFlagTemplate` (`m => [template, m]`), and `displayName` defaulting to `id` when absent.
- **Missing/empty `binary`** → `err({ code: ErrorCodes.VALIDATION_ERROR, message })` naming the bad
  field (NOT a throw). (`VALIDATION_ERROR` confirmed against `packages/core/src/errors.ts:21-32`.)
- **Invalid `promptDelivery`** (e.g. `"socket"`) → `err(...)` (rejected; not `stdin|arg|file`).
- Defaults applied: `args` → `[]`, `promptDelivery` → `"stdin"`, `nonInteractive` → `[]`,
  `modelFlag` omitted when no `modelFlagTemplate` (agent default model, REQ-MODEL-02).
- `parsesStream` is never set to anything but `false`/omitted (plain-text only, REQ-OBS-02).

`createGenericCliProvider` (the `ProviderFactory`):
- **Reserved-id path** (case 2): given a valid `providerConfig` record, returns a `CliAgent` whose
  `id === GENERIC_AGENT_ID` and whose `execute` invokes the configured binary. Drive it through a
  mocked `spawnProcessGroup` and assert the configured `binary`/`args`/`promptDelivery` are honored.
- Misconfigured (no usable config) → the factory throws (inherited `createProvider` contract,
  `registry.ts:15`); the runner's per-iteration resolve wraps it (`05`), so this test asserts only
  the throw shape (an `Error` carrying the validation message).

`configToCliAgentConfig` → `CliAgent` end-to-end (named-config path, case 1):
- A `ToolConfig.providers["my-agent"]`-shaped record builds a `CliAgent` with a real `binary`
  (so its descriptor carries a `binaryName` and PATH-probes via the default detector — the
  "add an agent without code" path, REQ-SCALE-01). Assert the built `CliAgentConfig.binary` equals
  the config's `binary`.

### 3.2d `runner.test.ts` (EDIT) — wiring (SC-3, SC-4: REQ-OBS-01, REQ-USAGE-02, REQ-DET-02)

Extends the existing `runner.test.ts` with the wiring additions from `05-runner-wiring.md`. Mock the
registry/selection seams (`vi.mock` `createProvider`/`detectAgent`/`resolveAgentId` or inject a fake
provider) so these are unit tests, not real spawns.

- **Per-iteration resolve + cache + dispose:** the runner resolves the agent id per iteration via
  `resolveAgentId`, constructs the provider via `createProvider`, and **caches one instance per
  distinct agent id** within a run (two iterations on the same id construct the provider once; a
  per-item override constructs a second). On loop end, `provider.dispose?.()` is called for each
  cached instance (assert dispose invoked on every cached id, on the normal-completion path and the
  fail-fast/abort/error paths — `05 §5`).
- **Event provider id (REQ-OBS-01, SC-4):** `llm_spawned` and `llm_exited` events carry
  `provider: provider.id` (the **real** resolved id), never the hardcoded `"claude-cli"`. Assert a
  run resolved to `"codex"` emits events with `provider: "codex"`.
- **Usage gating skip for non-claude (REQ-USAGE-02, SC-4):** when the active provider exposes **no**
  `checkUsage` (a `CliAgent`), every usage touchpoint is skipped — no preflight call, no
  mid-iteration banner scan, no between-iteration usage check, and no crash. Assert with a provider
  whose `stdout` contains a phrase like `"rate limit"`: it is **not** misclassified as
  `usage_limited` (the `hasUsageLimitInText` scan sits inside the `checkUsage`-gated block, `05 §3.6`
  / tech-spec §3.6). Conversely, a provider that DOES expose `checkUsage` (claude-cli fake) still
  runs the usage paths (REQ-USAGE-01 preserved).
- **Fail-fast (REQ-DET-02, SC-3):** when pre-loop detection reports an agent unavailable
  (`detectAgent` → `{ available: false }`), the runner returns the `AgentUnavailableError`-shaped
  error **before iteration 1**, the message names the agent + remediation + `getAgentDescriptors()`
  ids, and there is **no fallback to claude**. **Assert no state was written** — see §6 for the
  exact "no state written" assertions (no `.rauf/state.json`, no backlog status mutation). The
  candidate-id set probed pre-loop is the run-level resolved id PLUS every distinct per-item
  `provider` in the pending backlog (`05`/`02 §3.5`).
- **`runner.ts` no longer imports `spawnClaude`:** a guard test (or a grep-based check) asserts
  `runner.ts` contains no direct `spawnClaude(` call site (the only runtime caller is
  `providers/claude-cli.ts`). The guard greps **`runner.ts` only** — not the package — so it does
  not false-positive on the retained `index.ts:12` re-export or `claude-process.ts` (tech-spec §3.2).

### 3.2e `loop-commands.test.ts` (EDIT) — CLI surface (SC-5: REQ-SEL-01, REQ-DISC-01/02)

Extends the existing `packages/cli/src/loop-commands.test.ts` per `06-cli-surface.md`.
- `rauf loop run --agent <id>` plumbs `id` into `LoopStartOptions.provider` (direct path) and into
  `body.provider` (detached path, mirroring `body.model`).
- `rauf loop run --help` enumerates supported agent ids from `getAgentDescriptors()` (REQ-DISC-01).
- `rauf agents` lists each descriptor's id, `displayName`, and live `available` from `listAgents()`
  (REQ-DISC-02), including configured generic agents.

> Exact assertions for `loop-commands.test.ts` are owned by `06-cli-surface.md §Verification`; this
> document lists the cases for completeness because they cover SC-5's CLI surface. If `06` specifies
> a different test split, defer to it.

### 3.3 `cli-agent.test.ts` / `generic-cli.test.ts` summary (SC-1)

Together §3.2b and §3.2c prove SC-1 at the **unit** tier: a plain-text agent driven through
`CliAgent` (preset or generic config) assembles a correct non-interactive invocation, returns a
plain-text `ExecutionResult` with telemetry absent and no error, and a nonzero/timeout exit is data.
The **end-to-end** SC-1 proof (reaching `RAUF_DONE`, committing, real event id) is the sandbox tier
(§4).

### 3.4 Plain-text signal path note (REQ-SIG-02)

`parseSignal` (`signal-parser.ts:27`) is already agent-agnostic and unchanged; its tests
(`signal-parser.test.ts`) stay green. The new coverage is that a `CliAgent` leaves
`reconstructedText` unset so the runner's existing fallback `signalText = reconstructedText &&
reconstructedText.length > 0 ? reconstructedText : stdout` (`runner.ts:644-645`) parses raw stdout — asserted in `runner.test.ts`
(a non-claude provider whose `stdout` ends in `RAUF_DONE` resolves a `done` outcome) and end-to-end
in the sandbox (§4).

### 3.5 `signal-redactor.test.ts` (EDIT) — neutralization (SC-6: REQ-SEC-02)

Extends the existing `signal-redactor.test.ts` (which already covers `redactSignalTokens` for
`RAUF_DONE`/`RAUF_BLOCKED`/`RAUF_NEEDS_HUMAN`). New cases for the added
`neutralizeForDetection(text)` (`05-runner-wiring.md §3.7`) — the function applied to **every**
adapter's output immediately before `parseSignal`:

- **Quoted / inline token neutralized (SC-6 core):** input where a `RAUF_*` token appears inside a
  line that is NOT a standalone trimmed line — e.g. `The agent wrote "RAUF_DONE" in a comment.` or
  `prefix RAUF_DONE suffix` — is rewritten so the literal token is gone (`RAUF·DONE`), and a
  subsequent `parseSignal(neutralizeForDetection(input))` returns `none` (no false signal).
- **Genuine final-line signal preserved:** input whose **last trimmed line** is exactly `RAUF_DONE`
  (or `RAUF_BLOCKED:<reason>` / `RAUF_NEEDS_HUMAN:<reason>` / `RAUF_REVIEW:<json>`) is left intact —
  `neutralizeForDetection` must NOT touch a standalone trimmed-line signal, and
  `parseSignal(neutralizeForDetection(input))` returns the real signal type. This is the
  load-bearing assertion: neutralization must not break legitimate completion.
- **`RAUF_REVIEW` covered (extends the token set):** the existing redactor token set lacks
  `RAUF_REVIEW` (`00-core-definitions.md §6`, `signal-redactor.ts:1`). Assert an inline `RAUF_REVIEW`
  is neutralized and a final-line `RAUF_REVIEW:{...}` is preserved — proving the token set was
  extended to `SIGNAL_TOKENS = ["RAUF_DONE","RAUF_BLOCKED","RAUF_NEEDS_HUMAN","RAUF_REVIEW"]`.
- **Multiple inline tokens** in one line all neutralized; a final-line signal after inline mentions
  on earlier lines is still detected (the runner scans backward to the last whole-line match).
- **Uniformity:** these are pure-string assertions on `neutralizeForDetection`; the runner applies
  it at **both** sites (work iteration on `signalText`, review pass on `stdout` —
  `05-runner-wiring.md §3.7`), so the function-level test plus the runner-wiring test (§3.2d) cover
  REQ-SEC-02's "uniformly across all adapters" guarantee. The pre-existing log-preview
  `redactSignalTokens` tests stay green (that redaction is retained).

### 3.6 `claude-cli.test.ts` (UNCHANGED) — regression anchor (SC-2)

`providers/claude-cli.test.ts` must stay **green and unchanged**. It mocks `spawnClaude`,
`checkUsageLimit`, and `readClaudeOAuthToken` and asserts the claude adapter's `execute` /
`validateCredentials` / `checkUsage` behavior. The feature touches `claude-cli.ts` only at the
**registration line** (`registerProvider` → `registerAgent` + a `detectClaudeCli` helper,
`02 §3.3`); the class body is byte-for-byte unchanged, so this suite is the unit-tier proof that the
claude adapter is behaviorally preserved (SC-2). If any assertion in this file requires editing to
pass, the change has regressed the claude path and must be reverted.

## 4. Integration (sandbox) approach — SC-1 & SC-4

The existing `test-sandbox/` harness drives a real loop iteration through a mock agent CLI placed
first on `PATH`, with git redirected to a throwaway repo (`GIT_DIR=$SANDBOX_DIR/.sandbox-git`,
`GIT_WORK_TREE=$SANDBOX_DIR`) so commits stay out of the parent repo. Today the mock is
`test-sandbox/claude`, a tiny dispatcher that `exec`s
`scenarios/${MOCK_CLAUDE_SCENARIO:-stream-done}.sh`; `run.sh` and `verify.sh` set
`MOCK_CLAUDE_SCENARIO` and run `rauf loop run "$SANDBOX_DIR" --iterations 1 --timeout 1`. Scenario
scripts drain stdin (`cat > /dev/null` or `PROMPT="$(cat)"`) and emit Claude **stream-json** NDJSON,
placing the `RAUF_*` signal in the last `text_delta`. `verify.sh` asserts via `jq` against
`.rauf/backlog.json`, `.rauf/state.json`, `.rauf/events.ndjson`, and the throwaway git log.

This feature **generalizes** that harness (tech-spec §8, `01-architecture-layout.md §2`).

### 4.1 Driver env generalization (back-compatible)

- Introduce `MOCK_AGENT_SCENARIO` as the canonical scenario env. The mock dispatchers resolve the
  scenario as `MOCK_AGENT_SCENARIO` first, falling back to `MOCK_CLAUDE_SCENARIO`, then the
  `stream-done` default — so **every existing `MOCK_CLAUDE_SCENARIO` usage keeps working unchanged**
  (SC-2: the claude scenarios are untouched). The existing `test-sandbox/claude` dispatcher gains
  the same fallback (`SCENARIO="${MOCK_AGENT_SCENARIO:-${MOCK_CLAUDE_SCENARIO:-stream-done}}"`).
- `run.sh` / `verify.sh` gain an **agent selector**: which mock binary to put on `PATH` and which
  `--agent <id>` to pass. A `run_agent_scenario <agent> <scenario>` helper (the cross-agent sibling
  of the existing `run_scenario`) resets the sandbox, exports the scenario env, puts the chosen mock
  binary first on `PATH`, and runs `rauf loop run "$SANDBOX_DIR" --iterations 1 --timeout 1 --agent
  <id>`. For `<agent>=claude` (or no `--agent`) the behavior is exactly today's path.

### 4.2 Mock agents (NEW)

Add plain-text mock agents alongside `test-sandbox/claude`
(`01-architecture-layout.md §2`):

- `test-sandbox/codex`, `test-sandbox/gemini`, `test-sandbox/copilot`, and the cursor binary named
  **`cursor-agent`** (its `binary` differs from its id per
  `03-cli-agent-engine-and-presets.md §6`). Each is a tiny dispatcher (like `claude`) that resolves
  the scenario from `MOCK_AGENT_SCENARIO`/`MOCK_CLAUDE_SCENARIO` and `exec`s the scenario script in
  **plain-text mode**.
- `test-sandbox/mock-generic-agent.sh` — the target for the reserved `generic-cli` adapter, invoked
  via a `providerConfig` (`{ "binary": "<abs path to mock-generic-agent.sh>", "promptDelivery":
  "stdin", "nonInteractive": ["--auto-approve"] }`) supplied through the `.rauf.json` marker
  `providerConfig` (or a `ToolConfig.providers` entry for the named-config path). It emits plain text
  and a final-line `RAUF_DONE`.

**Plain-text emission (REQ-SIG-02, REQ-OBS-02).** The scenario scripts (`scenarios/*.sh`) are
extended to emit *either* stream-json (for claude) *or* plain text (for the non-claude agents),
selected by an env the dispatcher sets (e.g. `MOCK_AGENT_FORMAT=plain` exported by the non-claude
dispatchers; default/`stream` for claude). In plain-text mode a scenario drains stdin then prints
human-readable lines ending with the **same** signal as its stream-json form on the final non-empty
line — e.g. `stream-done` plain mode prints `All changes complete.` then `RAUF_DONE`;
`stream-blocked` prints the blocker prose then `RAUF_BLOCKED:<reason>`. No `message_start` /
`content_block_*` / `message_delta` JSON is emitted in plain mode, so **no token/tool telemetry
exists** — exercising the "telemetry gracefully absent" path. The reuse keeps one signal-source of
truth per scenario across both formats.

> Reuse over duplication: a shared helper sourced by each scenario (e.g.
> `scenarios/_emit.sh` with `emit_done`/`emit_blocked`/`emit_needs_human` that branch on
> `MOCK_AGENT_FORMAT`) keeps the stream-json and plain-text forms in lockstep. If a per-scenario
> branch is simpler, that is acceptable — the contract is "same signal, two formats".

### 4.3 `verify.sh` per-agent assertions (SC-1, SC-4)

For **each** non-claude agent (`codex`, `gemini`, `copilot`, `cursor`) and the `generic-cli` agent,
`verify.sh` runs the `stream-done` scenario (plain-text mode) via `run_agent_scenario` and asserts:

1. **Reaches `RAUF_DONE` / commits as today (SC-1):** `assert_item_status "001" "done"`,
   `assert_done_file_exists`, `assert_state_status "limit_reached"` (one iteration, `--iterations 1`,
   so the loop ends in `limit_reached` exactly as the claude `stream-done` case), and
   `assert_dogfood_commit` (exactly one `[rauf] 001:` commit, live `events.ndjson` excluded) — the
   plain-text agent drives the full backlog→commit pipeline identically.
2. **Real agent id in events (SC-4, REQ-OBS-01):** a new assertion `assert_event_provider <id>`
   checks that `llm_spawned`/`llm_exited` events in `.rauf/events.ndjson` carry `provider == "<id>"`
   (e.g. `"codex"`), and crucially `provider != "claude-cli"`. Implementation:
   `jq -s -e --arg id "$id" 'any(.[]; (.type=="llm_spawned" or .type=="llm_exited") and
   .provider==$id)'` and a companion check that **no** `llm_spawned`/`llm_exited` event carries
   `"claude-cli"` for a non-claude run.
3. **Anthropic preflight skipped without error (SC-4, REQ-USAGE-02):** assert the run completed
   cleanly (item done, state `limit_reached`, no error in the loop log) and that the usage-limit
   detection log line (the one `verify.sh` already greps for in the `usage-limit-stdout` case) is
   **absent** for the non-claude run — proving the claude usage preflight/banner scan did not run.
   A negative grep assertion suffices, reusing the exact marker `verify.sh:380` already greps for in
   the `usage-limit-stdout` case: `! grep -q "Usage limit detected" "$SANDBOX_DIR/.rauf/rauf.log"`.
4. **Telemetry gracefully absent, no error (SC-1, REQ-OBS-02):** assert `events.ndjson` for the
   non-claude run contains the spawn+exit lifecycle and `item_completed`, but **no** token-count or
   `llm_tool_activity` events (a `jq` "none of type llm_tool_activity" check), and the run raised no
   error (clean exit / `assert_events_never_contradict` still passes). Absence of telemetry must not
   fail the run.

The `generic-cli` agent additionally asserts the loop drove the `mock-generic-agent.sh` binary
(its event `provider == "generic-cli"`) and reached `RAUF_DONE` — proving the config-driven,
no-code path (REQ-ADP-04, REQ-SCALE-01).

Concrete scenario → assertion plan (one row per agent run added to `verify.sh`):

| Agent (`--agent`) | Mock binary | Scenario | Format | Key assertions |
|---|---|---|---|---|
| `codex` | `test-sandbox/codex` | `stream-done` | plain | item done, commit, `provider=="codex"`, no preflight, no telemetry |
| `gemini` | `test-sandbox/gemini` | `stream-done` | plain | item done, commit, `provider=="gemini"`, no preflight, no telemetry |
| `copilot` | `test-sandbox/copilot` | `stream-done` | plain | item done, commit, `provider=="copilot"`, no preflight, no telemetry |
| `cursor` | `test-sandbox/cursor-agent` | `stream-done` | plain | item done, commit, `provider=="cursor"`, no preflight, no telemetry |
| `generic-cli` | `mock-generic-agent.sh` (via `providerConfig`) | `stream-done` | plain | item done, commit, `provider=="generic-cli"`, no preflight, no telemetry |
| `codex` | `test-sandbox/codex` | `stream-blocked` | plain | `assert_item_status "001" "blocked"` — proves plain-text `RAUF_BLOCKED` parsing on the non-claude path (REQ-SIG-02) |

> At least one non-claude `stream-blocked` run is included to prove the plain-text path handles a
> non-done signal (not just `RAUF_DONE`), exercising `parseSignal` over raw stdout for a non-claude
> agent (REQ-SIG-01/02). A non-claude `RAUF_REVIEW` run is optional (the review pass is wired through
> the same provider seam per REQ-ADP-06; SC-6's review-token coverage is unit-level in §3.5).

### 4.4 Gate relationship

`pnpm gate` runs `pnpm test` (the Vitest suites — §3), which is the SC-7 acceptance gate. The
sandbox `verify.sh` is **not** part of `pnpm gate` today (it is a Bash integration harness run
manually: `bash test-sandbox/verify.sh`). This feature does not change that wiring; SC-1/SC-4's
end-to-end proof is `bash test-sandbox/verify.sh` green (all per-agent rows pass), run as the
documented integration check, while the unit tiers (§3) carry the gate. **WARNING: confirm** whether
the repo wires `verify.sh` into CI separately before assuming the cross-agent sandbox rows run
automatically — at authoring time `pnpm gate` does not invoke `verify.sh`.

## 5. Regression (SC-2)

The claude path must be behaviorally unchanged. Regression is proven by two unchanged surfaces:

- **Unit:** `providers/claude-cli.test.ts` stays green and unedited (§3.6); `claude-process.test.ts`
  stays green after the `process-group.ts` extraction (the helper is the same implementation,
  `03 §5.3`); `signal-parser.test.ts`, `stream-parser.test.ts`, `stream-integration.test.ts`,
  `usage-checker.test.ts`, `exit-classifier.test.ts` stay green.
- **Child-env forwarding (SC-2 — `ExecuteOptions.env`):** add a `claude-cli.test.ts` (or
  `runner.test.ts`) case asserting that env passed via `ExecuteOptions.env` reaches `spawnClaude`'s
  `SpawnClaudeOptions.env` — i.e. the runner's `childEnv` (review-hook suppression,
  `REVIEW_HOOK_SUPPRESSION_ENV`) still arrives at the claude process after routing through
  `provider.execute(...)` rather than the former direct `spawnClaude(..., { env })` call. Without
  this, the env-plumbing regression (`00 §3.4`, `05 §3.1`) would pass typecheck but silently
  break review-hook suppression. Assert the same for `CliAgent.execute` merging `options.env` over
  `config.env` (`cli-agent.test.ts`).
- **Sandbox:** **every existing claude scenario passes exactly as before** via `bash
  test-sandbox/verify.sh`, run with no `--agent` (or `--agent claude-cli`) so the claude adapter is
  resolved (REQ-SEL-03, row-5 keystone). The existing assertions are unchanged:
  - `stream-done` → item `001` done, `state==limit_reached`, DONE file, `assert_events_never_contradict`,
    `assert_dogfood_commit`.
  - `stream-blocked` → item `001` blocked.
  - `stream-tools` → done with multi-tool activity (token + `llm_tool_activity` events present —
    claude DOES emit telemetry).
  - `slow-stream`, `stream-needs-human`.
  - `usage-limit-stdout` → the Anthropic banner-in-stdout path still detects the usage limit, resets
    the item to pending, and pauses (REQ-USAGE-01 preserved); `verify.sh`'s "log shows usage-limit
    detection" assertion still passes.
  - `commit-no-signal`, `fast-infra-death`, `pause-resume-needs-human`, the multi-backlog and
    events.ndjson/compat cases — all unchanged.

  Because the generalized driver falls back to `MOCK_CLAUDE_SCENARIO` and the claude dispatcher is
  unchanged, **no existing claude scenario script or assertion is edited** beyond the additive
  scenario-env fallback. If a claude scenario assertion must change to pass, SC-2 has regressed.

- **Performance (REQ-PERF-01):** no perf test is added (the change is a single `provider.execute`
  indirection plus a per-id cache, `01-architecture-layout.md §6`); parity is argued structurally and
  confirmed by the claude scenarios completing within the same `--timeout 1` budget they use today.

## 6. Fail-fast — "no state written" (SC-3, REQ-DET-02)

Selecting an agent whose CLI is absent must fail **before any iteration runs or any state is
written**, naming the agent + remediation, with no fallback to claude. This is asserted at two
tiers.

**Unit (`runner.test.ts`, §3.2d):** with `detectAgent` mocked to return `{ available: false }` for
the resolved id, the runner returns the `AgentUnavailableError`-shaped `Result` error before
iteration 1. Assert "no state written" by:
- The runner never calls `provider.execute` (the provider's `execute` `vi.fn()` has zero calls).
- No `state.json` write occurs — assert the state-writer seam (the function the runner uses to
  persist `state.json`) is **not invoked** (spy/mock it), and no backlog mutation seam is invoked
  (backlog item statuses are untouched in the in-memory model).
- The error message contains the agent id, install/PATH remediation, and the
  `getAgentDescriptors()` id list (`00-core-definitions.md §5` template).

**Sandbox (`verify.sh`):** a new fail-fast row runs `rauf loop run "$SANDBOX_DIR" --iterations 1
--timeout 1 --agent codex` **without** the `test-sandbox/codex` mock on `PATH` (so the `codex`
binary genuinely does not resolve), and asserts on a **fresh** sandbox (`setup.sh` leaves no
`state.json`):
- the command exits non-zero with a message naming `codex` and how to install / put it on `PATH`;
- `assert_file_not_exists "$SANDBOX_DIR/.rauf/state.json"` — **no state file was written**;
- the backlog item `001` status is still its pre-run value (e.g. `pending`/`in_progress` as
  `setup.sh` leaves it) — `assert_item_status "001" "<pre-run status>"` — i.e. **no backlog status
  mutation**;
- no commit was made on the throwaway repo since the baseline (no `[rauf] …` commit) — fail-fast did
  not reach the commit step;
- the output does NOT mention `claude` being used — **no silent fallback** (REQ-DET-02).

> "No state written" is concretely: (a) no `.rauf/state.json` exists/changed, (b) no backlog item
> status changed, (c) no per-item commit. The fresh-sandbox precondition (`setup.sh` produces no
> `state.json`) makes assertion (a) a simple file-absence check.

## 7. Coverage targets

- The repository has **no configured coverage threshold** (no `@vitest/coverage-*` dependency, no
  `coverage` block in a `vitest.config.*`, no threshold in `package.json` — verified). `pnpm gate`
  enforces a **green test run**, not a coverage percentage.
- **Target: no regression in effective coverage; every new module is covered by the unit suites
  above.** Concretely, each net-new production module has a colocated suite exercising its public
  surface and error paths:
  - `agent-selection.ts` → `agent-selection.test.ts` (full precedence matrix + alias, §3.1).
  - `providers/registry.ts` (descriptor layer) → `registry.test.ts` (registration, enumeration,
    detect default/override/unknown, `listAgents`, `clearProviders`, §3.2).
  - `providers/cli-agent.ts` → `cli-agent.test.ts` (prompt delivery × model flag × non-interactive ×
    plain-text result × kill/timeout forwarding, §3.2b).
  - `providers/generic-cli.ts` → `generic-cli.test.ts` (`configToCliAgentConfig` valid/invalid,
    factory, both config sources, §3.2c).
  - `signal-redactor.ts` additions (`neutralizeForDetection`, `RAUF_REVIEW`) → `signal-redactor.test.ts`
    (§3.5).
  - `runner.ts` additions → `runner.test.ts` (per-iteration resolve/cache/dispose, event id, usage
    gating, fail-fast, §3.2d).
  - `process-group.ts` (if extracted) → covered by the unchanged `claude-process.test.ts` (same
    implementation) plus an optional direct kill/timeout case (§3.2b note).
  - CLI surface → `loop-commands.test.ts` (§3.2e, owned by `06`).
- **Branch coverage emphasis** (the failure-mode branches that matter):
  - selection: every precedence row + the empty-string-skip branch (REQ-SEL-02/03/04);
  - detection: found / not-found / credential-override / unknown-id / generic-no-config (REQ-DET-01/02);
  - engine: each `promptDelivery` value, model-flag-present vs absent, non-interactive always present,
    nonzero/timeout-as-data vs spawn-failure-as-error (REQ-EXEC/MODEL/OBS);
  - neutralization: inline-neutralized vs final-line-preserved, including `RAUF_REVIEW` (REQ-SEC-02);
  - runner gating: `checkUsage`-present vs absent (REQ-USAGE-01/02), fail-fast no-state (REQ-DET-02).

> **WARNING:** if a future change introduces a `vitest.config` coverage threshold, this section must
> be updated to that number; at authoring time the project enforces "green, not %", so the target is
> stated as "no regression + new modules covered" consistent with the repo.

## 8. Test file locations

All colocated `*.test.ts` per CLAUDE.md (`01-architecture-layout.md §2`):

| File | Status | Tier | Covers |
|---|---|---|---|
| `packages/loop/src/agent-selection.test.ts` | NEW | unit | SC-5 (precedence, alias) |
| `packages/loop/src/providers/registry.test.ts` | EDIT | unit | SC-5, SC-2 (descriptor layer, back-compat) |
| `packages/loop/src/providers/cli-agent.test.ts` | NEW | unit | SC-1 (engine) |
| `packages/loop/src/providers/generic-cli.test.ts` | NEW | unit | SC-1 (generic/named config) |
| `packages/loop/src/providers/claude-cli.test.ts` | UNCHANGED | unit | SC-2 (claude adapter parity) |
| `packages/loop/src/signal-redactor.test.ts` | EDIT | unit | SC-6 (neutralization + RAUF_REVIEW) |
| `packages/loop/src/runner.test.ts` | EDIT | unit | SC-3, SC-4 (wiring, fail-fast, gating) |
| `packages/loop/src/claude-process.test.ts` | UNCHANGED | unit | SC-2 (kill/timeout via shared helper) |
| `packages/cli/src/loop-commands.test.ts` | EDIT | unit | SC-5 (`--agent`, `rauf agents`) — owned by `06` |
| `test-sandbox/{codex,gemini,copilot,cursor}` | NEW | integration | SC-1/SC-4 (plain-text mock agents; cursor binary is `cursor-agent`) |
| `test-sandbox/mock-generic-agent.sh` | NEW | integration | SC-1 (generic-cli target) |
| `test-sandbox/scenarios/*.sh` | EDIT | integration | plain-text emission alongside stream emission |
| `test-sandbox/claude` | EDIT | integration | scenario-env fallback (`MOCK_AGENT_SCENARIO` → `MOCK_CLAUDE_SCENARIO`) |
| `test-sandbox/run.sh` | EDIT | integration | agent selector + generalized driver env |
| `test-sandbox/verify.sh` | EDIT | integration | per-agent assertions + fail-fast row + SC-2 regression rows |

## Test fixtures & factories

Reusable helpers keep unit tests aligned with the real interface shapes from
`00-core-definitions.md` (so a mock that drifts from `LLMProvider`/`AgentDescriptor`/`CliAgentConfig`
fails to compile under strict TS, catching shape drift at the gate).

- **`makeMockProvider(overrides?): LLMProvider`** — factory returning an `LLMProvider`
  (`00 §7`: `{ id, displayName, execute, validateCredentials, checkUsage?, dispose? }`), defaulting
  `execute` to `ok({ stdout: "RAUF_DONE", stderr: "", exitCode: 0, timedOut: false, durationMs: 1 })`
  and `validateCredentials` to `ok(undefined)`. Mirrors the existing `createMockProvider` in
  `providers/registry.test.ts`. Overrides let a test add `checkUsage` (to exercise the
  claude-only usage path) or omit it (to exercise REQ-USAGE-02 skip). Because the return type is
  annotated `LLMProvider`, any missing/extra member is a compile error — the mock cannot drift from
  the interface in `00`.
- **`makeDescriptor(overrides?): AgentDescriptor`** — factory for `AgentDescriptor` (`00 §3.3`),
  defaulting `{ id, displayName: id, binaryName: id, factory: () => makeMockProvider({ id }) }`;
  overrides supply a custom `detect` or omit `binaryName` (generic-cli shape).
- **`makeCliAgentConfig(overrides?): CliAgentConfig`** — factory for `CliAgentConfig` (`00 §3.2`),
  defaulting a minimal valid config (`{ id, displayName: id, binary: id, buildArgs: () => [],
  promptDelivery: "stdin", nonInteractive: [] }`); overrides set `promptDelivery`, `modelFlag`,
  `nonInteractive`, `env`. Used by `cli-agent.test.ts` and `generic-cli.test.ts`.
- **`mockSpawnProcessGroup(result)`** — a `vi.fn()` matching `spawnProcessGroup`'s signature
  (`03 §5.1`) that resolves `ok(result)` (a `ProcessGroupResult`) or `err(...)`, installed via
  `vi.mock("../process-group.js")`. Lets `cli-agent.test.ts` assert the recorded `(cmd, args, opts)`
  without spawning a real process. The recorded call is the assertion target for argv/stdin/timeout.
- **Controlled `PATH` fixture (registry detect):** in `registry.test.ts`, set `process.env.PATH` to
  a tmp dir containing (or not containing) an executable stub file to drive the default
  `probeBinaryOnPath` (`02 §5.1`) deterministically; restore the original `PATH` in `afterEach`. No
  agent subprocess is ever spawned (the probe is `fs.access(..., X_OK)`).
- **Registry reset:** every suite touching the registry uses `afterEach(clearProviders)` (which now
  clears BOTH the factory and descriptor maps, `02 §3.4`) so tests start clean — matching the
  existing `registry.test.ts` pattern.

**Sandbox fixtures:** the mock agents are plain Bash scripts (no Node), reusing the scenario scripts
in plain-text mode (§4.2). The `generic-cli` `providerConfig` fixture is a `.rauf.json` marker
fragment (or `ToolConfig.providers` entry) pointing `binary` at the absolute path of
`mock-generic-agent.sh`. These align with the real config shapes (`MarkerOptions.providerConfig` /
`ToolConfig.providers`, `core/schemas.ts:149/223`) so the sandbox exercises the same load path as
production.

## Dependencies

Must be implemented after every other document in the suite (it tests them):

- `00-core-definitions.md` — the interface shapes (`LLMProvider`, `AgentDescriptor`,
  `DetectionResult`, `CliAgentConfig`, `ExecuteOptions`, `ExecutionResult`) and constants
  (`DEFAULT_AGENT_ID`, `GENERIC_AGENT_ID`, `SIGNAL_TOKENS`) that mocks and factories must match.
- `01-architecture-layout.md` — the test-file map (§2) and the test-sandbox tree.
- `02-agent-registry-and-detection.md` — the registry/detection behavior `registry.test.ts` asserts;
  the `verify.sh` Verification checklist in `02 §Verification` enumerates the registry cases.
- `03-cli-agent-engine-and-presets.md` — the `CliAgent`/`generic-cli`/`process-group` behavior that
  `cli-agent.test.ts` / `generic-cli.test.ts` assert; the preset table (cursor → `cursor-agent`)
  the sandbox mocks mirror.
- `04-agent-selection.md` — the precedence matrix (`§3.1` rows 1–9) and alias rules that
  `agent-selection.test.ts` asserts (`04 §7` lists the assertions verbatim).
- `05-runner-wiring.md` — the per-iteration resolve/cache/dispose, event-id, usage-gating,
  neutralization-site, and fail-fast behavior that `runner.test.ts` asserts.
- `06-cli-surface.md` — owns `loop-commands.test.ts`'s exact assertions (this doc lists the SC-5 CLI
  cases for completeness).

Reuses (no change): the existing Vitest config, the `test-sandbox/` harness
(`setup.sh`/`run.sh`/`verify.sh`/`claude`/`scenarios/*.sh`), and the existing assertion helpers
(`assert_item_status`, `assert_no_iteration_status`, `assert_done_file_exists`,
`assert_state_status`, `assert_file_not_exists`, `assert_events_never_contradict`,
`assert_dogfood_commit`, `run_scenario`).

## Verification checklist

- [ ] `agent-selection.test.ts` exists and covers all nine precedence rows (incl. row-5 keystone →
  `DEFAULT_AGENT_ID`, row-8 empty-string skip) and the four `normalizeAgentAlias` cases (incl.
  both-keys-present → provider-wins + `onWarn` called) (SC-5).
- [ ] `registry.test.ts` covers descriptor registration, sync `getAgentDescriptors` (no
  `available`), async `listAgents`, default PATH probe found/not-found, claude credential override,
  generic-cli no-config available, unknown-id non-throwing `detectAgent`, back-compat
  `registerProvider` synthesis, and `clearProviders` clearing both maps (SC-5, SC-2).
- [ ] `cli-agent.test.ts` covers arg/stdin/file prompt delivery, model-flag on/off (REQ-MODEL-02),
  non-interactive always appended (REQ-EXEC-01), timeout/signal forwarding, plain-text
  `ExecutionResult` (`reconstructedText`/`parsedSignal`/`progressEvents` unset, telemetry absent),
  nonzero/timeout-as-data, spawn-failure-as-error, and absence of `checkUsage`/`dispose` (SC-1).
- [ ] `generic-cli.test.ts` covers `configToCliAgentConfig` valid + missing-binary +
  invalid-promptDelivery + defaults, the reserved-id factory path, and the named-config path (SC-1).
- [ ] `signal-redactor.test.ts` covers inline/quoted neutralization (false signal suppressed),
  final-line signal preserved, and `RAUF_REVIEW` both inline-neutralized and final-line-preserved
  (SC-6).
- [ ] `runner.test.ts` covers per-iteration resolve + per-id cache + dispose-on-every-exit, event
  `provider` = real id (not `claude-cli`), usage gating skip for non-`checkUsage` providers (no
  spurious `usage_limited` on a "rate limit" stdout), and fail-fast with **no state written**
  (SC-3, SC-4).
- [ ] `claude-cli.test.ts` and `claude-process.test.ts` are **green and unchanged** (SC-2).
- [ ] `test-sandbox/claude` resolves the scenario via `MOCK_AGENT_SCENARIO` with a
  `MOCK_CLAUDE_SCENARIO` fallback; all existing claude scenarios pass under `bash
  test-sandbox/verify.sh` exactly as before (SC-2).
- [ ] `test-sandbox/{codex,gemini,copilot,cursor-agent}` and `mock-generic-agent.sh` exist, emit
  plain text + a final-line signal, and each reaches `RAUF_DONE`, commits, emits the **real** agent
  id in `llm_spawned`/`llm_exited` (never `claude-cli`), skips the Anthropic preflight without
  error, and produces no token/tool telemetry without failing (SC-1, SC-4).
- [ ] A non-claude `stream-blocked` sandbox run marks the item `blocked` (plain-text non-done signal,
  REQ-SIG-02).
- [ ] A fail-fast sandbox row (`--agent codex` with no `codex` on PATH, fresh sandbox) exits
  non-zero naming the agent, writes no `state.json`, mutates no backlog status, makes no commit, and
  never mentions falling back to claude (SC-3).
- [ ] `pnpm gate` is green (SC-7); `bash test-sandbox/verify.sh` is green (SC-1/SC-2/SC-4 end-to-end).
