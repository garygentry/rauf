import * as fs from "node:fs";
import * as path from "node:path";

import type { ProjectProfile, ProfileCommands } from "./schemas.js";
import { fileExists } from "./fs-utils.js";

// ─── Indicator Files ─────────────────────────────────────────────
//
// Mapping from indicator files to the detected stack/language.
// Order matters — first match wins for language/runtime detection.

const LANGUAGE_INDICATORS: Array<{ file: string; stack: string }> = [
  { file: "package.json", stack: "node" }, // refined to node-typescript if tsconfig.json exists
  { file: "pyproject.toml", stack: "python" },
  { file: "setup.py", stack: "python" },
  { file: "requirements.txt", stack: "python" },
  { file: "go.mod", stack: "go" },
  { file: "Cargo.toml", stack: "rust" },
];

// Lock file → package manager mapping (checked in priority order)
const LOCK_FILE_MANAGERS: Array<{ file: string; manager: string }> = [
  { file: "pnpm-lock.yaml", manager: "pnpm" },
  { file: "bun.lockb", manager: "bun" },
  { file: "bun.lock", manager: "bun" },
  { file: "yarn.lock", manager: "yarn" },
  { file: "package-lock.json", manager: "npm" },
];

// Monorepo indicators
const MONOREPO_INDICATORS = [
  "pnpm-workspace.yaml",
  "lerna.json",
  // package.json "workspaces" field is checked separately
];

// ─── detectProfile ───────────────────────────────────────────────
//
// Scan a project directory for indicator files and derive a
// ProjectProfile with stack, package manager, monorepo flag,
// and recommended commands.

export function detectProfile(projectPath: string): ProjectProfile {
  const resolved = path.resolve(projectPath);

  // Detect language/runtime
  let stack = "unknown";
  for (const indicator of LANGUAGE_INDICATORS) {
    if (fileExists(path.join(resolved, indicator.file))) {
      stack = indicator.stack;
      break;
    }
  }

  // Refine Node.js to node-typescript or node-javascript
  if (stack === "node") {
    stack = fileExists(path.join(resolved, "tsconfig.json"))
      ? "node-typescript"
      : "node-javascript";
  }

  // Detect package manager (Node.js only)
  const packageManager = detectPackageManager(resolved, stack);

  // Detect monorepo
  const monorepo = detectMonorepo(resolved, stack);

  // Derive commands
  const commands = deriveCommands(resolved, stack, packageManager);

  // Build composite verify command
  const verify = buildVerifyCommand(commands);

  return { stack, packageManager, monorepo, commands, verify };
}

// ─── detectPackageManager ────────────────────────────────────────

function detectPackageManager(projectPath: string, stack: string): string | null {
  if (!stack.startsWith("node")) {
    return null;
  }

  for (const { file, manager } of LOCK_FILE_MANAGERS) {
    if (fileExists(path.join(projectPath, file))) {
      return manager;
    }
  }

  // Default to npm if package.json exists but no lock file found
  return "npm";
}

// ─── detectMonorepo ──────────────────────────────────────────────

function detectMonorepo(projectPath: string, stack: string): boolean {
  // Check dedicated monorepo indicator files
  for (const file of MONOREPO_INDICATORS) {
    if (fileExists(path.join(projectPath, file))) {
      return true;
    }
  }

  // Check package.json workspaces field (Node.js only)
  if (stack.startsWith("node")) {
    const pkgJson = readPackageJsonSafe(projectPath);
    if (pkgJson?.workspaces) {
      return true;
    }
  }

  return false;
}

// ─── deriveCommands ──────────────────────────────────────────────
//
// Derive sensible command defaults based on stack and package manager.
// For Node.js projects, we read package.json scripts to confirm
// that suggested commands actually exist.

function deriveCommands(
  projectPath: string,
  stack: string,
  packageManager: string | null,
): ProfileCommands {
  switch (stack) {
    case "node-typescript":
    case "node-javascript":
      return deriveNodeCommands(projectPath, packageManager ?? "npm");

    case "python":
      return {
        test: "pytest",
        typecheck: stack === "python" ? "mypy ." : null,
        lint: "ruff check .",
        build: null,
        format: "ruff format --check .",
      };

    case "go":
      return {
        test: "go test ./...",
        typecheck: "go vet ./...",
        lint: null,
        build: "go build ./...",
        format: null,
      };

    case "rust":
      return {
        test: "cargo test",
        typecheck: "cargo check",
        lint: "cargo clippy",
        build: "cargo build",
        format: null,
      };

    default:
      return {
        test: null,
        typecheck: null,
        lint: null,
        build: null,
        format: null,
      };
  }
}

// ─── deriveNodeCommands ──────────────────────────────────────────
//
// For Node.js projects, read package.json scripts and only suggest
// commands that actually exist in the scripts field.

function deriveNodeCommands(projectPath: string, packageManager: string): ProfileCommands {
  const pkgJson = readPackageJsonSafe(projectPath);
  const scripts = pkgJson?.scripts ?? {};
  const run = packageManager === "npm" ? "npm run" : packageManager;

  return {
    test: scripts["test"] ? `${run} test` : null,
    typecheck: scripts["typecheck"] ? `${run} typecheck` : null,
    lint: scripts["lint"] ? `${run} lint` : null,
    build: scripts["build"] ? `${run} build` : null,
    format: scripts["format:check"]
      ? `${run} format:check`
      : scripts["format"]
        ? `${run} format`
        : null,
  };
}

// ─── readPackageJsonSafe ─────────────────────────────────────────
//
// Best-effort read of package.json. Returns null on any failure.
// We don't use readJsonFile/Zod here because package.json has a
// much broader shape than we need — we just want scripts/workspaces.

interface PackageJsonPartial {
  scripts?: Record<string, string>;
  workspaces?: string[] | { packages: string[] };
}

function readPackageJsonSafe(projectPath: string): PackageJsonPartial | null {
  try {
    const content = fs.readFileSync(path.join(projectPath, "package.json"), "utf-8");
    return JSON.parse(content) as PackageJsonPartial;
  } catch {
    return null;
  }
}

// ─── buildVerifyCommand ──────────────────────────────────────────
//
// Join all non-null commands with " && " to form a composite verify
// command. Returns empty string if no commands are set.

function buildVerifyCommand(commands: ProfileCommands): string {
  const parts: string[] = [];

  if (commands.test) parts.push(commands.test);
  if (commands.typecheck) parts.push(commands.typecheck);
  if (commands.lint) parts.push(commands.lint);
  if (commands.build) parts.push(commands.build);
  if (commands.format) parts.push(commands.format);

  return parts.join(" && ");
}

// ─── getPreset ───────────────────────────────────────────────────
//
// Return a preset ProfileCommands for greenfield projects.
// Presets provide sensible defaults without filesystem detection.

const PRESETS: Record<string, ProjectProfile> = {
  "node-typescript": {
    stack: "node-typescript",
    packageManager: "npm",
    monorepo: false,
    commands: {
      test: "npm test",
      typecheck: "npx tsc --noEmit",
      lint: "npm run lint",
      build: "npm run build",
      format: null,
    },
    verify: "npm test && npx tsc --noEmit && npm run lint && npm run build",
  },
  "node-javascript": {
    stack: "node-javascript",
    packageManager: "npm",
    monorepo: false,
    commands: {
      test: "npm test",
      typecheck: null,
      lint: "npm run lint",
      build: "npm run build",
      format: null,
    },
    verify: "npm test && npm run lint && npm run build",
  },
  python: {
    stack: "python",
    packageManager: null,
    monorepo: false,
    commands: {
      test: "pytest",
      typecheck: "mypy .",
      lint: "ruff check .",
      build: null,
      format: "ruff format --check .",
    },
    verify: "pytest && mypy . && ruff check . && ruff format --check .",
  },
  go: {
    stack: "go",
    packageManager: null,
    monorepo: false,
    commands: {
      test: "go test ./...",
      typecheck: "go vet ./...",
      lint: null,
      build: "go build ./...",
      format: null,
    },
    verify: "go test ./... && go vet ./... && go build ./...",
  },
  rust: {
    stack: "rust",
    packageManager: null,
    monorepo: false,
    commands: {
      test: "cargo test",
      typecheck: "cargo check",
      lint: "cargo clippy",
      build: "cargo build",
      format: null,
    },
    verify: "cargo test && cargo check && cargo clippy && cargo build",
  },
  custom: {
    stack: "custom",
    packageManager: null,
    monorepo: false,
    commands: {
      test: null,
      typecheck: null,
      lint: null,
      build: null,
      format: null,
    },
    verify: "",
  },
};

export function getPreset(presetName: string): ProjectProfile {
  const preset = PRESETS[presetName];
  if (!preset) {
    // Return custom preset for unknown names
    return { ...PRESETS["custom"]! };
  }
  // Return a deep copy to prevent mutation
  return {
    ...preset,
    commands: { ...preset.commands },
  };
}

// ─── mergeProfileOverrides ───────────────────────────────────────
//
// Apply user-provided command overrides on top of a detected profile.
// Empty string means "explicitly disabled" → set to null.
// Undefined means "keep detected value".

export interface ProfileOverrides {
  test?: string;
  typecheck?: string;
  lint?: string;
  build?: string;
  format?: string;
}

export function mergeProfileOverrides(
  detected: ProjectProfile,
  overrides: ProfileOverrides,
): ProjectProfile {
  const commands: ProfileCommands = { ...detected.commands };

  for (const key of ["test", "typecheck", "lint", "build", "format"] as const) {
    const override = overrides[key];
    if (override !== undefined) {
      // Empty string means explicitly disabled → null
      commands[key] = override === "" ? null : override;
    }
  }

  const verify = buildVerifyCommand(commands);

  return {
    ...detected,
    commands,
    verify,
  };
}

// ─── Exported for testing ────────────────────────────────────────

export { PRESETS, buildVerifyCommand };
