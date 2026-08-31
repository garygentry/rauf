import { execFile } from "node:child_process";
import * as path from "node:path";

import type {
  LoopStartOptions,
  LoopEvent,
  LoopState,
  Backlog,
  BacklogItem,
  IterationStatus,
  PersistedEvent,
} from "@rauf/core";
import {
  appendEvent,
  rotateEventsLog,
  registerLoop,
  deregisterLoop,
  updateLoopStatus,
  EVENTS_SCHEMA_VERSION,
  TOKEN_COALESCE_MS,
  readBacklog,
  selectNextItem,
  updateItem,
  addItem,
  readMarkerFile,
  readToolConfig,
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
  type RaufError,
  ok,
  err,
  ErrorCodes,
} from "@rauf/core";

import { TypedEventEmitter } from "./events.js";
// Import from the providers barrel (not registry.js directly) so the side-effect
// registrations of claude-cli + presets + generic-cli run before createProvider is called.
import {
  createProvider,
  getAgentDescriptors,
  detectAgent,
  CODEX_AGENT_ID,
} from "./providers/index.js";
import type { LLMProvider } from "./providers/types.js";
import { resolveAgentId } from "./agent-selection.js";
import type { ClaudeStreamEvent } from "./stream-parser.js";
import { parseSignal } from "./signal-parser.js";
import { buildPrompt, buildReviewPrompt } from "./prompt-builder.js";
import { hasUsageLimitInText, classifyExit } from "./exit-classifier.js";
import {
  annotateCodexSandboxHint,
  hasSandboxDenialSignature,
} from "./codex-sandbox-diagnostics.js";
import { checkUsageLimit, interruptibleSleep } from "./usage-checker.js";
import { gitCommit } from "./git-commit.js";
import { findItemCommit, isTreeClean } from "./git-reconcile.js";
import { execGit } from "./git-exec.js";
import { resolveChildEnv } from "./review-hooks.js";
import { redactSignalTokens, neutralizeForDetection } from "./signal-redactor.js";

// ─── Types ──────────────────────────────────────────────────────────

/** Result returned when the loop finishes */
export interface LoopResult {
  completedCount: number;
  blockedCount: number;
  needsHumanCount?: number;
  cancelled: boolean;
  gracefulStop?: boolean;
  reviewItemsCreated?: number;
  reviewSummary?: string;
  /** Set when the loop halted in paused_human via --pause-on-needs-human (item 008). */
  pausedReason?: "needs_human";
  /**
   * Set when the loop terminated in a usage/iteration-limit state
   * (limit_reached / weekly_limit / paused_usage_limit). Carries the LIMIT
   * terminal so `loop run` can map it to ExitCode.LIMIT (00-core-definitions §2a).
   * Analogous to `pausedReason` — a clearly-named optional carrier, not a shape change.
   */
  limitReached?: boolean;
  /**
   * Set by {@link failRunSetup} when pre-loop setup aborts the run before any
   * iteration (fail-fast agent detection or run-level provider resolution). Maps
   * to ExitCode.ERROR so an unavailable agent surfaces a NON-zero exit (REQ-DET-02,
   * SC-3). The human-readable error is on the emitted `loop_error` event; this is
   * just the carrier the CLI exit mapping keys on — analogous to `limitReached`.
   */
  setupFailed?: boolean;
}

/** Result of a review pass */
type ReviewPassResult = "clean" | "continue" | "failed";

/** How long without activity before we emit a stuck warning */
const STUCK_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

/** How often to check for stuckness */
const STUCK_CHECK_INTERVAL_MS = 60 * 1000; // 1 minute

/** Minimum interval between token_update event emissions */
const TOKEN_EVENT_THROTTLE_MS = 5_000;

/**
 * Truncates `text` to its trailing `n` characters, prefixed with an ellipsis
 * when truncated. Mirrors the existing usage-limit-banner preview truncation
 * (see the `signalText.slice(-500)` preview below) so infra_error /
 * genuine_retry diagnostics use the same convention: a tail is far more
 * likely than a head to contain a test-runner's pass/fail summary or a crash
 * trace (#74).
 */
function tail(text: string, n = 500): string {
  return text.length > n ? `…${text.slice(-n)}` : text;
}

// ─── LoopRunner ─────────────────────────────────────────────────────

export class LoopRunner extends TypedEventEmitter {
  private readonly projectPath: string;
  private readonly paths: BacklogPaths;
  private instructionPaths!: InstructionPaths;
  private readonly options: LoopStartOptions;
  /** Env overrides applied to every spawned child session (undefined = inherit parent). */
  private readonly childEnv: Record<string, string> | undefined;
  private readonly abortController: AbortController;
  private softCancelled = false;
  private iterationCount = 0;
  private completedCount = 0;
  private blockedCount = 0;
  private needsHumanCount = 0;
  private completedItemIds: string[] = [];
  private blockedItemIds: string[] = [];
  private needsHumanItemIds: string[] = [];
  /** Items the RUNTIME gave up on (no signal after retries) — distinct from genuine agent blocks. */
  private deferredItemIds: string[] = [];
  /** Consecutive infra_error exits; consumed by the circuit breaker (item 008). */
  private consecutiveInfraFailures = 0;
  private currentItemId: string | null = null;
  private startedAt: string = "";
  private retryCounts: Map<string, number> = new Map();
  private baseCommitHash: string | null = null;
  private reviewItemsCreated = 0;
  private reviewSummary: string | null = null;
  /** Set when --pause-on-needs-human halts the loop (item 008); surfaced on LoopResult. */
  private pausedReason: "needs_human" | null = null;
  /** Set when the loop wrote a terminal limit state; surfaced as LoopResult.limitReached. */
  private limitTerminal = false;
  /** Per-run dense sequence counter for persisted events (assigned only when a record is written). */
  private eventSeq = 0;
  /** Last wall-clock ms an llm_token_update was persisted to FILE (coalescing window). */
  private lastTokenPersistMs = 0;
  /** One provider instance per distinct resolved agent id, for the lifetime of one run (REQ-PERF-01). */
  private readonly providerCache = new Map<string, LLMProvider>();
  /** Project-level agent id, read once at loop start alongside projectModel (04 §5.1). */
  private projectProvider?: string;
  /** Global default agent id, read once at loop start (04 §5.1). */
  private globalProvider?: string;
  /**
   * Project-level generic adapter config (MarkerOptions.providerConfig, schemas.ts:149),
   * read once at loop start. Threaded into createProvider so the reserved `generic-cli`
   * id (and any config-driven factory) resolves its binary from the marker (03 §7.2).
   */
  private projectProviderConfig?: Record<string, unknown>;

  /**
   * Create a new LoopRunner for the given project and options.
   * Resolves BacklogPaths from options.backlogRoot (or default .rauf/).
   */
  static create(projectPath: string, options: LoopStartOptions): Result<LoopRunner> {
    const backlogRoot = options.backlogRoot ?? path.join(projectPath, ".rauf");
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
    this.childEnv = resolveChildEnv({
      suppressIterationReview: options.suppressIterationReview,
      childEnv: options.childEnv,
    });
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

      // (1b) Rotate the prior run's event log to archive and reset the per-run
      // seq counter BEFORE the first event is emitted, so each run's
      // events.ndjson starts clean at seq 0 (best-effort; Result discarded).
      rotateEventsLog(this.paths);
      this.eventSeq = 0;

      // (2) Acquire lock
      const lockResult = acquireLock(this.paths);
      if (!lockResult.ok) {
        this.emitEvent("loop_error", { error: lockResult.error.message });
        return { completedCount: 0, blockedCount: 0, cancelled: false };
      }

      // (2b) Register this loop in the machine-wide active-loop registry, AFTER
      // acquireLock succeeds so the .loop.lock ground truth already exists when
      // the entry is written (a reconciling reader never prunes a live loop).
      // Best-effort: the Result is discarded — a registry failure must never
      // abort or block the loop (state.json stays authoritative).
      registerLoop({
        stateDir: this.paths.stateDir,
        projectPath: this.projectPath,
        backlogRoot: this.paths.root,
        pid: process.pid,
        startedAt: this.startedAt,
        status: "starting",
      });

      // (3) Resolve instruction paths
      this.instructionPaths = resolveInstructionPaths(this.paths);

      // (4) Clear DONE and CANCEL files at startup
      clearDoneFile(this.paths);
      clearCancelFile(this.paths);

      // (5) Log which backlog root is active
      const relativeRoot = path.relative(this.projectPath, this.paths.root);
      appendLog(this.paths, `Loop started (backlog root: ${relativeRoot || ".rauf"})`);

      // Note when child sessions run with review hooks suppressed (single-gate
      // review model). Review then belongs at the gate over the cumulative diff.
      if (this.childEnv) {
        appendLog(
          this.paths,
          `Child sessions run with env overrides: ${Object.keys(this.childEnv).join(", ")}` +
            (this.options.suppressIterationReview
              ? " (per-iteration review hooks suppressed — review at the gate)"
              : ""),
        );
      }

      // (6) Read .rauf.json marker for project-level options
      const markerResult = readMarkerFile(this.projectPath);
      let autoSweep = false;
      let sweepMinAgeDays = 0;
      let projectModel: string | undefined;

      if (markerResult.ok) {
        const opts = markerResult.value.options;
        autoSweep = opts.autoSweep ?? false;
        sweepMinAgeDays = opts.sweepMinAgeDays ?? 0;
        projectModel = opts.model;
        this.projectProvider = opts.provider; // MarkerOptions.provider (schemas.ts:148)
        this.projectProviderConfig = opts.providerConfig; // MarkerOptions.providerConfig (schemas.ts:149)
      }
      // Read the global default agent once (ToolConfig.defaultProvider, schemas.ts:222).
      // Hoisted out of the iteration loop — it does not vary per item.
      const toolConfig = readToolConfig();
      this.globalProvider = toolConfig.ok ? toolConfig.value.defaultProvider : undefined;

      // (3) Auto-sweep if enabled
      if (autoSweep) {
        appendLog(this.paths, "Auto-sweep enabled, sweeping completed items");
        sweepBacklog(this.paths, { minAgeDays: sweepMinAgeDays });
      }

      // Pre-loop fail-fast detection (REQ-DET-02, SC-3). Runs FIRST — before any
      // state is written and before the usage preflight — so an unavailable agent
      // ends the run with no state.json, no backlog mutation, and no fallback to
      // claude. Read the (post-sweep) pending items for the per-item candidate set.
      const detectBacklog = readBacklog(this.paths);
      const pendingItems = detectBacklog.ok
        ? detectBacklog.value.items.filter((i) => i.status === "pending")
        : [];
      const detection = await this.detectAllCandidateAgents(pendingItems);
      if (!detection.ok) {
        return this.failRunSetup(detection.error);
      }

      // Resolve the run-level provider once (no per-item context). Loop-level usage
      // paths (preflight + between-iterations) gate on its checkUsage capability.
      const runProviderResult = this.resolveRunLevelProvider();
      if (!runProviderResult.ok) {
        return this.failRunSetup(runProviderResult.error);
      }
      const runProvider = runProviderResult.value;

      // Write initial state
      this.writeState("starting", null);

      // (4) Pre-loop usage limit preflight — claude-only (gated on checkUsage).
      if (runProvider.checkUsage) {
        const preflightResult = await this.runUsagePreflight();
        if (preflightResult === "exit") {
          return {
            completedCount: 0,
            blockedCount: 0,
            cancelled: false,
            ...(this.limitTerminal ? { limitReached: true } : {}),
          };
        }
      }

      // Emit loop_started
      this.emitEvent("loop_started", {
        maxIterations: this.options.maxIterations,
        model: this.options.model ?? projectModel,
      });
      appendLog(this.paths, `Loop started (maxIterations=${this.options.maxIterations})`);
      appendLog(
        this.paths,
        `Circuit breaker threshold: ${this.circuitBreakerThreshold} consecutive infra failures`,
      );
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
            ...(this.needsHumanCount > 0 ? { needsHumanCount: this.needsHumanCount } : {}),
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
            ...(this.needsHumanCount > 0 ? { needsHumanCount: this.needsHumanCount } : {}),
            cancelled: this.isCancelled(),
            ...(this.pausedReason ? { pausedReason: this.pausedReason } : {}),
            ...(this.limitTerminal ? { limitReached: true } : {}),
          };
        }

        // Between iterations: check usage limits and cancellation
        if (this.iterationCount < this.options.maxIterations) {
          const betweenResult = await this.checkBetweenIterations(!!runProvider.checkUsage);
          if (betweenResult === "exit") {
            return {
              completedCount: this.completedCount,
              blockedCount: this.blockedCount,
              cancelled: this.isCancelled(),
              ...(this.limitTerminal ? { limitReached: true } : {}),
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
              const betweenResult = await this.checkBetweenIterations(!!runProvider.checkUsage);
              if (betweenResult === "exit") break;
            }
          }
        }
      }

      // Loop ended
      if (this.iterationCount >= this.options.maxIterations && this.hasEligibleItems()) {
        // Iteration budget exhausted with work still to do — a clean, resumable
        // stop. NOT a usage limit: distinct state so it presents as success and
        // exits 0 (re-run to continue). If the budget landed exactly as the
        // backlog drained, hasEligibleItems() is false and we fall through to
        // `complete` below.
        appendLog(this.paths, `Iteration budget reached (${this.options.maxIterations})`);
        this.writeState("iterations_complete", null);
        this.emitEvent("loop_completed", {
          completedCount: this.completedCount,
          blockedCount: this.blockedCount,
          needsHumanCount: this.needsHumanCount,
        });
        const summary = this.buildSummary();
        writeDoneFile(this.paths, summary);
      } else {
        // No more items or loop completed naturally
        this.writeState("complete", null);
        this.emitEvent("loop_completed", {
          completedCount: this.completedCount,
          blockedCount: this.blockedCount,
          needsHumanCount: this.needsHumanCount,
        });
        const summary = this.buildSummary();
        writeDoneFile(this.paths, summary);
        appendLog(this.paths, "Loop completed");
      }

      return {
        completedCount: this.completedCount,
        blockedCount: this.blockedCount,
        ...(this.needsHumanCount > 0 ? { needsHumanCount: this.needsHumanCount } : {}),
        cancelled: false,
        ...(this.reviewItemsCreated > 0 ? { reviewItemsCreated: this.reviewItemsCreated } : {}),
        ...(this.reviewSummary ? { reviewSummary: this.reviewSummary } : {}),
        ...(this.limitTerminal ? { limitReached: true } : {}),
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
      // Deregister from the active-loop registry on every exit path (success,
      // error, cancel). Idempotent (unlink-if-exists) and best-effort — pairs
      // with releaseLock. A hard SIGKILL that skips this finally leaves a stale
      // entry that the next listActiveLoops() self-heals (dead pid).
      deregisterLoop(this.paths.stateDir);

      // Dispose every cached provider (REQ-PERF-01 lifecycle). dispose? is optional
      // (LLMProvider): claude-cli MAY implement it; CliAgent does NOT. Best-effort
      // and awaited; a rejecting dispose must never mask the original run outcome.
      for (const provider of this.providerCache.values()) {
        try {
          await provider.dispose?.();
        } catch {
          // best-effort: a failing dispose never changes the run's result or rethrows
        }
      }
      this.providerCache.clear();
    }
  }

  /**
   * Annotate a `blocked`/`needs_human` reason with the codex sandbox-denial hint when
   * applicable (#84, #95) — shared by both signal cases so the gate/combined-output text stays
   * identical between them. Annotate ONLY codex's own reasons — the hint would be misleading
   * for a provider with no such sandbox.
   */
  private annotateBlockedReason(
    provider: LLMProvider,
    rawReason: string,
    stdout: string,
    stderr: string,
    signalText: string,
  ): string {
    if (provider.id !== CODEX_AGENT_ID) return rawReason;
    return annotateCodexSandboxHint(rawReason, `${stdout}\n${stderr}\n${signalText}`);
  }

  /**
   * Resolve and construct the provider for one iteration. Per-item agent wins
   * (REQ-SEL-04), then run-level, then project, then global, then DEFAULT_AGENT_ID
   * (resolveAgentId, 04). Caches one instance per distinct agent id (REQ-PERF-01).
   * Wraps createProvider's throw-on-unknown-id into a Result error listing the
   * supported ids — never throws for an expected (mistyped/unknown) id.
   */
  private resolveProviderForItem(item: BacklogItem): Result<LLMProvider> {
    return this.resolveProvider(item);
  }

  /**
   * Resolve the run-level provider (no BacklogItem). Item-less sibling of
   * resolveProviderForItem: same precedence (minus itemProvider), same per-id
   * cache, same createProvider-throw → Result wrapping. Never throws.
   */
  private resolveRunLevelProvider(): Result<LLMProvider> {
    return this.resolveProvider();
  }

  /** Shared body for the per-item and run-level resolves (the two differ only in itemProvider). */
  private resolveProvider(item?: BacklogItem): Result<LLMProvider> {
    const agentId = resolveAgentId({
      itemProvider: item?.provider,
      runProvider: this.options.provider,
      projectProvider: this.projectProvider,
      globalProvider: this.globalProvider,
    });

    const cached = this.providerCache.get(agentId);
    if (cached) return ok(cached);

    // `this.projectProviderConfig` is ONE untyped blob associated with the project's single
    // declared `provider` (schemas.ts MarkerOptions: `provider` + `providerConfig` is a pair,
    // not a per-id map) — pass it ONLY when the resolved id IS that primary/default provider. A
    // per-item `provider` OVERRIDE has no config of its own; handing it the primary's (mismatched)
    // config could fail its factory's validation for a documented, otherwise-valid per-item
    // override (same root cause as the detectAllCandidateAgents fix above).
    const primaryAgentId = resolveAgentId({
      runProvider: this.options.provider,
      projectProvider: this.projectProvider,
      globalProvider: this.globalProvider,
    });
    const config = agentId === primaryAgentId ? this.projectProviderConfig : undefined;

    try {
      // `generic-cli` resolves its binary from the config (03 §7.2) and `codex` reads its typed
      // sandbox/network/approval config (#94); any factory that doesn't read the arg (claude-cli,
      // presets) simply ignores it.
      const provider = createProvider(agentId, config); // may throw on unknown id
      this.providerCache.set(agentId, provider);
      return ok(provider);
    } catch (e) {
      const ids = getAgentDescriptors()
        .map((d) => d.id)
        .join(", ");
      return err({
        code: ErrorCodes.VALIDATION_ERROR,
        message:
          `Unknown agent "${agentId}": ${e instanceof Error ? e.message : String(e)}. ` +
          `Supported agents: ${ids || "(none)"}.`,
      });
    }
  }

  /**
   * Probe every agent id that could drive this run (REQ-DET-02, SC-3). The
   * candidate set is the run-level resolved id PLUS every distinct per-item
   * provider among the pending backlog items. If ANY is unavailable, return an
   * AgentUnavailableError-shaped Result error (FILE_NOT_FOUND) naming the agent +
   * remediation + supported ids — WITHOUT writing state and with NO fallback to
   * claude. `detectAgent` never throws (an absent CLI is data).
   */
  private async detectAllCandidateAgents(
    pendingItems: readonly BacklogItem[],
  ): Promise<Result<void>> {
    const primaryAgentId = resolveAgentId({
      runProvider: this.options.provider,
      projectProvider: this.projectProvider,
      globalProvider: this.globalProvider,
    });
    const candidateIds = new Set<string>([primaryAgentId]);
    for (const item of pendingItems) {
      candidateIds.add(
        resolveAgentId({
          itemProvider: item.provider,
          runProvider: this.options.provider,
          projectProvider: this.projectProvider,
          globalProvider: this.globalProvider,
        }),
      );
    }

    for (const id of candidateIds) {
      // `this.projectProviderConfig` is ONE untyped blob associated with the project's single
      // declared `provider` (schemas.ts MarkerOptions: `provider` + `providerConfig` is a pair,
      // not a per-id map) — hand it ONLY to the primary/default agent's detect, so a config-aware
      // `detect` (generic-cli's binary resolution, codex's config validation, #94) fails setup
      // here before any state/backlog mutation (P1 review). A per-item `provider` OVERRIDE to a
      // different agent has no config of its own; passing the primary agent's (mismatched) config
      // to it would validate the wrong shape and could fatally fail setup for a documented,
      // otherwise-valid mixed-provider backlog (adversarial review finding).
      const config = id === primaryAgentId ? this.projectProviderConfig : undefined;
      const result = await detectAgent(id, config); // never throws
      if (result.available) continue;

      // Unavailable. Discriminate by capability (not by id), matching item 010's
      // usage-gating philosophy: an agent that owns its runtime usage/credential
      // handling (checkUsage present, e.g. claude-cli) degrades gracefully at loop
      // time (reactive banner detection when credentials are absent), so a
      // detect-unavailable here is NON-fatal — preserving committed behavior
      // (SC-2). A binary-gated CLI adapter (no checkUsage) that is unavailable is
      // a genuine fail-fast: its CLI is absent from PATH (REQ-DET-02, SC-3).
      let ownsUsage = false;
      try {
        ownsUsage = !!createProvider(id).checkUsage;
      } catch {
        ownsUsage = false; // unknown/unconstructable id → treat as fatal below
      }
      if (ownsUsage) {
        appendLog(
          this.paths,
          `Agent "${id}" reported unavailable (${result.detail ?? "no detail"}); ` +
            `continuing with runtime degradation`,
        );
        continue;
      }

      const ids = getAgentDescriptors()
        .map((d) => d.id)
        .join(", ");
      const descriptor = getAgentDescriptors().find((d) => d.id === id);
      const binary = descriptor?.binaryName ?? id;
      return err({
        code: ErrorCodes.FILE_NOT_FOUND,
        message:
          `Agent "${id}" is not available: ${result.detail ?? "not detected"}. ` +
          `Install it or ensure "${binary}" is on PATH. Supported agents: ${ids || "(none)"}.`,
      });
    }
    return ok(undefined);
  }

  /**
   * Abort the run during setup, before iteration 1 and before any state write
   * (REQ-DET-02, SC-3). Emits loop_error with the message and returns the
   * zero-iteration LoopResult. Writes NO state (no writeState, no backlog
   * mutation), so a failed setup leaves the project untouched.
   */
  private failRunSetup(error: RaufError): LoopResult {
    appendLog(this.paths, error.message);
    this.emitEvent("loop_error", { error: error.message });
    return { completedCount: 0, blockedCount: 0, cancelled: false, setupFailed: true };
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
   * Execute a single iteration of the loop: select item, spawn the agent, handle signal.
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

    // Resolve model: item.model > options.model > projectModel.
    // When `ignoreItemModel` is set (rauf loop run --no-model / --model none),
    // skip the per-item override so a backlog carrying Claude-only tier aliases
    // can run portably under a non-Claude --agent without editing backlog.json.
    const resolvedModel = this.options.ignoreItemModel
      ? (this.options.model ?? projectModel)
      : (item.model ?? this.options.model ?? projectModel);

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

    // Resolve the provider for this iteration (per-item agent wins, REQ-SEL-04).
    const providerResult = this.resolveProviderForItem(item);
    if (!providerResult.ok) {
      appendLog(this.paths, `Failed to resolve agent: ${providerResult.error.message}`);
      updateItem(this.paths, item.id, { status: "pending" });
      this.currentItemId = null;
      this.emitEvent("loop_error", { error: providerResult.error.message });
      return "continue";
    }
    const provider = providerResult.value;

    // Spawn the agent with streaming
    this.emitEvent("llm_spawned", {
      itemId: item.id,
      provider: provider.id,
      model: resolvedModel,
      timeoutMinutes: this.options.sessionTimeoutMinutes,
    });
    // #84 item 3: surface the provider's EFFECTIVE resolved execution policy (sandbox/network/
    // approval for codex) in run diagnostics, not just on a subsequent failure's blocked-reason
    // hint. Optional — most providers have no configurable execution policy to report.
    const configNote = provider.describeConfig ? ` [${provider.describeConfig()}]` : "";
    appendLog(
      this.paths,
      `Spawning ${provider.id} for item ${item.id}${resolvedModel ? ` (model: ${resolvedModel})` : ""}${configNote}`,
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

    const execResult = await provider.execute(promptResult.value, {
      outputFormat: "stream-json",
      onStreamEvent,
      signal: this.abortController.signal,
      model: resolvedModel,
      timeoutMinutes: this.options.sessionTimeoutMinutes,
      ...(this.childEnv ? { env: this.childEnv } : {}),
    });

    clearInterval(stuckTimer);
    clearIterationStatus(this.paths);

    if (!execResult.ok) {
      appendLog(this.paths, `Failed to spawn ${provider.id}: ${execResult.error.message}`);
      updateItem(this.paths, item.id, { status: "pending" });
      this.currentItemId = null;
      this.emitEvent("loop_error", { error: execResult.error.message });
      return "break";
    }

    const { exitCode, stdout, stderr, timedOut, durationMs, reconstructedText } = execResult.value;
    this.emitEvent("llm_exited", {
      itemId: item.id,
      provider: provider.id,
      exitCode,
      timedOut,
      durationMs,
    });
    appendLog(
      this.paths,
      `${provider.id} exited (code=${exitCode}, timedOut=${timedOut}, duration=${Math.round(durationMs / 1000)}s)`,
    );

    // Compute signal text — prefer reconstructed text from stream-json, fall back to raw stdout
    const signalText =
      reconstructedText && reconstructedText.length > 0 ? reconstructedText : stdout;

    // Check for usage-limit banners BEFORE normal signal parsing. The banner can
    // arrive in EITHER stderr OR the reconstructed stdout stream (the session-limit
    // banner lands in the stream), so scan BOTH. Otherwise a fast usage-limit
    // death falls through to signal 'none' and is wrongly retried then blocked.
    if (
      provider.checkUsage &&
      exitCode !== 0 &&
      (hasUsageLimitInText(stderr) || hasUsageLimitInText(signalText))
    ) {
      appendLog(this.paths, "Usage limit detected in claude output");
      // Reset item to pending
      updateItem(this.paths, item.id, { status: "pending" });
      this.currentItemId = null;
      // No work was done — this is an API rejection, not an attempt. Don't drain
      // the iteration budget on it (item 007).
      this.uncountIteration("usage_limited");

      // Check API for 5h vs 7d (pass the banner so the no-token path can parse
      // the reset time)
      const stderrLimitResult = await this.handleStderrUsageLimit(`${stderr}\n${signalText}`);
      if (stderrLimitResult === "exit") {
        return "exit";
      }
      // If we get here, we slept through a 5h limit and can continue
      return "continue";
    }

    // Neutralize any quoted/inline RAUF_* tokens before detection so they cannot
    // be mis-parsed as a real completion signal; a genuine final-line signal is
    // preserved (REQ-SEC-02).
    const parsed = parseSignal(neutralizeForDetection(signalText));
    this.emitEvent("signal_parsed", {
      itemId: item.id,
      signal: parsed.signal,
      reason: parsed.reason,
    });
    appendLog(this.paths, `Signal: ${parsed.signal}${parsed.reason ? ` (${parsed.reason})` : ""}`);
    if (parsed.signal === "none") {
      const textSource =
        reconstructedText && reconstructedText.length > 0 ? "reconstructed" : "stdout";
      const preview = redactSignalTokens(
        signalText.length > 500 ? `…${signalText.slice(-500)}` : signalText,
      );
      appendLog(
        this.paths,
        `Signal text (source=${textSource}, len=${signalText.length}):\n${preview}`,
      );
    }

    // Before recording any non-done outcome, reconcile committed work. An
    // iteration can pass verify and commit `[rauf] <id>:` (e.g. via the agent's
    // own commit or a commit hook) but die before printing RAUF_DONE (the
    // incident's item 003, committed yet marked blocked). If that commit landed
    // AND the tree is clean, the work IS done — record it as such instead of
    // blocking/deferring, and do NOT re-commit. The clean-tree requirement is
    // what distinguishes a genuinely-committed item from one that merely left
    // bookkeeping dirty, so a stale same-id commit in history cannot trigger a
    // false recovery. This runs for ALL non-done exit classes (blocked,
    // needs_human, timeout, infra_error, deferred, retry). (item 009)
    if (parsed.signal !== "done") {
      const recovered = await this.reconcileCommittedWork(item);
      if (recovered) {
        this.currentItemId = null;
        return "continue";
      }
    }

    // Handle signal
    switch (parsed.signal) {
      case "done": {
        this.consecutiveInfraFailures = 0;
        // The runner's completion is authoritative once the agent signals
        // RAUF_DONE. The item's on-disk status can be perturbed during the
        // iteration (observed: reverted to `pending`), and `pending -> done` is
        // not a valid direct transition — so a plain updateItem(done) would
        // silently fail (its Result was previously ignored), leaving the item
        // re-selectable and wedging the loop into re-running it forever. Re-assert
        // in_progress first (valid from pending, idempotent from in_progress),
        // then complete, and surface any residual failure instead of swallowing it.
        updateItem(this.paths, item.id, { status: "in_progress" });
        const doneResult = updateItem(this.paths, item.id, { status: "done" });
        if (!doneResult.ok) {
          appendLog(
            this.paths,
            `WARNING: could not mark item ${item.id} done: ${doneResult.error.message}`,
          );
        }
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
        this.consecutiveInfraFailures = 0;
        const reason = this.annotateBlockedReason(
          provider,
          parsed.reason ?? "No reason provided",
          stdout,
          stderr,
          signalText,
        );
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
        this.consecutiveInfraFailures = 0;
        const reason = this.annotateBlockedReason(
          provider,
          parsed.reason ?? "No reason provided",
          stdout,
          stderr,
          signalText,
        );
        // Set the item aside as blocked + needsHuman so it is NOT reselected
        // (selectNextItem only picks pending) and is distinguishable from a
        // code-level blocker. Do NOT halt the loop — keep working other
        // still-runnable items. Dependents of this item naturally stay pending
        // because their dependency is not done. The human resolves it and
        // re-runs (--retry-blocked / unblock, which clears the flag).
        updateItem(this.paths, item.id, {
          status: "blocked",
          blockedReason: reason,
          needsHuman: true,
        });
        this.needsHumanCount++;
        this.needsHumanItemIds.push(item.id);
        this.emitEvent("needs_human", {
          itemId: item.id,
          reason,
        });
        appendLog(this.paths, `Item ${item.id} needs human input (set aside): ${reason}`);

        // Opt-in pause mode (item 008): after setting the item aside, HALT so a
        // supervising session can detect the pause and inject an answer. Default
        // (flag off) keeps today's behavior — set aside and keep working other
        // runnable items.
        if (this.pauseOnNeedsHuman) {
          this.currentItemId = null;
          return this.haltForNeedsHuman(item.id);
        }

        this.writeState("running", null, "needs_human");
        break;
      }

      case "review":
      case "none": {
        // No explicit signal. A missing signal must NEVER, by itself, mark an
        // item blocked — classify WHY the spawn produced no signal and route on
        // that. usage_limited/infra_error are environmental deaths (item stays
        // pending); only a clean genuine_retry exhaustion DEFERS the item.
        // Downgrade a usage_limited classification to genuine_retry when the
        // iteration provider has no usage semantics (no checkUsage): a
        // "usage_limited" verdict there can only be a false substring match on
        // plain-text output, and must never route into the claude OAuth pause
        // path (REQ-USAGE-02). classifyExit/ExitClass themselves stay unchanged.
        const rawExitClass = classifyExit(execResult.value, parsed);
        const exitClass =
          !provider.checkUsage && rawExitClass === "usage_limited" ? "genuine_retry" : rawExitClass;

        // Diagnostic tails for infra_error/genuine_retry (#74): tail the same
        // `signalText` the signal parser and its "Signal text" preview logging
        // above already prefer, NOT raw `stdout` — in production both providers
        // run with `outputFormat: "stream-json"`, so raw stdout is an NDJSON
        // event stream, not human-readable text (see codex-cli.ts's
        // reconstructedText comment). Tailing raw stdout would surface an
        // unreadable JSON fragment instead of a diagnosable pass/fail summary or
        // crash trace. Raw `stderr` needs no such treatment: neither provider
        // routes stderr through stream-json reconstruction. Redact literal
        // RAUF_* signal tokens (matching the sibling "Signal text" preview a
        // few lines above) so raw agent output can't leak an unredacted
        // signal-shaped substring into logs/events.
        const stdoutTail = redactSignalTokens(tail(signalText));
        const stderrTail = redactSignalTokens(tail(stderr));
        switch (exitClass) {
          case "usage_limited": {
            // Belt-and-suspenders with the pre-signal usage check (item 005):
            // route environmental usage death to the sleep-or-exit handler.
            appendLog(this.paths, "Usage limit detected (post-signal classification)");
            updateItem(this.paths, item.id, { status: "pending" });
            this.currentItemId = null;
            // No-op death — don't charge the iteration budget (item 007).
            this.uncountIteration("usage_limited");
            const usageResult = await this.handleStderrUsageLimit(`${stderr}\n${signalText}`);
            return usageResult === "exit" ? "exit" : "continue";
          }

          case "timeout": {
            // An item-specific real attempt that ran out of time — a genuine block.
            const seconds = Math.round(durationMs / 1000);
            const reason = `Timed out after ${seconds}s`;
            updateItem(this.paths, item.id, {
              status: "blocked",
              blockedReason: reason,
            });
            this.consecutiveInfraFailures = 0;
            this.blockedCount++;
            this.blockedItemIds.push(item.id);
            this.emitEvent("item_blocked", { itemId: item.id, reason });
            appendLog(this.paths, `Item ${item.id} blocked: ${reason}`);
            this.writeState("running", null, "error");
            break;
          }

          case "infra_error": {
            // Fast non-zero exit with no usage banner — environmental death.
            // Leave the item pending and count the failure for the circuit
            // breaker (item 008). Do NOT block a real work item on a flaky spawn.
            this.consecutiveInfraFailures++;
            updateItem(this.paths, item.id, { status: "pending" });
            // A fast EPERM-shaped exit under codex is often its sandbox denying a subprocess
            // spawn (#84), not a flaky/genuine infra failure — hint at it in the log so repeated
            // circuit-breaker trips don't get misdiagnosed as environment noise unrelated to codex.
            const infraHint =
              provider.id === CODEX_AGENT_ID && hasSandboxDenialSignature(`${stdout}\n${stderr}`)
                ? " (possible Codex sandbox denial — see providerConfig.sandboxMode/networkAccess)"
                : "";
            // Surface the already-captured output so a flaky non-zero exit (e.g. a
            // test-runner crash unrelated to test results) is diagnosable from the
            // log alone — a fast infra death otherwise has zero output evidence
            // attached (#74). stdout first: a test runner's pass/fail summary is
            // typically there, while stderr more often carries a crash trace.
            appendLog(
              this.paths,
              `Item ${item.id} infra failure (consecutive=${this.consecutiveInfraFailures}); left pending${infraHint}\n` +
                `stdout tail: ${stdoutTail}\n` +
                `stderr tail: ${stderrTail}`,
            );
            // No work was done — don't drain the iteration budget on a flaky
            // spawn (item 007). The circuit breaker (item 008) bounds repeats.
            this.uncountIteration("infra_error");
            // Circuit breaker: when every spawn dies the same way, halt instead
            // of grinding through the whole budget. uncountIteration keeps the
            // iteration counter from advancing on infra deaths, so without this
            // the loop would spin indefinitely on a persistently broken spawn.
            if (this.consecutiveInfraFailures >= this.circuitBreakerThreshold) {
              this.currentItemId = null;
              return this.haltForCircuitBreaker();
            }
            break;
          }

          case "genuine_retry":
          default: {
            // A clean / long no-signal exit: genuinely retry up to maxRetries.
            this.consecutiveInfraFailures = 0;
            const retries = (this.retryCounts.get(item.id) ?? 0) + 1;
            this.retryCounts.set(item.id, retries);

            // Surface the already-captured output (via the shared stdoutTail/
            // stderrTail computed above) on both the retry and the eventual
            // exhausted-retries block, so a genuine_retry death (e.g. a flaky
            // non-zero gate exit) is diagnosable without re-running the
            // iteration (#74) — written to rauf.log same as infra_error, so
            // `rauf log` (text-only) surfaces it too, not just events.ndjson.
            if (retries >= this.options.maxRetries) {
              // Runner gives up — DEFER (a false block), not a genuine agent block.
              const reason = `No signal after ${retries} attempts (deferred by runner)`;
              updateItem(this.paths, item.id, {
                status: "blocked",
                blockedReason: reason,
                deferred: true,
              });
              this.deferredItemIds.push(item.id);
              this.emitEvent("item_blocked", { itemId: item.id, reason, stdoutTail, stderrTail });
              appendLog(
                this.paths,
                `Item ${item.id} deferred after ${retries} attempts\n` +
                  `stdout tail: ${stdoutTail}\n` +
                  `stderr tail: ${stderrTail}`,
              );
              this.writeState("running", null, "error");
            } else {
              // Re-queue: reset to pending for retry
              updateItem(this.paths, item.id, { status: "pending" });
              this.emitEvent("item_retried", {
                itemId: item.id,
                attempt: retries,
                maxRetries: this.options.maxRetries,
                stdoutTail,
                stderrTail,
              });
              appendLog(
                this.paths,
                `Item ${item.id} retry ${retries}/${this.options.maxRetries}\n` +
                  `stdout tail: ${stdoutTail}\n` +
                  `stderr tail: ${stderrTail}`,
              );
            }
            break;
          }
        }
        break;
      }
    }

    // A failed iteration that SET THE ITEM ASIDE (blocked / needs_human /
    // timeout / deferred — all end status "blocked") may have left
    // half-finished, uncommitted code in the tree. Since the loop now moves on
    // to a DIFFERENT item, revert that abandoned work so the next item never
    // starts on — and the next item's `git add -A` commit never sweeps up —
    // dead code. Outcomes that leave the item PENDING (infra_error, usage
    // retry, mid-retry) retry the SAME item next and must NOT have their tree
    // wiped here. Loop bookkeeping (.rauf/ and the backlog files) is always
    // preserved. (item 009)
    if (parsed.signal !== "done") {
      const after = readBacklog(this.paths);
      const status = after.ok ? after.value.items.find((i) => i.id === item.id)?.status : undefined;
      if (status === "blocked") {
        await this.revertAbandonedWork(item.id);
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

    // Resolve the run-level provider for the review pass (no per-item context).
    const providerResult = this.resolveRunLevelProvider();
    if (!providerResult.ok) {
      const reason = `Failed to resolve agent for review: ${providerResult.error.message}`;
      appendLog(this.paths, reason);
      this.emitEvent("review_failed", { reason });
      return "failed";
    }
    const provider = providerResult.value;

    const reviewConfigNote = provider.describeConfig ? ` [${provider.describeConfig()}]` : "";
    appendLog(this.paths, `Spawning ${provider.id} for review pass${reviewConfigNote}`);

    // Spawn the agent with the review prompt. outputFormat is intentionally OMITTED —
    // preserves today's text review behavior (tech-spec §3.2, SC-2).
    const execResult = await provider.execute(promptResult.value, {
      signal: this.abortController.signal,
      model: resolvedModel,
      timeoutMinutes: this.options.sessionTimeoutMinutes,
      ...(this.childEnv ? { env: this.childEnv } : {}),
    });

    if (!execResult.ok) {
      const reason = `Failed to spawn ${provider.id} for review: ${execResult.error.message}`;
      appendLog(this.paths, reason);
      this.emitEvent("review_failed", { reason });
      return "failed";
    }

    const { stdout } = execResult.value;

    // Parse signal from review output (neutralize quoted/inline tokens first, REQ-SEC-02)
    const parsed = parseSignal(neutralizeForDetection(stdout));

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

  /**
   * Reconcile committed-but-unsignalled work before a non-done outcome is
   * recorded. If a `[rauf] <id>:` commit for this item landed AND the working
   * tree is clean, the work is genuinely done despite the missing signal:
   * record it done (recovered_via_commit), without invoking gitCommit again.
   *
   * Returns true when the item was recovered to done, false otherwise (no
   * matching commit, a dirty tree, or a git error — all of which fall through to
   * the normal block/defer handling). (item 009)
   */
  private async reconcileCommittedWork(item: Backlog["items"][number]): Promise<boolean> {
    // Scope the search to commits made during THIS run (baseCommitHash..HEAD)
    // so a stale `[rauf] <id>:` commit from a prior backlog cycle can't recover
    // a fresh item (rauf restarts ids at 001 each backlog). When the baseline
    // is unavailable (not a git repo), fall back to an unscoped search.
    const commitResult = await findItemCommit(
      this.projectPath,
      item.id,
      this.baseCommitHash ?? undefined,
    );
    if (!commitResult.ok) {
      appendLog(
        this.paths,
        `Commit reconciliation skipped (git log failed): ${commitResult.error.message}`,
      );
      return false;
    }
    const commit = commitResult.value;
    if (!commit) {
      // No commit landed for this item — nothing to recover.
      return false;
    }

    const cleanResult = await isTreeClean(this.projectPath);
    if (!cleanResult.ok) {
      appendLog(
        this.paths,
        `Commit reconciliation skipped (git status failed): ${cleanResult.error.message}`,
      );
      return false;
    }
    if (!cleanResult.value) {
      // A matching commit exists but the tree is dirty — the work is NOT cleanly
      // landed (e.g. a stale same-id commit from a prior run plus uncommitted
      // bookkeeping). Don't recover; let the normal outcome stand.
      return false;
    }

    // The work landed but the signal was lost — record done. Do NOT re-commit
    // (the commit already exists).
    this.consecutiveInfraFailures = 0;
    updateItem(this.paths, item.id, { status: "done" });
    this.completedCount++;
    this.completedItemIds.push(item.id);
    this.emitEvent("item_completed", { itemId: item.id, title: item.title });
    appendLog(this.paths, `recovered_via_commit: ${commit.commitHash}`);
    appendLog(this.paths, `Item ${item.id} recovered from commit (signal lost): ${item.title}`);
    this.writeState("running", null, "clean");
    return true;
  }

  /**
   * Revert half-finished, uncommitted code left by a failed iteration, while
   * preserving all loop bookkeeping (everything under any `.rauf/` dir, and the
   * backlog files). Stashes the abandoned changes (a recoverable note) so the
   * next iteration starts from a clean tree and a later `git add -A` commit
   * can't sweep up the dead work. A no-op when only loop bookkeeping is dirty.
   * Best-effort: a git failure is logged, never thrown. (item 009)
   */
  private async revertAbandonedWork(itemId: string): Promise<void> {
    // Positive `.` plus exclude pathspecs so the loop's own state is never
    // touched. Scope the exclusions to THIS loop's resolved runtime dir and
    // backlog (+ .bak) — relative to projectPath — instead of a repo-wide
    // `**/backlog.json` glob, so an unrelated application file that happens to
    // be named backlog.json elsewhere in the tree is NOT preserved. (item 019)
    const stateDirRel = path.relative(this.projectPath, this.paths.stateDir);
    const backlogRel = path.relative(this.projectPath, this.paths.backlog);
    const pathspecs = [
      ".",
      `:(exclude)${stateDirRel}`,
      `:(exclude)${backlogRel}`,
      `:(exclude)${backlogRel}.bak`,
    ];
    try {
      const status = await execGit(this.projectPath, ["status", "--porcelain", "--", ...pathspecs]);
      if (status.trim() === "") {
        // Only loop bookkeeping is dirty (normal between iterations) — nothing
        // to revert.
        return;
      }
      await execGit(this.projectPath, [
        "stash",
        "push",
        "--include-untracked",
        "-m",
        `rauf: abandoned work from item ${itemId}`,
        "--",
        ...pathspecs,
      ]);
      appendLog(
        this.paths,
        `Reverted dirty working tree after item ${itemId} (stashed abandoned uncommitted work)`,
      );
    } catch (e) {
      appendLog(
        this.paths,
        `Failed to revert dirty tree after item ${itemId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
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

    this.persistEvent(event);
    this.emit(type, event);
  }

  /**
   * Best-effort persistence of a LoopEvent to events.ndjson. Token updates are
   * coalesced to at most ~1 per TOKEN_COALESCE_MS in the FILE (still emitted
   * in-memory). seq is dense and per-run — assigned only when a record is
   * actually written, so coalesced token updates consume no seq. appendEvent
   * never throws and its Result is intentionally discarded (best-effort): a
   * persistence failure must never perturb the loop.
   */
  private persistEvent(event: LoopEvent): void {
    if (event.type === "llm_token_update") {
      const now = Date.now();
      if (now - this.lastTokenPersistMs < TOKEN_COALESCE_MS) {
        return; // drop from FILE only; still emitted in-memory
      }
      this.lastTokenPersistMs = now;
    }

    const record: PersistedEvent = {
      ...event,
      seq: this.eventSeq++,
      schemaVersion: EVENTS_SCHEMA_VERSION,
    };
    void appendEvent(this.paths, record);
  }

  /** Write state.json via core helper */
  private writeState(
    status: LoopState["status"],
    currentItem: string | null,
    lastSignal?: LoopState["lastSignal"],
    error?: string,
  ): void {
    // Track whether the loop has settled into a terminal usage/iteration-limit
    // state so the resolved LoopResult can carry the LIMIT terminal (00 §2a).
    // sleeping_limit is transient (the loop resumes), so it is NOT terminal here;
    // re-entering a running/active state clears the flag.
    if (
      status === "limit_reached" ||
      status === "weekly_limit" ||
      status === "paused_usage_limit"
    ) {
      this.limitTerminal = true;
    } else if (status === "running" || status === "starting" || status === "reviewing") {
      this.limitTerminal = false;
    }
    writeLoopState(this.paths, {
      status,
      iteration: this.iterationCount,
      maxIterations: this.options.maxIterations,
      currentItem,
      lastSignal: lastSignal ?? "clean",
      startedAt: this.startedAt,
      completedItems: this.completedItemIds,
      blockedItems: this.blockedItemIds,
      deferredItems: this.deferredItemIds,
      baseCommitHash: this.baseCommitHash,
      error: error ?? null,
    });
    // Advisory registry refresh (REQ-OBS-02). state.json (just written) stays
    // authoritative; this keeps the cross-root summary's status roughly current.
    // Best-effort — Result discarded; a no-op when the entry does not yet exist.
    updateLoopStatus(this.paths.stateDir, status);
  }

  /**
   * Roll back the iteration counter for a no-op death (usage_limited /
   * infra_error). Iterations should count work attempts, not API rejections or
   * flaky spawns, so environmental failures must not drain the budget (item 007).
   */
  private uncountIteration(reason: string): void {
    if (this.iterationCount > 0) {
      this.iterationCount--;
    }
    appendLog(
      this.paths,
      `Iteration not counted (${reason}); budget preserved at ${this.iterationCount}/${this.options.maxIterations}`,
    );
  }

  /** Whether to sleep through a 5h usage limit (default) or halt cleanly. */
  private get sleepOnLimit(): boolean {
    return this.options.sleepOnLimit ?? true;
  }

  /** Whether RAUF_NEEDS_HUMAN halts the loop (opt-in) or just sets the item aside. */
  private get pauseOnNeedsHuman(): boolean {
    return this.options.pauseOnNeedsHuman ?? false;
  }

  /** Consecutive infra_error deaths that trip the circuit breaker (default 3). */
  private get circuitBreakerThreshold(): number {
    return this.options.circuitBreakerThreshold ?? 3;
  }

  /**
   * Halt the loop when consecutive infra failures reach the circuit-breaker
   * threshold (item 008). Writes an `error` state plus a DONE summary, emits a
   * loop_error, and signals the caller to exit. Without this, uncountIteration
   * (item 007) keeps the budget from advancing on infra deaths, so a
   * persistently broken spawn would otherwise spin the loop forever.
   */
  private haltForCircuitBreaker(): "exit" {
    const message = `Circuit breaker: ${this.consecutiveInfraFailures} consecutive infra failures — halting`;
    appendLog(this.paths, message);
    this.emitEvent("loop_error", { error: message });
    this.writeState("error", null, "error", message);
    // Include "error" so parseDoneFileState classifies the derived status ERROR.
    writeDoneFile(this.paths, `error: ${message}\n${this.buildSummary()}`);
    return "exit";
  }

  /**
   * Clean-halt the loop on a 5h usage limit when sleepOnLimit is false. Writes
   * the resumable `paused_usage_limit` state plus a DONE summary with a one-line
   * resume hint, then signals the caller to exit (item 007). The hint is
   * consumed by `rauf resume` (item 012).
   */
  /**
   * Clean-halt the loop when an item emits RAUF_NEEDS_HUMAN and the opt-in
   * `pauseOnNeedsHuman` mode is on (item 008). The item has already been set
   * aside (blocked + needsHuman) and the `needs_human` event emitted by the
   * caller; here we additionally emit `loop_paused`, write the resumable
   * `paused_human` state (clearing currentItem), and a DONE marker so
   * `parseDoneFileState` derives PAUSED_HUMAN. Returns "exit" so the loop stops.
   * Modeled on haltForUsageLimit. Consumed by a supervisor via `rauf resume
   * --answer` (item 009).
   */
  private haltForNeedsHuman(itemId: string): "exit" {
    this.pausedReason = "needs_human";
    this.emitEvent("loop_paused", { reason: "needs_human", itemId });
    appendLog(
      this.paths,
      `Loop paused for human input on item ${itemId} (--pause-on-needs-human). Run \`rauf resume --answer ${itemId} "<answer>"\`.`,
    );
    this.writeState("paused_human", null);
    writeDoneFile(this.paths, `paused_human: needs human input on item ${itemId}`);
    return "exit";
  }

  private haltForUsageLimit(resetsAt: string): "exit" {
    const reset = resetsAt || "unknown";
    appendLog(
      this.paths,
      `Usage limit reached; halting without sleep (sleepOnLimit=false). Run \`rauf resume\` after ${reset}.`,
    );
    this.emitEvent("usage_limit_hit", { limitType: "5h", utilization: 100 });
    this.writeState("paused_usage_limit", null);
    writeDoneFile(this.paths, `paused_usage_limit:${reset} — run \`rauf resume\``);
    return "exit";
  }

  /**
   * Compute milliseconds from now until the next occurrence of a banner reset
   * time like "5:30pm" / "5pm" / "11am", in local time. Returns null if the
   * string cannot be parsed. Used when the API is unavailable and the only
   * reset hint is the human-readable banner (item 007).
   */
  private msUntilResetTime(timeStr: string): number | null {
    const m = timeStr.match(/^(\d{1,2})(?::(\d{2}))?\s*([ap])m$/i);
    const hourStr = m?.[1];
    const meridiem = m?.[3];
    if (!hourStr || !meridiem) return null;

    let hour = parseInt(hourStr, 10);
    const minute = m?.[2] ? parseInt(m[2], 10) : 0;
    if (hour < 1 || hour > 12 || minute > 59) return null;

    const isPm = meridiem.toLowerCase() === "p";
    if (hour === 12) hour = 0;
    if (isPm) hour += 12;

    const now = new Date();
    const target = new Date(now);
    target.setHours(hour, minute, 0, 0);
    // If the reset clock time is at/before now, it refers to the next day
    // (e.g. now 11pm, reset 1am).
    if (target.getTime() <= now.getTime()) {
      target.setDate(target.getDate() + 1);
    }
    return target.getTime() - now.getTime();
  }

  /** Run pre-loop usage limit preflight check */
  private async runUsagePreflight(): Promise<"continue" | "exit"> {
    const tokenResult = readClaudeOAuthToken();
    if (!tokenResult.ok) {
      const { code, message } = tokenResult.error;
      appendLog(
        this.paths,
        `OAuth token unavailable (${code}: ${message}). ` +
          `Ensure Claude Code is authenticated (token: ~/.claude/.credentials.json → .claudeAiOauth.accessToken). ` +
          `Relying on reactive banner detection.`,
      );
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
      // 5-hour limit. Clean halt instead of sleeping when sleepOnLimit is false.
      const resetsAt = usageResult.resetsAt ?? "";
      if (!this.sleepOnLimit) {
        return this.haltForUsageLimit(resetsAt);
      }
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

  /**
   * Handle a usage limit detected mid-loop. `bannerText` is the claude output
   * the limit was detected in — used to parse a reset time when the API token
   * is unavailable (item 007).
   */
  private async handleStderrUsageLimit(bannerText?: string): Promise<"continue" | "exit"> {
    const tokenResult = readClaudeOAuthToken();
    if (!tokenResult.ok) {
      // Can't hit the API for an exact reset. Parse the reset time out of the
      // banner if present and sleep until then (plus a small buffer); else 60s.
      const RESET_BUFFER_MS = 60_000;
      const FALLBACK_MS = 60_000;
      const timeStr = bannerText?.match(/resets\s+(\d{1,2}(?::\d{2})?\s*[ap]m)/i)?.[1];
      let sleepMs = FALLBACK_MS;
      let resetsAt = "";
      if (timeStr) {
        const untilMs = this.msUntilResetTime(timeStr);
        if (untilMs !== null) {
          sleepMs = untilMs + RESET_BUFFER_MS;
          resetsAt = timeStr;
        }
      }

      // Clean halt instead of sleeping when sleepOnLimit is false.
      if (!this.sleepOnLimit) {
        return this.haltForUsageLimit(resetsAt);
      }

      appendLog(
        this.paths,
        `OAuth token unavailable for usage check, sleeping ${Math.round(sleepMs / 1000)}s` +
          (resetsAt ? ` (banner reset ${resetsAt})` : " (60s fallback)"),
      );
      this.emitEvent("usage_limit_hit", { limitType: "5h", utilization: 100 });
      this.emitEvent("sleep_start", {
        sleepUntil: new Date(Date.now() + sleepMs).toISOString(),
        reason: resetsAt
          ? `Usage limit (API unavailable, banner reset ${resetsAt})`
          : "Usage limit (API unavailable)",
      });
      this.writeState("sleeping_limit", null);
      await interruptibleSleep(sleepMs, this.abortController.signal, () =>
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

    // 5-hour limit. Clean halt instead of sleeping when sleepOnLimit is false.
    const resetsAt = usageResult.resetsAt ?? "";
    if (!this.sleepOnLimit) {
      return this.haltForUsageLimit(resetsAt);
    }

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

  /**
   * Check usage limits between iterations. The cancellation check is ALWAYS run
   * (cancellation must work for every agent). The Anthropic usage portion is gated
   * on `checkUsage` — the run-level provider's capability (REQ-USAGE-02): a
   * non-claude run skips the OAuth read and usage check entirely.
   */
  private async checkBetweenIterations(checkUsage: boolean): Promise<"continue" | "exit"> {
    // Check cancellation (NOT gated — orthogonal to usage)
    if (this.isCancelled()) {
      appendLog(this.paths, "Loop cancelled between iterations");
      this.emitEvent("loop_cancelled", {});
      this.writeState("paused", null);
      writeDoneFile(this.paths, "cancel");
      return "exit";
    }

    // Non-claude run-level agent: no usage semantics — skip cleanly.
    if (!checkUsage) {
      return "continue";
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

    // 5h limit. Clean halt instead of sleeping when sleepOnLimit is false.
    const resetsAt = usageResult.resetsAt ?? "";
    if (!this.sleepOnLimit) {
      return this.haltForUsageLimit(resetsAt);
    }
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
  /**
   * Whether the backlog still has an item the loop could pick up — used at
   * budget exhaustion to tell a genuine "stopped early, work remains" stop
   * (`iterations_complete`) from "budget landed exactly as the backlog drained"
   * (`complete`). Mirrors the selection the main loop uses (selectNextItem only
   * returns pending/eligible items); a read failure is treated as "no eligible
   * items" so we never falsely claim outstanding work.
   */
  private hasEligibleItems(): boolean {
    const backlogResult = readBacklog(this.paths);
    if (!backlogResult.ok) return false;
    return selectNextItem(backlogResult.value) !== null;
  }

  private buildSummary(): string {
    const parts: string[] = [];
    parts.push(`completed=${this.completedCount}`);
    parts.push(`blocked=${this.blockedCount}`);
    parts.push(`iterations=${this.iterationCount}`);
    if (this.completedItemIds.length > 0) {
      parts.push(`items=${this.completedItemIds.join(",")}`);
    }
    // Only emit the needs_human token when there genuinely are set-aside human
    // items. parseDoneFileState classifies any "human" substring as
    // PAUSED_HUMAN, so a guarded push keeps clean runs classified COMPLETE.
    if (this.needsHumanCount > 0) {
      parts.push(`needs_human=${this.needsHumanCount}`);
      parts.push(`needs_human_items=${this.needsHumanItemIds.join(",")}`);
    }
    // Items the runner deferred (no signal after retries). The "deferred" token
    // contains no human/limit/error substring, so parseDoneFileState still
    // classifies an otherwise-clean run as COMPLETE.
    if (this.deferredItemIds.length > 0) {
      parts.push(`deferred=${this.deferredItemIds.length}`);
      parts.push(`deferred_items=${this.deferredItemIds.join(",")}`);
    }
    return parts.join(" ");
  }
}
