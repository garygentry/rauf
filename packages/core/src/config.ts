import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import { type Result, ok, err, ErrorCodes } from "./errors.js";
import { readJsonFile, atomicWrite, ensureDir } from "./fs-utils.js";
import { MarkerFileSchema, ToolConfigSchema, type MarkerFile, type ToolConfig } from "./schemas.js";
import { foldMarkerProviderAlias, foldToolConfigProviderAlias } from "./agent-alias.js";
import ports from "../../../config/ports.json";

// ─── Constants ───────────────────────────────────────────────────

const MARKER_FILENAME = ".rauf.json";
const TOOL_CONFIG_DIR = path.join(os.homedir(), ".rauf");
const TOOL_CONFIG_PATH = path.join(TOOL_CONFIG_DIR, "config.json");
const RAUF_ROOT_ENV = "RAUF_ROOT";

const DEFAULT_TOOL_CONFIG: ToolConfig = {
  rootDirectory: process.cwd(),
  port: ports.serverPort,
  theme: "system",
};

// ─── readMarkerFile ──────────────────────────────────────────────
//
// Read and validate <projectPath>/.rauf.json.

export function readMarkerFile(projectPath: string): Result<MarkerFile> {
  const markerPath = path.join(path.resolve(projectPath), MARKER_FILENAME);
  // Fold `options.agent` → `options.provider` before validation (04 §3.3).
  return readJsonFile(markerPath, MarkerFileSchema, foldMarkerProviderAlias);
}

// ─── writeMarkerFile ─────────────────────────────────────────────
//
// Atomic write of .rauf.json into projectPath.

export function writeMarkerFile(projectPath: string, marker: MarkerFile): Result<void> {
  const markerPath = path.join(path.resolve(projectPath), MARKER_FILENAME);
  const content = JSON.stringify(marker, null, 2) + "\n";
  return atomicWrite(markerPath, content);
}

// ─── readToolConfig ──────────────────────────────────────────────
//
// Read ~/.rauf/config.json. Return defaults if file doesn't exist.

export function readToolConfig(): Result<ToolConfig> {
  // Fold the global `defaultAgent` → `defaultProvider` alias before validation (04 §3.3).
  const result = readJsonFile(TOOL_CONFIG_PATH, ToolConfigSchema, foldToolConfigProviderAlias);

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
// Write to ~/.rauf/config.json. Create ~/.rauf/ if needed.

export function writeToolConfig(config: ToolConfig): Result<void> {
  // Ensure ~/.rauf/ directory exists
  const dirResult = ensureDir(TOOL_CONFIG_DIR);
  if (!dirResult.ok) {
    return dirResult;
  }

  const content = JSON.stringify(config, null, 2) + "\n";
  return atomicWrite(TOOL_CONFIG_PATH, content);
}

// ─── resolveRootDirectory ────────────────────────────────────────
//
// Resolution order: cliRoot → RAUF_ROOT env → config file → cwd.
// Returns an absolute path.

export function resolveRootDirectory(cliRoot?: string, envRoot?: string): string {
  // 1. CLI flag takes highest priority
  if (cliRoot) {
    return path.resolve(cliRoot);
  }

  // 2. Environment variable
  const envValue = envRoot ?? process.env[RAUF_ROOT_ENV];
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
//
// Modern Claude Code (v2.x) stores credentials at ~/.claude/.credentials.json;
// older builds used ~/.config/claude-code/credentials.json. Probe the modern
// location first and fall back to the legacy one, so an authenticated machine is
// detected regardless of which path the installed Claude Code writes.

const CLAUDE_CREDENTIALS_REL_MODERN = path.join(".claude", ".credentials.json");
const CLAUDE_CREDENTIALS_REL_LEGACY = path.join(".config", "claude-code", "credentials.json");

// Candidate credential paths, ordered most- to least-preferred. Deterministic
// (no filesystem access) so it stays trivially testable.
export function getClaudeCredentialsCandidatePaths(): string[] {
  const home = os.homedir();
  return [
    path.join(home, CLAUDE_CREDENTIALS_REL_MODERN),
    path.join(home, CLAUDE_CREDENTIALS_REL_LEGACY),
  ];
}

// The preferred default location (modern Claude Code). Retained for callers and
// messages that want a single representative path; it is the first candidate.
export function getClaudeCredentialsPath(): string {
  return path.join(os.homedir(), CLAUDE_CREDENTIALS_REL_MODERN);
}

// Read and validate a single credentials file, extracting claudeAiOauth.accessToken.
function readClaudeOAuthTokenFromFile(credentialsPath: string): Result<string> {
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

export function readClaudeOAuthToken(credentialsPathOverride?: string): Result<string> {
  // Explicit override → read exactly that file (single-path semantics, preserved
  // for callers/tests that pass a specific path).
  if (credentialsPathOverride !== undefined) {
    return readClaudeOAuthTokenFromFile(credentialsPathOverride);
  }

  const candidates = getClaudeCredentialsCandidatePaths();
  let lastPresentError: Result<string> | undefined;

  for (const candidate of candidates) {
    const result = readClaudeOAuthTokenFromFile(candidate);
    if (result.ok) {
      return result;
    }
    // A file that exists but is malformed/invalid is more informative than a plain
    // "not found" — remember it, but keep probing later candidates so a stale broken
    // file doesn't mask a valid one further down the list.
    if (result.error.code !== ErrorCodes.FILE_NOT_FOUND) {
      lastPresentError = result;
    }
  }

  if (lastPresentError !== undefined) {
    return lastPresentError;
  }

  return err({
    code: ErrorCodes.FILE_NOT_FOUND,
    message: `Claude credentials file not found (checked: ${candidates.join(", ")})`,
  });
}

// ─── Exported constants (for testing) ────────────────────────────

export { MARKER_FILENAME, TOOL_CONFIG_DIR, TOOL_CONFIG_PATH, DEFAULT_TOOL_CONFIG, RAUF_ROOT_ENV };
