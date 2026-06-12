# 04 — CLI Monitoring Surface

The post-Phase-1 **CLI monitoring command surface**: a clean-break removal of the four overlapping
"watch" verbs/flags, a single canonical top-level **`follow`** verb, a machine-wide **`status --all`**
listing, and **empty-is-never-silent** surfacing on every read command. All read commands reconstruct
their output entirely from files (`state.json` + `events.ndjson` + `iteration-status.json` +
`rauf.log`) plus the active-loop registry — never from owning the runner or from a server.

> Source of truth: [`PRD.md`](./PRD.md) (§3.3 monitoring surface, §3.4 empty-not-silent, §8 SC-2/SC-4)
> and [`tech-spec.md`](./tech-spec.md) (§3.6 unified file-based monitoring **D9**, §3.7 clean break,
> §3.8 empty-not-silent + `status --all` **D6/D7**, §5.2 CLI surface table, §6.2 cli→core integration).
> Shared types are defined in [`00-core-definitions.md`](./00-core-definitions.md). This document
> **consumes** `readEvents`/`watchEvents` from [`02-event-log.md`](./02-event-log.md) and
> `listActiveLoops` from [`03-active-loop-registry.md`](./03-active-loop-registry.md) — it does **not**
> redefine them. Where this spec and [`CANON.md`](./CANON.md) disagree, the canon wins.

---

## Requirement Coverage

| REQ ID      | Requirement                                                                  | Section          |
| ----------- | ---------------------------------------------------------------------------- | ---------------- |
| REQ-MON-01  | Canonical surface: `status`/`log`/top-level `follow`/`progress`, file-backed | 2, 3             |
| REQ-MON-02  | Clean-break removal of `loop watch`, `loop follow`, `--watch` (no aliases)   | 4                |
| REQ-MON-03  | `--json` honored on every read incl. `--follow` (NDJSON); one `--follow`/`-f`; `--interval` | 6 |
| REQ-MON-04  | `--backlog <dir>` is the single targeting spelling on every command          | 7                |
| REQ-OBS-01  | CLI reconstructs output entirely from files (no runner/server ownership)     | 2, 3, 5          |
| REQ-OBS-03  | In-process ≡ detached for CLI observers                                       | 2, 5             |
| REQ-OBS-04  | `follow` replays current run then tails (consumes `readEvents`/`watchEvents`)| 5                |
| REQ-DISC-01 | Read commands name the inspected directory when "nothing here"               | 8                |
| REQ-DISC-02 | Idle/empty read surfaces a live loop in another root + its state             | 8                |
| REQ-DISC-06 | `status --all` lists every live loop machine-wide (reads the registry)       | 9                |
| REQ-PERF-02 | Watch/tail-first liveness with `--interval` poll fallback (≈1s feel)         | 5, 6             |

---

## 1. Scope & Boundary

This document owns the **monitoring** verbs only. It changes which read/observe commands exist, what
flags they accept, and where their data comes from. It does **not** touch the **execution** grammar:
`loop run`, `loop start`, `loop stop`, `loop review` keep their current names and behavior. In
particular, **`loop start --follow` is an EXECUTION-side convenience flag and is UNTOUCHED here**
(Phase 2 owns execution grammar; tech-spec §3.7). The only flag this document removes is the
**monitoring** `status --watch`; the `--follow` flag on `loop start` is a different flag on a
different command and is out of scope.

Files this document drives (per [`01-architecture-layout.md`](./01-architecture-layout.md) §7):

| File | Change |
| --- | --- |
| `packages/cli/src/commands.ts` | remove `loop watch` (`commands.ts:242–247`) + `loop follow` (`commands.ts:182`) subcommands; add top-level `follow` command; update `status`/`log` usage strings |
| `packages/cli/src/status-commands.ts` | `--watch`→`--follow`/`-f`; `--json` under follow (NDJSON); `log --json` (+NDJSON under follow); empty-is-never-silent surfacing; `status --all` |
| `packages/cli/src/follow-command.ts` | **new** — top-level `follow` (promoted from `followDirectMode`) |
| `packages/cli/src/loop-commands.ts` | delete `handleLoopWatch` (`loop-commands.ts:1387–1464`) + `handleLoopFollow` (`loop-commands.ts:675–712`); `followDirectMode` (`loop-commands.ts:588–671`) logic moves to `follow-command.ts` |
| `packages/cli/src/parser.ts` | add `-f` short alias resolution for `--follow` |
| `packages/core/src/status.ts` | empty-path callers surface inspected dir + registry liveness (no `deriveStatus` signature change) |

---

## 2. Post-Phase-1 CLI surface table (REQ-MON-01, REQ-OBS-01)

The canonical monitoring surface after the clean break. Every "Source" column entry is a **file** (or
the file-backed registry) — no command depends on owning the runner or on a server (REQ-OBS-01),
which is what makes an in-process `loop run` and a detached run observationally identical for the CLI
(REQ-OBS-03).

| Command | Flags | Source |
| --- | --- | --- |
| `status [path]` | `[--follow/-f] [--json] [--interval N] [--all] [--backlog <dir>]` | `state.json` + `iteration-status.json` + `rauf.log` (via `deriveStatus`) + registry (`--all` / empty-not-silent) |
| `log [path]` | `[--tail N] [--follow/-f] [--json] [--backlog <dir>]` | `rauf.log` (via `readLogTail`/`watchLog`) + `events.ndjson` (via `readEvents`/`watchEvents`) |
| `follow [path]` | `[--json] [--interval N] [--backlog <dir>]` | `events.ndjson` replay+tail (`readEvents`/`watchEvents`) + `state.json` (`deriveStatus` terminal poll) |
| `progress [path]` | `[--json] [--backlog <dir>]` | `progress.md` — **unchanged** |
| ~~`loop watch`~~ | — | **removed** (C-4, §4) |
| ~~`loop follow`~~ | — | **removed → top-level `follow`** (§4) |
| ~~`status --watch`~~ | — | **removed → `--follow`/`-f`** (§4) |

> The `--follow`/`-f` flag on `status`/`log`/`follow` is the **monitoring** follow flag. It is the one
> flag name everywhere (REQ-MON-03). It is **distinct** from the unrelated `--follow` convenience flag
> on `loop start` (execution grammar, untouched — §1).

---

## 3. Command registration (`commands.ts`)

### 3.1 `loop` subcommands — after the clean break

The current `loop` command registers six subcommands (`commands.ts:148–248`):
`start`, `stop`, `follow`, `run`, `review`, `watch`. After Phase 1 it registers **four** — `follow`
and `watch` are removed (§4). The shape of each entry is unchanged (`SubcommandDef`); only the array
membership changes:

```typescript
// packages/cli/src/commands.ts — the `loop` command's subcommands array, AFTER:
subcommands: [
  { name: "start",  description: "Start a loop via server",  /* ...flags unchanged... */ handler: handleLoopStart },
  { name: "stop",   description: "Stop a running loop",       handler: handleLoopStop },
  { name: "run",    description: "Run loop directly in-process", /* ...flags unchanged... */ handler: handleLoopRun },
  { name: "review", description: "Review completed items and create fix items", /* ... */ handler: handleLoopReview },
  // REMOVED: { name: "follow", ... }  → promoted to top-level `follow` (§4)
  // REMOVED: { name: "watch",  ... }  → deleted outright (§4)
],
```

The `loop start` subcommand keeps its `--follow` flag entry verbatim (`commands.ts:169`) — that is the
execution-side flag (§1).

The import block (`commands.ts:43–50`) drops `handleLoopFollow` and `handleLoopWatch` and is unchanged
otherwise:

```typescript
// packages/cli/src/commands.ts — AFTER (handleLoopFollow + handleLoopWatch removed)
import {
  handleLoopStart,
  handleLoopStop,
  handleLoopRun,
  handleLoopReview,
} from "./loop-commands.js";
import { handleFollow } from "./follow-command.js"; // NEW — top-level follow
```

### 3.2 New top-level `follow` command

Registered in the top-level `COMMANDS` array (`commands.ts:109`), alongside `status`/`log`/`progress`:

```typescript
// packages/cli/src/commands.ts — new top-level command entry
{
  name: "follow",
  description: "Follow a loop's live event stream (replay current run, then tail)",
  usage: "rauf follow [path] [--json] [--interval N] [--backlog <dir>]",
  flags: [
    { name: "--json", description: "Emit one PersistedEvent (NDJSON) per line instead of formatted output" },
    { name: "--interval <N>", description: "Poll fallback interval in seconds when fs.watch is unavailable (default: 2)" },
    { name: "--backlog <dir>", description: "Backlog directory for multi-backlog projects" },
  ],
  handler: handleFollow,
},
```

> `--follow`/`-f` is **not** a flag of the top-level `follow` command — `follow` *is* the follow verb.
> The `--follow`/`-f` flag lives on `status` and `log` (§6).

### 3.3 Updated `status` / `log` usage strings (REQ-MON-02/03)

The `status` and `log` `usage` strings (`commands.ts:338` / `commands.ts:344`) currently advertise the
removed `--watch` spelling and an under-documented flag set. Update them to the canonical surface:

```typescript
// packages/cli/src/commands.ts — AFTER
{
  name: "status",
  description: "Show loop status for a project",
  usage: "rauf status [path] [--follow] [--json] [--interval N] [--all] [--backlog <dir>]",
  handler: handleStatus,
},
{
  name: "log",
  description: "View loop log for a project",
  usage: "rauf log [path] [--tail N] [--follow] [--json] [--backlog <dir>]",
  handler: handleLog,
},
```

The corresponding in-handler `info("Usage: …")` strings in `status-commands.ts`
(`status-commands.ts:37` for `status`, `status-commands.ts:152` for `log`) are updated to match
(removing `--watch`, adding `--follow`/`--json`/`--all`).

---

## 4. Clean break: removed monitor verbs/flags (REQ-MON-02, C-4) — no aliases

Removed outright, **with no deprecation shims or aliases** (ratified clean-break posture,
[`CANON.md`](./CANON.md) §1 P3 / C-4). Each locus below is deleted, not redirected; invoking a removed
name falls through to the existing "unknown command/subcommand" path.

| Removed | Exact locus | Disposition |
| --- | --- | --- |
| `loop watch` subcommand | `commands.ts:242–247` (registration) | deleted; no alias |
| `handleLoopWatch` | `loop-commands.ts:1387–1464` | deleted; its `iteration-status.json` tool/token detail is available via `follow` + `status --json` (both read `iteration-status.json` + events) |
| `loop follow` subcommand | `commands.ts:182` (registration) | deleted; **promoted** to top-level `follow` (§3.2) |
| `handleLoopFollow` | `loop-commands.ts:675–712` | deleted; its direct-mode path (`followDirectMode`) becomes the new `follow` handler (§5) |
| `status --watch` (+ `handleStatusWatch`) | `status-commands.ts:295–348` + the `watch` branch at `status-commands.ts:41,46–49` | deleted; replaced by `status --follow`/`-f` (§6.1) |

**No-alias note.** None of `loop watch`, `loop follow`, or `--watch` is shimmed. There is no hidden
subcommand, no flag-name fallback, and no deprecation warning that maps an old name to a new one. A
user typing `rauf loop watch` gets the standard unknown-subcommand error; a user passing `--watch`
gets it treated as an unknown flag (it is simply not extracted, so it is ignored / surfaced by
unknown-flag handling — §10).

**Execution grammar untouched.** `loop start --follow` (`commands.ts:169`) is an **execution** verb's
convenience flag and is **left exactly as-is** — Phase 2 owns the execution grammar (tech-spec §3.7).
Removing the monitoring `--watch` does not touch the execution `--follow`.

---

## 5. The new top-level `follow` command (REQ-OBS-04, REQ-OBS-01, REQ-OBS-03, REQ-MON-01) — D9

`follow` is the **single canonical live-view verb**. It is **file-based primary** (D9): it replays the
**current run's** `events.ndjson` then `fs.watch`-tails new records, polling `deriveStatus` only for
terminal detection. Server SSE is intentionally **not** part of Phase 1's `follow` — the old
`handleLoopFollow` SSE branch (`loop-commands.ts:680–697`) is dropped; `follow` reads files for **any**
loop regardless of who started it, which is exactly what collapses the in-process/server asymmetry for
this observer (REQ-OBS-01/03).

### 5.1 Handler signature & behavior

`follow-command.ts` exports `handleFollow(ctx)`; the file-tailing core is promoted from the old
`followDirectMode` (`loop-commands.ts:588–671`), generalized to also replay+tail `events.ndjson` and
to honor `--json` (NDJSON). The promoted logic keeps `followDirectMode`'s proven structure: a
`Promise<number>` that wires `SIGINT`/`SIGTERM` → `finish(SUCCESS)`, lazily (re)starts the watcher,
and runs a poll timer that detects terminal loop states via `deriveStatus`.

```typescript
// packages/cli/src/follow-command.ts — new
import {
  deriveStatus,
  readEvents,        // ← consumed from 02-event-log.md (does NOT replay archived runs)
  watchEvents,       // ← consumed from 02-event-log.md (fs.watch tail, re-reads from last offset)
  resolveBacklogRoot,
  resolveBacklogPaths,
  type BacklogPaths,
  type PersistedEvent,
} from "@rauf/core";
import type { CommandContext } from "./commands.js";
import { ExitCode } from "./commands.js";
import { extractNumberFlag, extractStringFlag } from "./parser.js";
import { c, info, print, error, outputJson } from "./formatter.js";

/** Terminal loop states — the loop is no longer active (promoted from loop-commands.ts:572). */
const TERMINAL_LOOP_STATES: ReadonlySet<string> = new Set([
  "IDLE", "COMPLETE", "ERROR", "PAUSED", "PAUSED_HUMAN", "LIMIT_REACHED", "WEEKLY_LIMIT",
]);

const DEFAULT_POLL_SECONDS = 2;

export async function handleFollow(ctx: CommandContext): Promise<number> {
  const targetPath = ctx.args[0];
  if (!targetPath) {
    error("Missing required argument: <path>");
    info("Usage: rauf follow [path] [--json] [--interval N] [--backlog <dir>]");
    return ExitCode.INVALID_ARGS;
  }

  const resolved = path.resolve(targetPath);
  const json = ctx.globalFlags.json;
  const intervalSeconds = extractNumberFlag(ctx.flags, "interval") ?? DEFAULT_POLL_SECONDS;
  const backlogFlag = extractStringFlag(ctx.flags, "backlog");

  // --backlog is the single targeting spelling (REQ-MON-04) — same preamble as every read command.
  const rootResult = resolveBacklogRoot(resolved, backlogFlag ?? undefined);
  if (!rootResult.ok) { error(rootResult.error.message); return ExitCode.INVALID_ARGS; }
  const pathsResult = resolveBacklogPaths(resolved, rootResult.value);
  if (!pathsResult.ok) { error(pathsResult.error.message); return ExitCode.ERROR; }
  const paths = pathsResult.value;

  return followEvents(paths, { json, intervalSeconds });
}
```

```typescript
// packages/cli/src/follow-command.ts — the replay-then-tail engine (promoted followDirectMode)
async function followEvents(
  paths: BacklogPaths,
  opts: { json: boolean; intervalSeconds: number },
): Promise<number> {
  // 1. REPLAY — current run only (REQ-OBS-04 / OQ-6 / D9): readEvents reads paths.eventsLog,
  //    which the runner rotated at start(); it never stitches the prior archived log.
  const replay = readEvents(paths);              // Result<PersistedEvent[]>; absent file → ok([])
  if (replay.ok) {
    for (const ev of replay.value) emitEvent(ev, opts.json); // ordered by seq
  }
  // Empty-is-never-silent applies here too if the run has produced nothing yet (§8) — emitted by
  // the caller before entering the tail loop when replay is empty AND state is non-live.

  return new Promise<number>((resolve) => {
    let resolved = false;
    let stopWatcher: (() => void) | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let watcherActive = false;

    const finish = (code: number) => {
      if (resolved) return;
      resolved = true;
      if (pollTimer) clearInterval(pollTimer);
      if (stopWatcher) stopWatcher();
      process.removeListener("SIGINT", onSignal);
      process.removeListener("SIGTERM", onSignal);
      resolve(code);
    };
    const onSignal = () => finish(ExitCode.SUCCESS);
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);

    // 2. TAIL — watchEvents (02) fires with newly-appended PersistedEvents, re-reading from the
    //    last byte offset on every fire (self-correcting against missed fs.watch events, tech-spec
    //    §3.3 / TQ-3). It returns a BARE cleanup fn (mirrors watchLog), not a { close } handle.
    const tryStartWatcher = () => {
      if (watcherActive) return;
      try {
        stopWatcher = watchEvents(paths, (records) => {
          for (const ev of records) emitEvent(ev, opts.json);
        });
        watcherActive = true;
      } catch {
        /* events.ndjson not present yet — retried on the next poll tick */
      }
    };
    tryStartWatcher();

    // 3. TERMINAL DETECTION + poll fallback (REQ-PERF-02): deriveStatus reads state.json (authoritative).
    //    The interval is BOTH the fs.watch-unavailable fallback AND a reconciliation safety-net for
    //    missed watch fires (tech-spec §3.3). On each tick, watchEvents' offset re-read delivers any
    //    records a dropped watch event would have missed.
    pollTimer = setInterval(() => {
      if (!watcherActive) tryStartWatcher();
      const st = deriveStatus(paths);           // unchanged signature (status.ts:357)
      if (!st.ok) return;
      if (TERMINAL_LOOP_STATES.has(st.value.loopState)) {
        if (!opts.json) { print(""); info(`Loop ended (${st.value.loopState}).`); }
        finish(st.value.loopState === "ERROR" ? ExitCode.ERROR : ExitCode.SUCCESS);
      }
    }, opts.intervalSeconds * 1000);
  });
}
```

`emitEvent(ev, json)` is the per-record renderer: in `--json` mode it writes **one NDJSON line per
`PersistedEvent`** (`outputJson(ev)` style, one object per line); otherwise it formats the structured
event for the terminal (reusing the existing event-formatting helpers the old `handleLoopFollow`
used). See §6.3.

### 5.2 Replay reads the current run ONLY (OQ-6 / D9)

`readEvents(paths)` reads `paths.eventsLog` (= `stateDir/events.ndjson`), which the runner **rotated
into `archive/{ts}-events.ndjson` at `start()`** (tech-spec D4). Therefore `follow` replays exactly
the **current run's** events and never stitches the prior archived log when attaching just after a
reset (the explicit OQ-6 resolution). A late observer sees the full current run, not just events
emitted after it attached (REQ-OBS-04).

### 5.3 Why file-based, not SSE (REQ-OBS-01/03)

The old `handleLoopFollow` had two paths: an SSE path (server-owned loops only) and `followDirectMode`
(files). Phase 1 keeps **only** the file path. Because `follow` now reads `events.ndjson` +
`state.json` directly, it shows identical live data for a foreground `loop run` and a detached run
(REQ-OBS-03), and works for a loop the observer did not start (REQ-OBS-01). Server SSE may return as a
*latency optimization* in a later phase but is **not** required for `follow` to be live — the
`watchEvents` tail already meets the ≈1s "feels live" target (REQ-PERF-02).

---

## 6. `--json`/NDJSON + flag semantics per command (REQ-MON-03)

`--json` (the existing global flag, `parser.ts:54`) is honored on **every** read/monitor command,
including under `--follow`. The `--follow` concept uses **one** flag name everywhere — `--follow`,
with `-f` as its short alias (§6.4).

### 6.1 `status` (`status-commands.ts:handleStatus`)

Replace the removed `--watch` branch (`status-commands.ts:41,46–49`) with a `--follow`/`-f` branch.
One-shot `status` already honors `--json` (`status-commands.ts:74,113`). Under `--follow`, `status`
streams **NDJSON snapshots — one `DerivedStatus` object per change** (not the screen-clearing TUI the
old `handleStatusWatch` printed):

```typescript
// packages/cli/src/status-commands.ts — handleStatus, AFTER (watch → follow)
const follow = extractBoolFlag(ctx.flags, "follow"); // -f resolved in parser (§6.4)
const all = extractBoolFlag(ctx.flags, "all");       // §9
const interval = extractNumberFlag(ctx.flags, "interval") ?? 2;
const resolved = path.resolve(targetPath);
const backlogFlag = extractStringFlag(ctx.flags, "backlog");

if (all) {
  return handleStatusAll(ctx, resolved);             // §9 — reads listActiveLoops()
}
if (follow) {
  return handleStatusFollow(resolved, interval, backlogFlag ?? undefined, ctx.globalFlags.json);
}
// ... existing one-shot path unchanged (single-root + scanActiveRoots), plus empty-not-silent (§8) ...
```

```typescript
// status follow: poll deriveStatus on --interval; emit on CHANGE only.
async function handleStatusFollow(
  projectPath: string, intervalSeconds: number, backlogFlag: string | undefined, json: boolean,
): Promise<number> {
  return new Promise<number>((resolve) => {
    let running = true;
    let lastSerialized: string | null = null;
    const stop = () => { running = false; resolve(ExitCode.SUCCESS); };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);

    const tick = () => {
      if (!running) return;
      const rootResult = resolveBacklogRoot(projectPath, backlogFlag);
      if (!rootResult.ok) { if (json) outputJson({ error: rootResult.error }); else error(rootResult.error.message); }
      else {
        const pathsResult = resolveBacklogPaths(projectPath, rootResult.value);
        if (pathsResult.ok) {
          const result = deriveStatus(pathsResult.value);
          if (result.ok) {
            if (json) {
              // REQ-MON-03: one DerivedStatus snapshot per CHANGE (NDJSON).
              const serialized = JSON.stringify(result.value);
              if (serialized !== lastSerialized) { lastSerialized = serialized; process.stdout.write(serialized + "\n"); }
            } else {
              // Human follow: screen-clear + re-render (the old --watch presentation, retained as the
              // non-JSON rendering of --follow — the verb changed, not the human display).
              process.stdout.write("\x1b[2J\x1b[H");
              print(c.dim(`rauf status  (${new Date().toLocaleTimeString()})  Ctrl+C to stop`));
              print("");
              printStatusSummary(result.value);
            }
          }
        }
      }
      if (running) setTimeout(tick, intervalSeconds * 1000);
    };
    tick();
  });
}
```

> `status --follow` is poll-based (it derives a *composite snapshot* from several files, so there is no
> single file to `fs.watch`); `--interval` is its native cadence. That is consistent with REQ-PERF-02
> being a qualitative ≈1s target rather than an SLA. `follow` and `log --follow` (which tail a single
> file) use `watchEvents`/`watchLog` and treat `--interval` as the fallback/safety-net (§5.1, §6.2).

### 6.2 `log` (`status-commands.ts:handleLog`)

`log` gains `--json` (one-shot and follow) and additionally consumes `events.ndjson` under `--follow`
so the unified file model is honored (REQ-OBS-01). One-shot `log --json` emits the tail as a JSON
array of log lines; `log --follow --json` emits **one object per line** (NDJSON):

```typescript
// packages/cli/src/status-commands.ts — handleLog one-shot --json
if (ctx.globalFlags.json) {
  outputJson(result.value);            // string[] of rauf.log lines
  return ExitCode.SUCCESS;
}
```

Under `--follow`, `log` keeps tailing `rauf.log` via `watchLog` (`status.ts:410`) **and** tails
`events.ndjson` via `watchEvents` (consumed from 02), interleaving both. In `--json` follow each
emitted unit is **one NDJSON object per line** — a `{ source: "log", line }` wrapper for raw log lines
and the raw `PersistedEvent` for event-log records — so a machine consumer can read one object per
line without ambiguity:

```typescript
// packages/cli/src/status-commands.ts — handleLogFollow, AFTER (adds events + --json NDJSON)
async function handleLogFollow(paths: BacklogPaths, initialLines: number, json: boolean): Promise<number> {
  // Replay: tail rauf.log + readEvents(paths) for events.ndjson (current run only).
  // Tail: watchLog(paths, …) for rauf.log + watchEvents(paths, …) for events.ndjson.
  // Each emitted unit honors `json`:
  //   json=true  → one NDJSON object per line ({source:"log",line} | PersistedEvent)
  //   json=false → the formatted human line / event (existing rendering)
  // SIGINT/SIGTERM → resolve(SUCCESS); cleanup both watchers (each returns a bare cleanup fn).
}
```

### 6.3 `follow` (`follow-command.ts`)

`follow --json` emits **one `PersistedEvent` (NDJSON) per line** (§5.1 `emitEvent`). Replay records and
tailed records are emitted identically — a consumer cannot tell replay from live from the line shape,
only from `seq` ordering. Non-JSON `follow` renders the formatted event stream.

### 6.4 One flag name, `-f` short alias (REQ-MON-03)

`--follow` is the **single** follow flag name on `status` and `log`. Its short alias is `-f`. The
parser already stores `-f` as the flag key `f` (`parser.ts:99–104`). Rather than threading a synonym
through every `extractBoolFlag` call, normalize `-f` → `--follow` once during parsing so handlers only
ever read `"follow"`:

```typescript
// packages/cli/src/parser.ts — immediately before the final `return { command, … }`
// (the flags map is complete once the arg-parsing loop exits; this runs after positionals
//  are split since it only touches `flags`).
// Normalize the -f short alias to the canonical --follow flag (REQ-MON-03: one flag name).
if (flags.has("f") && !flags.has("follow")) {
  flags.set("follow", flags.get("f")!);
  flags.delete("f");
}
```

`--interval <seconds>` (`extractNumberFlag`, `parser.ts:158`) retains its meaning as the poll cadence/
fallback under `--follow` on every command that follows (REQ-MON-03). It is reused verbatim from the
old `status --watch` extraction.

---

## 7. `--backlog <dir>` — single targeting spelling (REQ-MON-04)

`--backlog <dir>` remains the **only** way to target a non-default backlog root on every command that
touches state. No monitoring command introduces a second spelling. This is already true in the code:
`handleStatus`, `handleLog`, `handleProgress`, and the old `handleLoopFollow`/`handleLoopWatch` all
extract `extractStringFlag(ctx.flags, "backlog")` and run the standard `resolveBacklogRoot` →
`resolveBacklogPaths` preamble (`status-commands.ts:44,159,212`; multi-backlog §2.1). The new
`follow-command.ts` (`handleFollow`, §5.1) uses the identical preamble. Phase 1 adds **no** alternate
targeting flag.

---

## 8. Empty-is-never-silent surfacing (REQ-DISC-01, REQ-DISC-02, REQ-OBS-01) — D6/D8

Every read command (`status`, `log`, `follow`, `progress`) that resolves to "nothing here" MUST
**(a)** name the directory it inspected, and **(b)** consult `listActiveLoops()` (consumed from 03)
and, if a loop is live in another root, name that root + its state. This closes the three silent
causes the PRD identifies (backlog-root mismatch, silent-empty, cwd resolution — PRD §3.4).

"Nothing here" is detected from the data the command already reads — there is no new probe:

- For `status`: the existing `stateSource: "none"` discriminator on `DerivedStatus`
  (`status.ts:214,249`; `schemas.ts:273`) already distinguishes **absence** (no/early files) from
  **idle** (a real idle loop with `stateSource: "state.json"`, `loopState: "IDLE"`). Phase 1 *surfaces*
  it rather than adding a new signal (tech-spec §3.8).
- For `log`: an empty tail and empty `readEvents` (`status-commands.ts:188`).
- For `progress`: a missing `progress.md` (`status-commands.ts:227`).

### 8.1 Shared surfacing helper

A single helper renders both parts (a) and (b), used by all four read commands so the message is
identical everywhere:

```typescript
// packages/cli/src/status-commands.ts — shared empty-is-never-silent surfacing
import { listActiveLoops } from "@rauf/core"; // consumed from 03-active-loop-registry.md

/**
 * Render the empty-is-never-silent footer (REQ-DISC-01/02). Names the inspected
 * directory, then consults the reconciled registry and, if a loop is live in a
 * DIFFERENT root, names that root and its (advisory) state.
 *   - inspectedDir: the resolved state dir / backlog root the command read.
 *   - json: when true, emit a structured object instead of human lines.
 */
function surfaceEmptyNotSilent(inspectedDir: string, json: boolean): void {
  const live = listActiveLoops();                     // Result<ActiveLoopEntry[]> — reconciled + self-healed
  const elsewhere = live.ok
    ? live.value.filter((e) => path.resolve(e.stateDir) !== path.resolve(inspectedDir))
    : [];

  if (json) {
    outputJson({
      inspected: inspectedDir,
      empty: true,
      liveElsewhere: elsewhere.map((e) => ({
        backlogRoot: e.backlogRoot, stateDir: e.stateDir, status: e.status, pid: e.pid,
      })),
    });
    return;
  }

  info(`No loop activity in ${c.cyan(inspectedDir)}.`); // (a) name the inspected directory
  if (elsewhere.length > 0) {                            // (b) surface live loops in other roots
    print("");
    print(c.bold("A loop is live in another backlog root:"));
    for (const e of elsewhere) {
      print(`  ${c.cyan(e.backlogRoot)} — ${e.status} ${c.dim(`(PID ${e.pid})`)}`);
    }
    info(`Re-run with ${c.cyan(`--backlog <dir>`)} to inspect it, or ${c.cyan("rauf status --all")} to list all.`);
  }
}
```

`listActiveLoops()` is the **reconciled** registry read (03): it self-heals stale entries (a crashed
loop is excluded — REQ-DISC-05), so it never reports a dead loop as live. The `status` field on each
entry is **advisory** (REQ-OBS-02) — it is the registry's last-known status, surfaced only as a hint;
`state.json` remains authoritative for any root the user then inspects.

### 8.2 Wiring into each read command

- **`status`** (one-shot, default-root branch): after `printStatusSummary`, when
  `status.stateSource === "none"` (or the single-root branch derives `none`), call
  `surfaceEmptyNotSilent(paths.stateDir, json)`. The inspected dir is the resolved state dir for the
  queried root.
- **`log`**: replace the bare `info("No log entries found.")` (`status-commands.ts:189`) and the empty
  one-shot result with `surfaceEmptyNotSilent(paths.stateDir, json)`.
- **`follow`**: when replay is empty AND `deriveStatus` is non-live before the first tail fire, call
  `surfaceEmptyNotSilent(paths.stateDir, json)` (so attaching to a dead root is never silent), then
  continue tailing (the loop may yet start) or exit per the existing terminal-state logic.
- **`progress`**: replace the bare `info("No progress file found.")` (`status-commands.ts:231`) with
  `surfaceEmptyNotSilent(paths.stateDir, json)`.

> The existing `scanActiveRoots` per-tree walk (`status.ts:677`) is **superseded for liveness** by the
> O(1) `listActiveLoops()` registry (tech-spec §3.8). It MAY remain for in-project enumeration in the
> non-empty `status` default-root branch (`status-commands.ts:122`), but cross-root *liveness*
> surfacing in the empty case now reads the registry.

---

## 9. `status --all` (REQ-DISC-06) — D7

`status --all` lists **every backlog root with a live loop across the machine**, reading the same
reconciled registry, honoring `--json`. It is a flag on `status` (D7) — the existing project-scoped
`projects status` verb is **not** overloaded (it stays project-scoped).

```typescript
// packages/cli/src/status-commands.ts — handleStatusAll
async function handleStatusAll(ctx: CommandContext, _resolved: string): Promise<number> {
  const live = listActiveLoops();           // consumed from 03 — machine-wide, reconciled, self-healed
  if (!live.ok) {
    if (ctx.globalFlags.json) outputJson({ error: live.error });
    else error(live.error.message);
    return ExitCode.ERROR;
  }

  if (ctx.globalFlags.json) {
    outputJson({ loops: live.value });      // ActiveLoopEntry[] — { stateDir, projectPath, backlogRoot, pid, startedAt, status }
    return ExitCode.SUCCESS;
  }

  if (live.value.length === 0) {
    info("No live loops on this machine.");  // empty-is-never-silent: machine scope explicitly named
    return ExitCode.SUCCESS;
  }

  print(c.bold("Live loops (machine-wide):"));
  for (const e of live.value) {
    const started = new Date(e.startedAt).toLocaleTimeString();
    print(`  ${c.cyan(e.backlogRoot)} — ${e.status} ${c.dim(`(PID ${e.pid}, since ${started})`)}`);
  }
  return ExitCode.SUCCESS;
}
```

Notes:

- **Scope is machine-wide** (D6 / REQ-DISC-02): the registry lives under `~/.rauf/active/` and is
  naturally global; there is no scoping flag in Phase 1.
- The `status` field shown is the registry's **advisory** last-known status (REQ-OBS-02); to see the
  authoritative current status for one root the user runs `rauf status --backlog <root>` (or `status`
  in that root), which reads its `state.json`.
- Registry **reconciliation outcomes** (e.g. a stale crashed entry pruned by `listActiveLoops`) are
  naturally reflected because `--all` lists only reconciled-live entries — a self-healed entry simply
  does not appear (REQ-OBSV-01, surfaced not hidden).

---

## 10. Error handling

Follows the CLI convention (parse flags → resolve paths → call core → format; core returns
`Result<T>`, never throws for expected errors).

- **Missing files degrade to `state.json` + `rauf.log` (REQ-REL-03).** `readEvents` returns `ok([])`
  when `events.ndjson` is absent (consumed from 02), so `follow`/`log --follow` simply replay nothing
  and tail; `deriveStatus` already falls back to log-parsing then `stateSource: "none"` when
  `state.json` is absent (`status.ts:357`, two-tier). No reader crashes on a missing event log; an
  existing install with no `events.ndjson` keeps reporting correct status (REQ-COMPAT-01).
- **Torn trailing line tolerance.** `readEvents`/`watchEvents` (02) skip a torn/partial trailing line
  (REQ-REL-01) — `follow`/`log --follow` never crash mid-append. The CLI relies on this; it does no
  parsing of `events.ndjson` itself.
- **`--backlog` resolution errors surfaced.** `resolveBacklogRoot`/`resolveBacklogPaths` failures
  (e.g. a `PATH_VIOLATION` for `--backlog ../../outside`) are printed via `error(result.error.message)`
  and return `ExitCode.INVALID_ARGS` (root resolution) or `ExitCode.ERROR` (paths) — the existing
  pattern (`status-commands.ts:53–62`), now also used by `handleFollow` (§5.1). Error messages convert
  absolute paths to relative for readability (multi-backlog §2.1).
- **Unknown-flag handling.** Removed flags are simply not extracted, so `--watch` is left in the flags
  map and surfaced by the CLI's existing unknown-flag path (it is not silently aliased — §4). `-f` is
  normalized to `--follow` before handlers run (§6.4); any other unrecognized short flag is left as-is
  for the same unknown-flag handling.
- **Registry-read failure in surfacing.** If `listActiveLoops()` returns an error, the empty-not-silent
  footer still names the inspected directory (part a) and simply omits the cross-root section (part b)
  — a registry hiccup never suppresses the "which dir did I inspect" message (REQ-DISC-01 holds even if
  REQ-DISC-02 cannot).

---

## Dependencies

- [`00-core-definitions.md`](./00-core-definitions.md) — `PersistedEvent`/`ActiveLoopEntry` types,
  `BacklogPaths.eventsLog`, `DerivedStatus.stateSource: "none"` discriminator (reused).
- [`02-event-log.md`](./02-event-log.md) — **`readEvents(paths)`** (current-run replay) and
  **`watchEvents(paths, onRecords)`** (file tail, bare cleanup fn, offset re-read) that `follow` and
  `log --follow` consume. **Not redefined here.**
- [`03-active-loop-registry.md`](./03-active-loop-registry.md) — **`listActiveLoops()`** (reconciled,
  self-healed, machine-wide) that `status --all` and the empty-is-never-silent surfacing consume.
  **Not redefined here.**
- [`01-architecture-layout.md`](./01-architecture-layout.md) §7 — file-to-spec map for the CLI files
  touched here.

> `WARNING: Could not locate the formatted-event renderer the old handleLoopFollow used (the SSE-path
> event formatter) by exact name — verify the reusable terminal event-formatting helper in
> loop-commands.ts before implementing follow-command.ts's emitEvent non-JSON branch; reuse it rather
> than re-authoring per-type formatting.`

## Verification

Maps to **SC-2** (empty-not-silent) and **SC-4** (one follow verb + one follow flag, removals, `--json`
everywhere) from PRD §8.

**SC-2 — empty-is-never-silent (REQ-DISC-01/02):**

- [ ] `rauf status <idle-or-nonexistent-root>` prints the **inspected directory** and does not silently
      show only "idle".
- [ ] With a loop live on `--backlog specs/x` and `rauf status .` resolving to a different root, the
      output names `specs/x` and its (advisory) state (surfacing a registry-live loop in another root).
- [ ] `rauf log` / `rauf follow` / `rauf progress` on an empty/dead root each name the inspected
      directory and surface any cross-root live loop via the same `surfaceEmptyNotSilent` helper.
- [ ] `surfaceEmptyNotSilent` reads `listActiveLoops()` (reconciled) — a crashed loop never appears.

**SC-4 — one follow verb, one follow flag, removals, `--json` everywhere (REQ-MON-01/02/03):**

- [ ] Exactly **one** canonical live-view command exists: top-level `follow`. `loop follow` is gone.
- [ ] Exactly **one** follow flag name exists: `--follow` (with `-f` alias normalizing to it). No
      `--watch` anywhere; `status --watch` and `handleStatusWatch` are deleted.
- [ ] `loop watch` and `handleLoopWatch` are deleted (no alias); `rauf loop watch` errors as an
      unknown subcommand.
- [ ] **Subcommand-list test change** (`loop-commands.test.ts:100`):
      `["start","stop","follow","run","review","watch"]` → `["start","stop","run","review"]`.
- [ ] Removed-command tests deleted: the `handleLoopFollow` test (`loop-commands.test.ts:~187`) and the
      `handleLoopWatch` test; `commands.test.ts` registry assertions updated to include top-level
      `follow` and drop the two `loop` subcommands.
- [ ] `status` usage string no longer advertises `[--watch]`; advertises `[--follow] [--json] [--all]`.
- [ ] `--json` works on **every** read command including `status --follow` (one `DerivedStatus`
      snapshot per change), `log --follow` and `follow` (one NDJSON `PersistedEvent`/log object per
      line), and `status --all` (the `ActiveLoopEntry[]` list).

**Boundary / file-based parity (REQ-OBS-01/03/04, REQ-MON-04):**

- [ ] `loop start --follow` is unchanged (execution grammar, Phase 2) — not touched by this change.
- [ ] `follow` replays the **current run only** (`readEvents`), never the archived prior log (OQ-6/D9);
      a foreground `loop run` and a detached run produce identical `follow` output (REQ-OBS-03).
- [ ] `--backlog <dir>` is the only targeting spelling on `status`/`log`/`follow`/`progress`; no second
      spelling is introduced.
- [ ] `pnpm typecheck`, `pnpm test`, `pnpm lint` pass (SC-7).
