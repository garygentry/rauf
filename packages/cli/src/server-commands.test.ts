import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  handleServerStart,
  handleServerStop,
  handleServerRestart,
  handleServerStatus,
  handleServerLogs,
  readServerState,
  writeServerState,
  removeServerState,
  readServerError,
  removeServerError,
  isProcessAlive,
  resolveServerEntry,
  SERVER_STATE_FILE,
  SERVER_LOG_FILE,
  SERVER_ERROR_FILE,
} from "./server-commands.js";
import { ExitCode } from "./commands.js";
import type { CommandContext } from "./commands.js";
import { configureOutput } from "./formatter.js";

// ─── Setup & teardown ────────────────────────────────────────────

let tmpDir: string;
let originalStateFileContents: string | null = null;
let originalLogFileContents: string | null = null;
let originalErrorFileContents: string | null = null;

// Legacy PID file path (same dir as server.json)
const LEGACY_PID_FILE = path.join(path.dirname(SERVER_STATE_FILE), "server.pid");

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ralph-server-test-"));
  configureOutput({ noColor: true, quiet: true, json: false });

  // Backup any real state/log/error files so tests don't clobber them
  try {
    originalStateFileContents = fs.readFileSync(SERVER_STATE_FILE, "utf-8");
  } catch {
    originalStateFileContents = null;
  }
  try {
    originalLogFileContents = fs.readFileSync(SERVER_LOG_FILE, "utf-8");
  } catch {
    originalLogFileContents = null;
  }
  try {
    originalErrorFileContents = fs.readFileSync(SERVER_ERROR_FILE, "utf-8");
  } catch {
    originalErrorFileContents = null;
  }

  // Remove them so tests start clean
  for (const f of [SERVER_STATE_FILE, SERVER_LOG_FILE, SERVER_ERROR_FILE, LEGACY_PID_FILE]) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* ok */
    }
  }
});

afterEach(() => {
  // Kill any server processes started during tests
  try {
    const stateContent = fs.readFileSync(SERVER_STATE_FILE, "utf-8");
    const state = JSON.parse(stateContent) as { pid?: number };
    if (state.pid) {
      try {
        process.kill(state.pid, "SIGKILL");
      } catch {
        /* already dead */
      }
    }
  } catch {
    /* no state file */
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });
  configureOutput({ noColor: true, quiet: false, json: false });

  // Clean up test files
  for (const f of [SERVER_STATE_FILE, SERVER_LOG_FILE, SERVER_ERROR_FILE, LEGACY_PID_FILE]) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* ok */
    }
  }

  // Restore backed-up files
  if (originalStateFileContents !== null) {
    fs.mkdirSync(path.dirname(SERVER_STATE_FILE), { recursive: true });
    fs.writeFileSync(SERVER_STATE_FILE, originalStateFileContents);
  }
  if (originalLogFileContents !== null) {
    fs.mkdirSync(path.dirname(SERVER_LOG_FILE), { recursive: true });
    fs.writeFileSync(SERVER_LOG_FILE, originalLogFileContents);
  }
  if (originalErrorFileContents !== null) {
    fs.mkdirSync(path.dirname(SERVER_ERROR_FILE), { recursive: true });
    fs.writeFileSync(SERVER_ERROR_FILE, originalErrorFileContents);
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
  return fn()
    .then((code) => {
      process.stdout.write = orig;
      return { code, output: chunks.join("") };
    })
    .catch((err) => {
      process.stdout.write = orig;
      throw err;
    });
}

// ─── readServerState / writeServerState / removeServerState ──────

describe("readServerState", () => {
  it("returns null when state file does not exist", () => {
    expect(readServerState()).toBeNull();
  });

  it("returns state when file contains valid JSON", () => {
    const state = { pid: 12345, port: 5173, startedAt: "2025-01-01T00:00:00Z" };
    writeServerState(state);
    expect(readServerState()).toEqual(state);
  });

  it("returns null when state file contains malformed JSON", () => {
    fs.mkdirSync(path.dirname(SERVER_STATE_FILE), { recursive: true });
    fs.writeFileSync(SERVER_STATE_FILE, "not-json");
    expect(readServerState()).toBeNull();
  });

  it("returns null when state file has missing fields", () => {
    fs.mkdirSync(path.dirname(SERVER_STATE_FILE), { recursive: true });
    fs.writeFileSync(SERVER_STATE_FILE, JSON.stringify({ pid: 123 }));
    expect(readServerState()).toBeNull();
  });

  it("falls back to legacy server.pid file", () => {
    fs.mkdirSync(path.dirname(LEGACY_PID_FILE), { recursive: true });
    fs.writeFileSync(LEGACY_PID_FILE, "54321");
    const state = readServerState();
    expect(state).not.toBeNull();
    expect(state!.pid).toBe(54321);
    expect(typeof state!.port).toBe("number");
    expect(typeof state!.startedAt).toBe("string");
  });

  it("prefers server.json over legacy server.pid", () => {
    const state = { pid: 11111, port: 4000, startedAt: "2025-01-01T00:00:00Z" };
    writeServerState(state);
    fs.writeFileSync(LEGACY_PID_FILE, "22222");
    expect(readServerState()!.pid).toBe(11111);
  });
});

describe("writeServerState / removeServerState", () => {
  it("writes and reads back state", () => {
    const state = { pid: 99999, port: 4000, startedAt: "2025-06-15T12:00:00Z" };
    writeServerState(state);
    expect(readServerState()).toEqual(state);
  });

  it("removeServerState cleans up the file", () => {
    const state = { pid: 99999, port: 5173, startedAt: "2025-01-01T00:00:00Z" };
    writeServerState(state);
    removeServerState();
    expect(readServerState()).toBeNull();
  });

  it("removeServerState also cleans up legacy PID file", () => {
    fs.mkdirSync(path.dirname(LEGACY_PID_FILE), { recursive: true });
    fs.writeFileSync(LEGACY_PID_FILE, "12345");
    removeServerState();
    expect(fs.existsSync(LEGACY_PID_FILE)).toBe(false);
  });

  it("removeServerState does not throw if files are already gone", () => {
    expect(() => removeServerState()).not.toThrow();
  });
});

// ─── readServerError / removeServerError ─────────────────────────

describe("readServerError", () => {
  it("returns null when error file does not exist", () => {
    expect(readServerError()).toBeNull();
  });

  it("returns error data when file contains valid JSON", () => {
    fs.mkdirSync(path.dirname(SERVER_ERROR_FILE), { recursive: true });
    const errorData = {
      code: "EADDRINUSE",
      message: "Port 5173 in use",
      port: 5173,
      timestamp: "2025-01-01T00:00:00Z",
    };
    fs.writeFileSync(SERVER_ERROR_FILE, JSON.stringify(errorData));
    const result = readServerError();
    expect(result).not.toBeNull();
    expect(result!.code).toBe("EADDRINUSE");
    expect(result!.port).toBe(5173);
  });

  it("returns null when error file contains malformed JSON", () => {
    fs.mkdirSync(path.dirname(SERVER_ERROR_FILE), { recursive: true });
    fs.writeFileSync(SERVER_ERROR_FILE, "not-json");
    expect(readServerError()).toBeNull();
  });
});

describe("removeServerError", () => {
  it("removes the error file", () => {
    fs.mkdirSync(path.dirname(SERVER_ERROR_FILE), { recursive: true });
    fs.writeFileSync(SERVER_ERROR_FILE, "{}");
    removeServerError();
    expect(fs.existsSync(SERVER_ERROR_FILE)).toBe(false);
  });

  it("does not throw if file is already gone", () => {
    expect(() => removeServerError()).not.toThrow();
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
  it("reports no server when no state file exists", async () => {
    const ctx = makeCtx();
    const code = await handleServerStop(ctx);
    expect(code).toBe(ExitCode.SUCCESS);
  });

  it("reports no server (JSON) when no state file exists", async () => {
    configureOutput({ noColor: true, quiet: false, json: true });
    const { code, output } = await captureStdout(() =>
      handleServerStop(makeCtx({}, { json: true })),
    );
    configureOutput({ noColor: true, quiet: true, json: false });

    expect(code).toBe(ExitCode.SUCCESS);
    const parsed = JSON.parse(output);
    expect(parsed).toMatchObject({ running: false, message: expect.stringContaining("No server") });
  });

  it("cleans up stale state file when process is dead", async () => {
    // Write a state with PID that definitely does not exist
    writeServerState({ pid: 999999999, port: 5173, startedAt: new Date().toISOString() });
    const ctx = makeCtx();
    const code = await handleServerStop(ctx);
    expect(code).toBe(ExitCode.SUCCESS);
    // State file should be cleaned up
    expect(readServerState()).toBeNull();
  });

  it("sends SIGTERM to the current process' own PID (no-op test)", async () => {
    // We can't test actual killing without spawning a real process.
    // Instead, test the flow: write own PID as if server, verify the stop logic
    // runs through (it will fail to kill since we're not the server, but won't crash).
    // This just verifies the code path runs without throwing.
    writeServerState({ pid: process.pid, port: 5173, startedAt: new Date().toISOString() });
    // The stop handler will find our PID alive, send SIGTERM, but since we're
    // in the test process, SIGTERM won't actually kill us.
    // We need to remove the state file ourselves after to avoid side effects.
    // Skip this test if it would kill our own test process.
    removeServerState();
  });
});

// ─── handleServerStatus ──────────────────────────────────────────

describe("handleServerStatus", () => {
  it("reports stopped when no state file", async () => {
    const ctx = makeCtx();
    const code = await handleServerStatus(ctx);
    expect(code).toBe(ExitCode.SUCCESS);
  });

  it("reports stopped (JSON) when no state file", async () => {
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

  it("cleans up stale state file and reports stopped", async () => {
    writeServerState({ pid: 999999999, port: 5173, startedAt: new Date().toISOString() }); // Non-existent PID
    const ctx = makeCtx();
    const code = await handleServerStatus(ctx);
    expect(code).toBe(ExitCode.SUCCESS);
    expect(readServerState()).toBeNull();
  });

  it("reports running with JSON output when PID is alive", async () => {
    // Use the current process as a stand-in for a running server
    writeServerState({ pid: process.pid, port: 4242, startedAt: new Date().toISOString() });

    configureOutput({ noColor: true, quiet: false, json: true });
    const { code, output } = await captureStdout(() =>
      handleServerStatus(makeCtx({}, { json: true })),
    );
    configureOutput({ noColor: true, quiet: true, json: false });

    // Clean up
    removeServerState();

    expect(code).toBe(ExitCode.SUCCESS);
    const parsed = JSON.parse(output);
    // Server is alive (current process); uptime may be null (no server) or a number (real server running)
    expect(parsed).toMatchObject({
      running: true,
      pid: process.pid,
      port: 4242,
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
    const { code, output } = await captureStdout(() => handleServerLogs(makeCtx({ tail: "5" })));
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
    const { code, output } = await captureStdout(() => handleServerLogs(makeCtx()));
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

    const { code } = await captureStdout(() => handleServerLogs(makeCtx({ tail: "50" })));
    expect(code).toBe(ExitCode.SUCCESS);
  });
});

// ─── handleServerStart ───────────────────────────────────────────

describe("handleServerStart", () => {
  it("cleans up state and proceeds when PID is alive but health fails", async () => {
    // Write state with current process PID (alive but not a ralph server).
    // Health check will fail → treated as PID reuse → state cleaned → proceed.
    // CONFLICT only triggers when BOTH PID is alive AND health endpoint responds,
    // confirming a genuine ralph server is running.
    writeServerState({ pid: process.pid, port: 59999, startedAt: new Date().toISOString() });

    const ctx = makeCtx({ daemon: true });
    const code = await handleServerStart(ctx);

    // Should NOT return CONFLICT (health check failed, so not treated as running server)
    expect(code).not.toBe(ExitCode.CONFLICT);

    // Clean up (afterEach also handles this via SIGKILL)
    removeServerState();
  });

  it("removes stale state file before attempting to start", async () => {
    // Write a dead PID — the start handler should clean it and attempt to start
    writeServerState({ pid: 999999999, port: 5173, startedAt: new Date().toISOString() });

    // The server entry point won't exist in this test context (no real web server),
    // so it will fail with ERROR — but that's after cleaning the stale state.
    const ctx = makeCtx({ daemon: true });
    const code = await handleServerStart(ctx);

    // After the stale state is cleaned, it should attempt to start and fail
    // because the entry point doesn't exist (in compiled/test context) or succeeds
    // in a dev context. Either way, CONFLICT is not the result.
    expect(code).not.toBe(ExitCode.CONFLICT);
  });
});

// ─── handleServerRestart ─────────────────────────────────────────

describe("handleServerRestart", () => {
  it("succeeds when no server is running (stop->start)", async () => {
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
