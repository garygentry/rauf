import { Hono } from "hono";
import { VERSION, readToolConfig, resolveRootDirectory } from "@ralph/core";

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

export function errorResponse(
  code: string,
  message: string,
  details?: unknown,
): ApiErrorResponse {
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

export function createApp(startedAt: number = Date.now()) {
  const app = new Hono();

  // ── CSRF middleware ───────────────────────────────────────────
  //
  // POST, PUT, DELETE require X-Ralph-Request: true.
  // Without it: 403 Forbidden.
  // No CORS headers are set — cross-origin reads are blocked by the
  // browser. The custom header adds a second layer of defense.

  app.use("*", async (c, next) => {
    const method = c.req.method;
    if (method === "POST" || method === "PUT" || method === "DELETE") {
      const header = c.req.header("X-Ralph-Request");
      if (header !== "true") {
        return c.json(
          errorResponse(
            "FORBIDDEN",
            "X-Ralph-Request: true header is required for mutation requests",
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
    const rootDirectory = configResult.ok
      ? configResult.value.rootDirectory
      : resolveRootDirectory();

    return c.json({
      data: {
        version: VERSION,
        uptime,
        rootDirectory,
        projectCount: 0, // populated once /api/projects route (021) is added
      },
    });
  });

  // ── Global error handler ──────────────────────────────────────

  app.onError((err, c) => {
    const status = 500;
    return c.json(errorResponse("INTERNAL_ERROR", err.message), status);
  });

  // ── 404 handler ───────────────────────────────────────────────

  app.notFound((c) => {
    return c.json(
      errorResponse(
        "NOT_FOUND",
        `Route not found: ${c.req.method} ${c.req.path}`,
      ),
      404,
    );
  });

  return app;
}

// Default app instance (used by server entry point)
export const app = createApp();
