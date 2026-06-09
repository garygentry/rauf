// ─── LoopManager ─────────────────────────────────────────────────
//
// Singleton that tracks active loops by project path.
// - Max one loop per project
// - Creates LoopRunner instances, subscribes to their events
// - Fans events out to SSE clients via subscribe()
// - Handles graceful shutdown and stale loop recovery
//
// This is the bridge between the @rauf/loop runner module and the
// HTTP layer (Hono routes + SSE).

import * as path from "node:path";

import type { LoopEvent, LoopStartOptions } from "@rauf/core";
import { discoverProjects, resetStalledItems, defaultBacklogPaths } from "@rauf/core";
import { LoopRunner } from "@rauf/loop";
import type { LoopResult } from "@rauf/loop";

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
  "llm_spawned",
  "llm_exited",
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

const MAX_BUFFER_SIZE = 100;

// ─── LoopManager ─────────────────────────────────────────────────

export class LoopManager {
  /** Active loops keyed by resolved backlog root path */
  private activeLoops = new Map<string, ActiveLoop>();

  /** Event listeners keyed by backlog root path */
  private listeners = new Map<string, Set<LoopEventListener>>();

  /** Buffered events keyed by backlog root path (ring buffer, max MAX_BUFFER_SIZE) */
  private eventBuffers = new Map<string, LoopEvent[]>();

  /** Pending buffer cleanup timers */
  private bufferCleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /** Resolve the map key from projectPath + optional backlogRoot */
  private resolveKey(projectPath: string, backlogRoot?: string): string {
    return backlogRoot ?? path.join(projectPath, ".rauf");
  }

  /**
   * Start a loop for a project. Returns an error string if already running.
   */
  startLoop(
    projectPath: string,
    options: LoopStartOptions,
  ): { ok: true } | { ok: false; error: string } {
    const key = this.resolveKey(projectPath, options.backlogRoot);

    if (this.activeLoops.has(key)) {
      return { ok: false, error: "Loop already running for this backlog root" };
    }

    const runnerResult = LoopRunner.create(projectPath, options);
    if (!runnerResult.ok) {
      return { ok: false, error: runnerResult.error.message };
    }
    const runner = runnerResult.value;

    // Subscribe to all event types and fan out to listeners
    for (const eventType of LOOP_EVENT_TYPES) {
      runner.on(eventType, (event: LoopEvent) => {
        this.fanOut(key, event);
      });
    }

    // Start the loop and track the promise
    const promise = runner.start().then(
      (result) => {
        this.activeLoops.delete(key);
        this.deferBufferCleanup(key);
        return result;
      },
      (error) => {
        this.activeLoops.delete(key);
        this.deferBufferCleanup(key);
        throw error;
      },
    );

    this.activeLoops.set(key, { runner, projectPath, promise });
    return { ok: true };
  }

  /**
   * Stop a running loop for a project. Returns false if no loop is active.
   */
  stopLoop(projectPath: string, backlogRoot?: string): boolean {
    const key = this.resolveKey(projectPath, backlogRoot);
    const active = this.activeLoops.get(key);
    if (!active) return false;
    active.runner.cancel();
    return true;
  }

  /**
   * Subscribe to LoopEvents for a project. Returns an unsubscribe function.
   */
  subscribe(projectPath: string, listener: LoopEventListener, backlogRoot?: string): () => void {
    const key = this.resolveKey(projectPath, backlogRoot);

    // Replay buffered events to the new subscriber
    const buffer = this.eventBuffers.get(key);
    if (buffer) {
      for (const event of buffer) {
        try {
          listener(event);
        } catch {
          // Best effort
        }
      }
    }

    let set = this.listeners.get(key);
    if (!set) {
      set = new Set();
      this.listeners.set(key, set);
    }
    set.add(listener);

    return () => {
      set!.delete(listener);
      if (set!.size === 0) {
        this.listeners.delete(key);
      }
    };
  }

  /**
   * Check if a loop is active for a project.
   */
  isRunning(projectPath: string, backlogRoot?: string): boolean {
    const key = this.resolveKey(projectPath, backlogRoot);
    return this.activeLoops.has(key);
  }

  /**
   * Recover stale loops on server startup.
   * Scans all discovered projects and resets any stale in_progress items.
   */
  async recoverStaleLoops(rootDirectory: string): Promise<void> {
    const discoveryResult = discoverProjects(rootDirectory);
    if (!discoveryResult.ok) return;

    for (const project of discoveryResult.value.projects) {
      resetStalledItems(defaultBacklogPaths(project.path));
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

    // Clear all buffers and cancel cleanup timers
    this.eventBuffers.clear();
    for (const timer of this.bufferCleanupTimers.values()) {
      clearTimeout(timer);
    }
    this.bufferCleanupTimers.clear();
  }

  // ─── Private ───────────────────────────────────────────────────

  private fanOut(key: string, event: LoopEvent): void {
    // Buffer the event (ring buffer)
    this.bufferEvent(key, event);

    const set = this.listeners.get(key);
    if (!set) return;
    for (const listener of set) {
      try {
        listener(event);
      } catch {
        // Best effort — don't let a broken listener crash the loop
      }
    }
  }

  private deferBufferCleanup(key: string): void {
    // Cancel any existing timer for this key
    const existing = this.bufferCleanupTimers.get(key);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.eventBuffers.delete(key);
      this.bufferCleanupTimers.delete(key);
    }, 30_000);
    this.bufferCleanupTimers.set(key, timer);
  }

  private bufferEvent(key: string, event: LoopEvent): void {
    let buffer = this.eventBuffers.get(key);
    if (!buffer) {
      buffer = [];
      this.eventBuffers.set(key, buffer);
    }
    buffer.push(event);
    if (buffer.length > MAX_BUFFER_SIZE) {
      buffer.splice(0, buffer.length - MAX_BUFFER_SIZE);
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
