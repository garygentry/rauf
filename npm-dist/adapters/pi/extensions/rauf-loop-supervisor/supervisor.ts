/**
 * LoopSupervisor — turns a stream of rauf events into host actions, with
 * exactly-once reporting across session restarts.
 *
 * Reporting rule (rauf #154):
 *   - `item_completed` → one card (persisted, visible, no model turn);
 *   - other significant events (blocked, needs-human, stuck, review failure,
 *     loop error / pause, long sleep, weekly limit) → wake the session;
 *   - `loop_completed` / `loop_cancelled` → wake with a close-out prompt, clear
 *     the footer, stop watching.
 * Significance and card text come from rauf's shared card module (vendored as
 * item-card.ts), so the lines match `rauf loop wait` and `rauf follow`.
 *
 * Dedup + reattach: rauf events carry a dense per-run `seq`. A task persists the
 * highest seq it surfaced (`lastSeq`). On reattach the tailer re-reads the log
 * from the top; records with `seq <= lastSeq` rebuild state silently, later ones
 * are surfaced. A run that ENDED while no session watched is reported once as
 * stale instead of replaying every card and wake.
 */

import {
  formatLoopEndedCard,
  formatSupervisionCard,
  isRunEndingEvent,
  isSignificantEvent,
} from "./item-card.js";
import type { LiveSnapshot, RaufEvent, SupervisorHost, SupervisorTask } from "./types.js";

/** How many cards the widget keeps. */
export const RECENT_CARDS = 5;

/** A live watch handle: `poll()` on file change, `close()` on teardown. */
export interface TaskHandle {
  poll(): void;
  close(): void;
  readonly stateDir: string;
}

interface ActiveTask {
  task: SupervisorTask;
  done: number;
  /** Highest item_completed seq counted into `done` (guards re-read double counts). */
  doneCursor: number;
  total?: number;
  currentItem?: string;
  health: LiveSnapshot["health"];
  recentCards: string[];
  closed: boolean;
  /** Non-null while replaying a reattached task's backlog of unseen events. */
  replay: RaufEvent[] | null;
}

export class LoopSupervisor {
  private readonly active = new Map<string, ActiveTask>();

  constructor(private readonly host: SupervisorHost) {}

  isActive(stateDir: string): boolean {
    return this.active.has(stateDir);
  }

  /** Current progress of a task (for the status tool and tests). */
  progress(stateDir: string): (LiveSnapshot & { closed: boolean }) | null {
    const a = this.active.get(stateDir);
    return a ? { ...this.snapshot(a), closed: a.closed } : null;
  }

  task(stateDir: string): SupervisorTask | null {
    return this.active.get(stateDir)?.task ?? null;
  }

  /**
   * Begin (or reattach) supervision of one task. A second attach for the same
   * stateDir returns a no-op handle (no duplicate watchers). With `reattach`,
   * unseen events found by the first poll are held until {@link endReplay}, so a
   * run that finished while nobody watched is reported once, as stale.
   */
  attach(
    task: SupervisorTask,
    makeReader: (onRecord: (rec: RaufEvent) => void, onRotate: () => void) => { poll(): void },
    opts: { reattach?: boolean } = {},
  ): TaskHandle {
    if (this.active.has(task.stateDir)) {
      return { stateDir: task.stateDir, poll: () => {}, close: () => this.detach(task.stateDir) };
    }
    const entry: ActiveTask = {
      task: { ...task },
      done: 0,
      doneCursor: -1,
      total: task.total,
      health: "healthy",
      recentCards: [],
      closed: task.closed,
      replay: opts.reattach ? [] : null,
    };
    this.active.set(task.stateDir, entry);
    const reader = makeReader(
      (rec) => this.handleRecord(task.stateDir, rec),
      () => this.handleRotate(task.stateDir),
    );
    return {
      stateDir: task.stateDir,
      poll: () => reader.poll(),
      close: () => this.detach(task.stateDir),
    };
  }

  /**
   * Finish a reattach replay. If the held events include the run's end, report
   * one stale summary (the run finished while no session was attached);
   * otherwise surface them as if live.
   */
  endReplay(stateDir: string): void {
    const entry = this.active.get(stateDir);
    if (!entry || entry.replay === null) return;
    const held = entry.replay;
    entry.replay = null;
    const ending = held.find((e) => isRunEndingEvent(e as never));
    if (ending) {
      const at = typeof ending.timestamp === "string" ? ending.timestamp : "an unknown time";
      const text =
        `rauf loop: the run finished at ${at} while no session was attached — ` +
        `${formatSupervisionCard(ending as never)}. ` +
        `Read rauf_loop_status for the authoritative final state, then do the close-out.`;
      this.markSeen(entry, held);
      this.close(entry, text);
      return;
    }
    for (const e of held) this.dispatch(entry, e);
  }

  /** Stop tracking a task in memory. Never touches the detached runner. */
  detach(stateDir: string): void {
    this.active.delete(stateDir);
  }

  /**
   * The host found the run over without a run-ending event (after a
   * `loop_error` / `loop_paused`, or a crash): wake once and stop.
   */
  end(stateDir: string, loopState: string): void {
    const entry = this.active.get(stateDir);
    if (!entry || entry.closed) return;
    const card = formatLoopEndedCard(
      loopState,
      entry.total !== undefined ? { done: entry.done, total: entry.total } : undefined,
    );
    this.close(
      entry,
      `rauf loop: ${card}. Read rauf_loop_status for the authoritative state and decide.`,
    );
  }

  private snapshot(a: ActiveTask): LiveSnapshot {
    return {
      done: a.done,
      total: a.total,
      currentItem: a.currentItem,
      health: a.health,
      recentCards: [...a.recentCards],
    };
  }

  private handleRecord(stateDir: string, rec: RaufEvent): void {
    const entry = this.active.get(stateDir);
    if (!entry || entry.closed) return;
    const seq = typeof rec.seq === "number" ? rec.seq : null;

    // Live state is rebuilt from every record, seen or not.
    this.track(entry, rec, seq);

    if (!isSignificantEvent(rec as never)) {
      if (["item_selected", "sleep_start", "sleep_end", "llm_stuck_warning"].includes(rec.type)) {
        if (entry.replay === null) this.host.status(entry.task, this.snapshot(entry));
      }
      return;
    }
    const card = this.cardFor(entry, rec);
    entry.recentCards.push(card);
    if (entry.recentCards.length > RECENT_CARDS) entry.recentCards.shift();

    if (seq !== null && seq <= entry.task.lastSeq) return; // replayed history: silent
    if (entry.replay !== null) {
      entry.replay.push(rec);
      return;
    }
    this.dispatch(entry, rec);
  }

  private track(entry: ActiveTask, rec: RaufEvent, seq: number | null): void {
    switch (rec.type) {
      case "item_selected":
        entry.currentItem = typeof rec.itemId === "string" ? rec.itemId : undefined;
        entry.health = "healthy";
        break;
      case "item_completed":
        if (seq === null || seq > entry.doneCursor) {
          entry.done = typeof rec.doneCount === "number" ? rec.doneCount : entry.done + 1;
          if (typeof rec.totalCount === "number") entry.total = rec.totalCount;
          if (seq !== null) entry.doneCursor = seq;
        }
        entry.currentItem = undefined;
        entry.health = "healthy";
        break;
      case "llm_stuck_warning":
        entry.health = "stuck";
        break;
      case "sleep_start":
        entry.health = "sleeping";
        break;
      case "sleep_end":
        entry.health = "healthy";
        break;
    }
  }

  private cardFor(entry: ActiveTask, rec: RaufEvent): string {
    const progress =
      entry.total !== undefined ? { done: entry.done, total: entry.total } : undefined;
    return formatSupervisionCard(rec as never, progress);
  }

  private dispatch(entry: ActiveTask, rec: RaufEvent): void {
    const card = this.cardFor(entry, rec);
    if (isRunEndingEvent(rec as never)) {
      this.markSeen(entry, [rec]);
      this.close(
        entry,
        `rauf loop: ${card}. Read rauf_loop_status for the authoritative final state, then do the close-out.`,
        rec,
      );
      return;
    }
    if (rec.type === "item_completed") {
      this.host.card(card, rec);
    } else {
      this.host.wake(
        `rauf loop: ${card}. The loop is still being supervised; check rauf_loop_status before acting.`,
        rec,
        "warning",
      );
      if (rec.type === "loop_error" || rec.type === "loop_paused") this.host.checkEnded(entry.task);
    }
    this.markSeen(entry, [rec]);
    this.host.status(entry.task, this.snapshot(entry));
  }

  private markSeen(entry: ActiveTask, recs: RaufEvent[]): void {
    let advanced = false;
    for (const r of recs) {
      if (typeof r.seq === "number" && r.seq > entry.task.lastSeq) {
        entry.task.lastSeq = r.seq;
        advanced = true;
      }
    }
    if (advanced) this.host.persist({ ...entry.task });
  }

  private close(entry: ActiveTask, text: string, evt: RaufEvent | null = null): void {
    entry.closed = true;
    entry.task.closed = true;
    this.host.persist({ ...entry.task });
    this.host.wake(text, evt, "info");
    this.host.status(entry.task, null);
  }

  /** rauf rotated the log (a new run, seq restarts at 0): reset per-run state. */
  private handleRotate(stateDir: string): void {
    const entry = this.active.get(stateDir);
    if (!entry) return;
    entry.task.lastSeq = -1;
    entry.doneCursor = -1;
    entry.done = 0;
    entry.currentItem = undefined;
    entry.health = "healthy";
    entry.recentCards = [];
    entry.closed = false;
    entry.task.closed = false;
    this.host.persist({ ...entry.task });
  }
}
