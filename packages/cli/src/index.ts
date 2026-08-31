#!/usr/bin/env bun
// ─── rauf CLI Entry Point ───────────────────────────────────────
//
// Dev mode entry point. For the compiled binary, see scripts/binary-entry.ts.
// Delegates to runCli() in main.ts.

import { runCli } from "./main.js";
import { error } from "./formatter.js";
import { ExitCode } from "./commands.js";

// Use process.exitCode (not process.exit()) so the event loop drains
// naturally — stdout writes to a pipe are async, and process.exit()
// terminates before anything still queued past the pipe buffer flushes,
// silently truncating large --json output (#81, #82).
runCli()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    error(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = ExitCode.ERROR;
  });
