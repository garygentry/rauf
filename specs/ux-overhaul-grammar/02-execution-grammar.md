# 02 — Execution Grammar (ux-overhaul-grammar)

The single loop-execution verb (`loop run` with `--detached`/`-d`), the flag canon, and the
removed-command remediation interceptor for the v0.5.0 grammar flip. This is the `@rauf/cli` surface
change: it reuses the existing `loop start` server path verbatim behind a flag, removes `loop start` as a
verb, and turns removed tokens into targeted errors. Shared contracts (the `ExitCode` enum values, the
remediation lookup table) live in [`00-core-definitions.md`](./00-core-definitions.md) and are USED here,
not redefined. The `loop run` terminal-outcome → exit-code mapping is specified in
[`03-exit-codes.md`](./03-exit-codes.md) and referenced here, not duplicated.

All file:line references were verified against source on 2026-06-13; re-confirm at implementation time
(they drift).

## Requirement Coverage

| REQ | Covered by (section) |
|-----|----------------------|
| REQ-EXEC-01 | §2 `--detached` branch in `handleLoopRun` |
| REQ-EXEC-02 | §2.3 `handleLoopStart` demoted to shared helper; verb removed |
| REQ-EXEC-03 | §2.1 server auto-provision via `ensureServerRunning` |
| REQ-EXEC-04 | §3 `--detached --follow` compose + Ctrl-C lifecycle |
| REQ-EXEC-05 | §4 `loop stop` (unchanged) |
| REQ-EXEC-06 | §5 observation parity (no new observation path) |
| REQ-FLAG-01 | §6 `--follow`/`-f` the one streaming flag; `--watch` removed |
| REQ-FLAG-02 | §6 `--json` on every read incl. streaming (NDJSON) |
| REQ-FLAG-03 | §6 `--backlog <dir>` sole non-default-root target |
| REQ-FLAG-04 | §6 `--interval <seconds>` sole poll-cadence flag |
| REQ-RMV-01 | §7 removed-command remediation interceptor |
| NFR-PARITY-01 | §5 observation parity (both branches feed the same file substrate) |

---

## 1. Surface delta (what this doc lands)

| Before (current) | After (v0.5.0) |
|------------------|----------------|
| `loop run [path]` — in-process, foreground | `loop run [path]` — **unchanged default**: in-process, foreground |
| `loop start [path]` — server-owned, detached (separate verb) | **removed** → folded into `loop run --detached` / `-d` |
| `loop start --follow` | `loop run --detached --follow` |
| `--watch` (streaming follow on read commands) | **removed** → `--follow` / `-f` (the one streaming flag) |
| `loop stop` | `loop stop` — **unchanged** |

Bare `loop run` keeps its exact current behavior (the in-process `LoopRunner.create().start()` path); only
the `--detached` branch is new. `loop start` is removed as a dispatchable verb but its server-POST logic is
preserved verbatim as a shared helper that the `--detached` branch calls.

---

## 2. `loop run --detached` reuses the server path (REQ-EXEC-01/02/03)

`loop run --detached` must do exactly what `loop start` does today: auto-start the server daemon, POST the
loop options to the existing route, and return immediately. No execution-semantics change — canon P2 ("hide
the mode, don't change it").

### 2.1 Server auto-provision (REQ-EXEC-03)

The detached branch calls the existing, **unchanged** `ensureServerRunning` (`loop-commands.ts:258-286`):

```ts
export async function ensureServerRunning(ctx: CommandContext): Promise<boolean>;
```

It no-ops when a healthy server is already running (never restarts a live server — that would cancel every
project's in-flight loop), otherwise spawns the daemon via `handleServerStart` with a synthetic
`{ daemon: true, quiet: true }` context and waits for readiness. The operator never separately starts a
server (REQ-EXEC-03). No change to this function.

### 2.2 The shared detached helper (REQ-EXEC-01/02)

Extract the current `handleLoopStart` body (`loop-commands.ts:290-418`) verbatim into a non-exported helper,
preserving its exact flow: optional `--create-branch`, optional `--retry-blocked` unblock,
`ensureServerRunning`, the request-body builder (`loop-commands.ts:334-357`), and the
`POST /api/projects/:id/loop/start` fetch with the `X-Rauf-Request: true` CSRF header. Signature:

```ts
/**
 * Detached-run path (formerly `handleLoopStart`). Auto-starts the server daemon,
 * POSTs the loop options to `POST /api/projects/:id/loop/start`, and returns
 * immediately. Invoked only from the `--detached`/`-d` branch of `handleLoopRun`.
 * `--follow` is handled CLI-side AFTER this returns (see §3) and is NOT in the
 * request body — the body carries only loop options.
 */
async function runDetached(ctx: CommandContext): Promise<number>;
```

The request body builder is preserved exactly (`loop-commands.ts:334-357`) — it carries only loop options:

```ts
const body: Record<string, unknown> = {};
// body.maxIterations  ← resolveLoopMaxIterations(...) | iterations
// body.maxRetries     ← --retries
// body.model          ← --model
// body.sessionTimeoutMinutes ← --timeout
// body.backlogRoot    ← --backlog
// body.suppressIterationReview ← --suppress-iteration-review
```

`--follow` and `--detached` are intentionally **absent** from the body — `--detached` is a CLI mode switch,
`--follow` is a post-return observation concern (§3). The POST sends only loop options, matching the
unchanged web route contract (`web/src/server/routes/loop.ts`).

> **Exit codes in the helper:** the call sites currently using `ExitCode.CONFLICT` (branch-create failure,
> 409 already-running) and `ExitCode.ERROR` (daemon-start failure) are re-pointed per
> [`00-core-definitions.md`](./00-core-definitions.md) §1: the 409 already-running becomes `USAGE`(2)
> (a correctable precondition). The full call-site remap is owned by [`03-exit-codes.md`](./03-exit-codes.md)
> — this doc does not restate it.

### 2.3 Wiring into `handleLoopRun` (REQ-EXEC-01)

`handleLoopRun` (`loop-commands.ts:620`) gains an early `--detached` branch, before the in-process path's
backlog-resolution / precondition / `LoopRunner.create()` work:

```ts
export async function handleLoopRun(ctx: CommandContext): Promise<number> {
  const projectPath = resolveProjectPath(ctx);

  // Detached mode: delegate to the server-POST flow (formerly `loop start`).
  // Bare `loop run` falls through to the unchanged in-process path below.
  const detached = extractBoolFlag(ctx.flags, "detached");
  if (detached) {
    const code = await runDetached(ctx);
    if (code !== ExitCode.SUCCESS) return code;
    // --follow attaches the live view CLI-side AFTER the POST returns (§3).
    if (extractBoolFlag(ctx.flags, "follow")) {
      return followDetached(ctx, projectPath);
    }
    return ExitCode.SUCCESS;
  }

  // ── existing in-process path (UNCHANGED) ──
  // ...LoopRunner.create().start(); terminal mapping per 03-exit-codes.md ...
}
```

`extractBoolFlag` (`parser.ts:144`) removes the flag from the map as it reads it. `--detached` is read and
consumed here so it never leaks into the in-process path or the POST body.

The old `handleLoopStart` export is **deleted** from `commands.ts`'s import list and from the `loop`
subcommand registry (the `{ name: "start", ... }` entry, `commands.ts:148-179`). It is no longer a
dispatchable verb (REQ-EXEC-02). Its `--start`-only flags (e.g. the `start`-specific `--follow` doc entry)
move onto the `run` subcommand's flag list (§8).

---

## 3. `--detached --follow` composes (REQ-EXEC-04)

After `runDetached` returns `SUCCESS`, attach the canonical live view CLI-side. This reuses the exact
follow mechanism `handleLoopStart` used in its `follow` branch today (`loop-commands.ts:384-393`): the
existing `streamEventsUntilDone(eventsUrl, statusLine)` helper (`loop-commands.ts:489`) against the
`apiUrl(port, id, "events")` SSE endpoint. Factor it into a small helper so `handleLoopRun` stays readable:

```ts
/**
 * Attach the canonical live view to an already-detached, server-owned loop.
 * Ctrl-C (SIGINT) detaches THE VIEW ONLY — the server keeps running the loop.
 * Honors --json (NDJSON streaming) via the StatusLine's json mode.
 */
async function followDetached(ctx: CommandContext, projectPath: string): Promise<number> {
  const port = getPort();
  const id = projectId(projectPath);
  const eventsUrl = apiUrl(port, id, "events");
  const statusLine = new StatusLine({
    isTTY: process.stdout.isTTY ?? false,
    quiet: ctx.globalFlags.quiet,
    json: ctx.globalFlags.json,   // status --follow --json → NDJSON (REQ-FLAG-02)
    noColor: ctx.globalFlags.noColor,
  });
  info(c.dim("Following loop events... Press Ctrl+C to detach (the loop keeps running)."));
  return streamEventsUntilDone(eventsUrl, statusLine);
}
```

**Lifecycle (the load-bearing semantics, REQ-EXEC-04):**

- `--follow` is **NOT** in the server request body — the loop is already running server-side; following is a
  pure read attached after the POST. The body carries only loop options (§2.2).
- **Ctrl-C on the attached view detaches the VIEW ONLY.** `streamEventsUntilDone` interrupts its SSE read and
  returns; it does **not** issue `POST /loop/stop`. The server-owned loop keeps running.
- The help/hint copy must say so explicitly (the current `loop start --follow` wording "Press Ctrl+C to
  stop" at `loop-commands.ts:386` is **misleading for the detached case and must change** to "Press Ctrl+C
  to detach (the loop keeps running)").
- **Stopping a detached run requires `loop stop`** (§4) — not Ctrl-C.

This is distinct from bare `loop run` (foreground/in-process), where Ctrl-C **does** stop the loop (it owns
the process). The mode difference in Ctrl-C semantics is intentional and is the only operator-visible
behavioral split — it falls out of "detached = server owns the loop, you're only viewing".

---

## 4. `loop stop` (REQ-EXEC-05) — unchanged

`handleLoopStop` (`loop-commands.ts:422`) already targets the server/detached loop via `POST /loop/stop` and
requires a running server. **No code change** beyond the `ExitCode` call-site remap owned by
[`03-exit-codes.md`](./03-exit-codes.md) (its current `ERROR` for "server not running" / "no loop to stop"
becomes `USAGE`(2) per [`00-core-definitions.md`](./00-core-definitions.md) §1). Its remediation hint text
referencing `rauf loop start` (`loop-commands.ts:431`) must be updated to `rauf loop run --detached`
(REQ-DOC-02 / no-stale-verb rule).

A foreground `loop run` is stopped by Ctrl-C (REQ-EXEC-05), as today.

---

## 5. Observation parity (REQ-EXEC-06, NFR-PARITY-01)

Both branches feed the **same file-backed substrate** established in Phase 1 — `state.json` +
`events.ndjson` — and nothing else:

- **Detached:** the server runs the loop in-process (`LoopManager.startLoop()`,
  `web/src/server/loop-manager.ts`), which drives the same `LoopRunner` that writes `state.json` and stamps
  `events.ndjson`.
- **Foreground:** `LoopRunner.create().start()` writes the same files directly.

The `--detached` branch adds **no new observation path** — `--follow` reads the same SSE/events surface every
observer (CLI `follow`, web, external tools) already reads. Parity is therefore **structural**, inherited
from the Phase 1 substrate, not re-implemented here. An attended run and a detached run of the same backlog
are observationally identical. The verification of this (§Verification) is an equivalence assertion over
observer output plus the `--detached` delegation test guarding the new branch from diverging.

---

## 6. Flag canon (REQ-FLAG-01/02/03/04)

One flag name per concept, on every command the concept applies to. Phase 1 already normalized
`--follow`/`-f`, `--json`, `--backlog`, `--interval` for `status`/`log`/`follow`; this feature extends
`--follow` to `loop run --detached` and adds `-d`/`--detached`.

| Concept | Canonical flag | Applies to | This feature's change |
|---------|----------------|------------|-----------------------|
| Detached execution | `--detached` / `-d` | `loop run` | **new** — added (this doc) |
| Streaming follow | `--follow` / `-f` | `status`, `log`, `follow`, `loop run --detached` | **extend** to `loop run --detached`; `--watch` removed everywhere (REQ-FLAG-01) |
| Machine output | `--json` (global) | every read/monitor, incl. streaming → NDJSON | honored under `--follow` (REQ-FLAG-02) |
| Non-default backlog root | `--backlog <dir>` | every command touching state | sole spelling; no second spelling introduced (REQ-FLAG-03) |
| Poll cadence | `--interval <seconds>` | under `--follow` | sole poll-cadence flag (REQ-FLAG-04) |

### 6.1 `-d`/`--detached` parsing (REQ-FLAG-01)

`--detached` parses through the existing long-flag path in `parseArgs` (`parser.ts:79-97`) into the flags
map as `detached → true`. The short alias `-d` is normalized to `--detached` exactly as `-f`→`--follow` is
today — extend the alias-normalization block at `parser.ts:124-130`:

```ts
// Normalize short aliases to their canonical long flag (one flag name per concept).
if (flags.has("f") && !flags.has("follow")) { flags.set("follow", flags.get("f")!); flags.delete("f"); }
if (flags.has("d") && !flags.has("detached")) { flags.set("detached", flags.get("d")!); flags.delete("d"); }
```

Handlers then only ever read `"detached"` / `"follow"` (never `"d"` / `"f"`). `-d` is boolean — it takes no
value (the short-flag branch `parser.ts:99-104` sets `true`).

### 6.2 `--json` under `--follow` (REQ-FLAG-02)

`--json` is the global flag (`globalFlags.json`, `parser.ts:54-58`). Streaming commands honor it by emitting
NDJSON: `followDetached` (§3) passes `json: ctx.globalFlags.json` into `StatusLine`, which switches to
per-line NDJSON instead of the formatted renderer — so `loop run -d -f --json` streams NDJSON, matching
`status --follow --json` and `follow --json`. No new flag, no per-command spelling.

### 6.3 `--watch` removal (REQ-FLAG-01)

`--watch` is removed everywhere; any occurrence is intercepted as a removed flag (§7). It is not a parsed
flag any handler reads.

---

## 7. Removed-command remediation (REQ-RMV-01)

Invoking a removed verb (`loop start`) or flag (`--watch`) must exit **non-zero `USAGE`(2)** with a targeted
message naming the replacement, **executing nothing** — an error message, not an alias (it must not run the
replacement). The message strings and the removed-token → replacement mapping are the canonical lookup table
in [`00-core-definitions.md`](./00-core-definitions.md) §5; this doc specifies the interception loci and
ordering. The interceptor must run **before** the generic unknown-subcommand / unknown-flag error so the
targeted message wins.

### 7.1 Lookup table (imported from 00 §5)

A single source-of-truth table in `commands.ts`, populated from [`00-core-definitions.md`](./00-core-definitions.md) §5:

```ts
/** Removed verbs/flags → remediation guidance (v0.5.0 clean break). Not aliases —
 *  these execute nothing. Messages are normative in 00-core-definitions.md §5. */
export const REMOVED_TOKENS: ReadonlyMap<string, string> = new Map([
  ["loop start", "`loop start` was removed in v0.5.0 — use `loop run --detached` (`-d`)."],
  ["--watch", "`--watch` was removed in v0.5.0 — use `--follow` (`-f`)."],
]);
```

### 7.2 Verb interception — `commands.ts` dispatch (in `main.ts`)

`loop start` is intercepted in the subcommand-dispatch path of `runCli` (`main.ts:106-136`), **before** the
`findSubcommand` unknown-subcommand error (`main.ts:119-128`). Because `start` is no longer in the `loop`
subcommand registry, it would otherwise fall through to the generic "Unknown subcommand 'start'" error;
instead, a check keyed on `${commandName} ${parsed.subcommand}` short-circuits with the targeted message:

```ts
// main.ts, inside the `if (cmd.subcommands)` block, BEFORE findSubcommand(...):
if (parsed.subcommand) {
  const removed = REMOVED_TOKENS.get(`${commandName} ${parsed.subcommand}`);
  if (removed) {
    error(removed);
    return ExitCode.USAGE; // 2 — executes nothing, not an alias
  }
}
```

This runs after the `--help` intercept (`main.ts:99-103`) so `rauf loop start --help` still surfaces help
rather than the removal error — acceptable; the help text itself no longer lists `start`. It runs before
`findSubcommand`, so the targeted message wins over the generic unknown-subcommand error.

### 7.3 Flag interception — `parser.ts` / per-command path

`--watch` is intercepted wherever flags are finalized. The lowest-risk locus is a post-parse check in
`runCli` (`main.ts`, after `parseArgs` resolves `parsed.flags`, before any handler dispatch at
`main.ts:105`), so it catches `--watch` on any command uniformly:

```ts
// main.ts, after the --help intercept, before subcommand/handler dispatch:
if (parsed.flags.has("watch")) {
  error(REMOVED_TOKENS.get("--watch")!);
  return ExitCode.USAGE; // 2
}
```

This precedes every handler, so no command ever sees `--watch` and the targeted message wins over any
per-command unknown-flag handling. (Equivalently, the check may live in `parseArgs` returning a sentinel; the
`main.ts` locus is preferred because `parseArgs` currently has no error channel and returns `ParsedArgs`
unconditionally.)

### 7.4 Ordering invariant

The remediation checks (§7.2 verb, §7.3 flag) execute strictly **before**: `findSubcommand`'s
unknown-subcommand error (`main.ts:121`), the `findSimilarCommand` "did you mean" suggestion
(`main.ts:77-80`), and any per-handler flag validation. They execute **after** the `--help`/`-h` intercept
(`main.ts:101-103`). Both return `ExitCode.USAGE`(2) and invoke no handler.

---

## 8. Help / usage updates (REQ-DOC-02, supporting)

The `loop` subcommand registry in `commands.ts` (`commands.ts:147-240`) is updated so help reflects the new
grammar with no stale verbs/flags (except the §7 remediation messages):

- **Remove** the `{ name: "start", ... }` subcommand entry (`commands.ts:148-179`) entirely.
- **`run`** subcommand: add `--detached`/`-d` and `--follow`/`-f` flag doc entries; usage becomes
  `rauf loop run [path] [--detached|-d] [--follow|-f] [options]`. The detached-only flags previously documented
  on `start` (e.g. its `--follow` entry) are folded onto `run`.
- The `loop stop` hint string referencing `rauf loop start` (`loop-commands.ts:431`) → `rauf loop run --detached`.
- The `loop start` success-hint copy that contrasts with `rauf loop run` (`loop-commands.ts:376-379`) moves
  into the detached branch and is reworded for the single-verb grammar.

(The broader project-spec / `docs/SPEC-*.md` updates for REQ-DOC-01 are owned by the docs spec, not here.)

---

## 9. Error handling

Philosophy unchanged: core returns `Result<T,E>`; the CLI maps outcomes to exit codes. Specific to this doc:

- **Removed verb/flag** (§7): non-zero `USAGE`(2) with the §5 guidance message — never a throw, never an
  alias, executes nothing.
- **Detached server-POST failures** (§2.2): surfaced by `runDetached`. 409 already-running → `USAGE`(2)
  (correctable precondition, [`00-core-definitions.md`](./00-core-definitions.md) §1); daemon-start failure
  and connect failure → `ERROR`(1). Mapping authority: [`03-exit-codes.md`](./03-exit-codes.md).
- **Ctrl-C on `--detached --follow`** (§3): not an error — `streamEventsUntilDone` returns its terminal code
  for the observed run; the loop is untouched.
- **Bare `loop run` terminal outcome**: mapped per [`03-exit-codes.md`](./03-exit-codes.md) (§2a there);
  this doc does not restate that mapping.

---

## 10. Example invocations

```bash
# Foreground, in-process (UNCHANGED) — Ctrl-C stops the loop
rauf loop run .

# Detached: auto-starts the server daemon, POSTs loop options, returns immediately
rauf loop run . --detached
rauf loop run . -d                      # short alias, identical

# Detached + attach the live view; Ctrl-C detaches the VIEW only (loop keeps running)
rauf loop run . --detached --follow
rauf loop run . -d -f                    # short aliases

# Detached + machine-readable streaming (NDJSON), honored under --follow
rauf loop run . -d -f --json

# Stop a detached/server-owned loop (foreground runs stop via Ctrl-C)
rauf loop stop .

# Removed verb → targeted error, exits 2, runs nothing:
rauf loop start .
#  ⇒ `loop start` was removed in v0.5.0 — use `loop run --detached` (`-d`).   (exit 2)

# Removed flag → targeted error, exits 2, runs nothing:
rauf status . --watch
#  ⇒ `--watch` was removed in v0.5.0 — use `--follow` (`-f`).                 (exit 2)
```

---

## Dependencies

- [`00-core-definitions.md`](./00-core-definitions.md) — `ExitCode` values (esp. `USAGE`=2, used for
  remediation and 409), and the removed-command remediation table (§5, the normative message strings).
- [`01-architecture-layout.md`](./01-architecture-layout.md) — the `@rauf/cli` change map and the
  change-ordering graph (this doc is step 5: depends on the `ExitCode` redefinition in step 3).
- [`03-exit-codes.md`](./03-exit-codes.md) — the `loop run` terminal-outcome → exit-code mapping and the
  full `ExitCode` call-site remap (referenced, **not** duplicated here).

## Verification

- `loop start` is not a dispatchable verb; `rauf loop start` exits `USAGE`(2) with the §5 message and runs
  nothing (asserted: no server started, no `POST /loop/start` issued).
- `rauf status . --watch` (and `--watch` on any command) exits `USAGE`(2) with the §5 message, runs nothing.
- `rauf loop run -d` delegates to the server-POST flow (mock `ensureServerRunning` / the server) and returns
  immediately; bare `rauf loop run` still runs in-process via `LoopRunner.create().start()`.
- `rauf loop run -d -f` attaches the live view after the POST; SIGINT on the view returns without issuing
  `POST /loop/stop` (the loop keeps running — verified by a subsequent `status` / `loop stop`).
- `-d` parses to `--detached`; `-f` to `--follow`; `--json` is honored under `--follow` (NDJSON output).
- Observation parity: an attended run and a detached run of the same backlog produce equivalent observer
  output (`events.ndjson` / `status`) — structural (shared Phase-1 substrate), guarded by the delegation test.
- No stale `loop start` / `--watch` token remains in `loop` help/usage strings or the `loop stop` hint
  (only the §7 remediation messages name them).
- Build/typecheck green after this step (it depends on the `ExitCode` redefinition having landed — 01 §3 step 3).
