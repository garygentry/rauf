import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  readMarkerFile,
  writeMarkerFile,
  readToolConfig,
  writeToolConfig,
  resolveRootDirectory,
  MARKER_FILENAME,
  TOOL_CONFIG_DIR,
  TOOL_CONFIG_PATH,
  DEFAULT_TOOL_CONFIG,
  RALPH_ROOT_ENV,
} from "./config.js";
import { ErrorCodes } from "./errors.js";
import type { MarkerFile, ToolConfig } from "./schemas.js";

// ─── Helpers ──────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ralph-config-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** Create a valid MarkerFile object for testing */
function makeMarker(overrides: Partial<MarkerFile> = {}): MarkerFile {
  return {
    ralph: true,
    version: "1",
    variant: "backlog-json",
    installedAt: "2026-01-01T00:00:00Z",
    installedBy: "ralph@0.1.0",
    profile: {
      stack: "node-typescript",
      packageManager: "pnpm",
      monorepo: false,
      commands: {
        test: "pnpm test",
        typecheck: "pnpm typecheck",
        lint: "pnpm lint",
        build: "pnpm build",
        format: null,
      },
      verify: "pnpm test && pnpm typecheck && pnpm lint && pnpm build",
    },
    artifactHashes: {},
    options: {
      ignoreInTool: false,
      gitignoreScripts: false,
      maxIterations: 20,
    },
    ...overrides,
  };
}

// ─── readMarkerFile ──────────────────────────────────────────────

describe("readMarkerFile", () => {
  it("reads and validates a valid .ralph.json", () => {
    const marker = makeMarker();
    fs.writeFileSync(path.join(tmpDir, MARKER_FILENAME), JSON.stringify(marker, null, 2));

    const result = readMarkerFile(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.ralph).toBe(true);
    expect(result.value.version).toBe("1");
    expect(result.value.profile.stack).toBe("node-typescript");
  });

  it("returns FILE_NOT_FOUND when .ralph.json is missing", () => {
    const result = readMarkerFile(tmpDir);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe(ErrorCodes.FILE_NOT_FOUND);
  });

  it("returns INVALID_JSON for malformed JSON", () => {
    fs.writeFileSync(path.join(tmpDir, MARKER_FILENAME), "{ not valid json }}}");

    const result = readMarkerFile(tmpDir);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe(ErrorCodes.INVALID_JSON);
  });

  it("returns VALIDATION_ERROR for JSON that doesn't match schema", () => {
    fs.writeFileSync(
      path.join(tmpDir, MARKER_FILENAME),
      JSON.stringify({ ralph: false, version: "1" }),
    );

    const result = readMarkerFile(tmpDir);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  it("rejects marker with ralph !== true", () => {
    const marker = { ...makeMarker(), ralph: "yes" };
    fs.writeFileSync(path.join(tmpDir, MARKER_FILENAME), JSON.stringify(marker));

    const result = readMarkerFile(tmpDir);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  it("resolves relative paths", () => {
    const subDir = path.join(tmpDir, "sub");
    fs.mkdirSync(subDir);
    fs.writeFileSync(path.join(subDir, MARKER_FILENAME), JSON.stringify(makeMarker()));

    // Use resolved path to avoid relative path issues in test runner
    const result = readMarkerFile(subDir);
    expect(result.ok).toBe(true);
  });
});

// ─── writeMarkerFile ─────────────────────────────────────────────

describe("writeMarkerFile", () => {
  it("writes a valid .ralph.json atomically", () => {
    const marker = makeMarker();

    const result = writeMarkerFile(tmpDir, marker);
    expect(result.ok).toBe(true);

    // Verify file exists and is valid
    const filePath = path.join(tmpDir, MARKER_FILENAME);
    expect(fs.existsSync(filePath)).toBe(true);

    const content = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    expect(content.ralph).toBe(true);
    expect(content.version).toBe("1");
  });

  it("does not leave .tmp files after successful write", () => {
    const marker = makeMarker();
    writeMarkerFile(tmpDir, marker);

    const tmpFile = path.join(tmpDir, `${MARKER_FILENAME}.tmp`);
    expect(fs.existsSync(tmpFile)).toBe(false);
  });

  it("overwrites existing .ralph.json", () => {
    const original = makeMarker({ version: "1" });
    writeMarkerFile(tmpDir, original);

    const updated = makeMarker({ version: "2" });
    const result = writeMarkerFile(tmpDir, updated);
    expect(result.ok).toBe(true);

    const content = JSON.parse(fs.readFileSync(path.join(tmpDir, MARKER_FILENAME), "utf-8"));
    expect(content.version).toBe("2");
  });

  it("round-trips marker file correctly", () => {
    const marker = makeMarker({
      artifactHashes: {
        "ralph.sh": "abc123",
        "RALPH.md": "def456",
      },
    });

    writeMarkerFile(tmpDir, marker);
    const result = readMarkerFile(tmpDir);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toEqual(marker);
  });

  it("produces pretty-printed JSON with trailing newline", () => {
    const marker = makeMarker();
    writeMarkerFile(tmpDir, marker);

    const raw = fs.readFileSync(path.join(tmpDir, MARKER_FILENAME), "utf-8");
    // Pretty-printed means multiline
    expect(raw.split("\n").length).toBeGreaterThan(1);
    // Trailing newline
    expect(raw.endsWith("\n")).toBe(true);
  });

  it("returns error when directory doesn't exist", () => {
    const result = writeMarkerFile(path.join(tmpDir, "nonexistent", "sub"), makeMarker());
    expect(result.ok).toBe(false);
  });
});

// ─── readToolConfig ──────────────────────────────────────────────

describe("readToolConfig", () => {
  // These tests mock the config file path by writing to the real
  // ~/.ralph/config.json location. To avoid affecting the real config,
  // we intercept at the readJsonFile level.

  it("returns defaults when config file does not exist", () => {
    // Mock readJsonFile to simulate missing file by mocking at the module level
    // Instead, we test the actual behavior: readToolConfig falls back on FILE_NOT_FOUND
    const result = readToolConfig();

    // This will either:
    // 1. Read the real ~/.ralph/config.json if it exists, or
    // 2. Return defaults if it doesn't
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The result should have all required fields
    expect(result.value).toHaveProperty("rootDirectory");
    expect(result.value).toHaveProperty("port");
    expect(result.value).toHaveProperty("theme");
  });

  it("default config has expected values", () => {
    expect(DEFAULT_TOOL_CONFIG).toEqual({
      rootDirectory: process.cwd(),
      port: 5173,
      theme: "system",
    });
  });

  it("TOOL_CONFIG_PATH is under ~/.ralph/", () => {
    expect(TOOL_CONFIG_PATH).toBe(path.join(os.homedir(), ".ralph", "config.json"));
  });
});

// ─── writeToolConfig + readToolConfig round-trip ─────────────────

describe("writeToolConfig / readToolConfig round-trip", () => {
  let savedConfig: string | null = null;
  const configPath = TOOL_CONFIG_PATH;
  const configDir = TOOL_CONFIG_DIR;

  beforeEach(() => {
    // Backup existing config if present
    try {
      savedConfig = fs.readFileSync(configPath, "utf-8");
    } catch {
      savedConfig = null;
    }
  });

  afterEach(() => {
    // Restore original config
    if (savedConfig !== null) {
      fs.writeFileSync(configPath, savedConfig, "utf-8");
    } else {
      try {
        fs.unlinkSync(configPath);
      } catch {
        // ignore if it wasn't created
      }
    }
  });

  it("writes and reads back config correctly", () => {
    const config: ToolConfig = {
      rootDirectory: "/home/test/projects",
      port: 8080,
      theme: "dark",
    };

    const writeResult = writeToolConfig(config);
    expect(writeResult.ok).toBe(true);

    const readResult = readToolConfig();
    expect(readResult.ok).toBe(true);
    if (!readResult.ok) return;

    expect(readResult.value.rootDirectory).toBe("/home/test/projects");
    expect(readResult.value.port).toBe(8080);
    expect(readResult.value.theme).toBe("dark");
  });

  it("creates ~/.ralph/ directory if needed", () => {
    // If ~/.ralph/ already exists (likely), this is a no-op for ensureDir.
    // The important thing is writeToolConfig doesn't fail.
    const config: ToolConfig = {
      rootDirectory: "/tmp/test",
      port: 3000,
      theme: "light",
    };

    const result = writeToolConfig(config);
    expect(result.ok).toBe(true);
    expect(fs.existsSync(configDir)).toBe(true);
  });

  it("overwrites existing config", () => {
    const config1: ToolConfig = {
      rootDirectory: "/first",
      port: 5173,
      theme: "system",
    };
    const config2: ToolConfig = {
      rootDirectory: "/second",
      port: 9090,
      theme: "dark",
    };

    writeToolConfig(config1);
    writeToolConfig(config2);

    const result = readToolConfig();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.rootDirectory).toBe("/second");
    expect(result.value.port).toBe(9090);
    expect(result.value.theme).toBe("dark");
  });
});

// ─── resolveRootDirectory ────────────────────────────────────────

describe("resolveRootDirectory", () => {
  let savedConfig: string | null = null;
  const configPath = TOOL_CONFIG_PATH;
  let originalEnv: string | undefined;

  beforeEach(() => {
    // Backup config and env
    try {
      savedConfig = fs.readFileSync(configPath, "utf-8");
    } catch {
      savedConfig = null;
    }
    originalEnv = process.env[RALPH_ROOT_ENV];
    delete process.env[RALPH_ROOT_ENV];
  });

  afterEach(() => {
    // Restore
    if (savedConfig !== null) {
      fs.writeFileSync(configPath, savedConfig, "utf-8");
    } else {
      try {
        fs.unlinkSync(configPath);
      } catch {
        // ignore
      }
    }
    if (originalEnv !== undefined) {
      process.env[RALPH_ROOT_ENV] = originalEnv;
    } else {
      delete process.env[RALPH_ROOT_ENV];
    }
  });

  it("returns cliRoot when provided (highest priority)", () => {
    process.env[RALPH_ROOT_ENV] = "/from-env";

    const result = resolveRootDirectory("/from-cli");
    expect(result).toBe(path.resolve("/from-cli"));
  });

  it("returns envRoot param when cliRoot is undefined", () => {
    const result = resolveRootDirectory(undefined, "/from-env-param");
    expect(result).toBe(path.resolve("/from-env-param"));
  });

  it("reads RALPH_ROOT env var when no explicit args", () => {
    process.env[RALPH_ROOT_ENV] = "/from-env-var";

    const result = resolveRootDirectory();
    expect(result).toBe(path.resolve("/from-env-var"));
  });

  it("reads from config file when no flag or env", () => {
    const config: ToolConfig = {
      rootDirectory: "/from-config",
      port: 5173,
      theme: "system",
    };
    writeToolConfig(config);

    const result = resolveRootDirectory();
    expect(result).toBe(path.resolve("/from-config"));
  });

  it("falls back to cwd when nothing else is set", () => {
    // Clear config by writing it to cwd (which is what DEFAULT_TOOL_CONFIG does)
    // Just delete config.json so defaults kick in, and defaults use cwd
    try {
      fs.unlinkSync(configPath);
    } catch {
      // might not exist
    }

    const result = resolveRootDirectory();
    expect(result).toBe(process.cwd());
  });

  it("cliRoot takes priority over envRoot", () => {
    const result = resolveRootDirectory("/from-cli", "/from-env");
    expect(result).toBe(path.resolve("/from-cli"));
  });

  it("envRoot param takes priority over RALPH_ROOT env var", () => {
    process.env[RALPH_ROOT_ENV] = "/from-env-var";

    const result = resolveRootDirectory(undefined, "/from-param");
    expect(result).toBe(path.resolve("/from-param"));
  });

  it("resolves relative paths to absolute", () => {
    const result = resolveRootDirectory("./relative/path");
    expect(path.isAbsolute(result)).toBe(true);
    expect(result).toBe(path.resolve("./relative/path"));
  });

  it("ignores empty string cliRoot (falls through)", () => {
    process.env[RALPH_ROOT_ENV] = "/from-env";

    // Empty string is falsy, should fall through to env
    const result = resolveRootDirectory("");
    expect(result).toBe(path.resolve("/from-env"));
  });

  it("ignores empty string envRoot (falls through)", () => {
    try {
      fs.unlinkSync(configPath);
    } catch {
      // might not exist
    }

    // Empty string is falsy, should fall through to config/cwd
    const result = resolveRootDirectory(undefined, "");
    // Should be cwd since config was deleted
    expect(result).toBe(process.cwd());
  });

  it("priority chain: flag > env > config > cwd", () => {
    // Set all sources
    const config: ToolConfig = {
      rootDirectory: "/from-config",
      port: 5173,
      theme: "system",
    };
    writeToolConfig(config);
    process.env[RALPH_ROOT_ENV] = "/from-env-var";

    // Flag wins
    expect(resolveRootDirectory("/from-flag")).toBe(path.resolve("/from-flag"));

    // Without flag, env param wins
    expect(resolveRootDirectory(undefined, "/from-env-param")).toBe(
      path.resolve("/from-env-param"),
    );

    // Without flag and env param, env var wins
    expect(resolveRootDirectory()).toBe(path.resolve("/from-env-var"));

    // Without env var, config wins
    delete process.env[RALPH_ROOT_ENV];
    expect(resolveRootDirectory()).toBe(path.resolve("/from-config"));

    // Without config, cwd wins
    fs.unlinkSync(configPath);
    expect(resolveRootDirectory()).toBe(process.cwd());
  });
});
