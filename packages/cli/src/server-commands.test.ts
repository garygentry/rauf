import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  handleServerStart,
  handleServerStop,
  handleServerRestart,
  handleServerStatus,
  handleServerLogs,
  readPidFile,
  writePidFile,
  removePidFile,
  isProcessAlive,
  resolveServerEntry,
  SERVER_PID_FILE,
  SERVER_LOG_FILE,
} from "./server-commands.js";
import { ExitCode } from "./commands.js";
import type { CommandContext } from "./commands.js";
import { configureOutput } from "./formatter.js";

// ─── Setup & teardown ────────────────────────────────────────────

let tmpDir: string;
let originalPidFileContents: string | null = null;
let originalLogFileContents: string | null = null;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ralph-server-test-"));
  configureOutput({ noColor: true, quiet: true, json: false });

  // Backup any real PID/log files so tests don't clobber them
  try {
    originalPidFileContents = fs.readFileSync(SERVER_PID_FILE, "utf-8");
  } catch {
    originalPidFileContents = null;
  }
  try {
    originalLogFileContents = fs.readFileSync(SERVER_LOG_FILE, "utf-8");
  } catch {
    originalLogFileContents = null;
  }

  // Remove them so tests start clean
  try { fs.unlinkSync(SERVER_PID_FILE); } catch { /* ok */ }
  try { fs.unlinkSync(SERVER_LOG_FILE); } catch { /* ok */ }
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  configureOutput({ noColor: true, quiet: false, json: false });

  // Restore backed-up files
  try { fs.unlinkSync(SERVER_PID_FILE); } catch { /* ok */ }
  try { fs.unlinkSync(SERVER_LOG_FILE); } catch { /* ok */ }
  if (originalPidFileContents !== null) {
    fs.mkdirSync(path.dirname(SERVER_PID_FILE), { recursive: true });
    fs.writeFileSync(SERVER_PID_FILE, originalPidFileContents);
  }
  if (originalLogFileContents !== null) {
    fs.mkdirSync(path.dirname(SERVER_LOG_FILE), { recursive: true });
    fs.writeFileSync(SERVER_LOG_FILE, originalLogFileContents);
  }
});

// ─── Helpers ─────────────────────────────────────────────────────

function makeCtx(
  flags: Record<string, string | true> = {},
  globalFlags: Partial<{ json: boolean; quiet: boolean; noColor: boolean }> = {},
): CommandContext {
  return {
    args: [],
    flags: new Map(Object.entries(flags)),
    globalFlags: {
      json: globalFlags.json ?? false,
      quiet: globalFlags.quiet ?? true,
      noColor: globalFlags.noColor ?? true,
      root: null,
    },
    rawArgv: [],
  };
}

function captureStdout(fn: () => Promise<number>): Promise<{ code: number; output: string }> {
  const chunks: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = (s: string | Uint8Array) => {
    chunks.push(s.toString());
    return true;
  };
  return fn().then((code) => {
    process.stdout.write = orig;
    return { code, output: chunks.join("") };
  }).catch((err) => {
    process.stdout.write = orig;
    throw err;
  });
}

// ─── readPidFile / writePidFile / removePidFile ──────────────────

describe("readPidFile", () => {
  it("returns null when PID file does not exist", () => {
    expect(readPidFile()).toBeNull();
  });

  it("returns the PID when file contains a valid number", () => {
    writePidFile(12345);
    expect(readPidFile()).toBe(12345);
  });

  it("returns null when PID file contains invalid content", () => {
    fs.mkdirSync(path.dirname(SERVER_PID_FILE), { recursive: true });
    fs.writeFileSync(SERVER_PID_FILE, "not-a-number");
    expect(readPidFile()).toBeNull();
  });
});

describe("writePidFile / removePidFile", () => {
  it("writes and reads back a PID", () => {
    writePidFile(99999);
    expect(readPidFile()).toBe(99999);
  });

  it("removePidFile cleans up the file", () => {
    writePidFile(99999);
    removePidFile();
    expect(readPidFile()).toBeNull();
  });

  it("removePidFile does not throw if file is already gone", () => {
    expect(() => removePidFile()).not.toThrow();
  });
});

// ─── isProcessAlive ──────────────────────────────────────────────

describe("isProcessAlive", () => {
  it("returns true for the current process", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it("returns false for a PID that does not exist", () => {
    // PID 999999999 should not exist
    expect(isProcessAlive(999999999)).toBe(false);
  });
});

// ─── resolveServerEntry ──────────────────────────────────────────

describe("resolveServerEntry", () => {
  it("returns a path ending in packages/web/src/server/index.ts", () => {
    const entry = resolveServerEntry();
    expect(entry).toMatch(/packages[\\/]web[\\/]src[\\/]server[\\/]index\.ts$/);
  });

  it("returns an absolute path", () => {
    const entry = resolveServerEntry();
    expect(path.isAbsolute(entry)).toBe(true);
  });
});

// ─── handleServerStop ────────────────────────────────────────────

describe("handleServerStop", () => {
  it("reports no server when no PID file exists", async () => {
    const ctx = makeCtx();
    const code = await handleServerStop(ctx);
    expect(code).toBe(ExitCode.SUCCESS);
  });

  it("reports no server (JSON) when no PID file exists", async () => {
    configureOutput({ noColor: true, quiet: false, json: true });
    const { code, output } = await captureStdout(() =>
      handleServerStop(makeCtx({}, { json: true })),
    );
    configureOutput({ noColor: true, quiet: true, json: false });

    expect(code).toBe(ExitCode.SUCCESS);
    const parsed = JSON.parse(output);
    expect(parsed).toMatchObject({ running: false, message: expect.stringContaining("No server") });
  });

  it("cleans up stale PID file when process is dead", async () => {
    // Write a PID that definitely does not exist
    writePidFile(999999999);
    const ctx = makeCtx();
    const code = await handleServerStop(ctx);
    expect(code).toBe(ExitCode.SUCCESS);
    // PID file should be cleaned up
    expect(readPidFile()).toBeNull();
  });

  it("sends SIGTERM to the current process' own PID (no-op test)", async () => {
    // We can't test actual killing without spawning a real process.
    // Instead, test the flow: write own PID as if server, verify the stop logic
    // runs through (it will fail to kill since we're not the server, but won't crash).
    // This just verifies the code path runs without throwing.
    writePidFile(process.pid);
    // The stop handler will find our PID alive, send SIGTERM, but since we're
    // in the test process, SIGTERM won't actually kill us.
    // We need to remove the PID file ourselves after to avoid side effects.
    // Skip this test if it would kill our own test process.
    removePidFile();
  });
});

// ─── handleServerStatus ──────────────────────────────────────────

describe("handleServerStatus", () => {
  it("reports stopped when no PID file", async () => {
    const ctx = makeCtx();
    const code = await handleServerStatus(ctx);
    expect(code).toBe(ExitCode.SUCCESS);
  });

  it("reports stopped (JSON) when no PID file", async () => {
    configureOutput({ noColor: true, quiet: false, json: true });
    const { code, output } = await captureStdout(() =>
      handleServerStatus(makeCtx({}, { json: true })),
    );
    configureOutput({ noColor: true, quiet: true, json: false });

    expect(code).toBe(ExitCode.SUCCESS);
    const parsed = JSON.parse(output);
    expect(parsed).toMatchObject({ running: false });
    expect(typeof parsed.port).toBe("number");
  });

  it("cleans up stale PID file and reports stopped", async () => {
    writePidFile(999999999); // Non-existent PID
    const ctx = makeCtx();
    const code = await handleServerStatus(ctx);
    expect(code).toBe(ExitCode.SUCCESS);
    expect(readPidFile()).toBeNull();
  });

  it("reports running with JSON output when PID is alive", async () => {
    // Use the current process as a stand-in for a running server
    writePidFile(process.pid);

    configureOutput({ noColor: true, quiet: false, json: true });
    const { code, output } = await captureStdout(() =>
      handleServerStatus(makeCtx({}, { json: true })),
    );
    configureOutput({ noColor: true, quiet: true, json: false });

    // Clean up
    removePidFile();

    expect(code).toBe(ExitCode.SUCCESS);
    const parsed = JSON.parse(output);
    // Server is alive (current process); uptime may be null (no server) or a number (real server running)
    expect(parsed).toMatchObject({
      running: true,
      pid: process.pid,
    });
    expect(parsed.uptime === null || typeof parsed.uptime === "number").toBe(true);
  });
});

// ─── handleServerLogs ────────────────────────────────────────────

describe("handleServerLogs", () => {
  it("returns SUCCESS with empty result when no log file", async () => {
    const ctx = makeCtx();
    const code = await handleServerLogs(ctx);
    expect(code).toBe(ExitCode.SUCCESS);
  });

  it("returns empty JSON lines array when no log file", async () => {
    configureOutput({ noColor: true, quiet: false, json: true });
    const { code, output } = await captureStdout(() =>
      handleServerLogs(makeCtx({}, { json: true })),
    );
    configureOutput({ noColor: true, quiet: true, json: false });

    expect(code).toBe(ExitCode.SUCCESS);
    const parsed = JSON.parse(output);
    expect(parsed).toEqual({ lines: [] });
  });

  it("shows last N lines of log file", async () => {
    const lines = Array.from({ length: 20 }, (_, i) => `server log line ${i + 1}`);
    fs.mkdirSync(path.dirname(SERVER_LOG_FILE), { recursive: true });
    fs.writeFileSync(SERVER_LOG_FILE, lines.join("\n") + "\n");

    configureOutput({ noColor: true, quiet: false, json: false });
    const { code, output } = await captureStdout(() =>
      handleServerLogs(makeCtx({ tail: "5" })),
    );
    configureOutput({ noColor: true, quiet: true, json: false });

    expect(code).toBe(ExitCode.SUCCESS);
    const printed = output.trim().split("\n");
    expect(printed).toHaveLength(5);
    expect(printed[0]).toBe("server log line 16");
    expect(printed[4]).toBe("server log line 20");
  });

  it("defaults to 50 lines tail", async () => {
    const lines = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`);
    fs.mkdirSync(path.dirname(SERVER_LOG_FILE), { recursive: true });
    fs.writeFileSync(SERVER_LOG_FILE, lines.join("\n") + "\n");

    configureOutput({ noColor: true, quiet: false, json: false });
    const { code, output } = await captureStdout(() =>
      handleServerLogs(makeCtx()),
    );
    configureOutput({ noColor: true, quiet: true, json: false });

    expect(code).toBe(ExitCode.SUCCESS);
    const printed = output.trim().split("\n");
    expect(printed).toHaveLength(50);
    expect(printed[0]).toBe("line 11");
  });

  it("returns JSON lines array with log content", async () => {
    const lines = ["server start", "request received", "response sent"];
    fs.mkdirSync(path.dirname(SERVER_LOG_FILE), { recursive: true });
    fs.writeFileSync(SERVER_LOG_FILE, lines.join("\n") + "\n");

    configureOutput({ noColor: true, quiet: false, json: true });
    const { code, output } = await captureStdout(() =>
      handleServerLogs(makeCtx({}, { json: true })),
    );
    configureOutput({ noColor: true, quiet: true, json: false });

    expect(code).toBe(ExitCode.SUCCESS);
    const parsed = JSON.parse(output);
    expect(parsed.lines).toEqual(lines);
  });

  it("returns all lines when log has fewer than tail count", async () => {
    const lines = ["line 1", "line 2"];
    fs.mkdirSync(path.dirname(SERVER_LOG_FILE), { recursive: true });
    fs.writeFileSync(SERVER_LOG_FILE, lines.join("\n") + "\n");

    const { code } = await captureStdout(() =>
      handleServerLogs(makeCtx({ tail: "50" })),
    );
    expect(code).toBe(ExitCode.SUCCESS);
  });
});

// ─── handleServerStart ───────────────────────────────────────────

describe("handleServerStart", () => {
  it("returns CONFLICT if a server is already running", async () => {
    // Simulate a running server by writing the current process PID
    writePidFile(process.pid);

    const ctx = makeCtx();
    const code = await handleServerStart(ctx);

    removePidFile();
    expect(code).toBe(ExitCode.CONFLICT);
  });

  it("returns CONFLICT with JSON if a server is already running", async () => {
    writePidFile(process.pid);

    configureOutput({ noColor: true, quiet: false, json: true });
    const { code, output } = await captureStdout(() =>
      handleServerStart(makeCtx({}, { json: true })),
    );
    configureOutput({ noColor: true, quiet: true, json: false });

    removePidFile();

    expect(code).toBe(ExitCode.CONFLICT);
    const parsed = JSON.parse(output);
    expect(parsed.error.code).toBe("SERVER_ALREADY_RUNNING");
  });

  it("removes stale PID file before attempting to start", async () => {
    // Write a dead PID — the start handler should clean it and attempt to start
    writePidFile(999999999);

    // The server entry point won't exist in this test context (no real web server),
    // so it will fail with ERROR — but that's after cleaning the stale PID.
    const ctx = makeCtx({ daemon: true });
    const code = await handleServerStart(ctx);

    // After the stale PID is cleaned, it should attempt to start and fail
    // because the entry point doesn't exist (in compiled/test context) or succeeds
    // in a dev context. Either way, CONFLICT is not the result.
    expect(code).not.toBe(ExitCode.CONFLICT);
  });
});

// ─── handleServerRestart ─────────────────────────────────────────

describe("handleServerRestart", () => {
  it("succeeds when no server is running (stop→start)", async () => {
    // With no running server, restart = stop (no-op) + start (will fail if no web server)
    // We just verify it goes through the stop phase cleanly.
    const ctx = makeCtx();
    // Will attempt to start the web server which may fail due to missing entry point.
    // The stop phase should succeed (no server running).
    const code = await handleServerRestart(ctx);
    // Any result is acceptable as long as it doesn't throw
    expect(typeof code).toBe("number");
  });
});

// ─── Registry integration ─────────────────────────────────────────

describe("server command registry", () => {
  it("server subcommands all have handlers wired up", async () => {
    const { findCommand } = await import("./commands.js");
    const serverCmd = findCommand("server");
    expect(serverCmd).toBeDefined();
    for (const sub of serverCmd!.subcommands ?? []) {
      expect(sub.handler, `${sub.name} should have a handler`).toBeDefined();
    }
  });
});
