// ─── LoopManager ─────────────────────────────────────────────────
//
// Singleton that tracks active loops by project path.
// - Max one loop per project
// - Creates LoopRunner instances, subscribes to their events
// - Fans events out to SSE clients via subscribe()
// - Handles graceful shutdown and stale loop recovery
//
// This is the bridge between the @ralph/loop runner module and the
// HTTP layer (Hono routes + SSE).

import type { LoopEvent, LoopStartOptions } from "@ralph/core";
import { discoverProjects, resetStalledItems } from "@ralph/core";
import { LoopRunner } from "@ralph/loop";
import type { LoopResult } from "@ralph/loop";

// ─── Types ──────────────────────────────────────────────────────

export type LoopEventListener = (event: LoopEvent) => void;

interface ActiveLoop {
  runner: LoopRunner;
  projectPath: string;
  /** Promise that resolves when the loop finishes */
  promise: Promise<LoopResult>;
}

// ─── All LoopEvent type discriminators ──────────────────────────

const LOOP_EVENT_TYPES: ReadonlyArray<LoopEvent["type"]> = [
  "loop_started",
  "iteration_start",
  "item_selected",
  "claude_spawned",
  "claude_exited",
  "signal_parsed",
  "item_completed",
  "item_blocked",
  "item_retried",
  "needs_human",
  "usage_limit_hit",
  "usage_limit_cleared",
  "sleep_start",
  "sleep_end",
  "loop_completed",
  "loop_error",
  "loop_cancelled",
];

// ─── LoopManager ─────────────────────────────────────────────────

export class LoopManager {
  /** Active loops keyed by resolved project path */
  private activeLoops = new Map<string, ActiveLoop>();

  /** Event listeners keyed by project path */
  private listeners = new Map<string, Set<LoopEventListener>>();

  /**
   * Start a loop for a project. Returns an error string if already running.
   */
  startLoop(
    projectPath: string,
    options: LoopStartOptions,
  ): { ok: true } | { ok: false; error: string } {
    if (this.activeLoops.has(projectPath)) {
      return { ok: false, error: "Loop already running for this project" };
    }

    const runner = new LoopRunner(projectPath, options);

    // Subscribe to all event types and fan out to listeners
    for (const eventType of LOOP_EVENT_TYPES) {
      runner.on(eventType, (event: LoopEvent) => {
        this.fanOut(projectPath, event);
      });
    }

    // Start the loop and track the promise
    const promise = runner.start().then(
      (result) => {
        this.activeLoops.delete(projectPath);
        return result;
      },
      (error) => {
        this.activeLoops.delete(projectPath);
        throw error;
      },
    );

    this.activeLoops.set(projectPath, { runner, projectPath, promise });
    return { ok: true };
  }

  /**
   * Stop a running loop for a project. Returns false if no loop is active.
   */
  stopLoop(projectPath: string): boolean {
    const active = this.activeLoops.get(projectPath);
    if (!active) return false;
    active.runner.cancel();
    return true;
  }

  /**
   * Subscribe to LoopEvents for a project. Returns an unsubscribe function.
   */
  subscribe(projectPath: string, listener: LoopEventListener): () => void {
    let set = this.listeners.get(projectPath);
    if (!set) {
      set = new Set();
      this.listeners.set(projectPath, set);
    }
    set.add(listener);

    return () => {
      set!.delete(listener);
      if (set!.size === 0) {
        this.listeners.delete(projectPath);
      }
    };
  }

  /**
   * Check if a loop is active for a project.
   */
  isRunning(projectPath: string): boolean {
    return this.activeLoops.has(projectPath);
  }

  /**
   * Recover stale loops on server startup.
   * Scans all discovered projects and resets any stale in_progress items.
   */
  async recoverStaleLoops(rootDirectory: string): Promise<void> {
    const discoveryResult = discoverProjects(rootDirectory);
    if (!discoveryResult.ok) return;

    for (const project of discoveryResult.value.projects) {
      resetStalledItems(project.path);
    }
  }

  /**
   * Gracefully cancel all active loops. Waits for them to finish.
   */
  async shutdownAll(): Promise<void> {
    const promises: Promise<unknown>[] = [];

    for (const [, active] of this.activeLoops) {
      active.runner.cancel();
      promises.push(active.promise.catch(() => {}));
    }

    await Promise.all(promises);
  }

  // ─── Private ───────────────────────────────────────────────────

  private fanOut(projectPath: string, event: LoopEvent): void {
    const set = this.listeners.get(projectPath);
    if (!set) return;
    for (const listener of set) {
      try {
        listener(event);
      } catch {
        // Best effort — don't let a broken listener crash the loop
      }
    }
  }
}

// ─── Singleton ──────────────────────────────────────────────────

let instance: LoopManager | undefined;

export function getLoopManager(): LoopManager {
  if (!instance) {
    instance = new LoopManager();
  }
  return instance;
}

/** Reset singleton (for testing) */
export function resetLoopManager(): void {
  instance = undefined;
}
