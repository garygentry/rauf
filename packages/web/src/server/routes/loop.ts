// ─── Loop API Routes ─────────────────────────────────────────────
//
// POST /api/projects/:id/loop/start  → Start a loop
// POST /api/projects/:id/loop/stop   → Graceful cancel
// GET  /api/projects/:id/loop/events → SSE stream of LoopEvent
//
// All mutation routes require X-Ralph-Request: true (enforced by
// app-level CSRF middleware).

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";

import {
  LoopStartOptionsSchema,
  readToolConfig,
  resolveRootDirectory,
  validatePath,
} from "@ralph/core";

import { errorResponse } from "../app.js";
import { getLoopManager } from "../loop-manager.js";
import { resolveProjectPath as resolveProjectPathShared } from "../resolve-project.js";

// ─── Request body schema ─────────────────────────────────────────

const StartLoopBodySchema = z
  .object({
    maxIterations: z.number().int().positive().optional(),
    maxRetries: z.number().int().positive().optional(),
    model: z.string().optional(),
    sessionTimeoutMinutes: z.number().int().positive().optional(),
  })
  .optional();

// ─── Default loop options ────────────────────────────────────────

const DEFAULT_MAX_ITERATIONS = 20;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_SESSION_TIMEOUT_MINUTES = 60;

// ─── SSE constants ───────────────────────────────────────────────

const SSE_HEARTBEAT_MS = 15_000;

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
    const options = LoopStartOptionsSchema.parse({
      maxIterations: body.maxIterations ?? DEFAULT_MAX_ITERATIONS,
      maxRetries: body.maxRetries ?? DEFAULT_MAX_RETRIES,
      model: body.model,
      sessionTimeoutMinutes: body.sessionTimeoutMinutes ?? DEFAULT_SESSION_TIMEOUT_MINUTES,
    });

    const manager = getLoopManager();
    const result = manager.startLoop(projectPath, options);

    if (!result.ok) {
      return c.json(errorResponse("CONFLICT", result.error), 409);
    }

    return c.json({ data: { started: true, projectPath } });
  });

  // ── POST /:id/loop/stop ───────────────────────────────────────

  router.post("/:id/loop/stop", (c) => {
    const id = c.req.param("id");
    const projectPath = resolveProjectPath(id);
    if (!projectPath) {
      return c.json(errorResponse("INVALID_ID", `Invalid project ID: ${id}`), 400);
    }
    const violation = validateProjectPath(projectPath);
    if (violation) {
      return c.json(errorResponse("PATH_VIOLATION", "Project ID escapes root directory"), 400);
    }

    const manager = getLoopManager();
    const stopped = manager.stopLoop(projectPath);

    if (!stopped) {
      return c.json(errorResponse("NOT_FOUND", "No active loop for this project"), 404);
    }

    return c.json({ data: { stopped: true, projectPath } });
  });

  // ── GET /:id/loop/events ──────────────────────────────────────
  //
  // SSE stream of LoopEvent objects. Each event is JSON-encoded.
  // Heartbeats sent every 30s to keep the connection alive.
  // Streams until client disconnects.

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

      // Subscribe to loop events for this project
      const manager = getLoopManager();
      const unsubscribe = manager.subscribe(projectPath, (event) => {
        if (stream.aborted || stream.closed) return;
        stream.writeSSE({ data: JSON.stringify(event), event: "loop_event" }).catch(() => {});
      });
      cleanups.push(unsubscribe);

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
