import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  detectProfile,
  detectVerificationWarnings,
  getPreset,
  mergeProfileOverrides,
  PRESETS,
  buildVerifyCommand,
  type ProfileOverrides,
} from "./profile.js";
import type { ProjectProfile, ProfileCommands } from "./schemas.js";

// ─── Helpers ──────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ralph-profile-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Write a package.json with optional scripts and workspaces */
function writePackageJson(
  dir: string,
  opts: {
    scripts?: Record<string, string>;
    workspaces?: string[];
  } = {},
) {
  const pkg: Record<string, unknown> = { name: "test-project", version: "1.0.0" };
  if (opts.scripts) pkg.scripts = opts.scripts;
  if (opts.workspaces) pkg.workspaces = opts.workspaces;
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg, null, 2));
}

/** Touch a file (create empty) */
function touch(dir: string, filename: string) {
  fs.writeFileSync(path.join(dir, filename), "");
}

// ═══════════════════════════════════════════════════════════════════
// detectProfile — Language/Runtime Detection
// ═══════════════════════════════════════════════════════════════════

describe("detectProfile — language detection", () => {
  it("detects Node.js/TypeScript with pnpm correctly", () => {
    writePackageJson(tmpDir, {
      scripts: { test: "vitest", typecheck: "tsc --noEmit", lint: "eslint .", build: "tsc" },
    });
    touch(tmpDir, "tsconfig.json");
    touch(tmpDir, "pnpm-lock.yaml");

    const profile = detectProfile(tmpDir);

    expect(profile.stack).toBe("node-typescript");
    expect(profile.packageManager).toBe("pnpm");
    expect(profile.commands.test).toBe("pnpm test");
    expect(profile.commands.typecheck).toBe("pnpm typecheck");
    expect(profile.commands.lint).toBe("pnpm lint");
    expect(profile.commands.build).toBe("pnpm build");
  });

  it("detects Node.js/JavaScript (no tsconfig.json)", () => {
    writePackageJson(tmpDir, {
      scripts: { test: "jest", lint: "eslint ." },
    });
    touch(tmpDir, "package-lock.json");

    const profile = detectProfile(tmpDir);

    expect(profile.stack).toBe("node-javascript");
    expect(profile.packageManager).toBe("npm");
  });

  it("detects Python from pyproject.toml", () => {
    touch(tmpDir, "pyproject.toml");

    const profile = detectProfile(tmpDir);

    expect(profile.stack).toBe("python");
    expect(profile.packageManager).toBeNull();
    expect(profile.commands.test).toBe("pytest");
    expect(profile.commands.typecheck).toBe("mypy .");
    expect(profile.commands.lint).toBe("ruff check .");
  });

  it("detects Python from setup.py", () => {
    touch(tmpDir, "setup.py");

    const profile = detectProfile(tmpDir);
    expect(profile.stack).toBe("python");
  });

  it("detects Python from requirements.txt", () => {
    touch(tmpDir, "requirements.txt");

    const profile = detectProfile(tmpDir);
    expect(profile.stack).toBe("python");
  });

  it("detects Go from go.mod", () => {
    touch(tmpDir, "go.mod");

    const profile = detectProfile(tmpDir);

    expect(profile.stack).toBe("go");
    expect(profile.packageManager).toBeNull();
    expect(profile.commands.test).toBe("go test ./...");
    expect(profile.commands.typecheck).toBe("go vet ./...");
    expect(profile.commands.build).toBe("go build ./...");
  });

  it("detects Rust from Cargo.toml", () => {
    touch(tmpDir, "Cargo.toml");

    const profile = detectProfile(tmpDir);

    expect(profile.stack).toBe("rust");
    expect(profile.packageManager).toBeNull();
    expect(profile.commands.test).toBe("cargo test");
    expect(profile.commands.typecheck).toBe("cargo check");
    expect(profile.commands.lint).toBe("cargo clippy");
    expect(profile.commands.build).toBe("cargo build");
  });

  it("returns unknown for empty directory", () => {
    const profile = detectProfile(tmpDir);

    expect(profile.stack).toBe("unknown");
    expect(profile.packageManager).toBeNull();
    expect(profile.commands.test).toBeNull();
    expect(profile.commands.typecheck).toBeNull();
    expect(profile.commands.lint).toBeNull();
    expect(profile.commands.build).toBeNull();
    expect(profile.commands.format).toBeNull();
    expect(profile.verify).toBe("");
  });

  it("first indicator wins when multiple languages present", () => {
    // package.json comes before go.mod in detection order
    writePackageJson(tmpDir, { scripts: { test: "jest" } });
    touch(tmpDir, "go.mod");

    const profile = detectProfile(tmpDir);
    // package.json is checked first → detected as node
    expect(profile.stack).toBe("node-javascript");
  });
});

// ═══════════════════════════════════════════════════════════════════
// detectProfile — Package Manager Detection
// ═══════════════════════════════════════════════════════════════════

describe("detectProfile — package manager detection", () => {
  it("detects pnpm from pnpm-lock.yaml", () => {
    writePackageJson(tmpDir);
    touch(tmpDir, "pnpm-lock.yaml");

    const profile = detectProfile(tmpDir);
    expect(profile.packageManager).toBe("pnpm");
  });

  it("detects bun from bun.lockb", () => {
    writePackageJson(tmpDir);
    touch(tmpDir, "bun.lockb");

    const profile = detectProfile(tmpDir);
    expect(profile.packageManager).toBe("bun");
  });

  it("detects bun from bun.lock", () => {
    writePackageJson(tmpDir);
    touch(tmpDir, "bun.lock");

    const profile = detectProfile(tmpDir);
    expect(profile.packageManager).toBe("bun");
  });

  it("detects yarn from yarn.lock", () => {
    writePackageJson(tmpDir);
    touch(tmpDir, "yarn.lock");

    const profile = detectProfile(tmpDir);
    expect(profile.packageManager).toBe("yarn");
  });

  it("detects npm from package-lock.json", () => {
    writePackageJson(tmpDir);
    touch(tmpDir, "package-lock.json");

    const profile = detectProfile(tmpDir);
    expect(profile.packageManager).toBe("npm");
  });

  it("defaults to npm when no lock file found", () => {
    writePackageJson(tmpDir);

    const profile = detectProfile(tmpDir);
    expect(profile.packageManager).toBe("npm");
  });

  it("pnpm-lock.yaml takes priority over yarn.lock", () => {
    writePackageJson(tmpDir);
    touch(tmpDir, "pnpm-lock.yaml");
    touch(tmpDir, "yarn.lock");

    const profile = detectProfile(tmpDir);
    expect(profile.packageManager).toBe("pnpm");
  });

  it("non-Node.js projects have null package manager", () => {
    touch(tmpDir, "go.mod");

    const profile = detectProfile(tmpDir);
    expect(profile.packageManager).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// detectProfile — Monorepo Detection
// ═══════════════════════════════════════════════════════════════════

describe("detectProfile — monorepo detection", () => {
  it("detects monorepo from pnpm-workspace.yaml", () => {
    writePackageJson(tmpDir);
    touch(tmpDir, "pnpm-workspace.yaml");
    touch(tmpDir, "pnpm-lock.yaml");

    const profile = detectProfile(tmpDir);
    expect(profile.monorepo).toBe(true);
  });

  it("detects monorepo from lerna.json", () => {
    writePackageJson(tmpDir);
    touch(tmpDir, "lerna.json");

    const profile = detectProfile(tmpDir);
    expect(profile.monorepo).toBe(true);
  });

  it("detects monorepo from package.json workspaces field", () => {
    writePackageJson(tmpDir, {
      workspaces: ["packages/*"],
      scripts: { test: "vitest" },
    });

    const profile = detectProfile(tmpDir);
    expect(profile.monorepo).toBe(true);
  });

  it("non-monorepo project returns false", () => {
    writePackageJson(tmpDir);

    const profile = detectProfile(tmpDir);
    expect(profile.monorepo).toBe(false);
  });

  it("non-Node.js project with lerna.json detects monorepo", () => {
    // Unusual but technically possible
    touch(tmpDir, "go.mod");
    touch(tmpDir, "lerna.json");

    const profile = detectProfile(tmpDir);
    expect(profile.monorepo).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// detectProfile — Command Derivation
// ═══════════════════════════════════════════════════════════════════

describe("detectProfile — command derivation", () => {
  it("only suggests commands that exist in package.json scripts", () => {
    writePackageJson(tmpDir, {
      scripts: { test: "vitest", build: "tsc" },
      // no typecheck, lint, or format scripts
    });
    touch(tmpDir, "tsconfig.json");
    touch(tmpDir, "pnpm-lock.yaml");

    const profile = detectProfile(tmpDir);

    expect(profile.commands.test).toBe("pnpm test");
    expect(profile.commands.build).toBe("pnpm build");
    expect(profile.commands.typecheck).toBeNull();
    expect(profile.commands.lint).toBeNull();
    expect(profile.commands.format).toBeNull();
  });

  it("uses 'npm run' prefix for npm package manager", () => {
    writePackageJson(tmpDir, {
      scripts: { test: "jest", lint: "eslint ." },
    });
    touch(tmpDir, "package-lock.json");

    const profile = detectProfile(tmpDir);

    expect(profile.commands.test).toBe("npm run test");
    expect(profile.commands.lint).toBe("npm run lint");
  });

  it("uses package manager name directly for pnpm", () => {
    writePackageJson(tmpDir, {
      scripts: { test: "vitest" },
    });
    touch(tmpDir, "pnpm-lock.yaml");

    const profile = detectProfile(tmpDir);
    expect(profile.commands.test).toBe("pnpm test");
  });

  it("uses package manager name directly for yarn", () => {
    writePackageJson(tmpDir, {
      scripts: { test: "jest" },
    });
    touch(tmpDir, "yarn.lock");

    const profile = detectProfile(tmpDir);
    expect(profile.commands.test).toBe("yarn test");
  });

  it("uses package manager name directly for bun", () => {
    writePackageJson(tmpDir, {
      scripts: { test: "bun:test" },
    });
    touch(tmpDir, "bun.lockb");

    const profile = detectProfile(tmpDir);
    expect(profile.commands.test).toBe("bun test");
  });

  it("detects format:check script with higher priority than format", () => {
    writePackageJson(tmpDir, {
      scripts: { "format:check": "prettier --check .", format: "prettier --write ." },
    });

    const profile = detectProfile(tmpDir);
    expect(profile.commands.format).toBe("npm run format:check");
  });

  it("falls back to format script when format:check doesn't exist", () => {
    writePackageJson(tmpDir, {
      scripts: { format: "prettier --write ." },
    });

    const profile = detectProfile(tmpDir);
    expect(profile.commands.format).toBe("npm run format");
  });

  it("all commands null when package.json has no scripts", () => {
    writePackageJson(tmpDir);

    const profile = detectProfile(tmpDir);

    expect(profile.commands.test).toBeNull();
    expect(profile.commands.typecheck).toBeNull();
    expect(profile.commands.lint).toBeNull();
    expect(profile.commands.build).toBeNull();
    expect(profile.commands.format).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// detectProfile — Verify Command
// ═══════════════════════════════════════════════════════════════════

describe("detectProfile — verify command", () => {
  it("joins non-null commands with ' && '", () => {
    writePackageJson(tmpDir, {
      scripts: { test: "vitest", typecheck: "tsc --noEmit", lint: "eslint ." },
    });
    touch(tmpDir, "tsconfig.json");
    touch(tmpDir, "pnpm-lock.yaml");

    const profile = detectProfile(tmpDir);
    expect(profile.verify).toBe("pnpm test && pnpm typecheck && pnpm lint");
  });

  it("returns empty string when all commands are null", () => {
    const profile = detectProfile(tmpDir);
    expect(profile.verify).toBe("");
  });

  it("single command produces no ' && '", () => {
    writePackageJson(tmpDir, {
      scripts: { test: "vitest" },
    });

    const profile = detectProfile(tmpDir);
    expect(profile.verify).toBe("npm run test");
    expect(profile.verify).not.toContain("&&");
  });
});

// ═══════════════════════════════════════════════════════════════════
// buildVerifyCommand
// ═══════════════════════════════════════════════════════════════════

describe("buildVerifyCommand", () => {
  it("joins non-null commands in order: test, typecheck, lint, build, format", () => {
    const commands: ProfileCommands = {
      test: "a",
      typecheck: "b",
      lint: "c",
      build: "d",
      format: "e",
    };

    expect(buildVerifyCommand(commands)).toBe("a && b && c && d && e");
  });

  it("skips null commands", () => {
    const commands: ProfileCommands = {
      test: "a",
      typecheck: null,
      lint: "c",
      build: null,
      format: null,
    };

    expect(buildVerifyCommand(commands)).toBe("a && c");
  });

  it("returns empty string when all null", () => {
    const commands: ProfileCommands = {
      test: null,
      typecheck: null,
      lint: null,
      build: null,
      format: null,
    };

    expect(buildVerifyCommand(commands)).toBe("");
  });
});

// ═══════════════════════════════════════════════════════════════════
// getPreset
// ═══════════════════════════════════════════════════════════════════

describe("getPreset", () => {
  it("returns node-typescript preset with correct defaults", () => {
    const preset = getPreset("node-typescript");

    expect(preset.stack).toBe("node-typescript");
    expect(preset.packageManager).toBe("npm");
    expect(preset.monorepo).toBe(false);
    expect(preset.commands.test).toBe("npm test");
    expect(preset.commands.typecheck).toBe("npx tsc --noEmit");
    expect(preset.commands.lint).toBe("npm run lint");
    expect(preset.commands.build).toBe("npm run build");
    expect(preset.verify).toContain("npm test");
  });

  it("returns node-javascript preset without typecheck", () => {
    const preset = getPreset("node-javascript");

    expect(preset.stack).toBe("node-javascript");
    expect(preset.commands.typecheck).toBeNull();
    expect(preset.verify).not.toContain("tsc");
  });

  it("returns python preset", () => {
    const preset = getPreset("python");

    expect(preset.stack).toBe("python");
    expect(preset.packageManager).toBeNull();
    expect(preset.commands.test).toBe("pytest");
    expect(preset.commands.typecheck).toBe("mypy .");
    expect(preset.commands.lint).toBe("ruff check .");
  });

  it("returns go preset", () => {
    const preset = getPreset("go");

    expect(preset.stack).toBe("go");
    expect(preset.commands.test).toBe("go test ./...");
    expect(preset.commands.typecheck).toBe("go vet ./...");
    expect(preset.commands.build).toBe("go build ./...");
  });

  it("returns rust preset", () => {
    const preset = getPreset("rust");

    expect(preset.stack).toBe("rust");
    expect(preset.commands.test).toBe("cargo test");
    expect(preset.commands.typecheck).toBe("cargo check");
    expect(preset.commands.lint).toBe("cargo clippy");
    expect(preset.commands.build).toBe("cargo build");
  });

  it("returns custom preset with all null commands", () => {
    const preset = getPreset("custom");

    expect(preset.stack).toBe("custom");
    expect(preset.packageManager).toBeNull();
    expect(preset.commands.test).toBeNull();
    expect(preset.commands.typecheck).toBeNull();
    expect(preset.commands.lint).toBeNull();
    expect(preset.commands.build).toBeNull();
    expect(preset.commands.format).toBeNull();
    expect(preset.verify).toBe("");
  });

  it("returns custom preset for unknown preset names", () => {
    const preset = getPreset("nonexistent");

    expect(preset.stack).toBe("custom");
    expect(preset.verify).toBe("");
  });

  it("returns a copy, not a reference to the preset object", () => {
    const preset1 = getPreset("go");
    const preset2 = getPreset("go");

    preset1.commands.test = "modified";

    expect(preset2.commands.test).toBe("go test ./...");
  });

  it("all defined presets have matching verify string", () => {
    for (const name of Object.keys(PRESETS)) {
      const preset = getPreset(name);
      // Rebuild verify from commands and compare
      const rebuilt = buildVerifyCommand(preset.commands);
      expect(preset.verify).toBe(rebuilt);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// mergeProfileOverrides
// ═══════════════════════════════════════════════════════════════════

describe("mergeProfileOverrides", () => {
  const baseProfile: ProjectProfile = {
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
  };

  it("applies overrides to specific commands", () => {
    const overrides: ProfileOverrides = {
      test: "vitest run",
      lint: "biome check",
    };

    const result = mergeProfileOverrides(baseProfile, overrides);

    expect(result.commands.test).toBe("vitest run");
    expect(result.commands.lint).toBe("biome check");
    // Unchanged
    expect(result.commands.typecheck).toBe("pnpm typecheck");
    expect(result.commands.build).toBe("pnpm build");
  });

  it("empty string override disables a command (sets null)", () => {
    const overrides: ProfileOverrides = {
      typecheck: "",
      lint: "",
    };

    const result = mergeProfileOverrides(baseProfile, overrides);

    expect(result.commands.typecheck).toBeNull();
    expect(result.commands.lint).toBeNull();
  });

  it("recalculates verify after applying overrides", () => {
    const overrides: ProfileOverrides = {
      typecheck: "",
    };

    const result = mergeProfileOverrides(baseProfile, overrides);

    expect(result.verify).toBe("pnpm test && pnpm lint && pnpm build");
    expect(result.verify).not.toContain("typecheck");
  });

  it("empty overrides returns equivalent profile", () => {
    const result = mergeProfileOverrides(baseProfile, {});

    expect(result.commands).toEqual(baseProfile.commands);
    expect(result.verify).toBe(baseProfile.verify);
  });

  it("does not mutate the original profile", () => {
    const original = { ...baseProfile, commands: { ...baseProfile.commands } };
    const overrides: ProfileOverrides = { test: "custom-test" };

    mergeProfileOverrides(baseProfile, overrides);

    expect(baseProfile.commands.test).toBe(original.commands.test);
  });

  it("preserves non-command fields from detected profile", () => {
    const overrides: ProfileOverrides = { test: "custom" };

    const result = mergeProfileOverrides(baseProfile, overrides);

    expect(result.stack).toBe("node-typescript");
    expect(result.packageManager).toBe("pnpm");
    expect(result.monorepo).toBe(false);
  });

  it("can override all commands at once", () => {
    const overrides: ProfileOverrides = {
      test: "custom-test",
      typecheck: "custom-typecheck",
      lint: "custom-lint",
      build: "custom-build",
      format: "custom-format",
    };

    const result = mergeProfileOverrides(baseProfile, overrides);

    expect(result.commands.test).toBe("custom-test");
    expect(result.commands.typecheck).toBe("custom-typecheck");
    expect(result.commands.lint).toBe("custom-lint");
    expect(result.commands.build).toBe("custom-build");
    expect(result.commands.format).toBe("custom-format");
    expect(result.verify).toBe(
      "custom-test && custom-typecheck && custom-lint && custom-build && custom-format",
    );
  });

  it("can enable a previously null command", () => {
    const overrides: ProfileOverrides = {
      format: "prettier --check .",
    };

    const result = mergeProfileOverrides(baseProfile, overrides);

    expect(result.commands.format).toBe("prettier --check .");
    expect(result.verify).toContain("prettier --check .");
  });
});

// ═══════════════════════════════════════════════════════════════════
// Edge Cases
// ═══════════════════════════════════════════════════════════════════

describe("detectProfile — edge cases", () => {
  it("handles malformed package.json gracefully", () => {
    fs.writeFileSync(path.join(tmpDir, "package.json"), "{ not valid json }");

    // Should still detect as node (file exists), but commands will be null
    // because package.json parsing fails
    const profile = detectProfile(tmpDir);

    expect(profile.stack).toBe("node-javascript");
    expect(profile.commands.test).toBeNull();
    expect(profile.commands.build).toBeNull();
  });

  it("handles package.json without scripts key", () => {
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ name: "no-scripts" }));

    const profile = detectProfile(tmpDir);

    expect(profile.stack).toBe("node-javascript");
    expect(profile.commands.test).toBeNull();
  });

  it("resolves relative paths", () => {
    writePackageJson(tmpDir, { scripts: { test: "vitest" } });
    touch(tmpDir, "tsconfig.json");

    // Using the absolute tmpDir is the normal pattern, but detectProfile
    // should handle it fine via path.resolve
    const profile = detectProfile(tmpDir);
    expect(profile.stack).toBe("node-typescript");
  });

  it("handles nonexistent directory gracefully", () => {
    const profile = detectProfile(path.join(tmpDir, "nonexistent"));

    expect(profile.stack).toBe("unknown");
    expect(profile.packageManager).toBeNull();
    expect(profile.monorepo).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// detectProfile — dispatcher script fallback (GH#85)
// ═══════════════════════════════════════════════════════════════════

/** Write an executable-looking scripts/verify.sh dispatcher */
function writeDispatcherScript(dir: string): void {
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "scripts", "verify.sh"),
    '#!/usr/bin/env bash\necho "verify $1"\n',
  );
}

describe("detectProfile — dispatcher script fallback", () => {
  it("falls back to scripts/verify.sh when normal detection finds nothing", () => {
    writeDispatcherScript(tmpDir);

    const profile = detectProfile(tmpDir);

    expect(profile.verify).not.toBe("");
    expect(profile.commands.test).toBe("bash scripts/verify.sh test");
    expect(profile.commands.typecheck).toBe("bash scripts/verify.sh typecheck");
    expect(profile.commands.lint).toBe("bash scripts/verify.sh lint");
    expect(profile.commands.build).toBe("bash scripts/verify.sh build");
    expect(profile.commands.format).toBe("bash scripts/verify.sh format");
    expect(profile.verify).toContain("bash scripts/verify.sh");
  });

  it("does not fire when normal detection already produced commands (a named test script wins)", () => {
    writePackageJson(tmpDir, { scripts: { test: "vitest" } });
    writeDispatcherScript(tmpDir);

    const profile = detectProfile(tmpDir);

    expect(profile.commands.test).toBe("npm run test");
    expect(profile.commands.typecheck).toBeNull();
    expect(profile.verify).not.toContain("scripts/verify.sh");
  });

  it("stack remains unknown even when the dispatcher fallback fires", () => {
    writeDispatcherScript(tmpDir);

    const profile = detectProfile(tmpDir);
    expect(profile.stack).toBe("unknown");
  });

  it("does not fire when no dispatcher script exists (empty verify stays empty)", () => {
    const profile = detectProfile(tmpDir);
    expect(profile.verify).toBe("");
  });

  it("does not fire when allowDispatcherGuess is false, even with a dispatcher script present", () => {
    writeDispatcherScript(tmpDir);

    const profile = detectProfile(tmpDir, { allowDispatcherGuess: false });

    expect(profile.verify).toBe("");
    expect(profile.commands.test).toBeNull();
  });

  it("fires by default (allowDispatcherGuess defaults to true)", () => {
    writeDispatcherScript(tmpDir);

    const profile = detectProfile(tmpDir, {});

    expect(profile.verify).not.toBe("");
    expect(profile.commands.test).toBe("bash scripts/verify.sh test");
  });

  it("does not treat a scripts/verify DIRECTORY as a dispatcher script (fileExists vs isRegularFile)", () => {
    // A directory named like a dispatcher candidate must not false-positive.
    fs.mkdirSync(path.join(tmpDir, "scripts", "verify"), { recursive: true });

    const profile = detectProfile(tmpDir);

    expect(profile.verify).toBe("");
    expect(profile.commands.test).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// detectVerificationWarnings (GH#85)
// ═══════════════════════════════════════════════════════════════════

describe("detectVerificationWarnings", () => {
  it("warns when the profile has no verification commands at all", () => {
    const profile = detectProfile(tmpDir); // empty dir → all null, verify === ""

    const warnings = detectVerificationWarnings(tmpDir, profile);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("No verification commands detected");
    expect(warnings[0]).toContain("--test-cmd");
    expect(warnings[0]).toContain("rauf profile set");
  });

  it("warns (more mildly) when commands were dispatcher-inferred", () => {
    writeDispatcherScript(tmpDir);
    const profile = detectProfile(tmpDir);

    const warnings = detectVerificationWarnings(tmpDir, profile);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("dispatcher script");
    expect(warnings[0]).toContain("scripts/verify.sh");
    expect(warnings[0]).not.toContain("No verification commands detected");
  });

  it("does not warn for a normally-detected, non-empty profile", () => {
    writePackageJson(tmpDir, { scripts: { test: "vitest", lint: "eslint ." } });
    const profile = detectProfile(tmpDir);

    const warnings = detectVerificationWarnings(tmpDir, profile);

    expect(warnings).toEqual([]);
  });

  it("does not warn when a dispatcher script exists but wasn't actually used", () => {
    // Dispatcher present, but normal detection already found commands — the
    // profile's commands don't start with "bash scripts/verify.sh".
    writePackageJson(tmpDir, { scripts: { test: "vitest" } });
    writeDispatcherScript(tmpDir);
    const profile = detectProfile(tmpDir);

    const warnings = detectVerificationWarnings(tmpDir, profile);
    expect(warnings).toEqual([]);
  });

  it("warns when a command references a dispatcher-shaped script that no longer exists on disk", () => {
    // scripts/verify.sh does NOT exist — simulates a deleted/renamed dispatcher
    // whose guessed commands were persisted to the profile at some earlier
    // point (either by the dispatcher-guess fallback, or hand-configured).
    const profile: ProjectProfile = {
      stack: "unknown",
      packageManager: null,
      monorepo: false,
      commands: {
        test: "bash scripts/verify.sh test",
        typecheck: "bash scripts/verify.sh typecheck",
        lint: null,
        build: null,
        format: null,
      },
      verify: "bash scripts/verify.sh test && bash scripts/verify.sh typecheck",
    };

    const warnings = detectVerificationWarnings(tmpDir, profile);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("scripts/verify.sh");
    expect(warnings[0]).toContain("no longer exists");
  });

  it("still warns about a stale dispatcher reference even when DISPATCHER_SCRIPT_CANDIDATES no longer matches (script deleted)", () => {
    // Regression check: the stale-script warning must NOT depend on a live
    // detectDispatcherScript() probe succeeding — that probe returns null once
    // the script is gone, which previously made the warning stop firing
    // entirely (the exact "stale profile" case the feature exists to catch).
    writeDispatcherScript(tmpDir);
    const profile = detectProfile(tmpDir);
    expect(profile.commands.test).toBe("bash scripts/verify.sh test"); // sanity

    // Now delete the dispatcher script — detectDispatcherScript(tmpDir) is null.
    fs.rmSync(path.join(tmpDir, "scripts", "verify.sh"));

    const warnings = detectVerificationWarnings(tmpDir, profile);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("no longer exists");
  });

  it("does not mislabel a deliberately-configured command that merely shares the dispatcher path as a string prefix", () => {
    fs.mkdirSync(path.join(tmpDir, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "scripts", "verify"), "#!/usr/bin/env bash\n"); // dispatcher candidate
    fs.writeFileSync(path.join(tmpDir, "scripts", "verify-full.sh"), "#!/usr/bin/env bash\n"); // unrelated script

    const profile: ProjectProfile = {
      stack: "unknown",
      packageManager: null,
      monorepo: false,
      commands: {
        test: "bash scripts/verify-full.sh test",
        typecheck: null,
        lint: null,
        build: null,
        format: null,
      },
      verify: "bash scripts/verify-full.sh test",
    };

    const warnings = detectVerificationWarnings(tmpDir, profile);
    expect(warnings).toEqual([]);
  });
});
