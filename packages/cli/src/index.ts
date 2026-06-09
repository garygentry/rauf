#!/usr/bin/env bun
// ─── rauf CLI Entry Point ───────────────────────────────────────
//
// Dev mode entry point. For the compiled binary, see scripts/binary-entry.ts.
// Delegates to runCli() in main.ts.

import { runCli } from "./main.js";
import { error } from "./formatter.js";
import { ExitCode } from "./commands.js";

runCli()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    error(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(ExitCode.ERROR);
  });
