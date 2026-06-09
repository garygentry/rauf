// @ralph/web — Server start function
//
// Exports startServer() for use by the compiled binary's --internal-server mode
// and by the dev entry point (index.ts).
//
// In compiled binary mode, serves the React SPA from embedded assets.
// In dev mode, the Vite dev server handles frontend assets separately.

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import { readToolConfig, resolveRootDirectory } from "@ralph/core";
import ports from "../../../../config/ports.json";

import { createApp } from "./app.js";
import { EMBEDDED_ASSETS, getAssetMimeType } from "./embedded-assets.js";
import { getLoopManager } from "./loop-manager.js";

// ─── Server state file paths (shared with CLI package) ──────────

const RAUF_CONFIG_DIR = path.join(os.homedir(), ".rauf");
const SERVER_STATE_FILE = path.join(RAUF_CONFIG_DIR, "server.json");
const SERVER_ERROR_FILE = path.join(RAUF_CONFIG_DIR, "server.error");

export interface StartServerOptions {
  /** Override port (default: from config or 5173) */
  port?: number;
}

/**
 * Start the Rauf web server.
 * Binds to 127.0.0.1 ONLY. Serves API routes and embedded frontend assets.
 */
export function startServer(options?: StartServerOptions): void {
  const configResult = readToolConfig();
  const port = options?.port ?? (configResult.ok ? configResult.value.port : ports.serverPort);

  const startedAt = Date.now();
  const app = createApp(startedAt);

  // Serve embedded frontend assets for all non-API routes.
  // API routes are registered first in createApp(), so they take priority.
  app.get("/*", (c) => {
    // Strip leading slash to get the relative asset path
    let assetPath = c.req.path.slice(1);
    if (!assetPath || assetPath === "") assetPath = "index.html";

    const content = EMBEDDED_ASSETS.get(assetPath);
    if (content !== undefined) {
      return c.body(content, 200, {
        "Content-Type": getAssetMimeType(assetPath),
        "Cache-Control": assetPath.startsWith("assets/")
          ? "public, max-age=31536000, immutable"
          : "no-cache",
      });
    }

    // SPA fallback: serve index.html for client-side routing
    const indexHtml = EMBEDDED_ASSETS.get("index.html");
    if (indexHtml !== undefined) {
      return c.body(indexHtml, 200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache",
      });
    }

    return c.notFound();
  });

  // ── Start the HTTP server with error handling ──────────────────
  try {
    Bun.serve({
      hostname: "127.0.0.1",
      port,
      idleTimeout: 255, // Max value (seconds) — keeps SSE connections alive
      fetch: app.fetch,
    });
  } catch (err: unknown) {
    const code = err instanceof Error && "code" in err ? (err as { code: string }).code : "UNKNOWN";
    const message = err instanceof Error ? err.message : String(err);
    const errorData = {
      code: code === "EADDRINUSE" ? "EADDRINUSE" : "UNKNOWN",
      message,
      port,
      timestamp: new Date().toISOString(),
    };

    // Write structured error for CLI to read
    try {
      fs.mkdirSync(RAUF_CONFIG_DIR, { recursive: true });
      fs.writeFileSync(SERVER_ERROR_FILE, JSON.stringify(errorData), "utf-8");
    } catch {
      // Best-effort — if we can't write the error file, the log still has it
    }

    console.error(`Failed to start server on port ${port}: ${message}`);
    process.exit(1);
  }

  // Server started successfully — remove any stale error file
  try {
    fs.unlinkSync(SERVER_ERROR_FILE);
  } catch {
    // No stale error file — fine
  }

  console.log(`Rauf web server running at http://127.0.0.1:${port}`);

  // ── Recover stale loops on startup ────────────────────────────
  const rootDirectory = configResult.ok ? configResult.value.rootDirectory : resolveRootDirectory();
  const manager = getLoopManager();
  manager.recoverStaleLoops(rootDirectory).catch((err) => {
    console.error("Failed to recover stale loops:", err);
  });

  // ── Graceful shutdown on SIGTERM ──────────────────────────────
  process.on("SIGTERM", () => {
    console.log("SIGTERM received, shutting down loops...");

    // Clean up server state file so no stale state remains
    try {
      fs.unlinkSync(SERVER_STATE_FILE);
    } catch {
      // Already removed — fine
    }

    manager.shutdownAll().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
}
