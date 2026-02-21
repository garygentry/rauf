// ─── Status API Routes ────────────────────────────────────────────
//
// /api/projects/:id/status   → DerivedStatus
// /api/projects/:id/log      → string[] (tail)
// /api/projects/:id/log/stream → SSE stream
// /api/projects/:id/progress → raw markdown
//
// All routes are read-only (GET), so no CSRF header required.

import * as fs from "node:fs";
import * as path from "node:path";

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import {
  deriveStatus,
  readLogTail,
  watchLog,
  validatePath,
  readToolConfig,
  resolveRootDirectory,
} from "@ralph/core";

import { errorResponse } from "../app.js";

// ─── Constants ────────────────────────────────────────────────────

const RALPH_DIR = ".ralph";
const PROGRESS_FILENAME = "progress.md";

/** How often to emit a heartbeat event (ms) */
const SSE_HEARTBEAT_MS = 30_000;

/** How often to poll deriveStatus for changes (ms) */
const SSE_STATUS_POLL_MS = 5_000;

// ─── createStatusRouter ───────────────────────────────────────────
//
// Returns a Hono router for status/log/progress routes.
// rootDirectoryOverride lets tests inject a controlled directory.

export function createStatusRouter(rootDirectoryOverride?: string): Hono {
  const router = new Hono();

  // ── Helpers ───────────────────────────────────────────────────

  function getRootDirectory(): string {
    if (rootDirectoryOverride !== undefined) return rootDirectoryOverride;
    const configResult = readToolConfig();
    return configResult.ok ? configResult.value.rootDirectory : resolveRootDirectory();
  }

  /**
   * Decode a raw `:id` param and build the absolute project path.
   * Returns null if the id contains illegal path components.
   */
  function resolveProjectPath(id: string): string | null {
    const decoded = decodeURIComponent(id);
    if (decoded.includes("/") || decoded.includes("\\") || decoded === "." || decoded === "..") {
      return null;
    }
    return path.join(getRootDirectory(), decoded);
  }

  /** Validate that a resolved path is within ROOT_DIRECTORY. Returns error code or null. */
  function validateProjectPath(projectPath: string): string | null {
    const rootDir = getRootDirectory();
    const pathResult = validatePath(projectPath, [rootDir]);
    return pathResult.ok ? null : pathResult.error.code;
  }

  // ── GET /:id/status ───────────────────────────────────────────
  //
  // Returns DerivedStatus for the project. Uses two-tier derivation:
  // state.json (primary) → log parsing fallback.
  // Always returns 200 — even NOT_INSTALLED is a valid derived state.

  router.get("/:id/status", (c) => {
    const id = c.req.param("id");
    const projectPath = resolveProjectPath(id);
    if (!projectPath) {
      return c.json(errorResponse("INVALID_ID", `Invalid project ID: ${id}`), 400);
    }
    const violation = validateProjectPath(projectPath);
    if (violation) {
      return c.json(errorResponse("PATH_VIOLATION", "Project ID escapes root directory"), 400);
    }

    const result = deriveStatus(projectPath);
    if (!result.ok) {
      return c.json(
        errorResponse(result.error.code, result.error.message, result.error.details),
        500,
      );
    }
    return c.json({ data: result.value });
  });

  // ── GET /:id/log/stream ───────────────────────────────────────
  //
  // SSE endpoint. Registered before /:id/log to avoid any ambiguity.
  //
  // Event types emitted:
  //   "log"       — array of new log lines (initial + incremental)
  //   "status"    — DerivedStatus (initial + on change detection)
  //   "heartbeat" — ISO timestamp (every 30s)
  //
  // Streams until client disconnects. Cleans up fs.watch handles
  // and timers via stream.onAbort().

  router.get("/:id/log/stream", (c) => {
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
      // abortPromise resolves when the client disconnects.
      // Hono calls stream.onAbort() when responseReadable.cancel() fires
      // (client disconnect) or when the request signal is aborted.
      let abortResolve: (() => void) | undefined;
      const abortPromise = new Promise<void>((r) => {
        abortResolve = r;
      });
      stream.onAbort(() => abortResolve?.());

      const cleanups: Array<() => void> = [];

      // ── Initial events ──────────────────────────────────────

      // 1. Send last 50 log lines immediately on connect
      const logResult = readLogTail(projectPath, 50);
      if (logResult.ok && logResult.value.length > 0) {
        await stream
          .writeSSE({ data: JSON.stringify(logResult.value), event: "log" })
          .catch(() => {});
      }

      // 2. Send current derived status on connect
      const statusResult = deriveStatus(projectPath);
      let lastStatusJson = "";
      if (statusResult.ok) {
        lastStatusJson = JSON.stringify(statusResult.value);
        await stream.writeSSE({ data: lastStatusJson, event: "status" }).catch(() => {});
      }

      // ── Live log watching ───────────────────────────────────
      //
      // watchLog uses fs.watch to detect new bytes in ralph.log.
      // If the log file doesn't exist yet, fs.watch throws — catch and skip.

      try {
        const stopLog = watchLog(projectPath, (newLines) => {
          if (stream.aborted || stream.closed) return;
          stream.writeSSE({ data: JSON.stringify(newLines), event: "log" }).catch(() => {});
        });
        cleanups.push(stopLog);
      } catch {
        // Log file does not exist yet — watching skipped
      }

      // ── Status change detection ─────────────────────────────
      //
      // Poll deriveStatus every 5s. Emit "status" only when it changes.

      const statusPoll = setInterval(() => {
        if (stream.aborted || stream.closed) return;
        const newStatusResult = deriveStatus(projectPath);
        if (newStatusResult.ok) {
          const json = JSON.stringify(newStatusResult.value);
          if (json !== lastStatusJson) {
            lastStatusJson = json;
            stream.writeSSE({ data: json, event: "status" }).catch(() => {});
          }
        }
      }, SSE_STATUS_POLL_MS);
      cleanups.push(() => clearInterval(statusPoll));

      // ── Heartbeat ───────────────────────────────────────────
      //
      // Use setInterval for heartbeat (every 30s). Cleanup registered
      // in cleanups so it's cleared when abortPromise resolves.

      const heartbeatInterval = setInterval(() => {
        if (stream.aborted || stream.closed) return;
        stream.writeSSE({ data: new Date().toISOString(), event: "heartbeat" }).catch(() => {});
      }, SSE_HEARTBEAT_MS);
      cleanups.push(() => clearInterval(heartbeatInterval));

      // ── Block until client disconnects ──────────────────────
      //
      // Await abortPromise so this callback stays alive (and the SSE
      // stream stays open) until the client disconnects.

      await abortPromise;

      // ── Cleanup ─────────────────────────────────────────────
      cleanups.forEach((fn) => fn());
    });
  });

  // ── GET /:id/log ──────────────────────────────────────────────
  //
  // Returns last N lines from ralph.log. ?tail=N controls line count
  // (default 50, max 10,000). Returns empty array when log is missing.

  router.get("/:id/log", (c) => {
    const id = c.req.param("id");
    const projectPath = resolveProjectPath(id);
    if (!projectPath) {
      return c.json(errorResponse("INVALID_ID", `Invalid project ID: ${id}`), 400);
    }
    const violation = validateProjectPath(projectPath);
    if (violation) {
      return c.json(errorResponse("PATH_VIOLATION", "Project ID escapes root directory"), 400);
    }

    const tailParam = c.req.query("tail");
    const tail = tailParam !== undefined ? parseInt(tailParam, 10) : 50;
    const lines = isNaN(tail) || tail <= 0 ? 50 : tail;

    const result = readLogTail(projectPath, lines);
    if (!result.ok) {
      return c.json(
        errorResponse(result.error.code, result.error.message, result.error.details),
        500,
      );
    }
    return c.json({ data: result.value });
  });

  // ── GET /:id/progress ─────────────────────────────────────────
  //
  // Returns the raw markdown content of .ralph/progress.md.
  // Returns { data: "" } when the file is missing (graceful handling).

  router.get("/:id/progress", (c) => {
    const id = c.req.param("id");
    const projectPath = resolveProjectPath(id);
    if (!projectPath) {
      return c.json(errorResponse("INVALID_ID", `Invalid project ID: ${id}`), 400);
    }
    const violation = validateProjectPath(projectPath);
    if (violation) {
      return c.json(errorResponse("PATH_VIOLATION", "Project ID escapes root directory"), 400);
    }

    const progressPath = path.join(path.resolve(projectPath), RALPH_DIR, PROGRESS_FILENAME);
    try {
      const content = fs.readFileSync(progressPath, "utf-8");
      return c.json({ data: content });
    } catch {
      // Missing file — return empty string (graceful handling)
      return c.json({ data: "" });
    }
  });

  return router;
}
