# 05 — Web Observation Parity + Event Timeline

How the web becomes a **faithful observer of in-process (`loop run`) loops**, not just the
server-owned loops it started. Phase 1 rewires three read paths and adds one frontend component so
that the web reconstructs loop activity **from the same files as the CLI** (`events.ndjson`,
`state.json`, the active-loop registry) instead of from the in-memory ring buffer that only sees
loops the server itself launched.

This is the **web half of SC-1**: with no server-owned runner, a foreground `rauf loop run` must
produce a live timeline on the web status page that is identical in kind to a detached run.

> Source of truth: [`PRD.md`](./PRD.md) §3.5 (web parity), §4.3 (security), §8 (SC-1);
> [`tech-spec.md`](./tech-spec.md) §3.9 (D8), §5.3 (web API table), §6.3 (web→core integration), §8
> (frontend test posture). Shared types from [`00-core-definitions.md`](./00-core-definitions.md);
> the read primitives `readEvents`/`watchEvents` from [`02-event-log.md`](./02-event-log.md); the
> reconciled listing `listActiveLoops` from
> [`03-active-loop-registry.md`](./03-active-loop-registry.md). Where this spec and
> [`CANON.md`](./CANON.md) disagree, the canon wins.

---

## Requirement Coverage

| REQ ID     | Requirement                                                                              | Section          |
| ---------- | ---------------------------------------------------------------------------------------- | ---------------- |
| REQ-WEB-01 | Web reconstructs from the same files as the CLI; shows in-process `loop run`s            | 3, 4.1, 4.4      |
| REQ-WEB-02 | In-memory buffer is a latency optimization (cache), never the sole source of truth       | 4.1, 4.3         |
| REQ-WEB-03 | Cross-root liveness from the registry surfaces in the projects view                      | 4.2, 4.5         |
| REQ-SEC-02 | 127.0.0.1 bind + `X-Rauf-Request` unchanged; Phase 1 adds NO mutation endpoints          | 6 (Security)     |
| REQ-OBS-03 | Web observer parity — in-process and detached runs observationally identical (web half)  | 1, 3, 8 (SC-1)   |

Supporting requirements consumed (defined in the cited docs, not re-derived here):

| REQ ID     | Used for                                                                 | Defined in |
| ---------- | ------------------------------------------------------------------------ | ---------- |
| REQ-OBS-04 | `/loop/events` replays current-run history then tails new events         | `02`       |
| REQ-REL-01 | Concurrent web tail tolerates a torn trailing line                       | `02`, §5   |
| REQ-REL-03 | Missing `events.ndjson` → empty timeline, graceful degradation           | `02`, §7   |
| REQ-DISC-05| `/api/loops` returns reconciled (self-healed) live loops                 | `03`       |

> **Boundary (Phase 4 — NOT pulled forward).** Web **recovery actions**
> (reset / resume / review / unblock / validate buttons) and the **shared status-vocabulary label-map
> + missing badges** (`REVIEWING`, `PAUSED_USAGE_LIMIT`, "Needs Human" rendering) are **Phase 4**
> (PRD §6). `<EventTimeline>` renders the 24 **event types** with existing/minimal labels only.
> **Event rendering ≠ status vocabulary**: this doc adds no `LoopStateStatus` label-map, no new status
> badges, and no mutation buttons. See §9 for the explicit boundary statement.

---

## 1. Problem & Intent

Today the web's live event stream and active-loop list are sourced from `LoopManager` — an in-memory
singleton that only knows about loops **it** started via `POST /:id/loop/start`
(`loop-manager.ts:77`). A foreground `rauf loop run` (or a pipeline-started loop, or a loop in a
backlog root the server never touched) is invisible to:

- `GET /api/projects/:id/loop/events` — subscribes to `manager.subscribe()`
  (`routes/loop.ts:264`), which has no listener set for a loop the manager didn't create, so the SSE
  stream is silent.
- `GET /api/loops` — returns `manager.listActive()` (`routes/loop.ts:103`), which enumerates only the
  manager's `activeLoops` map, so an in-process loop is reported as "nothing running."

Phase 1's keystone (events persisted to `events.ndjson`, liveness in `~/.rauf/active/`) lets the web
read the **same on-disk substrate** the CLI reads. The fix is to repoint these read paths at the
files and demote the in-memory buffer to an optional cache (REQ-WEB-01/02/03, REQ-OBS-03).

The in-memory buffer's incompleteness is itself evidence it cannot be authoritative: `LoopManager`'s
`LOOP_EVENT_TYPES` fan-out array (`loop-manager.ts:32–50`) lists only **17** of the **24**
`LoopEventSchema` members — it omits `loop_paused`, `review_started`, `review_completed`,
`review_failed`, `llm_tool_activity`, `llm_token_update`, and `llm_stuck_warning`. The file-backed
path captures all 24 because the runner persists every event through `emitEvent()` (see `02` §3.1),
so moving to the file is also a correctness fix, not only a parity fix.

---

## 2. Web API Change Table (read-path only)

Confirmed route paths from source: the loop router is mounted at `/api/projects`
(`app.ts:105`, `app.route("/api/projects", createLoopRouter(...))`) and the loops router at
`/api/loops` (`app.ts:109`). Within `createLoopRouter` the handlers are registered as `/:id/loop/...`
(`routes/loop.ts:233`), so the **full** event path is `/api/projects/:id/loop/events`. Within
`createLoopsRouter` the list handler is `router.get("/")` (`routes/loop.ts:101`), so the full path is
`/api/loops`.

| Method | Full path                          | Change                                                                                                              | Req                  |
| ------ | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------- |
| GET    | `/api/projects/:id/loop/events`    | Source of truth becomes `events.ndjson`: replay via `readEvents`, then tail via `watchEvents`, for **any** project | REQ-WEB-01, REQ-OBS-04 |
| GET    | `/api/loops`                       | Returns reconciled `listActiveLoops()` (all live loops) instead of `manager.listActive()` (server-owned only)      | REQ-WEB-03, REQ-DISC-05 |
| GET    | `/api/projects/:id/status`         | **No source change** — already file-based (`routes/status.ts` `deriveStatus`); verify in-process parity (SC-1)     | REQ-WEB-01           |
| GET    | `/api/projects/:id/log/stream`     | **No source change** — already file-based (`readLogTail` + `watchLog`); the `<EventTimeline>` template (§4.4)      | REQ-WEB-01           |
| —      | (no new mutation endpoints)        | Recovery buttons are **Phase 4**; Phase 1 adds zero POST/PUT/DELETE routes                                          | REQ-SEC-02           |

**No route paths change.** The two repointed handlers keep their exact URLs; only their data source
changes. No new routes are added.

---

## 3. Architecture: file = truth, buffer = cache

```
   Foreground `rauf loop run`            Server-owned `POST /loop/start`
        (no server runner)                    (LoopManager runner)
              │                                        │
              ▼                                        ▼
   runner.emitEvent() ──persist──► <root>/.rauf/events.ndjson ◄── runner.emitEvent()
              │                              ▲   (single writer per root, REQ-EVT-06)
              │                              │
              │                    readEvents / watchEvents  ── core, file-backed (02)
              │                              │
              ▼                              ▼
        registerLoop ──► ~/.rauf/active/  ──► /api/projects/:id/loop/events  (SSE)
              │            (registry)    ──► /api/loops (listActiveLoops, reconciled)
              ▼                                        │
        listActiveLoops (03)                           ▼
                                            <EventTimeline> / projects view  (browser)
```

The decisive change: **both** execution modes write the same `events.ndjson` and register in the same
`~/.rauf/active/`. The web reads only those files, so it observes both modes identically
(REQ-OBS-03). `LoopManager`'s in-memory buffer is no longer on the read path's critical line; it
survives only as an optional same-process latency shortcut (§4.3).

---

## 4. Backend Handler Changes

### 4.1 `GET /api/projects/:id/loop/events` — file-backed replay-then-tail (REQ-WEB-01, REQ-OBS-04, REQ-WEB-02)

**Current** (`routes/loop.ts:233–287`): the SSE handler resolves `projectPath`, validates the path
sandbox, then `manager.subscribe(projectPath, listener, resolvedBacklogRoot)`
(`routes/loop.ts:264`) to fan in-memory events out as `loop_event` SSE messages, with a 15s heartbeat
(`SSE_HEARTBEAT_MS`, `routes/loop.ts:88`).

**Change**: replace the `manager.subscribe(...)` source with the **file-backed** replay-then-tail,
exactly mirroring the already-file-based `/log/stream` handler (`routes/status.ts:134`, which sends
`readLogTail` results on connect then `watchLog`-tails). The handler resolves `BacklogPaths` for the
project (+ optional `?backlog=` query, already parsed at `routes/loop.ts:257–262`) and then:

```typescript
// routes/loop.ts — inside streamSSE(c, async (stream) => { … }), replacing the manager.subscribe block.
// paths: BacklogPaths resolved from projectPath (+ optional ?backlog), as the existing handler already does.

import { readEvents, watchEvents } from "@rauf/core"; // 02 — file-backed primitives

// 1. History replay (REQ-OBS-04): the CURRENT run's events.ndjson, in seq order.
//    Missing file → ok([]) (REQ-REL-03) → empty timeline, never an error.
const replay = readEvents(paths);
if (replay.ok) {
  for (const record of replay.value) {
    if (stream.aborted || stream.closed) return;
    await stream.writeSSE({ data: JSON.stringify(record), event: "loop_event" });
  }
}

// 2. Live tail (REQ-WEB-01): watchEvents fires with newly-appended PersistedEvents.
//    Mirrors watchLog; returns a bare cleanup fn (02 §3.3), pushed onto `cleanups`.
const stopTail = watchEvents(paths, (records) => {
  if (stream.aborted || stream.closed) return;
  for (const record of records) {
    stream.writeSSE({ data: JSON.stringify(record), event: "loop_event" }).catch(() => {});
  }
});
cleanups.push(stopTail);
```

Notes:

- **Same SSE wire shape.** Events are still emitted under the `loop_event` SSE event name with a
  JSON-encoded body, so the frontend contract is unchanged except that the body is now a
  `PersistedEvent` (a `LoopEvent` plus `seq` + `schemaVersion`; `00` §1.1) rather than a bare
  `LoopEvent`. The extra fields are additive and ignored by any consumer that only reads `type`.
- **Any project, no ownership.** Because the source is the file, the handler serves a loop the server
  never started (REQ-WEB-01 / SC-1). The `projectPath`/`?backlog` resolution and the existing
  `validateProjectPath` sandbox guard (`routes/loop.ts:239–242`) are retained verbatim.
- **Heartbeat + abort/cleanup retained.** The immediate heartbeat (`routes/loop.ts:254`), the 15s
  `setInterval` heartbeat (`routes/loop.ts:275–279`), the `cleanups` array, and the `abortPromise`
  teardown (`routes/loop.ts:282–285`) are unchanged; `stopTail` is just another entry in `cleanups`.
- **Buffer demotion (REQ-WEB-02).** The handler no longer depends on `manager.subscribe`. The in-memory
  buffer is no longer the source; see §4.3 for its optional-cache role.
- **No new mutation, no new header.** This is a GET; the `X-Rauf-Request` guard does not apply (§6).

> WARNING: `watchEvents`/`readEvents` are defined in `02-event-log.md` (core `events-log.ts`). At the
> time of writing this doc, `02` had not yet been committed to disk — verify the exact exported
> signatures (`readEvents(paths): Result<PersistedEvent[]>`,
> `watchEvents(paths, onRecords): () => void`, bare cleanup fn) against `02` and `core/src/index.ts`
> before implementing.

### 4.2 `GET /api/loops` — reconciled `listActiveLoops()` (REQ-WEB-03, REQ-DISC-05)

**Current** (`routes/loop.ts:98–107`):

```typescript
export function createLoopsRouter(): Hono {
  const router = new Hono();
  router.get("/", (c) => {
    const manager = getLoopManager();
    return c.json({ data: { loops: manager.listActive() } }); // server-owned loops only
  });
  return router;
}
```

`manager.listActive()` (`loop-manager.ts:175–179`) returns `{ projectPath }[]` for entries in the
manager's in-memory `activeLoops` map — server-owned only.

**Change**: source from the **registry** so every live loop (any execution mode, any root) is listed
and stale entries are pruned by reconciliation (REQ-DISC-05):

```typescript
import { listActiveLoops } from "@rauf/core"; // 03 — reconciled + self-healed

router.get("/", (c) => {
  const result = listActiveLoops(); // reconciles each entry against .loop.lock + process liveness (03)
  const loops = result.ok ? result.value : []; // degrade to empty on registry IO error (REQ-REL-03 spirit)
  return c.json({ data: { loops } });
});
```

Notes:

- **Reconciled liveness (REQ-DISC-05).** `listActiveLoops()` self-heals: a crashed loop that never
  deregistered is excluded and its stale entry unlinked (per `03`). The web therefore never reports a
  dead loop as live.
- **Richer entries.** Response items are `ActiveLoopEntry` objects
  (`{ stateDir, projectPath, backlogRoot, pid, startedAt, status }`; `00` §1.2), a superset of the
  old `{ projectPath }`. Existing `/api/loops` consumers that read `projectPath` keep working; the
  projects view (§4.5) consumes `stateDir`/`backlogRoot`/`status` for cross-root liveness.

> WARNING: `listActiveLoops` is defined in `03-active-loop-registry.md` (core `loop-registry.ts`),
> not yet committed at write time. Verify its exact signature (`listActiveLoops(): Result<ActiveLoopEntry[]>`)
> and the `ActiveLoopEntry` field names against `03` / `00` §1.2 before implementing.

### 4.3 `loop-manager.ts` — buffer → cache demotion (REQ-WEB-02)

The in-memory ring buffer (`eventBuffers`, `MAX_BUFFER_SIZE = 100`, `loop-manager.ts:52,63–64`) and
the `subscribe` replay (`loop-manager.ts:132–160`) are **demoted to a latency optimization**, never
the sole source of truth (REQ-WEB-02):

- The **read path no longer requires** `LoopManager`. `/loop/events` (§4.1) and `/api/loops` (§4.2)
  read files; correctness does not depend on any in-memory buffer existing.
- `LoopManager` retains its **execution** responsibilities unchanged: creating runners, starting
  loops, graceful shutdown, stale-loop recovery (`startLoop`/`stopLoop`/`shutdownAll`/
  `recoverStaleLoops`). Those are server-owned execution concerns, untouched by Phase 1.
- The buffer/`subscribe`/`fanOut` machinery (`loop-manager.ts:132–263`) MAY remain as a
  same-process shortcut for server-owned loops (lower latency than waiting for an `fs.watch` fire),
  but is **no longer wired into the route** in Phase 1 — the route reads the file. If retained, it is
  pure cache: dropping it changes latency, never correctness. Phase 1 may simply leave it in place
  (dead on the read path) to keep the change minimal; removing it is optional cleanup, not required.

The load-bearing invariant for REQ-WEB-02: **the file is authoritative; the buffer is at most a cache
in front of it.** No observer's correctness depends on the buffer.

### 4.4 `<EventTimeline>` template = the existing `LogPanel` `EventSource` pattern

The frontend component (§7) is built directly on the **proven** `LogPanel` `EventSource` lifecycle
(`status.tsx:321–355`), which is the canonical SSE-consumer idiom in this codebase:

```tsx
// status.tsx:331–355 — LogPanel's EventSource lifecycle (the template for <EventTimeline>)
useEffect(() => {
  if (!projectId) return;
  const url = `/api/projects/${encodeURIComponent(projectId)}/log/stream`;
  const es = new EventSource(url);
  es.onopen = () => setConnected(true);
  es.onerror = () => setConnected(false);
  es.addEventListener("log", (e) => {
    try {
      const newLines = JSON.parse((e as MessageEvent<string>).data) as string[];
      if (!Array.isArray(newLines)) return;
      setLines((prev) => [...prev, ...newLines].slice(-50));
    } catch {
      /* ignore malformed SSE data */
    }
  });
  return () => {
    es.close();
    setConnected(false);
  };
}, [projectId]);
```

`<EventTimeline>` reuses this shape verbatim, swapping only: the URL (`/loop/events`), the SSE event
name (`loop_event`), and the parse target (`PersistedEvent`). See §7.

### 4.5 Projects-view liveness badge wiring (REQ-WEB-03)

**Current** (`index.tsx:118–164`, `ProjectCard`): each card runs a per-project status query
(`index.tsx:119–124`, `useQuery` on `/api/projects/:id/status`, `refetchInterval: 30_000`) and renders
a `<StateBadge state={loopState} />` (`index.tsx:163`) derived from that project's own `state.json`.

**Change**: augment the projects view with **registry liveness** so the list reflects every live loop
(any mode, any root), not only server-owned ones (REQ-WEB-03):

- Add a single registry query at the **projects-list level** (the parent of the card grid), e.g.
  `useQuery({ queryKey: ["loops"], queryFn: () => raufFetchJson<{ loops: ActiveLoopEntry[] }>("/api/loops"), refetchInterval: 30_000 })`.
- For each `ProjectCard`, derive a **liveness flag** by matching the project against the registry list
  (by resolved `backlogRoot`/`stateDir` and/or `projectPath`). A registry-live entry whose root the
  card represents marks the card as live.
- Render a **minimal liveness indicator** from the registry (a "live" dot/marker on the card),
  alongside the existing `<StateBadge>`. This indicator distinguishes "a loop is live in this root"
  (from the registry) from the per-card `loopState` (from `state.json`), closing the in-process blind
  spot in the projects view.

> **Boundary held (Phase 4).** This is a **liveness** indicator from the registry, **not** the shared
> status-vocabulary label-map or the missing status badges (`REVIEWING`, `PAUSED_USAGE_LIMIT`,
> "Needs Human"). The existing `<StateBadge>` and its current label set are reused as-is; no new
> status-label mapping is introduced here (PRD §6; §9 of this doc). If a card needs more than
> "live / not-live" plus the existing badge, that styling work is Phase 4.

---

## 5. Concurrent-Read / Torn-Line Safety (REQ-REL-01)

A web reader tailing `events.ndjson` **while the runner is appending to it** is safe — it cannot
corrupt or crash on a partial write. The correctness argument is established in `02` (and
`tech-spec.md` §7) and is **referenced, not re-derived** here:

- There is exactly **one writer per root** (the loop runner; REQ-EVT-06), and every append is a single
  whole line via `fs.appendFileSync(line + "\n")`.
- Therefore the **only** line a concurrent read can ever observe mid-write is the **trailing** line; an
  interior line can never be torn.
- `readEvents` (via `readNdjson`, `02`) **skips** any line that fails `JSON.parse`/schema validation
  and returns all earlier valid records. The skipped line is necessarily the trailing torn one.
- `watchEvents` re-reads from its last byte offset on each fire (`02` §3.3 / tech-spec TQ-3), so a
  trailing line observed torn on one fire is delivered intact on the next.

Net: the web SSE handler (§4.1) inherits this tolerance for free by building on `readEvents` +
`watchEvents`. No web-side torn-line handling is needed beyond the existing `.catch(() => {})` on
`writeSSE` and the `try/catch` JSON parse in the frontend (§7). See `02` for the full proof.

---

## 6. Security — unchanged posture (REQ-SEC-02)

Phase 1's web work is **read-path only** and adds **no** mutation endpoints. The existing security
posture is preserved verbatim:

- **127.0.0.1 bind unchanged.** The server binds to localhost only (architecture rule #4); Phase 1
  does not touch the bind. No change to the server entry point.
- **`X-Rauf-Request` guard unchanged and untouched.** The CSRF middleware (`app.ts:54–69`) fires
  **only** on `POST`/`PUT`/`DELETE` (`app.ts:56`) and returns `403` without the
  `X-Rauf-Request: true` header. Both repointed handlers (`/loop/events`, `/api/loops`) are **GET**,
  so they are unaffected by the guard, and **adding read-path data sources needs no middleware
  change** (REQ-SEC-02). The middleware is not edited.
- **No new POST/PUT/DELETE routes.** Recovery actions (reset / resume / review / unblock / validate)
  are **Phase 4** (PRD §6). Phase 1 introduces zero mutation surface, so there is no new endpoint to
  guard.
- **Path sandbox retained.** The `validateProjectPath` guard (`routes/loop.ts:239–242`, calling
  `validatePath(projectPath, [rootDir])`) on `/loop/events` is kept; `listActiveLoops` reads only
  within `~/.rauf/active/` (sandboxed in `03`/`00`). No read escapes the established sandbox.

---

## 7. `<EventTimeline>` Component (NEW, on the status page)

A new component rendered on the status page (`status.tsx`), opening an `EventSource` to the
now-file-backed `/api/projects/:id/loop/events` and rendering the 24 structured `LoopEvent` types
with **minimal/existing labels**.

### 7.1 Props interface

```tsx
// status.tsx — new component, alongside LogPanel (status.tsx:321)
interface EventTimelineProps {
  /**
   * Encoded project id whose loop event stream to observe. Mirrors LogPanel's
   * `projectId` prop (status.tsx:321); the EventSource re-connects when it changes.
   */
  projectId: string;
  /**
   * Optional non-default backlog root, forwarded as the `?backlog=` query param —
   * the same param the backend already parses (routes/loop.ts:257). Omit for the
   * default root. Matches REQ-MON-04: `--backlog` is the single targeting spelling.
   */
  backlogRoot?: string;
}
```

### 7.2 EventSource lifecycle (mirrors `LogPanel`, REQ-WEB-01, REQ-OBS-04)

```tsx
function EventTimeline({ projectId, backlogRoot }: EventTimelineProps) {
  const [events, setEvents] = useState<PersistedEvent[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!projectId) return;

    // Same URL shape as LogPanel, pointed at the file-backed /loop/events.
    const base = `/api/projects/${encodeURIComponent(projectId)}/loop/events`;
    const url = backlogRoot ? `${base}?backlog=${encodeURIComponent(backlogRoot)}` : base;
    const es = new EventSource(url);

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false); // browser auto-reconnects; REQ-REL handled server-side

    // Server emits both history-replay (REQ-OBS-04) and live records under "loop_event".
    es.addEventListener("loop_event", (e) => {
      try {
        const record = JSON.parse((e as MessageEvent<string>).data) as PersistedEvent;
        if (typeof record?.type !== "string") return; // ignore malformed SSE data
        // Bounded buffer, mirroring LogPanel's .slice(-50); ordered by arrival = seq order.
        setEvents((prev) => [...prev, record].slice(-200));
      } catch {
        /* ignore malformed SSE data — same posture as LogPanel */
      }
    });

    // Cleanup on unmount / projectId|backlogRoot change: close the EventSource (REQ-REL).
    return () => {
      es.close();
      setConnected(false);
    };
  }, [projectId, backlogRoot]);

  return (/* … render `events` with minimal labels (§7.3) + a `connected` indicator … */);
}
```

Lifecycle guarantees (all mirroring `LogPanel`):

- **Replay-then-tail** is server-side (§4.1); the client simply appends every `loop_event` it
  receives, so a late-attaching observer still sees the current run's full history then live progression
  (REQ-OBS-04).
- **Cleanup on unmount.** The `useEffect` cleanup calls `es.close()` and resets `connected`, so
  navigating away or changing `projectId`/`backlogRoot` tears down the prior stream — no leaked
  connection (same as `LogPanel:351–354`).
- **Reconnect.** `es.onerror` sets `connected=false`; the browser's native `EventSource` auto-reconnect
  re-establishes the stream, and the server replays current-run history on reconnect (§4.1), so a brief
  drop self-heals. No manual reconnect loop is written.
- **Bounded memory.** `events` is capped (`.slice(-200)`), mirroring `LogPanel`'s `.slice(-50)`.

### 7.3 Rendering the 24 event types (minimal labels — boundary held)

`<EventTimeline>` renders each `PersistedEvent` as a timeline row keyed by `seq` (dense, monotonic per
run; `00` §1.1), discriminating on `record.type`. It covers all **24** `LoopEventSchema` members
(confirmed in `schemas.ts:574–595`):

```
loop_started · iteration_start · item_selected · llm_spawned · llm_exited · signal_parsed ·
item_completed · item_blocked · item_retried · needs_human · loop_paused · usage_limit_hit ·
usage_limit_cleared · sleep_start · sleep_end · loop_completed · loop_error · loop_cancelled ·
review_started · review_completed · review_failed · llm_tool_activity · llm_token_update ·
llm_stuck_warning
```

Rendering rules (deliberately minimal — REQ-WEB-01/OBS-03, boundary held):

- Each row shows the event `type` (a short human label or the raw type string is acceptable), its
  `timestamp`, and a few salient payload fields where obvious (e.g. `item_selected.itemId`,
  `signal_parsed`'s signal, `llm_token_update`'s counts). An unknown future `type` (forward-stable
  envelope, REQ-EVT-04) renders generically (raw `type` + JSON-ish payload) rather than crashing —
  additive-tolerant, matching `readNdjson`'s posture.
- **Labels are existing/minimal.** This component introduces **no** shared status-vocabulary label-map
  and **no** new status badges. It maps **event types** (not `LoopStateStatus` values) to display
  strings only for rendering. See §9.

### 7.4 Placement on the status page

`<EventTimeline>` is added to the status page next to the existing `LogPanel`
(`status.tsx:909–914`, the right-column "Live Log" block). Exact layout (a new panel/tab/section) is an
implementation detail; the requirement is that the status page shows the live, file-backed event
timeline for the project's loop (SC-1). It receives the same `projectId` the page already resolves for
`LogPanel`, plus the page's optional backlog-root selection if present.

---

## 8. Verification → SC-1

Frontend has **no automated test harness today** (`tech-spec.md` §8); standing one up is **out of
scope for Phase 1**. Web parity is verified two ways:

| # | Check | How | Verifies |
| - | ----- | --- | -------- |
| V1 | `/loop/events` serves a project's `events.ndjson` with **no server-owned runner** | `routes/loop.test.ts` (extend): write a project with an `events.ndjson` (no `manager.startLoop`), GET `/api/projects/:id/loop/events`, assert the SSE stream replays the file's records as `loop_event` | REQ-WEB-01, SC-1 (API boundary) |
| V2 | `/api/loops` returns registry-reconciled loops, not server-owned only | `routes/loop.test.ts` (extend): register a loop in the registry (no manager runner), GET `/api/loops`, assert the entry appears; a stale entry is pruned | REQ-WEB-03, REQ-DISC-05 |
| V3 | Missing `events.ndjson` → empty timeline, no error | `routes/loop.test.ts`: GET `/loop/events` for a project with no event log; assert connection succeeds, replay is empty | REQ-REL-03 |
| V4 | `X-Rauf-Request` guard / 127.0.0.1 posture unchanged | existing `app`/CSRF tests still pass; no GET read-path requires the header | REQ-SEC-02 |
| V5 | **Manual SC-1 check** (frontend) | Run a foreground `rauf loop run` with **no server-owned runner**, open the web status page, confirm `<EventTimeline>` renders the live event stream identical in kind to a detached run | REQ-OBS-03, SC-1 (web half) |

V1–V4 prove the **data** `<EventTimeline>` consumes is correct at the API boundary. V5 is the manual
acceptance check that the rendered web page reflects an in-process loop — added to the Phase-1
manual-verification checklist so SC-1's web-parity claim is not asserted at the backend level alone.
Full test details (including the loop-integration and CLI tests) live in
[`07-testing-strategy.md`](./07-testing-strategy.md); this doc defers to it.

**SC-1 (headline) — web half.** With no server running, a foreground `rauf loop run` produces a live
timeline on the web status page identical in kind to a detached/server-owned run. The
in-process/server observability asymmetry is gone because both modes write the same `events.ndjson`
and the web reads only that file (V1 + V5). *(Verifies REQ-OBS-03, REQ-WEB-01.)*

---

## 9. Phase-4 Boundary (explicit — do NOT pull forward)

This document holds the Phase-1/Phase-4 line precisely (PRD §6, tech-spec D8):

- **Event rendering ≠ status vocabulary.** `<EventTimeline>` maps **`LoopEvent` types** to minimal
  display strings for rendering. It does **NOT** introduce the shared **status-vocabulary label-map**
  for `LoopStateStatus` values, and it does **NOT** add the missing status badges (`REVIEWING`,
  `PAUSED_USAGE_LIMIT`, "Needs Human" rendering). Those are **Phase 4**.
- **No recovery actions.** No reset / resume / review / unblock / validate buttons, and therefore no
  new mutation endpoints, are added (Phase 4; REQ-SEC-02 keeps Phase 1 read-only).
- The projects-view change (§4.5) adds a **liveness indicator from the registry** and reuses the
  existing `<StateBadge>` label set as-is; it does **not** restyle or relabel status badges.

If a downstream reader is tempted to add a status-label map, a status badge, or a recovery button
while implementing this doc: **stop** — it is Phase 4.

---

## Dependencies

- [`00-core-definitions.md`](./00-core-definitions.md) — `PersistedEvent` (the `/loop/events` body),
  `ActiveLoopEntry` (the `/api/loops` item shape).
- [`02-event-log.md`](./02-event-log.md) — `readEvents` (history replay) and `watchEvents` (live tail),
  plus the torn-line correctness argument referenced in §5.
- [`03-active-loop-registry.md`](./03-active-loop-registry.md) — `listActiveLoops` (reconciled,
  self-healed) consumed by `/api/loops` and the projects-view liveness query.
- [`01-architecture-layout.md`](./01-architecture-layout.md) — module map (this doc owns
  `web/server/routes/loop.ts`, `web/server/loop-manager.ts`, `web/client/routes/projects/*`).

This doc consumes core exports only; it adds **no** new `web`-specific exports to core (architecture
rule #1, REQ-COMPAT-03).

## Verification

- [ ] `GET /api/projects/:id/loop/events` sources from `readEvents` (replay) + `watchEvents` (tail),
      not `manager.subscribe`; serves a project with no server-owned runner (REQ-WEB-01, SC-1).
- [ ] The SSE handler retains its existing path sandbox guard, heartbeat, and `cleanups`/abort teardown;
      `watchEvents`' cleanup fn is pushed onto `cleanups` (no leaked watcher).
- [ ] `GET /api/loops` returns `listActiveLoops()` (reconciled), not `manager.listActive()`; a stale
      entry does not appear (REQ-WEB-03, REQ-DISC-05).
- [ ] `LoopManager`'s ring buffer is off the read path; correctness no longer depends on it (REQ-WEB-02).
- [ ] `<EventTimeline>` opens an `EventSource` to `/loop/events`, renders all 24 event types with minimal
      labels, and closes the stream on unmount / id change (mirrors `LogPanel`).
- [ ] Projects view surfaces registry liveness (`/api/loops`) per card without adding status-label maps
      or new status badges (REQ-WEB-03; boundary held).
- [ ] No new POST/PUT/DELETE route; `X-Rauf-Request` middleware (`app.ts:54–69`) and 127.0.0.1 bind
      unchanged (REQ-SEC-02).
- [ ] Missing `events.ndjson` → `/loop/events` yields an empty timeline, no error (REQ-REL-03).
- [ ] `routes/loop.test.ts` extended for V1–V3; manual SC-1 check (V5) added to the Phase-1 checklist.
- [ ] No status-vocabulary label-map, status badges, or recovery buttons introduced (Phase-4 boundary, §9).
