import { execFile } from "node:child_process";
import * as path from "node:path";

import type {
  LoopStartOptions,
  LoopEvent,
  LoopState,
  Backlog,
  BacklogItem,
  IterationStatus,
} from "@ralph/core";
import {
  readBacklog,
  selectNextItem,
  updateItem,
  addItem,
  readMarkerFile,
  readClaudeOAuthToken,
  writeLoopState,
  appendLog,
  writeDoneFile,
  clearDoneFile,
  checkCancelRequested,
  clearCancelFile,
  sweepBacklog,
  writeIterationStatus,
  clearIterationStatus,
  resolveBacklogPaths,
  resolveInstructionPaths,
  ensureStateDir,
  acquireLock,
  releaseLock,
  type BacklogPaths,
  type InstructionPaths,
  type Result,
  ok,
} from "@ralph/core";

import { TypedEventEmitter } from "./events.js";
import { spawnClaude } from "./claude-process.js";
import type { ClaudeStreamEvent } from "./stream-parser.js";
import { parseSignal } from "./signal-parser.js";
import { buildPrompt, buildReviewPrompt } from "./prompt-builder.js";
import { checkUsageLimit, interruptibleSleep } from "./usage-checker.js";
import { gitCommit } from "./git-commit.js";

// ─── Types ──────────────────────────────────────────────────────────

/** Result returned when the loop finishes */
export interface LoopResult {
  completedCount: number;
  blockedCount: number;
  cancelled: boolean;
  gracefulStop?: boolean;
  reviewItemsCreated?: number;
  reviewSummary?: string;
}

/** Result of a review pass */
type ReviewPassResult = "clean" | "continue" | "failed";

/** How long without activity before we emit a stuck warning */
const STUCK_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

/** How often to check for stuckness */
const STUCK_CHECK_INTERVAL_MS = 60 * 1000; // 1 minute

/** Minimum interval between token_update event emissions */
const TOKEN_EVENT_THROTTLE_MS = 5_000;

/** Usage limit patterns detected in stderr (case-insensitive) */
const USAGE_LIMIT_PATTERNS = [
  "usage limit",
  "rate limit",
  "claude ai usage limit",
  "too many requests",
];

// ─── LoopRunner ─────────────────────────────────────────────────────

export class LoopRunner extends TypedEventEmitter {
  private readonly projectPath: string;
  private readonly paths: BacklogPaths;
  private instructionPaths!: InstructionPaths;
  private readonly options: LoopStartOptions;
  private readonly abortController: AbortController;
  private softCancelled = false;
  private iterationCount = 0;
  private completedCount = 0;
  private blockedCount = 0;
  private completedItemIds: string[] = [];
  private blockedItemIds: string[] = [];
  private currentItemId: string | null = null;
  private startedAt: string = "";
  private retryCounts: Map<string, number> = new Map();
  private baseCommitHash: string | null = null;
  private reviewItemsCreated = 0;
  private reviewSummary: string | null = null;

  /**
   * Create a new LoopRunner for the given project and options.
   * Resolves BacklogPaths from options.backlogRoot (or default .ralph/).
   */
  static create(projectPath: string, options: LoopStartOptions): Result<LoopRunner> {
    const backlogRoot = options.backlogRoot ?? path.join(projectPath, ".ralph");
    const pathsResult = resolveBacklogPaths(projectPath, backlogRoot);
    if (!pathsResult.ok) {
      return pathsResult;
    }
    return ok(new LoopRunner(projectPath, pathsResult.value, options));
  }

  private constructor(projectPath: string, paths: BacklogPaths, options: LoopStartOptions) {
    super();
    this.projectPath = projectPath;
    this.paths = paths;
    this.options = options;
    this.abortController = new AbortController();
  }

  /** Trigger graceful cancellation via AbortController signal */
  cancel(): void {
    this.abortController.abort();
  }

  /** Request graceful stop: finish current iteration, then exit. Does NOT kill the subprocess. */
  requestGracefulStop(): void {
    this.softCancelled = true;
  }

  /** Run the main loop. Resolves with LoopResult when done. */
  async start(): Promise<LoopResult> {
    this.startedAt = new Date().toISOString();

    // Capture git baseline commit hash for review diff
    this.baseCommitHash = await this.getHeadCommit();

    try {
      // (1) Ensure state directory exists
      const ensureResult = ensureStateDir(this.paths);
      if (!ensureResult.ok) {
        throw new Error(`Failed to create state directory: ${ensureResult.error.message}`);
      }

      // (2) Acquire lock
      const lockResult = acquireLock(this.paths);
      if (!lockResult.ok) {
        this.emitEvent("loop_error", { error: lockResult.error.message });
        return { completedCount: 0, blockedCount: 0, cancelled: false };
      }

      // (3) Resolve instruction paths
      this.instructionPaths = resolveInstructionPaths(this.paths);

      // (4) Clear DONE and CANCEL files at startup
      clearDoneFile(this.paths);
      clearCancelFile(this.paths);

      // (5) Log which backlog root is active
      const relativeRoot = path.relative(this.projectPath, this.paths.root);
      appendLog(this.paths, `Loop started (backlog root: ${relativeRoot || ".ralph"})`);

      // (6) Read .ralph.json marker for project-level options
      const markerResult = readMarkerFile(this.projectPath);
      let autoSweep = false;
      let sweepMinAgeDays = 0;
      let projectModel: string | undefined;

      if (markerResult.ok) {
        const opts = markerResult.value.options;
        autoSweep = opts.autoSweep ?? false;
        sweepMinAgeDays = opts.sweepMinAgeDays ?? 0;
        projectModel = opts.model;
      }

      // (3) Auto-sweep if enabled
      if (autoSweep) {
        appendLog(this.paths, "Auto-sweep enabled, sweeping completed items");
        sweepBacklog(this.paths, { minAgeDays: sweepMinAgeDays });
      }

      // Write initial state
      this.writeState("starting", null);

      // (4) Pre-loop usage limit preflight
      const preflightResult = await this.runUsagePreflight();
      if (preflightResult === "exit") {
        return { completedCount: 0, blockedCount: 0, cancelled: false };
      }

      // Emit loop_started
      this.emitEvent("loop_started", {
        maxIterations: this.options.maxIterations,
        model: this.options.model ?? projectModel,
      });
      appendLog(this.paths, `Loop started (maxIterations=${this.options.maxIterations})`);
      this.writeState("running", null);

      // (5) Main loop
      while (this.iterationCount < this.options.maxIterations) {
        if (this.isCancelled()) {
          appendLog(this.paths, "Loop cancelled");
          this.emitEvent("loop_cancelled", {});
          this.writeState("paused", null);
          writeDoneFile(this.paths, "cancel");
          return {
            completedCount: this.completedCount,
            blockedCount: this.blockedCount,
            cancelled: true,
            gracefulStop: this.softCancelled && !this.abortController.signal.aborted,
          };
        }

        const iterResult = await this.runIteration(projectModel);
        if (iterResult === "break") break;
        if (iterResult === "exit") {
          return {
            completedCount: this.completedCount,
            blockedCount: this.blockedCount,
            cancelled: this.isCancelled(),
          };
        }

        // Between iterations: check usage limits and cancellation
        if (this.iterationCount < this.options.maxIterations) {
          const betweenResult = await this.checkBetweenIterations();
          if (betweenResult === "exit") {
            return {
              completedCount: this.completedCount,
              blockedCount: this.blockedCount,
              cancelled: this.isCancelled(),
            };
          }
        }
      }

      // Review pass (if enabled and there are completed items)
      if (this.options.review && this.completedItemIds.length > 0 && !this.isCancelled()) {
        const reviewResult = await this.runReviewPass();

        if (reviewResult === "continue" && !this.options.reviewOnly) {
          // Re-enter iteration loop to process fix items (using remaining budget)
          while (this.iterationCount < this.options.maxIterations) {
            if (this.isCancelled()) break;

            const iterResult = await this.runIteration();
            if (iterResult === "break" || iterResult === "exit") break;

            // Between iterations check
            if (this.iterationCount < this.options.maxIterations) {
              const betweenResult = await this.checkBetweenIterations();
              if (betweenResult === "exit") break;
            }
          }
        }
      }

      // Loop ended
      if (this.iterationCount >= this.options.maxIterations) {
        // Max iterations reached
        appendLog(this.paths, `Max iterations reached (${this.options.maxIterations})`);
        this.writeState("limit_reached", null);
        this.emitEvent("loop_completed", {
          completedCount: this.completedCount,
          blockedCount: this.blockedCount,
        });
        const summary = this.buildSummary();
        writeDoneFile(this.paths, summary);
      } else {
        // No more items or loop completed naturally
        this.writeState("complete", null);
        this.emitEvent("loop_completed", {
          completedCount: this.completedCount,
          blockedCount: this.blockedCount,
        });
        const summary = this.buildSummary();
        writeDoneFile(this.paths, summary);
        appendLog(this.paths, "Loop completed");
      }

      return {
        completedCount: this.completedCount,
        blockedCount: this.blockedCount,
        cancelled: false,
        ...(this.reviewItemsCreated > 0 ? { reviewItemsCreated: this.reviewItemsCreated } : {}),
        ...(this.reviewSummary ? { reviewSummary: this.reviewSummary } : {}),
      };
    } catch (e) {
      // Crash cleanup: reset in_progress item to pending
      const errorMsg = e instanceof Error ? e.message : String(e);
      appendLog(this.paths, `Loop error: ${errorMsg}`);
      this.emitEvent("loop_error", { error: errorMsg });
      this.writeState("error", null, "error", errorMsg);
      throw e;
    } finally {
      // Reset in_progress item on crash/unexpected termination
      if (this.currentItemId) {
        try {
          updateItem(this.paths, this.currentItemId, {
            status: "pending",
          });
          appendLog(this.paths, `Reset item ${this.currentItemId} to pending (crash cleanup)`);
        } catch {
          // Best effort
        }
        this.currentItemId = null;
      }
      // Release lock
      releaseLock(this.paths);
    }
  }

  /**
   * Run a standalone review of already-completed items.
   * Does not run any fix iterations — just creates review items.
   */
  async startReviewOnly(): Promise<LoopResult> {
    this.startedAt = new Date().toISOString();
    this.baseCommitHash = await this.getHeadCommit();
    this.instructionPaths = resolveInstructionPaths(this.paths);

    // Read backlog and find all done items
    const backlogResult = readBacklog(this.paths);
    if (!backlogResult.ok) {
      appendLog(this.paths, `Failed to read backlog: ${backlogResult.error.message}`);
      return { completedCount: 0, blockedCount: 0, cancelled: false };
    }

    const doneItems = backlogResult.value.items.filter((i) => i.status === "done");
    if (doneItems.length === 0) {
      appendLog(this.paths, "No completed items to review");
      return { completedCount: 0, blockedCount: 0, cancelled: false };
    }

    // Use done item IDs for the review
    this.completedItemIds = doneItems.map((i) => i.id);

    const reviewResult = await this.runReviewPass();

    return {
      completedCount: 0,
      blockedCount: 0,
      cancelled: false,
      ...(this.reviewItemsCreated > 0 ? { reviewItemsCreated: this.reviewItemsCreated } : {}),
      ...(this.reviewSummary ? { reviewSummary: this.reviewSummary } : {}),
      ...(reviewResult === "clean" ? {} : {}),
    };
  }

  // ─── Iteration logic (extracted from main loop body) ──────────────

  /**
   * Execute a single iteration of the loop: select item, spawn Claude, handle signal.
   * Returns "continue" to keep looping, "break" to stop loop, or "exit" to return immediately.
   */
  private async runIteration(projectModel?: string): Promise<"continue" | "break" | "exit"> {
    this.iterationCount++;
    this.emitEvent("iteration_start", {
      iteration: this.iterationCount,
      maxIterations: this.options.maxIterations,
    });
    appendLog(
      this.paths,
      `--- Iteration ${this.iterationCount} / ${this.options.maxIterations} ---`,
    );

    // Select next item
    const backlogResult = readBacklog(this.paths);
    if (!backlogResult.ok) {
      appendLog(this.paths, `Failed to read backlog: ${backlogResult.error.message}`);
      this.emitEvent("loop_error", { error: backlogResult.error.message });
      return "break";
    }

    const backlog: Backlog = backlogResult.value;
    const item = selectNextItem(backlog);

    if (!item) {
      appendLog(this.paths, "No eligible items found, loop complete");
      return "break";
    }

    this.currentItemId = item.id;
    this.emitEvent("item_selected", {
      itemId: item.id,
      title: item.title,
      priority: item.priority,
    });
    appendLog(this.paths, `Selected item ${item.id}: ${item.title}`);

    // Mark item as in_progress
    const markResult = updateItem(this.paths, item.id, {
      status: "in_progress",
    });
    if (!markResult.ok) {
      appendLog(
        this.paths,
        `Failed to mark item ${item.id} in_progress: ${markResult.error.message}`,
      );
      return "break";
    }
    this.writeState("running", item.id);

    // Resolve model: item.model > options.model
    const resolvedModel = item.model ?? this.options.model ?? projectModel;

    // Build prompt
    // Re-read backlog since we just updated the item status
    const freshBacklog = readBacklog(this.paths);
    const promptBacklog = freshBacklog.ok ? freshBacklog.value : backlog;
    const promptResult = buildPrompt(this.paths, this.instructionPaths, item, promptBacklog);
    if (!promptResult.ok) {
      appendLog(this.paths, `Failed to build prompt: ${promptResult.error.message}`);
      // Reset item to pending since we couldn't process it
      updateItem(this.paths, item.id, { status: "pending" });
      this.currentItemId = null;
      return "continue";
    }

    // Spawn claude with streaming
    this.emitEvent("llm_spawned", {
      itemId: item.id,
      provider: "claude-cli",
      model: resolvedModel,
      timeoutMinutes: this.options.sessionTimeoutMinutes,
    });
    appendLog(
      this.paths,
      `Spawning claude for item ${item.id}${resolvedModel ? ` (model: ${resolvedModel})` : ""}`,
    );

    // Set up iteration status tracking
    let lastActivityAt = new Date().toISOString();
    let currentTool: string | null = null;
    const recentTools: string[] = [];
    let latestInputTokens = 0;
    let latestOutputTokens = 0;
    let lastTokenEventAt = 0;
    let stuckWarning = false;

    const iterStatus: IterationStatus = {
      itemId: item.id,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      currentTool: null,
      recentTools: [],
      tokens: { input: 0, output: 0 },
      lastActivityAt,
      stuckWarning: false,
    };
    writeIterationStatus(this.paths, iterStatus, true);

    // Stuck detection interval
    const stuckTimer = setInterval(() => {
      const silentMs = Date.now() - new Date(lastActivityAt).getTime();
      if (silentMs >= STUCK_THRESHOLD_MS && !stuckWarning) {
        stuckWarning = true;
        this.emitEvent("llm_stuck_warning", { itemId: item.id, silentMs });
        iterStatus.stuckWarning = true;
        iterStatus.updatedAt = new Date().toISOString();
        writeIterationStatus(this.paths, iterStatus);
      }
    }, STUCK_CHECK_INTERVAL_MS);

    const onStreamEvent = (event: ClaudeStreamEvent): void => {
      lastActivityAt = new Date().toISOString();
      stuckWarning = false;

      try {
        switch (event.type) {
          case "tool_start": {
            currentTool = event.toolName;
            recentTools.push(event.toolName);
            if (recentTools.length > 10) recentTools.shift();
            this.emitEvent("llm_tool_activity", {
              itemId: item.id,
              toolName: event.toolName,
              phase: "start",
            });
            break;
          }
          case "tool_end": {
            currentTool = null;
            this.emitEvent("llm_tool_activity", {
              itemId: item.id,
              toolName: "unknown",
              phase: "end",
            });
            break;
          }
          case "token_update": {
            latestInputTokens = event.inputTokens;
            latestOutputTokens = event.outputTokens;
            const now = Date.now();
            if (now - lastTokenEventAt >= TOKEN_EVENT_THROTTLE_MS) {
              lastTokenEventAt = now;
              this.emitEvent("llm_token_update", {
                itemId: item.id,
                inputTokens: event.inputTokens,
                outputTokens: event.outputTokens,
              });
            }
            break;
          }
        }

        // Update iteration status file
        iterStatus.currentTool = currentTool;
        iterStatus.recentTools = [...recentTools];
        iterStatus.tokens = { input: latestInputTokens, output: latestOutputTokens };
        iterStatus.lastActivityAt = lastActivityAt;
        iterStatus.stuckWarning = stuckWarning;
        iterStatus.updatedAt = new Date().toISOString();
        writeIterationStatus(this.paths, iterStatus);
      } catch {
        // Stream event handling must never crash the loop
      }
    };

    const claudeResult = await spawnClaude(promptResult.value, {
      sessionTimeoutMinutes: this.options.sessionTimeoutMinutes,
      model: resolvedModel,
      signal: this.abortController.signal,
      outputFormat: "stream-json",
      onStreamEvent,
    });

    clearInterval(stuckTimer);
    clearIterationStatus(this.paths);

    if (!claudeResult.ok) {
      appendLog(this.paths, `Failed to spawn claude: ${claudeResult.error.message}`);
      updateItem(this.paths, item.id, { status: "pending" });
      this.currentItemId = null;
      this.emitEvent("loop_error", { error: claudeResult.error.message });
      return "break";
    }

    const { exitCode, stdout, stderr, timedOut, durationMs, reconstructedText } =
      claudeResult.value;
    this.emitEvent("llm_exited", {
      itemId: item.id,
      provider: "claude-cli",
      exitCode,
      timedOut,
      durationMs,
    });
    appendLog(
      this.paths,
      `Claude exited (code=${exitCode}, timedOut=${timedOut}, duration=${Math.round(durationMs / 1000)}s)`,
    );

    // Check stderr for usage limit patterns BEFORE normal signal parsing
    if (exitCode !== 0 && this.hasUsageLimitInStderr(stderr)) {
      appendLog(this.paths, "Usage limit detected in stderr");
      // Reset item to pending
      updateItem(this.paths, item.id, { status: "pending" });
      this.currentItemId = null;

      // Check API for 5h vs 7d
      const stderrLimitResult = await this.handleStderrUsageLimit();
      if (stderrLimitResult === "exit") {
        return "exit";
      }
      // If we get here, we slept through a 5h limit and can continue
      return "continue";
    }

    // Parse signal — prefer reconstructed text from stream-json, fall back to raw stdout
    const signalText =
      reconstructedText && reconstructedText.length > 0 ? reconstructedText : stdout;
    const parsed = parseSignal(signalText);
    this.emitEvent("signal_parsed", {
      itemId: item.id,
      signal: parsed.signal === "review" ? "done" : parsed.signal,
      reason: parsed.reason,
    });
    appendLog(this.paths, `Signal: ${parsed.signal}${parsed.reason ? ` (${parsed.reason})` : ""}`);
    if (parsed.signal === "none") {
      const textSource =
        reconstructedText && reconstructedText.length > 0 ? "reconstructed" : "stdout";
      const preview = signalText.length > 500 ? `…${signalText.slice(-500)}` : signalText;
      appendLog(
        this.paths,
        `Signal text (source=${textSource}, len=${signalText.length}):\n${preview}`,
      );
    }

    // Handle signal
    switch (parsed.signal) {
      case "done": {
        updateItem(this.paths, item.id, { status: "done" });
        this.completedCount++;
        this.completedItemIds.push(item.id);
        this.emitEvent("item_completed", {
          itemId: item.id,
          title: item.title,
        });
        appendLog(this.paths, `Item ${item.id} completed: ${item.title}`);
        this.writeState("running", null, "clean");

        // Auto-commit
        const commitResult = await gitCommit(this.projectPath, item.id, item.title);
        if (commitResult.ok && commitResult.value.commitHash) {
          appendLog(this.paths, `Committed: ${commitResult.value.commitHash}`);
        }
        break;
      }

      case "blocked": {
        const reason = parsed.reason ?? "No reason provided";
        updateItem(this.paths, item.id, {
          status: "blocked",
          blockedReason: reason,
        });
        this.blockedCount++;
        this.blockedItemIds.push(item.id);
        this.emitEvent("item_blocked", {
          itemId: item.id,
          reason,
        });
        appendLog(this.paths, `Item ${item.id} blocked: ${reason}`);
        this.writeState("running", null, "blocked");
        break;
      }

      case "needs_human": {
        const reason = parsed.reason ?? "No reason provided";
        // IMPORTANT: Leave item as in_progress (do NOT reset)
        // Clear currentItemId so the finally block doesn't reset it to pending
        this.currentItemId = null;
        this.emitEvent("needs_human", {
          itemId: item.id,
          reason,
        });
        appendLog(this.paths, `Item ${item.id} needs human input: ${reason}`);
        this.writeState("paused_human", item.id, "needs_human");
        writeDoneFile(this.paths, `needs_human: ${reason}`);
        return "exit";
      }

      case "review":
      case "none": {
        // No signal — retry logic
        const retries = (this.retryCounts.get(item.id) ?? 0) + 1;
        this.retryCounts.set(item.id, retries);

        if (retries >= this.options.maxRetries) {
          // Max retries reached — mark as blocked
          const reason = `No signal after ${retries} attempts`;
          updateItem(this.paths, item.id, {
            status: "blocked",
            blockedReason: reason,
          });
          this.blockedCount++;
          this.blockedItemIds.push(item.id);
          this.emitEvent("item_blocked", {
            itemId: item.id,
            reason,
          });
          appendLog(this.paths, `Item ${item.id} blocked after ${retries} retries`);
          this.writeState("running", null, "error");
        } else {
          // Re-queue: reset to pending for retry
          updateItem(this.paths, item.id, { status: "pending" });
          this.emitEvent("item_retried", {
            itemId: item.id,
            attempt: retries,
            maxRetries: this.options.maxRetries,
          });
          appendLog(this.paths, `Item ${item.id} retry ${retries}/${this.options.maxRetries}`);
        }
        break;
      }
    }

    this.currentItemId = null;
    return "continue";
  }

  // ─── Review pass ──────────────────────────────────────────────────

  /** Run the post-loop review pass. Returns result indicating outcome. */
  private async runReviewPass(): Promise<ReviewPassResult> {
    appendLog(this.paths, "Starting review pass");
    this.emitEvent("review_started", {
      completedItemIds: [...this.completedItemIds],
    });
    this.writeState("reviewing", null);

    // Read completed items from backlog
    const backlogResult = readBacklog(this.paths);
    if (!backlogResult.ok) {
      const reason = `Failed to read backlog for review: ${backlogResult.error.message}`;
      appendLog(this.paths, reason);
      this.emitEvent("review_failed", { reason });
      return "failed";
    }

    const completedItems = backlogResult.value.items.filter(
      (i) => this.completedItemIds.includes(i.id) && i.status === "done",
    );

    if (completedItems.length === 0) {
      appendLog(this.paths, "No completed items to review");
      this.emitEvent("review_failed", { reason: "No completed items found" });
      return "failed";
    }

    // Get git diff
    const gitDiff = await this.getGitDiff();

    // Build review prompt
    const promptResult = buildReviewPrompt(
      this.paths,
      this.instructionPaths,
      completedItems,
      gitDiff,
    );
    if (!promptResult.ok) {
      const reason = `Failed to build review prompt: ${promptResult.error.message}`;
      appendLog(this.paths, reason);
      this.emitEvent("review_failed", { reason });
      return "failed";
    }

    // Resolve model
    const markerResult = readMarkerFile(this.projectPath);
    const projectModel = markerResult.ok ? markerResult.value.options.model : undefined;
    const resolvedModel = this.options.model ?? projectModel;

    appendLog(this.paths, "Spawning claude for review pass");

    // Spawn Claude with review prompt
    const claudeResult = await spawnClaude(promptResult.value, {
      sessionTimeoutMinutes: this.options.sessionTimeoutMinutes,
      model: resolvedModel,
      signal: this.abortController.signal,
    });

    if (!claudeResult.ok) {
      const reason = `Failed to spawn claude for review: ${claudeResult.error.message}`;
      appendLog(this.paths, reason);
      this.emitEvent("review_failed", { reason });
      return "failed";
    }

    const { stdout } = claudeResult.value;

    // Parse signal from review output
    const parsed = parseSignal(stdout);

    if (parsed.signal === "done") {
      appendLog(this.paths, "Review pass: clean — no issues found");
      this.emitEvent("review_completed", {
        itemsCreated: 0,
        summary: "No issues found",
      });
      return "clean";
    }

    if (parsed.signal === "review" && parsed.reviewPayload) {
      const batch = new Date().toISOString();
      let created = 0;

      for (const reviewItem of parsed.reviewPayload.items) {
        const result = addItem(this.paths, {
          type: reviewItem.type,
          priority: reviewItem.priority,
          title: reviewItem.title,
          description: reviewItem.description,
          acceptanceCriteria: reviewItem.acceptanceCriteria,
          source: "review",
          reviewBatch: batch,
        });
        if (result.ok) {
          created++;
          appendLog(this.paths, `Review created item: ${result.value.id} — ${reviewItem.title}`);
        }
      }

      this.reviewItemsCreated = created;
      this.reviewSummary = parsed.reviewPayload.summary;

      appendLog(
        this.paths,
        `Review pass complete: ${created} items created — ${parsed.reviewPayload.summary}`,
      );
      this.emitEvent("review_completed", {
        itemsCreated: created,
        summary: parsed.reviewPayload.summary,
      });

      return created > 0 ? "continue" : "clean";
    }

    // Other signal or parse failure — non-fatal
    const reason = `Review returned unexpected signal: ${parsed.signal}`;
    appendLog(this.paths, reason);
    this.emitEvent("review_failed", { reason });
    return "failed";
  }

  // ─── Git helpers ──────────────────────────────────────────────────

  /** Get current HEAD commit hash, or null if not a git repo */
  private async getHeadCommit(): Promise<string | null> {
    return new Promise((resolve) => {
      execFile("git", ["rev-parse", "HEAD"], { cwd: this.projectPath }, (error, stdout) => {
        if (error) {
          resolve(null);
        } else {
          resolve(stdout.trim());
        }
      });
    });
  }

  /** Get git diff from base commit to HEAD. Returns empty string if unavailable. */
  private async getGitDiff(): Promise<string> {
    if (!this.baseCommitHash) return "";

    return new Promise((resolve) => {
      execFile(
        "git",
        ["diff", `${this.baseCommitHash}..HEAD`],
        { cwd: this.projectPath, maxBuffer: 1024 * 1024 * 10 },
        (error, stdout) => {
          if (error) {
            resolve("");
          } else {
            resolve(stdout);
          }
        },
      );
    });
  }

  // ─── Private helpers ──────────────────────────────────────────────

  /** Check if cancellation has been requested via soft cancel, AbortController, or CANCEL file */
  private isCancelled(): boolean {
    if (this.softCancelled) return true;
    if (this.abortController.signal.aborted) return true;
    return checkCancelRequested(this.paths);
  }

  /** Emit a typed LoopEvent with base fields */
  private emitEvent<T extends LoopEvent["type"]>(
    type: T,
    payload: Omit<Extract<LoopEvent, { type: T }>, "type" | "timestamp" | "projectPath">,
  ): void {
    const event = {
      type,
      timestamp: new Date().toISOString(),
      projectPath: this.projectPath,
      ...payload,
    } as Extract<LoopEvent, { type: T }>;

    this.emit(type, event);
  }

  /** Write state.json via core helper */
  private writeState(
    status: LoopState["status"],
    currentItem: string | null,
    lastSignal?: LoopState["lastSignal"],
    error?: string,
  ): void {
    writeLoopState(this.paths, {
      status,
      iteration: this.iterationCount,
      maxIterations: this.options.maxIterations,
      currentItem,
      lastSignal: lastSignal ?? "clean",
      startedAt: this.startedAt,
      completedItems: this.completedItemIds,
      blockedItems: this.blockedItemIds,
      error: error ?? null,
    });
  }

  /** Check stderr for usage limit patterns (case-insensitive) */
  private hasUsageLimitInStderr(stderr: string): boolean {
    const lower = stderr.toLowerCase();
    return USAGE_LIMIT_PATTERNS.some((pattern) => lower.includes(pattern));
  }

  /** Run pre-loop usage limit preflight check */
  private async runUsagePreflight(): Promise<"continue" | "exit"> {
    const tokenResult = readClaudeOAuthToken();
    if (!tokenResult.ok) {
      // Can't read token — proceed with reactive-only detection
      appendLog(this.paths, "OAuth token unavailable, skipping usage preflight");
      return "continue";
    }

    const usageResult = await checkUsageLimit(tokenResult.value);

    if (!usageResult.limited) {
      return "continue";
    }

    if (usageResult.limitType === "7d") {
      // Weekly limit — write DONE and exit
      const resetsAt = usageResult.resetsAt ?? "unknown";
      appendLog(this.paths, `Weekly usage limit reached (resets at ${resetsAt})`);
      this.emitEvent("usage_limit_hit", {
        limitType: "7d",
        utilization: usageResult.utilization ?? 100,
      });
      this.writeState("weekly_limit", null);
      writeDoneFile(this.paths, `weekly_limit:${resetsAt}`);
      return "exit";
    }

    if (usageResult.limitType === "5h") {
      // 5-hour limit — sleep until reset
      const resetsAt = usageResult.resetsAt ?? "";
      const retryAfter = usageResult.retryAfter ?? 0;
      appendLog(
        this.paths,
        `5-hour usage limit reached, sleeping until ${resetsAt} (${retryAfter}s)`,
      );
      this.emitEvent("usage_limit_hit", {
        limitType: "5h",
        utilization: usageResult.utilization ?? 100,
      });
      this.emitEvent("sleep_start", {
        sleepUntil: resetsAt,
        reason: "5-hour usage limit",
      });
      this.writeState("sleeping_limit", null);

      await interruptibleSleep(retryAfter * 1000, this.abortController.signal, () =>
        this.writeState("sleeping_limit", null),
      );

      this.emitEvent("sleep_end", {});
      appendLog(this.paths, "Woke from usage limit sleep");

      if (this.isCancelled()) {
        appendLog(this.paths, "Loop cancelled during sleep");
        this.emitEvent("loop_cancelled", {});
        writeDoneFile(this.paths, "cancel");
        return "exit";
      }

      this.emitEvent("usage_limit_cleared", { limitType: "5h" });
    }

    return "continue";
  }

  /** Handle usage limit detected via stderr mid-loop */
  private async handleStderrUsageLimit(): Promise<"continue" | "exit"> {
    const tokenResult = readClaudeOAuthToken();
    if (!tokenResult.ok) {
      // Can't check API — treat as 5h limit with short sleep
      appendLog(this.paths, "OAuth token unavailable for usage check, sleeping 60s");
      this.emitEvent("usage_limit_hit", { limitType: "5h", utilization: 100 });
      this.emitEvent("sleep_start", {
        sleepUntil: new Date(Date.now() + 60_000).toISOString(),
        reason: "Usage limit (API unavailable)",
      });
      this.writeState("sleeping_limit", null);
      await interruptibleSleep(60_000, this.abortController.signal, () =>
        this.writeState("sleeping_limit", null),
      );
      this.emitEvent("sleep_end", {});
      if (this.isCancelled()) {
        writeDoneFile(this.paths, "cancel");
        return "exit";
      }
      return "continue";
    }

    const usageResult = await checkUsageLimit(tokenResult.value);

    if (!usageResult.limited) {
      // API says we're not limited — proceed
      return "continue";
    }

    if (usageResult.limitType === "7d") {
      // Weekly limit — exit
      const resetsAt = usageResult.resetsAt ?? "unknown";
      appendLog(this.paths, `Weekly usage limit detected (resets at ${resetsAt})`);
      this.emitEvent("usage_limit_hit", {
        limitType: "7d",
        utilization: usageResult.utilization ?? 100,
      });
      this.writeState("weekly_limit", null);
      writeDoneFile(this.paths, `weekly_limit:${resetsAt}`);
      return "exit";
    }

    // 5-hour limit — sleep
    const resetsAt = usageResult.resetsAt ?? "";
    const retryAfter = usageResult.retryAfter ?? 0;
    appendLog(
      this.paths,
      `5-hour usage limit detected, sleeping until ${resetsAt} (${retryAfter}s)`,
    );
    this.emitEvent("usage_limit_hit", {
      limitType: "5h",
      utilization: usageResult.utilization ?? 100,
    });
    this.emitEvent("sleep_start", {
      sleepUntil: resetsAt,
      reason: "5-hour usage limit (stderr)",
    });
    this.writeState("sleeping_limit", null);

    await interruptibleSleep(retryAfter * 1000, this.abortController.signal, () =>
      this.writeState("sleeping_limit", null),
    );

    this.emitEvent("sleep_end", {});
    appendLog(this.paths, "Woke from usage limit sleep");

    if (this.isCancelled()) {
      appendLog(this.paths, "Loop cancelled during sleep");
      writeDoneFile(this.paths, "cancel");
      return "exit";
    }

    this.emitEvent("usage_limit_cleared", { limitType: "5h" });
    return "continue";
  }

  /** Check usage limits between iterations */
  private async checkBetweenIterations(): Promise<"continue" | "exit"> {
    // Check cancellation
    if (this.isCancelled()) {
      appendLog(this.paths, "Loop cancelled between iterations");
      this.emitEvent("loop_cancelled", {});
      this.writeState("paused", null);
      writeDoneFile(this.paths, "cancel");
      return "exit";
    }

    const tokenResult = readClaudeOAuthToken();
    if (!tokenResult.ok) {
      return "continue";
    }

    const usageResult = await checkUsageLimit(tokenResult.value);
    if (!usageResult.limited) {
      return "continue";
    }

    if (usageResult.limitType === "7d") {
      const resetsAt = usageResult.resetsAt ?? "unknown";
      appendLog(this.paths, `Weekly usage limit hit between iterations (resets at ${resetsAt})`);
      this.emitEvent("usage_limit_hit", {
        limitType: "7d",
        utilization: usageResult.utilization ?? 100,
      });
      this.writeState("weekly_limit", null);
      writeDoneFile(this.paths, `weekly_limit:${resetsAt}`);
      return "exit";
    }

    // 5h limit — sleep
    const resetsAt = usageResult.resetsAt ?? "";
    const retryAfter = usageResult.retryAfter ?? 0;
    appendLog(this.paths, `5-hour usage limit between iterations, sleeping until ${resetsAt}`);
    this.emitEvent("usage_limit_hit", {
      limitType: "5h",
      utilization: usageResult.utilization ?? 100,
    });
    this.emitEvent("sleep_start", {
      sleepUntil: resetsAt,
      reason: "5-hour usage limit (between iterations)",
    });
    this.writeState("sleeping_limit", null);

    await interruptibleSleep(retryAfter * 1000, this.abortController.signal, () =>
      this.writeState("sleeping_limit", null),
    );

    this.emitEvent("sleep_end", {});
    appendLog(this.paths, "Woke from usage limit sleep");

    if (this.isCancelled()) {
      appendLog(this.paths, "Loop cancelled during sleep");
      writeDoneFile(this.paths, "cancel");
      return "exit";
    }

    this.emitEvent("usage_limit_cleared", { limitType: "5h" });
    return "continue";
  }

  /** Build a summary string for the DONE file */
  private buildSummary(): string {
    const parts: string[] = [];
    parts.push(`completed=${this.completedCount}`);
    parts.push(`blocked=${this.blockedCount}`);
    parts.push(`iterations=${this.iterationCount}`);
    if (this.completedItemIds.length > 0) {
      parts.push(`items=${this.completedItemIds.join(",")}`);
    }
    return parts.join(" ");
  }
}
