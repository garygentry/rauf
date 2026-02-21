// @ralph/web — Hono server entry point
//
// Binds to 127.0.0.1 ONLY (never 0.0.0.0).
// Static React SPA served from `build/` directory.
// API routes under /api/.

import { serveStatic } from "hono/bun";
import { readToolConfig } from "@ralph/core";

import { createApp } from "./app.js";

const configResult = readToolConfig();
const port = configResult.ok ? configResult.value.port : 5173;

const startedAt = Date.now();
const app = createApp(startedAt);

// Serve the compiled React SPA for all non-API routes.
// Must come after API routes so /api/* is handled first.
app.use("/*", serveStatic({ root: "./build" }));

// Fallback: serve index.html for client-side routing
app.use("/*", serveStatic({ path: "./build/index.html" }));

Bun.serve({
  hostname: "127.0.0.1",
  port,
  fetch: app.fetch,
});

console.log(`Ralph web server running at http://127.0.0.1:${port}`);
