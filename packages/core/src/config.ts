import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import { type Result, ok, err, ErrorCodes } from "./errors.js";
import { readJsonFile, atomicWrite, ensureDir } from "./fs-utils.js";
import { MarkerFileSchema, ToolConfigSchema, type MarkerFile, type ToolConfig } from "./schemas.js";

// ─── Constants ───────────────────────────────────────────────────

const MARKER_FILENAME = ".ralph.json";
const TOOL_CONFIG_DIR = path.join(os.homedir(), ".ralph");
const TOOL_CONFIG_PATH = path.join(TOOL_CONFIG_DIR, "config.json");
const RALPH_ROOT_ENV = "RALPH_ROOT";

const DEFAULT_TOOL_CONFIG: ToolConfig = {
  rootDirectory: process.cwd(),
  port: 5173,
  theme: "system",
};

// ─── readMarkerFile ──────────────────────────────────────────────
//
// Read and validate <projectPath>/.ralph.json.

export function readMarkerFile(projectPath: string): Result<MarkerFile> {
  const markerPath = path.join(path.resolve(projectPath), MARKER_FILENAME);
  return readJsonFile(markerPath, MarkerFileSchema);
}

// ─── writeMarkerFile ─────────────────────────────────────────────
//
// Atomic write of .ralph.json into projectPath.

export function writeMarkerFile(projectPath: string, marker: MarkerFile): Result<void> {
  const markerPath = path.join(path.resolve(projectPath), MARKER_FILENAME);
  const content = JSON.stringify(marker, null, 2) + "\n";
  return atomicWrite(markerPath, content);
}

// ─── readToolConfig ──────────────────────────────────────────────
//
// Read ~/.ralph/config.json. Return defaults if file doesn't exist.

export function readToolConfig(): Result<ToolConfig> {
  const result = readJsonFile(TOOL_CONFIG_PATH, ToolConfigSchema);

  if (result.ok) {
    return result;
  }

  // If the file doesn't exist, return defaults — this is expected on first run.
  // Only propagate errors for files that exist but are malformed.
  if (result.error.code === ErrorCodes.FILE_NOT_FOUND) {
    return ok({ ...DEFAULT_TOOL_CONFIG });
  }

  return result;
}

// ─── writeToolConfig ─────────────────────────────────────────────
//
// Write to ~/.ralph/config.json. Create ~/.ralph/ if needed.

export function writeToolConfig(config: ToolConfig): Result<void> {
  // Ensure ~/.ralph/ directory exists
  const dirResult = ensureDir(TOOL_CONFIG_DIR);
  if (!dirResult.ok) {
    return dirResult;
  }

  const content = JSON.stringify(config, null, 2) + "\n";
  return atomicWrite(TOOL_CONFIG_PATH, content);
}

// ─── resolveRootDirectory ────────────────────────────────────────
//
// Resolution order: cliRoot → RALPH_ROOT env → config file → cwd.
// Returns an absolute path.

export function resolveRootDirectory(cliRoot?: string, envRoot?: string): string {
  // 1. CLI flag takes highest priority
  if (cliRoot) {
    return path.resolve(cliRoot);
  }

  // 2. Environment variable
  const envValue = envRoot ?? process.env[RALPH_ROOT_ENV];
  if (envValue) {
    return path.resolve(envValue);
  }

  // 3. Config file
  const configResult = readToolConfig();
  if (configResult.ok) {
    return path.resolve(configResult.value.rootDirectory);
  }

  // 4. Current working directory (fallback)
  return process.cwd();
}

// ─── readClaudeOAuthToken ────────────────────────────────────────
//
// Read the Claude OAuth bearer token from the Claude Code credentials file.
// Extracts .claudeAiOauth.accessToken from the parsed JSON.

const CLAUDE_CREDENTIALS_REL = path.join(".config", "claude-code", "credentials.json");

export function getClaudeCredentialsPath(): string {
  return path.join(os.homedir(), CLAUDE_CREDENTIALS_REL);
}

export function readClaudeOAuthToken(credentialsPathOverride?: string): Result<string> {
  const credentialsPath = credentialsPathOverride ?? getClaudeCredentialsPath();

  let raw: string;
  try {
    raw = fs.readFileSync(credentialsPath, "utf-8");
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return err({
        code: ErrorCodes.FILE_NOT_FOUND,
        message: `Claude credentials file not found: ${credentialsPath}`,
      });
    }
    return err({
      code: ErrorCodes.FILE_NOT_FOUND,
      message: `Cannot read Claude credentials file: ${credentialsPath}`,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return err({
      code: ErrorCodes.INVALID_JSON,
      message: `Claude credentials file contains malformed JSON: ${credentialsPath}`,
    });
  }

  if (typeof parsed !== "object" || parsed === null) {
    return err({
      code: ErrorCodes.VALIDATION_ERROR,
      message: "Claude credentials file does not contain a JSON object",
    });
  }

  const obj = parsed as Record<string, unknown>;
  const claudeAiOauth = obj["claudeAiOauth"];

  if (typeof claudeAiOauth !== "object" || claudeAiOauth === null) {
    return err({
      code: ErrorCodes.VALIDATION_ERROR,
      message: "Claude credentials missing claudeAiOauth object",
    });
  }

  const oauthObj = claudeAiOauth as Record<string, unknown>;
  const accessToken = oauthObj["accessToken"];

  if (typeof accessToken !== "string" || accessToken === "") {
    return err({
      code: ErrorCodes.VALIDATION_ERROR,
      message: "Claude credentials missing or empty claudeAiOauth.accessToken",
    });
  }

  return ok(accessToken);
}

// ─── Exported constants (for testing) ────────────────────────────

export { MARKER_FILENAME, TOOL_CONFIG_DIR, TOOL_CONFIG_PATH, DEFAULT_TOOL_CONFIG, RALPH_ROOT_ENV };
