// ─── Loop API Routes ─────────────────────────────────────────────
//
// POST /api/projects/:id/loop/start  → Start a loop
// POST /api/projects/:id/loop/stop   → Graceful cancel
// GET  /api/projects/:id/loop/events → SSE stream of LoopEvent
//
// All mutation routes require X-Rauf-Request: true (enforced by
// app-level CSRF middleware).

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";

import {
  LoopStartOptionsSchema,
  readToolConfig,
  resolveRootDirectory,
  resolveBacklogRoot,
  resolveBacklogPaths,
  validatePath,
  readEvents,
  watchEvents,
  listActiveLoops,
} from "@rauf/core";

import { errorResponse } from "../app.js";
import {
  DEFAULT_MAX_RETRIES,
  DEFAULT_SESSION_TIMEOUT_MINUTES,
  resolveRequestMaxIterations,
} from "../loop-defaults.js";
import { getLoopManager } from "../loop-manager.js";
import { resolveProjectPath as resolveProjectPathShared } from "../resolve-project.js";

// ─── Request body schema ─────────────────────────────────────────

const StartLoopBodySchema = z
  .object({
    maxIterations: z.number().int().positive().optional(),
    maxRetries: z.number().int().positive().optional(),
    model: z.string().optional(),
    sessionTimeoutMinutes: z.number().int().positive().optional(),
    backlogRoot: z.string().optional(),
    suppressIterationReview: z.boolean().optional(),
  })
  .optional();

const StopLoopBodySchema = z
  .object({
    backlogRoot: z.string().optional(),
  })
  .optional();

// ─── SSE constants ───────────────────────────────────────────────

const SSE_HEARTBEAT_MS = 15_000;

// ─── createLoopsRouter ───────────────────────────────────────────
//
// GET /api/loops → list every live loop across the machine.
//
// Read-only; mounted at the top level (not under a project id) so the
// CLI can ask "is anything running anywhere?" before a server-wide
// stop/restart, which would otherwise cancel every project's loop.
//
// Sources from the reconciled active-loop registry (listActiveLoops),
// NOT the in-memory manager — so an in-process `rauf loop run` the
// server never started is still reported (REQ-WEB-03, REQ-DISC-05).
// listActiveLoops self-heals: a crashed loop that never deregistered is
// excluded and its stale entry unlinked, so the web never reports a dead
// loop as live. Degrade to an empty list on registry IO error.

export function createLoopsRouter(): Hono {
  const router = new Hono();

  router.get("/", (c) => {
    const result = listActiveLoops();
    const loops = result.ok ? result.value : [];
    return c.json({ data: { loops } });
  });

  return router;
}

// ─── createLoopRouter ────────────────────────────────────────────

export function createLoopRouter(rootDirectoryOverride?: string): Hono {
  const router = new Hono();

  // ── Helpers ───────────────────────────────────────────────────

  function getRootDirectory(): string {
    if (rootDirectoryOverride !== undefined) return rootDirectoryOverride;
    const configResult = readToolConfig();
    return configResult.ok ? configResult.value.rootDirectory : resolveRootDirectory();
  }

  function resolveProjectPath(id: string): string | null {
    return resolveProjectPathShared(id, getRootDirectory());
  }

  function validateProjectPath(projectPath: string): string | null {
    const rootDir = getRootDirectory();
    const pathResult = validatePath(projectPath, [rootDir]);
    return pathResult.ok ? null : pathResult.error.code;
  }

  // ── POST /:id/loop/start ──────────────────────────────────────

  router.post("/:id/loop/start", async (c) => {
    const id = c.req.param("id");
    const projectPath = resolveProjectPath(id);
    if (!projectPath) {
      return c.json(errorResponse("INVALID_ID", `Invalid project ID: ${id}`), 400);
    }
    const violation = validateProjectPath(projectPath);
    if (violation) {
      return c.json(errorResponse("PATH_VIOLATION", "Project ID escapes root directory"), 400);
    }

    // Parse optional body for loop options
    const raw = await c.req.json().catch(() => ({}));
    const parseResult = StartLoopBodySchema.safeParse(raw);
    if (!parseResult.success) {
      return c.json(
        errorResponse("VALIDATION_ERROR", "Invalid request body", parseResult.error.flatten()),
        400,
      );
    }

    const body = parseResult.data ?? {};

    // Resolve backlog root from body (relative path → absolute)
    let backlogRoot: string | undefined;
    if (body.backlogRoot) {
      const rootResult = resolveBacklogRoot(projectPath, body.backlogRoot);
      if (!rootResult.ok) {
        return c.json(errorResponse(rootResult.error.code, rootResult.error.message), 400);
      }
      backlogRoot = rootResult.value;
    }

    const options = LoopStartOptionsSchema.parse({
      maxIterations: resolveRequestMaxIterations(
        projectPath,
        body.maxIterations ?? null,
        backlogRoot,
      ),
      maxRetries: body.maxRetries ?? DEFAULT_MAX_RETRIES,
      model: body.model,
      sessionTimeoutMinutes: body.sessionTimeoutMinutes ?? DEFAULT_SESSION_TIMEOUT_MINUTES,
      backlogRoot,
      ...(body.suppressIterationReview ? { suppressIterationReview: true } : {}),
    });

    const manager = getLoopManager();
    const result = manager.startLoop(projectPath, options);

    if (!result.ok) {
      return c.json(errorResponse("CONFLICT", result.error), 409);
    }

    return c.json({ data: { started: true, projectPath } });
  });

  // ── POST /:id/loop/stop ───────────────────────────────────────

  router.post("/:id/loop/stop", async (c) => {
    const id = c.req.param("id");
    const projectPath = resolveProjectPath(id);
    if (!projectPath) {
      return c.json(errorResponse("INVALID_ID", `Invalid project ID: ${id}`), 400);
    }
    const violation = validateProjectPath(projectPath);
    if (violation) {
      return c.json(errorResponse("PATH_VIOLATION", "Project ID escapes root directory"), 400);
    }

    const raw = await c.req.json().catch(() => ({}));
    const parseResult = StopLoopBodySchema.safeParse(raw);
    const body = parseResult.success ? (parseResult.data ?? {}) : {};

    // Resolve backlog root if specified
    let resolvedRoot: string | undefined;
    if (body.backlogRoot) {
      const rootResult = resolveBacklogRoot(projectPath, body.backlogRoot);
      if (!rootResult.ok) {
        return c.json(errorResponse(rootResult.error.code, rootResult.error.message), 400);
      }
      resolvedRoot = rootResult.value;
    }

    const manager = getLoopManager();
    const stopped = manager.stopLoop(projectPath, resolvedRoot);

    if (!stopped) {
      return c.json(errorResponse("NOT_FOUND", "No active loop for this project"), 404);
    }

    return c.json({ data: { stopped: true, projectPath } });
  });

  // ── GET /:id/loop/events ──────────────────────────────────────
  //
  // SSE stream of PersistedEvent objects, sourced from the loop's
  // events.ndjson (NOT the in-memory manager buffer): replay the current
  // run's history via readEvents, then live-tail new appends via
  // watchEvents. This observes ANY loop — including an in-process
  // `rauf loop run` the server never started (REQ-WEB-01, REQ-OBS-04).
  // Each record is JSON-encoded under the `loop_event` SSE event.
  // Heartbeats keep the connection alive; streams until client disconnects.

  router.get("/:id/loop/events", (c) => {
    const id = c.req.param("id");
    const projectPath = resolveProjectPath(id);
    if (!projectPath) {
      return c.json(errorResponse("INVALID_ID", `Invalid project ID: ${id}`), 400);
    }
    const violation = validateProjectPath(projectPath);
    if (violation) {
      return c.json(errorResponse("PATH_VIOLATION", "Project ID escapes root directory"), 400);
    }

    return streamSSE(c, async (stream) => {
      let abortResolve: (() => void) | undefined;
      const abortPromise = new Promise<void>((r) => {
        abortResolve = r;
      });
      stream.onAbort(() => abortResolve?.());

      const cleanups: Array<() => void> = [];

      // Immediate heartbeat so the connection is active from the start
      await stream.writeSSE({ data: new Date().toISOString(), event: "heartbeat" });

      // 0. Resolve a full BacklogPaths. resolveBacklogRoot handles the optional
      //    ?backlog= query. A *resolution* failure is distinct from graceful
      //    *absence*: surface it to the client rather than silently tailing the
      //    DEFAULT root's events.ndjson, which would be the wrong root and
      //    re-introduce the cross-root "looking in the wrong place" footgun
      //    (REQ-DISC-01/02). Do NOT fall back to the default root here.
      const backlogParam = c.req.query("backlog");
      const rootResult = resolveBacklogRoot(projectPath, backlogParam);
      if (!rootResult.ok) {
        await stream.writeSSE({
          data: JSON.stringify({ error: rootResult.error }),
          event: "loop_error",
        });
        cleanups.forEach((fn) => fn());
        return;
      }

      // resolveBacklogPaths failure → graceful absence: a resolved root with no
      // backlog.json yet. Run a heartbeat-only stream (no replay, no tail); once
      // a backlog.json exists, a reconnect streams normally (REQ-REL-03).
      const pathsResult = resolveBacklogPaths(projectPath, rootResult.value);
      const paths = pathsResult.ok ? pathsResult.value : undefined;

      if (paths) {
        // 1. History replay (REQ-OBS-04): the current run's events.ndjson in seq
        //    order. Missing file → ok([]) (REQ-REL-03) → empty timeline, no error.
        const replay = readEvents(paths);
        if (replay.ok) {
          for (const record of replay.value) {
            if (stream.aborted || stream.closed) break;
            await stream.writeSSE({ data: JSON.stringify(record), event: "loop_event" });
          }
        }

        // 2. Live tail (REQ-WEB-01): watchEvents fires with newly-appended
        //    PersistedEvents. It throws synchronously if events.ndjson is absent
        //    (no file to watch yet); tolerate that — the heartbeat keeps the
        //    connection alive and a reconnect picks the file up once it exists.
        try {
          const stopTail = watchEvents(paths, (records) => {
            if (stream.aborted || stream.closed) return;
            for (const record of records) {
              stream
                .writeSSE({ data: JSON.stringify(record), event: "loop_event" })
                .catch(() => {});
            }
          });
          cleanups.push(stopTail);
        } catch {
          /* events.ndjson not present yet — heartbeat-only until reconnect */
        }
      }

      // Heartbeat every 15s
      const heartbeatInterval = setInterval(() => {
        if (stream.aborted || stream.closed) return;
        stream.writeSSE({ data: new Date().toISOString(), event: "heartbeat" }).catch(() => {});
      }, SSE_HEARTBEAT_MS);
      cleanups.push(() => clearInterval(heartbeatInterval));

      // Block until client disconnects
      await abortPromise;

      // Cleanup
      cleanups.forEach((fn) => fn());
    });
  });

  return router;
}
