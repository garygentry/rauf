import { Hono } from "hono";
import { VERSION, readToolConfig, resolveRootDirectory, discoverProjects } from "@rauf/core";
import { createProjectsRouter } from "./routes/projects.js";
import { createStatusRouter } from "./routes/status.js";
import { createLoopRouter, createLoopsRouter } from "./routes/loop.js";
import { createProfileRouter, createConfigRouter } from "./routes/profile-config.js";

// ─── Types ────────────────────────────────────────────────────────

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

export interface ApiErrorResponse {
  error: ApiError;
}

// ─── Helpers ─────────────────────────────────────────────────────

export function errorResponse(code: string, message: string, details?: unknown): ApiErrorResponse {
  const error: ApiError = { code, message };
  if (details !== undefined) {
    error.details = details;
  }
  return { error };
}

// ─── App factory ─────────────────────────────────────────────────
//
// createApp() is exported for testing. The default export `app` is
// the instance used by the server entry point.

export interface AppOptions {
  /** Override ROOT_DIRECTORY (useful for tests) */
  rootDirectory?: string;
}

export function createApp(startedAt: number = Date.now(), appOptions: AppOptions = {}) {
  const app = new Hono();

  // ── CSRF middleware ───────────────────────────────────────────
  //
  // POST, PUT, DELETE require X-Rauf-Request: true.
  // Without it: 403 Forbidden.
  // No CORS headers are set — cross-origin reads are blocked by the
  // browser. The custom header adds a second layer of defense.

  app.use("*", async (c, next) => {
    const method = c.req.method;
    if (method === "POST" || method === "PUT" || method === "DELETE") {
      const header = c.req.header("X-Rauf-Request");
      if (header !== "true") {
        return c.json(
          errorResponse(
            "FORBIDDEN",
            "X-Rauf-Request: true header is required for mutation requests",
          ),
          403,
        );
      }
    }
    await next();
  });

  // ── Health endpoint ───────────────────────────────────────────

  app.get("/api/health", (c) => {
    const uptime = Math.floor((Date.now() - startedAt) / 1000);

    const configResult = readToolConfig();
    const rootDirectory =
      appOptions.rootDirectory ??
      (configResult.ok ? configResult.value.rootDirectory : resolveRootDirectory());

    const discoveryResult = discoverProjects(rootDirectory);
    const projectCount = discoveryResult.ok ? discoveryResult.value.projects.length : 0;

    return c.json({
      data: {
        version: VERSION,
        uptime,
        pid: process.pid,
        rootDirectory,
        projectCount,
      },
    });
  });

  // ── Projects routes ───────────────────────────────────────────

  app.route("/api/projects", createProjectsRouter(appOptions.rootDirectory));

  // ── Status / log / progress routes ───────────────────────────

  app.route("/api/projects", createStatusRouter(appOptions.rootDirectory));

  // ── Loop routes ─────────────────────────────────────────────

  app.route("/api/projects", createLoopRouter(appOptions.rootDirectory));

  // ── Active-loops list route (server-wide, not per project) ────

  app.route("/api/loops", createLoopsRouter());

  // ── Profile routes ────────────────────────────────────────────

  app.route("/api/projects", createProfileRouter(appOptions.rootDirectory));

  // ── Config routes ─────────────────────────────────────────────

  app.route("/api/config", createConfigRouter());

  // ── Global error handler ──────────────────────────────────────

  app.onError((err, c) => {
    const status = 500;
    return c.json(errorResponse("INTERNAL_ERROR", err.message), status);
  });

  // ── 404 handler ───────────────────────────────────────────────

  app.notFound((c) => {
    return c.json(
      errorResponse("NOT_FOUND", `Route not found: ${c.req.method} ${c.req.path}`),
      404,
    );
  });

  return app;
}

// Default app instance (used by server entry point)
export const app = createApp();
