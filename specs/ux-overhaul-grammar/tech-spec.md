# UX/DX Overhaul — Phase 2+3: Command Grammar & Contract Flip — Technical Specification

> Implements `specs/ux-overhaul-grammar/PRD.md` (Phase 2 grammar + Phase 3 contract, one breaking
> v0.5.0 flip). Cross-cutting source of truth is `../ux-overhaul/CANON.md` (§4.1, §4.4, §4.5). This
> spec answers HOW; requirements (WHAT) are referenced by REQ-ID. All file:line references were verified
> against source during forge-2-tech research and must be re-confirmed at implementation time.

## 1. Overview

This is a **surface + contract** change, not an engine change. The execution engine (`LoopRunner`, the
server daemon, the file-backed observation substrate from Phase 1) is reused as-is. The work is:

1. **Grammar (Phase 2):** collapse `loop run` (in-process) and `loop start` (server) into one verb —
   `loop run`, with `--detached`/`-d` selecting the server-owned mode — by **reusing the existing
   `loop start` server path verbatim** behind the flag and removing the `loop start` verb. Normalize the
   flag canon and add targeted remediation errors for removed verbs/flags.
2. **Contract (Phase 3):** **redefine the `ExitCode` enum in place** to the unified canon table and audit
   all call sites; add the explicit `review` value to the `signal_parsed` event enum and **remove the
   `review→done` collapse**; formalize `events.ndjson` as a versioned, additive-only machine surface
   (documentation discipline — the shapes already align).
3. **Cutover:** land everything as **v0.5.0**, and update **feature-forge** (separate repo) in lockstep
   (out-of-loop step, gated as part of done — REQ-CONTRACT-04/05).

Key ratified technical decisions (forge-2-tech session): reuse the `loop start` server path for
`--detached`; redefine `ExitCode` in place + audit; keep the `POST /loop/start` route URL (drop only the
CLI verb); minimal `review` fix (event enum + collapse removal, no handling-semantics change).

## 2. Module Structure

No new packages or modules. All changes are edits within the existing 4-package monorepo
(`@rauf/core`, `@rauf/loop`, `@rauf/cli`, `@rauf/web`). Public-API surface changes:

- `@rauf/cli` — `ExitCode` const redefined (`commands.ts`); `loop start` handler removed, `--detached`
  branch added to `loop run`; flag parsing (`parser.ts`) gains `-d`/`--detached`; remediation-error map.
- `@rauf/core` — `SignalParsedSchema.signal` enum gains `"review"` (`schemas.ts`); `EVENTS_SCHEMA_VERSION`
  unchanged (stays `"1"`; versioning *discipline* documented, not bumped — this is the first formal
  version, not a breaking change to the log shape).
- `@rauf/loop` — remove the `review→done` collapse at the `signal_parsed` emit site (`runner.ts`); the
  `loop run` terminal-state → exit-code mapping moves from a ternary to a full mapping.
- `@rauf/web` — `POST /:id/loop/start` route retained (URL + contract unchanged); no removal.

## 3. Technical Decisions

### 3.1 `loop run --detached` reuses the server path (REQ-EXEC-01/02/03/04/05)

`loop run --detached` delegates to the **exact mechanism `loop start` uses today**: `ensureServerRunning(ctx)`
(`packages/cli/src/loop-commands.ts:258-286`, auto-starts the daemon via `handleServerStart`/`startDaemon`
→ `child_process.spawn(..., {detached:true})` + `child.unref()`), then `POST /api/projects/:id/loop/start`
with the same request body `handleLoopStart` builds (`loop-commands.ts:336-367`), then return immediately
(printing the `rauf follow <path>` hint). The server runs the loop in-process via
`LoopManager.startLoop()` (`packages/web/src/server/loop-manager.ts:86`) — unchanged.

- **Implementation:** in `handleLoopRun` (`loop-commands.ts:620`), branch on `--detached`/`-d`: if set,
  execute the current `handleLoopStart` body (server-POST flow); else the existing in-process
  `LoopRunner.create().start()` path (unchanged). `handleLoopStart` is then deleted as a dispatchable
  verb and its logic folded into the `--detached` branch (shared helper to avoid duplication).
- **`--detached --follow` (REQ-EXEC-04):** after the server-POST returns, attach the canonical top-level
  `follow` view. Lifecycle (per PRD): Ctrl-C on the attached view **detaches the view only**; the loop
  keeps running server-side. Stopping requires `loop stop` (`POST /loop/stop`, unchanged).
- **`loop stop` (REQ-EXEC-05):** unchanged — already targets the server/detached loop.
- **Rationale:** canon P2 ("hide the mode, don't change it"). Zero execution-semantics change; lowest risk.
- **Alternatives considered:** server spawning a detached `rauf loop run` subprocess (rejected — changes
  execution semantics for no grammar-phase benefit).

### 3.2 Unified exit codes — redefine `ExitCode` in place (REQ-EXIT-01/02/03/04)

Current `ExitCode` (`packages/cli/src/commands.ts:90-101`): `SUCCESS:0, ERROR:1, INVALID_ARGS:2,
NOT_FOUND:3, VALIDATION:4, CONFLICT:5, PAUSED_HUMAN:6`. The canon meanings collide with these values, so
the enum is **redefined** to the canon table and every call site is audited and re-pointed:

| Code | New member | Meaning (CANON §4.4) | Old member at this value |
|------|-----------|----------------------|--------------------------|
| 0 | `SUCCESS` | clean terminal (idle/complete) | SUCCESS (same) |
| 1 | `ERROR` | generic failure | ERROR (same) |
| 2 | `USAGE` | bad args / IO / failed precondition | INVALID_ARGS (rename) |
| 3 | `NEEDS_HUMAN` | `PAUSED_HUMAN` | NOT_FOUND (remap) |
| 4 | `LIMIT` | limit reached / usage-paused / sleeping | VALIDATION (remap) |
| 5 | `BLOCKED` | terminal with blocked items | CONFLICT (remap) |
| 6 | `RUNNING` | running — query-time only (`status`) | PAUSED_HUMAN (remap) |

**Old non-canon semantic uses are folded into `USAGE`(2) or `ERROR`(1):** the old `NOT_FOUND`
(e.g. "no loop to stop", missing project), `VALIDATION` (bad input), and `CONFLICT` (loop already
running — `loop run`/`loop start` 409) all become **`USAGE`(2)** (failed-precondition/usage errors), since
the canon reserves 3/4/5/6 for loop-state outcomes. Each call site currently using
`NOT_FOUND`/`VALIDATION`/`CONFLICT` must be reviewed and re-pointed (grep the CLI for `ExitCode.NOT_FOUND`,
`.VALIDATION`, `.CONFLICT`).

- **`loop run` terminal mapping (REQ-EXIT-01):** replace the single ternary at `loop-commands.ts:979-983`
  (`pausedReason === "needs_human" ? PAUSED_HUMAN : SUCCESS`) with a full mapping over `LoopResult`
  (`packages/loop/src/runner.ts:62-72`: `completedCount`, `blockedCount`, `needsHumanCount?`, `cancelled`,
  `pausedReason?`): `pausedReason==="needs_human"`/`needsHumanCount>0` → `NEEDS_HUMAN`(3); limit/sleeping
  terminal → `LIMIT`(4); `blockedCount>0` (terminal) → `BLOCKED`(5); clean → `SUCCESS`(0); failure →
  `ERROR`(1).
- **`status` mapping (REQ-EXIT-01):** rewrite `statusExitCode(state)` (`status-commands.ts:492-504`) over
  `LoopStateEnum` (`schemas.ts:228-239`): `RUNNING`→`RUNNING`(6), `PAUSED_HUMAN`→`NEEDS_HUMAN`(3),
  `LIMIT_REACHED`/`SLEEPING_LIMIT`/`WEEKLY_LIMIT`→`LIMIT`(4), terminal-with-blocked→`BLOCKED`(5),
  `IDLE`/`COMPLETE`/`PAUSED`/`ERROR`/`NOT_INSTALLED`→ per canon (0, except `ERROR`→1).
- **`backlog validate` untouched (REQ-EXIT-03):** keeps 0/1/2.
- **Rationale:** one coherent enum, single contract; clean break (no parallel scheme).

### 3.3 Flag canon (REQ-FLAG-01/02/03/04)

`--follow`/`-f` already normalized for `status`/`log`/`follow` in Phase 1; this feature extends it to
`loop run --detached --follow` and confirms `--watch` is absent everywhere. `--json` must be honored on
every read incl. streaming (NDJSON). `--backlog <dir>` and `--interval <seconds>` are the sole spellings.
Flag wiring lives in `packages/cli/src/parser.ts` (`-d`/`--detached` added) and per-command flag extraction
(`extractBoolFlag`/`extractStringFlag`/`extractNumberFlag`). *(Verify the exact parser short-alias
mechanism at impl — R1 research returned no detail here.)*

### 3.4 Explicit `review` signal — minimal fix (REQ-SIG-01/02)

- **Enum (REQ-SIG-01):** add `"review"` to `SignalParsedSchema.signal` (`packages/core/src/schemas.ts:466`,
  currently `z.enum(["done","blocked","needs_human","none"])`).
- **Remove collapse:** delete the `parsed.signal === "review" ? "done" :` downcast at the `signal_parsed`
  emit site (`packages/loop/src/runner.ts:655-656`) so the event reports `"review"` truthfully. This also
  fixes the latent bug where a *work* item emitting `RAUF_REVIEW` emitted `signal_parsed:"done"` while the
  item was actually retried/deferred.
- **`SignalType`** (`packages/loop/src/signal-parser.ts:4`) already includes `"review"`; `exit-classifier.ts`
  already handles it — no change. **No handling-semantics change** (review-pass routing, item status) — out
  of scope (ratified minimal).
- **Signal-placement docs (REQ-SIG-02):** update `docs/SPEC-BACKLOG-TOOL-CONTRACT.md` (the "final line"
  wording and the `review→done` collapse note at ~lines 206-209) + agent templates to match the actual
  scan-from-end parser (`parseSignal`, `signal-parser.ts:27-38`).

### 3.5 `events.ndjson` as a versioned machine surface (REQ-EVT-01/02)

Mostly a **documentation/discipline** decision — the shapes already align: `LoopEventSchema`
(`schemas.ts:574-599`, 24-member discriminated union) is shared by the live `--ndjson` stream and the
persisted log; `PersistedEventSchema` (`schemas.ts:614-629`) = `LoopEventSchema` ∩ `{seq, schemaVersion}`.
`EVENTS_SCHEMA_VERSION="1"` (`schemas.ts:663`), stamped at `runner.ts:1213`. This feature **does not bump**
the version (no breaking shape change); it documents the additive-only discipline in `docs/SCHEMAS.md` +
`docs/SPEC-BACKLOG-TOOL-CONTRACT.md`: within a major version, (a) no `type` discriminator renamed/removed,
(b) no documented field removed, (c) readers ignore unknown types/fields, (d) version bumped only on a
breaking change. REQ-EVT-02 (same shapes) is satisfied by the shared `LoopEventSchema`.

### 3.6 Removed-command remediation (REQ-RMV-01)

Invoking `loop start` (or `--watch`) must exit non-zero with a targeted message naming the replacement,
executing nothing. Implementation: in the command dispatch (`packages/cli/src/commands.ts`) and
flag-parsing path, intercept the removed tokens BEFORE the generic unknown-subcommand/flag error and emit
e.g. `` `loop start` was removed in v0.5.0 — use `loop run --detached`. `` / `` `--watch` was removed — use
`--follow`. ``, returning `USAGE`(2). A small lookup table maps removed token → replacement string. Not an
alias — it does not run the replacement.

### 3.7 feature-forge lockstep update (REQ-CONTRACT-02/03/04/05)

feature-forge (`/home/gary/workspace/feature-forge`, `main`, epic support merged PR #2) is a separate repo
**outside the rauf loop's write sandbox**, so this is an **out-of-loop step at cutover**, gated as part of
done (REQ-CONTRACT-05). Concrete edits (verified locations):

- `references/forge-config-schema.json` — `minRunnerVersion` default `0.2.0` → **`0.5.0`**.
- `skills/forge-5-loop/SKILL.md` — the `minRunnerVersion` default reference `0.2.0` → `0.5.0`.
- `COMPATIBILITY.md`, `CHANGELOG.md`, `references/ralph-loop-contract.md` — align the documented minimum
  and the contract notes.
- **Re-validate** feature-forge's `status --json` reads and any exit-code assumptions against the new
  scheme (§3.2). feature-forge invokes `loop run … --ndjson` (its configurable `runCommand`), **not**
  `loop start` — so no verb references to change there.
- The runner must report `version ≥ 0.5.0` via `rauf version --json` (REQ-CONTRACT-02): bump the rauf
  package versions at the flip.

### 3.8 CLI help/usage (REQ-DOC-02) + project specs (REQ-DOC-01)

Update top-level and per-command `--help`/usage strings (registered in `packages/cli/src/commands.ts`
`SubcommandDef`s) to the new grammar — single `loop run [--detached|-d]`, no `loop start`/`--watch`,
canonical flags. Update the 6 project specs to the new surface: `docs/SPEC-CLI.md` (loop start §, exit-code
tables, follow note), `docs/SPEC-WEB.md` (note the route is now the detached-run backend), `docs/SPEC-
BACKLOG-TOOL-CONTRACT.md` (exit-code space unification §, signal collapse note, signal placement),
`docs/SCHEMAS.md` (signal enum + events versioning), `docs/ARCHITECTURE.md` (data-flow diagram verbs),
`docs/SPEC-ARTIFACTS.md` (`loop start` mention).

## 4. Data Model

No new persisted entities. One schema change: `SignalParsedSchema.signal` enum gains `"review"`
(`packages/core/src/schemas.ts:466`). No change to `PersistedEventSchema`, `LoopEventSchema`,
`DerivedStatusSchema`, `LoopStateEnumSchema`, or `backlog.json`. `state.json.lastSignal`
(`LoopStateSignalSchema`, `schemas.ts:183` = `clean|blocked|needs_human|error`) is a separate vocabulary
and is **not** changed (review is a per-item parsed signal, not a loop-level outcome).

## 5. API Design

- **CLI grammar (the user-facing contract):** `loop run [path] [--detached|-d] [--follow|-f] [--json]
  [--backlog <dir>] [--iterations N] …`; `loop stop`; `loop review`; top-level `status`/`log`/`follow`/
  `progress` (Phase 1). `loop start` removed.
- **Exit codes (the machine contract):** the §3.2 table, used by `status` and `loop run`.
- **`signal_parsed.signal`** value set: `done|blocked|needs_human|review|none`.
- **Web HTTP API:** unchanged URLs/contracts. `POST /api/projects/:id/loop/start` retained as the
  detached-run backend (CSRF `X-Rauf-Request: true`, 127.0.0.1; `app.ts:54-69`, `97-109`).
- **`events.ndjson`:** versioned (`schemaVersion`), additive-only; same `LoopEvent` shapes as `--ndjson`.

## 6. Integration Points

| Surface | File:line | Change | REQ |
|---|---|---|---|
| `ExitCode` const | `cli/src/commands.ts:90-101` | redefine to unified table; rename members | REQ-EXIT-01 |
| ExitCode call sites | grep `cli/src` for `.NOT_FOUND`/`.VALIDATION`/`.CONFLICT`/`.PAUSED_HUMAN`/`.INVALID_ARGS` | re-point to new semantics | REQ-EXIT-01/02 |
| `loop run` exit mapping | `cli/src/loop-commands.ts:979-983` | ternary → full `LoopResult` mapping | REQ-EXIT-01 |
| `statusExitCode` | `cli/src/status-commands.ts:492-504` | rewrite to unified table | REQ-EXIT-01 |
| `handleLoopRun` / `handleLoopStart` | `cli/src/loop-commands.ts:620 / 290` | add `--detached` branch (reuse start flow); remove `loop start` verb | REQ-EXEC-01/02/03 |
| `ensureServerRunning` | `cli/src/loop-commands.ts:258-286` | reuse as-is (no change) | REQ-EXEC-03 |
| flag parsing | `cli/src/parser.ts` | add `-d`/`--detached` | REQ-EXEC-01, REQ-FLAG |
| subcommand registry + usage | `cli/src/commands.ts` (`SubcommandDef`s) | drop `loop start`, update usage/help; remediation map | REQ-RMV-01, REQ-DOC-02 |
| `SignalParsedSchema.signal` | `core/src/schemas.ts:466` | add `"review"` | REQ-SIG-01 |
| review→done collapse | `loop/src/runner.ts:655-656` | remove downcast | REQ-SIG-01 |
| events versioning docs | `core/src/schemas.ts:663` (no code change) + docs | document discipline | REQ-EVT-01 |
| web start route | `web/src/server/routes/loop.ts:145-199` | retain (URL/contract unchanged) | REQ-EXEC-03 |
| project specs | `docs/SPEC-CLI.md`, `SPEC-WEB.md`, `SPEC-BACKLOG-TOOL-CONTRACT.md`, `SCHEMAS.md`, `ARCHITECTURE.md`, `SPEC-ARTIFACTS.md` | update to new surface | REQ-DOC-01, REQ-SIG-02, REQ-EVT-01 |
| feature-forge (separate repo) | `references/forge-config-schema.json`, `skills/forge-5-loop/SKILL.md`, `COMPATIBILITY.md`, `CHANGELOG.md`, `references/ralph-loop-contract.md` | `minRunnerVersion` → 0.5.0; revalidate reads | REQ-CONTRACT-04 (out-of-loop, REQ-CONTRACT-05) |
| rauf package versions | `package.json`s | bump to 0.5.0 | REQ-CONTRACT-02 |

**Downstream importers of `ExitCode`:** all within `@rauf/cli`. `signal_parsed` consumers: the web
`<EventTimeline>` (renders the event; adding `review` is additive — verify its switch tolerates the new
value), and any tool reading `events.ndjson`. **WARNING — verify at impl:** the exact `parser.ts` short-flag
mechanism and the precise `--help`/usage rendering locus were not pinned by research (R1 returned no detail).

## 7. Error Handling

Unchanged philosophy: core returns `Result<T,E>`; CLI maps outcomes to exit codes (§3.2). Removed-command
remediation (§3.6) is a non-zero `USAGE`(2) exit with a guidance message — never a throw, never an alias.
The detached path surfaces server-POST failures (e.g. 409 already-running) as `USAGE`(2).

## 8. Testing Approach

Vitest, colocated `*.test.ts`. New/updated coverage:
- **Exit codes:** unit-test the `loop run` `LoopResult`→code mapping and `statusExitCode(state)` against the
  full §3.2 table (every state/outcome → expected code), incl. the old-use remaps (not-found/validation/
  conflict → USAGE).
- **`--detached`:** test `handleLoopRun --detached` delegates to the server-POST flow (mock the server /
  `ensureServerRunning`); `--detached --follow` attaches; bare `loop run` still runs in-process.
- **Removed-command remediation:** `loop start` / `--watch` → non-zero + the exact guidance message,
  executes nothing.
- **`review` signal:** `signal_parsed` now emits `"review"` (no collapse); schema accepts it; a work-item
  `RAUF_REVIEW` no longer mislabels as `done`.
- **Flag canon:** `--json` honored under `--follow`; `-d` parses to `--detached`.
- Full gate (typecheck/lint/format/tests) green (NFR-QUALITY-01). The web frontend has no tests — lean on
  backend/CLI tests.

## 9. Dependencies

No new external or internal package dependencies. Cross-repo coordination only: feature-forge
(`/home/gary/workspace/feature-forge`) updated out-of-loop at cutover (§3.7). Dogfood with the frozen
`rauf-stable` binary (NFR-SAFETY-01; `forge.config.json` pins `loopRunner.bin`). Dev runner executes built
`dist/` — rebuild before testing runner edits.

## 10. Open Technical Questions

1. **`parser.ts` short-flag mechanism** — the exact way `-d`/`--detached` (and existing `-f`) are wired was
   not pinned by research; confirm at implementation (low risk — Phase 1 already added `-f`).
2. **`--help`/usage rendering locus** — confirm where help text is generated to update it (REQ-DOC-02).
3. **Old-`CONFLICT`(loop-already-running) mapping** — spec'd here as `USAGE`(2); confirm that's the desired
   code for the 409/already-running case rather than a generic `ERROR`(1).
4. **`<EventTimeline>` switch** — verify the web timeline's event rendering tolerates the new
   `signal: "review"` value (Phase 4 owns status vocabulary, but the event value is additive now).
