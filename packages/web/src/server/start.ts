// @ralph/web — Server start function
//
// Exports startServer() for use by the compiled binary's --internal-server mode
// and by the dev entry point (index.ts).
//
// In compiled binary mode, serves the React SPA from embedded assets.
// In dev mode, the Vite dev server handles frontend assets separately.

import { readToolConfig, resolveRootDirectory } from "@ralph/core";

import { createApp } from "./app.js";
import { EMBEDDED_ASSETS, getAssetMimeType } from "./embedded-assets.js";
import { getLoopManager } from "./loop-manager.js";

export interface StartServerOptions {
  /** Override port (default: from config or 5173) */
  port?: number;
}

/**
 * Start the Ralph web server.
 * Binds to 127.0.0.1 ONLY. Serves API routes and embedded frontend assets.
 */
export function startServer(options?: StartServerOptions): void {
  const configResult = readToolConfig();
  const port = options?.port ?? (configResult.ok ? configResult.value.port : 5173);

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

  Bun.serve({
    hostname: "127.0.0.1",
    port,
    fetch: app.fetch,
  });

  console.log(`Ralph web server running at http://127.0.0.1:${port}`);

  // ── Recover stale loops on startup ────────────────────────────
  const rootDirectory = configResult.ok ? configResult.value.rootDirectory : resolveRootDirectory();
  const manager = getLoopManager();
  manager.recoverStaleLoops(rootDirectory).catch((err) => {
    console.error("Failed to recover stale loops:", err);
  });

  // ── Graceful shutdown on SIGTERM ──────────────────────────────
  process.on("SIGTERM", () => {
    console.log("SIGTERM received, shutting down loops...");
    manager.shutdownAll().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
}
