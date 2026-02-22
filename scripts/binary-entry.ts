#!/usr/bin/env bun
// ─── ralph Compiled Binary Entry Point ──────────────────────────
//
// This file is the single entry point for `bun build --compile`.
// It is NOT used in development — dev mode uses packages/cli/src/index.ts.
//
// Two modes:
//   1. CLI mode (default): runs the normal CLI command parser
//   2. Server mode (--internal-server): starts the Hono web server
//      Used internally by `ralph server start` in the compiled binary
//      to spawn the server in foreground or daemon mode.
//
// All imports are static so Bun's compiler bundles everything into
// the single binary: CLI modules, core library, Hono server, and
// embedded frontend assets.

import { startServer } from "../packages/web/src/server/start.js";
import { runCli } from "../packages/cli/src/main.js";

if (process.argv.includes("--internal-server")) {
  // ─── Internal server mode ────────────────────────────────
  const portIdx = process.argv.indexOf("--port");
  const port = portIdx >= 0 ? parseInt(process.argv[portIdx + 1]!, 10) : undefined;
  startServer({ port: port && !isNaN(port) ? port : undefined });
} else {
  // ─── Normal CLI mode ────────────────────────────────────
  runCli()
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    });
}
