/**
 * Shared types for the rauf-loop-supervisor Pi extension.
 *
 * The extension launches a rauf loop in rauf's detached, server-managed mode
 * (`rauf loop run <root> --backlog <dir> --detached`), which returns at once and
 * leaves the loop running in rauf's server, so it outlives the Pi session. It
 * then tails rauf's single-writer event log (`<stateDir>/events.ndjson`): each
 * completed item becomes a persisted card message (no model turn), and the
 * session is woken only on events a human or the agent must act on.
 *
 * The core (tailer, supervisor, registry, guard) takes a narrow host so it is
 * unit-tested with a fake host and temp files; only index.ts touches pi.
 */

/** A rauf persisted loop event. Only fields the extension reads are typed;
 *  extra fields are preserved (rauf `packages/core/src/schemas.ts`). */
export interface RaufEvent {
  type: string;
  seq?: number;
  timestamp?: string;
  itemId?: string;
  [key: string]: unknown;
}

/** Durable identity of one supervised loop, persisted so a later Pi session can
 *  reattach to a still-running (or since-finished) loop without relaunching. */
export interface SupervisorTask {
  /** Project root (contains `.rauf.json`), absolute. Absent in legacy mirrors. */
  projectPath?: string;
  /** Backlog directory as passed to `--backlog` (relative to projectPath), or
   *  undefined for the project's default `.rauf` root. */
  backlogDir?: string;
  /** The runner state directory holding events.ndjson, absolute. */
  stateDir: string;
  /** Absolute path of the watched event file (`<stateDir>/events.ndjson`). */
  eventsFile: string;
  /** Inode of `eventsFile` when last persisted. On reattach a different inode
   *  means rauf rotated the log (a new run) while nobody watched, so the per-run
   *  cursor resets instead of swallowing the new run. */
  eventsIno?: number;
  /** ISO time of the launch. */
  launchedAt: string;
  /** Backlog item count at launch, when known (fallback `[N/M]` for old runners). */
  total?: number;
  /** Highest event `seq` already surfaced — the dedup cursor across reattach. */
  lastSeq: number;
  /** A run-ending event has been surfaced for this task. */
  closed: boolean;
}

/** What the footer and widget show for a live loop. */
export interface LiveSnapshot {
  done: number;
  total?: number;
  currentItem?: string;
  health: "healthy" | "stuck" | "sleeping";
  /** Most recent cards, oldest first (the widget). */
  recentCards: string[];
}

/** Everything the supervisor does to the outside world goes through this. */
export interface SupervisorHost {
  /** A persisted, visible card that enters the model's context on its next turn
   *  but does not start one (a routine item completion). */
  card(text: string, evt: RaufEvent): void;
  /** Wake the session: a message that starts a model turn when idle. Only for
   *  exceptions and loop endings. */
  wake(text: string, evt: RaufEvent | null, level: "warning" | "info"): void;
  /** Footer + widget for a task; `null` clears them. */
  status(task: SupervisorTask, snapshot: LiveSnapshot | null): void;
  /** Persist the task record (session entry + file mirror). */
  persist(task: SupervisorTask): void;
  /** A `loop_error` / `loop_paused` arrived: the run may or may not be over —
   *  the host checks `rauf status --json` and calls `LoopSupervisor.end` if so. */
  checkEnded(task: SupervisorTask): void;
}
