import * as fs from "node:fs";
import * as path from "node:path";

import { type Result, ok, err, ErrorCodes } from "./errors.js";
import { atomicWrite, computeHash, fileExists, ensureDir, readJsonFile } from "./fs-utils.js";
import {
  BacklogSchema,
  type MarkerFile,
  type InstallAction,
  type InstallationReport,
  type ProjectProfile,
  type MarkerOptions,
} from "./schemas.js";
import { readMarkerFile, writeMarkerFile, MARKER_FILENAME } from "./config.js";
import { detectProfile, mergeProfileOverrides, type ProfileOverrides } from "./profile.js";
import { renderTemplate, updateSentinelBlock } from "./template.js";
import {
  mergeClaudeMd,
  extractRalphBlock,
  CLAUDE_MD_SENTINEL_START,
  CLAUDE_MD_SENTINEL_END,
} from "./claude-md.js";
import { getEmbeddedArtifact } from "./embedded-artifacts.js";

// Avoid circular import by not importing VERSION from index.ts
// This will be set to match the version in index.ts
const TOOL_VERSION = "0.1.0";

// ─── Constants ────────────────────────────────────────────────────

/** Name of the .ralph directory — duplicated here to avoid circular imports with status.ts */
const DOT_RALPH = ".ralph";

/** Files deployed inside .ralph/ */
const DIR_FILES = {
  ralphMd: "RALPH.md",
  ralphMdTemplate: ".ralph/RALPH.md.tmpl",
  backlog: ".ralph/backlog.json",
  progress: ".ralph/progress.md",
  backlogSchema: ".ralph/backlog.schema.json",
} as const;

/** Template used for CLAUDE.md merge — not deployed directly */
const CLAUDE_ADDON_FILE = "CLAUDE_ADDON.md";

/** Sentinels for the managed block in RALPH.md */
const RALPH_MD_MANAGED_START = "<!-- ralph:managed:start -->";
const RALPH_MD_MANAGED_END = "<!-- ralph:managed:end -->";

// ─── Artifact reading ─────────────────────────────────────────────

/**
 * Read an artifact's content. If artifactsDir is provided, reads from
 * the filesystem (development mode). Otherwise reads from embedded
 * artifacts (compiled binary mode).
 */
function readArtifact(relativePath: string, artifactsDir?: string): Result<string> {
  if (artifactsDir) {
    const fullPath = path.join(artifactsDir, relativePath);
    try {
      return ok(fs.readFileSync(fullPath, "utf-8"));
    } catch (e) {
      return err({
        code: ErrorCodes.FILE_NOT_FOUND,
        message: `Artifact not found: ${fullPath}`,
        details: { path: fullPath, cause: e instanceof Error ? e.message : String(e) },
      });
    }
  }

  try {
    return ok(getEmbeddedArtifact(relativePath));
  } catch (e) {
    return err({
      code: ErrorCodes.FILE_NOT_FOUND,
      message: `Embedded artifact not found: ${relativePath}`,
      details: { path: relativePath, cause: e instanceof Error ? e.message : String(e) },
    });
  }
}

// ─── Types ────────────────────────────────────────────────────────

export interface InstallOptions {
  /** Path to canonical artifacts on disk (optional — defaults to embedded artifacts) */
  artifactsDir?: string;
  /** Profile command overrides */
  profileOverrides?: ProfileOverrides;
  /** Marker file options overrides */
  options?: Partial<MarkerOptions>;
  /** Project name for backlog.json */
  projectName?: string;
  /** Project description for backlog.json */
  projectDescription?: string;
}

export interface UpdateOptions {
  /** Path to canonical artifacts on disk (optional — defaults to embedded artifacts) */
  artifactsDir?: string;
}

export interface UninstallOptions {
  /** Keep .ralph/backlog.json (default: true) */
  keepBacklog?: boolean;
  /** Keep .ralph/progress.md (default: true) */
  keepProgress?: boolean;
  /** Keep .ralph/ralph.log (default: true) */
  keepLog?: boolean;
  /** Remove ralph section from CLAUDE.md (default: true) */
  removeClaudeMdSection?: boolean;
}

export interface PreflightCheck {
  name: string;
  passed: boolean;
  message: string;
  severity: "error" | "warning";
}

export interface PreflightResult {
  passed: boolean;
  checks: PreflightCheck[];
}

// ─── preflight ────────────────────────────────────────────────────
//
// Run preflight checks before installation. Returns a structured
// result with individual check results and an overall pass/fail.

export function preflight(projectPath: string): PreflightResult {
  const resolved = path.resolve(projectPath);
  const checks: PreflightCheck[] = [];

  // 1. Directory exists?
  const dirExists = fs.existsSync(resolved) && fs.statSync(resolved).isDirectory();
  checks.push({
    name: "directory_exists",
    passed: dirExists,
    message: dirExists ? `Directory exists: ${resolved}` : `Directory not found: ${resolved}`,
    severity: "error",
  });

  // 2. Git repo?
  const isGitRepo = dirExists && fileExists(path.join(resolved, ".git"));
  checks.push({
    name: "git_repo",
    passed: isGitRepo,
    message: isGitRepo
      ? "Git repository detected"
      : "Not a git repository (recommended for version control)",
    severity: "warning",
  });

  // 3. Already installed?
  const alreadyInstalled = dirExists && fileExists(path.join(resolved, MARKER_FILENAME));
  checks.push({
    name: "not_already_installed",
    passed: !alreadyInstalled,
    message: alreadyInstalled
      ? "Ralph is already installed (.ralph.json exists). Use update() instead."
      : "No existing installation found",
    severity: "error",
  });

  // 4. claude in PATH?
  const hasClaude = isCommandInPath("claude");
  checks.push({
    name: "claude_available",
    passed: hasClaude,
    message: hasClaude
      ? "claude found in PATH"
      : "claude CLI not found in PATH (required to run the loop)",
    severity: "warning",
  });

  // Overall pass: all error-severity checks must pass
  const passed = checks.filter((c) => c.severity === "error").every((c) => c.passed);

  return { passed, checks };
}

// ─── install ──────────────────────────────────────────────────────
//
// Full installation flow for existing projects.
// Idempotent: running twice produces the same result.

export function install(projectPath: string, options: InstallOptions): Result<InstallationReport> {
  const resolved = path.resolve(projectPath);
  const artifactsDir = options.artifactsDir ? path.resolve(options.artifactsDir) : undefined;
  const actions: InstallAction[] = [];
  const warnings: string[] = [];

  // 1. Preflight checks
  const preflightResult = preflight(resolved);
  for (const check of preflightResult.checks) {
    if (!check.passed && check.severity === "warning") {
      warnings.push(check.message);
    }
  }

  // Check for hard errors (except already_installed — we handle idempotency)
  const dirCheck = preflightResult.checks.find((c) => c.name === "directory_exists");
  if (dirCheck && !dirCheck.passed) {
    return err({
      code: ErrorCodes.FILE_NOT_FOUND,
      message: `Project directory not found: ${resolved}`,
      details: { path: resolved },
    });
  }

  // If already installed, treat as idempotent — update instead of erroring
  const alreadyInstalledCheck = preflightResult.checks.find(
    (c) => c.name === "not_already_installed",
  );
  const isReinstall = alreadyInstalledCheck && !alreadyInstalledCheck.passed;

  // Read existing marker options to preserve them during re-install
  let existingOptions: MarkerOptions | undefined;
  if (isReinstall) {
    const existingMarker = readMarkerFile(resolved);
    if (existingMarker.ok) {
      existingOptions = existingMarker.value.options;
    }
  }

  // 2. Profile detection + overrides
  const profile = options.profileOverrides
    ? mergeProfileOverrides(detectProfile(resolved), options.profileOverrides)
    : detectProfile(resolved);

  // 3. Create .ralph/ directory
  const ralphDir = path.join(resolved, DOT_RALPH);
  const dirResult = ensureDir(ralphDir);
  if (!dirResult.ok) return dirResult;

  // 4. Prepare artifact tracking
  const artifactHashes: Record<string, string> = {};

  // 5. Render RALPH.md from template
  const templateVars = buildTemplateVars(profile);
  const ralphMdResult = deployRalphMd(ralphDir, templateVars, artifactsDir);
  if (!ralphMdResult.ok) return ralphMdResult;
  actions.push(ralphMdResult.value);

  // Hash the rendered RALPH.md
  const ralphMdPath = path.join(ralphDir, DIR_FILES.ralphMd);
  const ralphMdHash = computeHash(ralphMdPath);
  if (ralphMdHash.ok) {
    artifactHashes["RALPH.md"] = ralphMdHash.value;
  }

  // 6. Create backlog.json if missing, validate if exists
  const backlogResult = deployBacklog(
    ralphDir,
    options.projectName,
    options.projectDescription,
    artifactsDir,
  );
  if (!backlogResult.ok) return backlogResult;
  actions.push(backlogResult.value);

  // 7. Copy progress.md if missing
  const progressResult = deployProgress(ralphDir, artifactsDir);
  if (!progressResult.ok) return progressResult;
  actions.push(progressResult.value);

  // 8. Deploy backlog.schema.json (tool-managed, always overwrite)
  const schemaContentResult = readArtifact(DIR_FILES.backlogSchema, artifactsDir);
  if (schemaContentResult.ok) {
    fs.writeFileSync(
      path.join(resolved, ".ralph", "backlog.schema.json"),
      schemaContentResult.value,
      "utf-8",
    );
    actions.push({
      file: ".ralph/backlog.schema.json",
      action: "created",
      detail: "JSON Schema for editor validation",
    });
  }

  // 9. CLAUDE.md smart merge
  const claudeMdResult = deployClaudeMd(resolved, artifactsDir);
  if (!claudeMdResult.ok) return claudeMdResult;
  actions.push(claudeMdResult.value);

  // 10. Write .ralph.json marker file
  // On re-install, preserve existing options unless explicitly overridden
  const markerOptions: MarkerOptions = {
    ignoreInTool: options.options?.ignoreInTool ?? existingOptions?.ignoreInTool ?? false,
    gitignoreScripts:
      options.options?.gitignoreScripts ?? existingOptions?.gitignoreScripts ?? false,
    maxIterations: options.options?.maxIterations ?? existingOptions?.maxIterations ?? 20,
  };

  const marker: MarkerFile = {
    ralph: true,
    version: "1",
    variant: "backlog-json",
    installedAt: new Date().toISOString(),
    installedBy: `ralph-manager@${TOOL_VERSION}`,
    profile,
    artifactHashes,
    options: markerOptions,
  };

  const markerResult = writeMarkerFile(resolved, marker);
  if (!markerResult.ok) return markerResult;

  const markerAction: InstallAction = isReinstall
    ? { file: MARKER_FILENAME, action: "updated", detail: "Updated .ralph.json marker file" }
    : { file: MARKER_FILENAME, action: "created", detail: "Created .ralph.json marker file" };
  actions.push(markerAction);

  // Determine project name for report
  const projectName = options.projectName || path.basename(resolved);

  return ok({
    projectName,
    projectPath: resolved,
    actions,
    profile,
    warnings,
  });
}

// ─── checkArtifactStaleness ───────────────────────────────────────
//
// Previously checked script staleness via three-way hash comparison.
// Scripts have been removed; this now always returns an empty report.
// Kept for API compatibility with the web frontend.

export type ArtifactFileStatus =
  | "up_to_date"
  | "safe_update"
  | "local_only"
  | "conflict"
  | "missing";

export type ArtifactStalenessReport = {
  files: Record<string, ArtifactFileStatus>;
  updatesAvailable: number;
  conflicts: number;
};

export function checkArtifactStaleness(
  projectPath: string,
  _options: UpdateOptions = {},
): Result<ArtifactStalenessReport> {
  const resolved = path.resolve(projectPath);

  const markerResult = readMarkerFile(resolved);
  if (!markerResult.ok) {
    return err({
      code: ErrorCodes.NOT_INSTALLED,
      message: `Ralph is not installed in ${resolved}`,
      details: { path: resolved },
    });
  }

  return ok({ files: {}, updatesAvailable: 0, conflicts: 0 });
}

// ─── update ───────────────────────────────────────────────────────
//
// Re-sync data artifacts. Never touches backlog.json or progress.md.

export function update(
  projectPath: string,
  options: UpdateOptions = {},
): Result<InstallationReport> {
  const resolved = path.resolve(projectPath);
  const artifactsDir = options.artifactsDir ? path.resolve(options.artifactsDir) : undefined;
  const actions: InstallAction[] = [];
  const warnings: string[] = [];

  // Must be installed first
  const markerResult = readMarkerFile(resolved);
  if (!markerResult.ok) {
    return err({
      code: ErrorCodes.NOT_INSTALLED,
      message: `Ralph is not installed in ${resolved}`,
      details: { path: resolved },
    });
  }

  const marker = markerResult.value;
  const storedHashes = marker.artifactHashes;
  const newHashes: Record<string, string> = { ...storedHashes };

  // Re-render RALPH.md managed sections
  const profile = marker.profile;
  const templateVars = buildTemplateVars(profile);
  const ralphMdResult = deployRalphMd(path.join(resolved, DOT_RALPH), templateVars, artifactsDir);
  if (!ralphMdResult.ok) return ralphMdResult;
  actions.push(ralphMdResult.value);

  // Hash updated RALPH.md
  const ralphMdPath = path.join(resolved, DOT_RALPH, DIR_FILES.ralphMd);
  const ralphMdHash = computeHash(ralphMdPath);
  if (ralphMdHash.ok) newHashes["RALPH.md"] = ralphMdHash.value;

  // Update CLAUDE.md ralph section
  const claudeMdResult = deployClaudeMd(resolved, artifactsDir);
  if (!claudeMdResult.ok) return claudeMdResult;
  actions.push(claudeMdResult.value);

  // Never touch backlog.json or progress.md during update
  actions.push({
    file: ".ralph/backlog.json",
    action: "skipped",
    detail: "Backlog preserved during update",
  });
  actions.push({
    file: ".ralph/progress.md",
    action: "skipped",
    detail: "Progress preserved during update",
  });

  // Always update backlog.schema.json (tool-managed, safe to overwrite)
  const schemaContentResult = readArtifact(DIR_FILES.backlogSchema, artifactsDir);
  if (schemaContentResult.ok) {
    fs.writeFileSync(
      path.join(resolved, ".ralph", "backlog.schema.json"),
      schemaContentResult.value,
      "utf-8",
    );
    actions.push({
      file: ".ralph/backlog.schema.json",
      action: "updated",
      detail: "JSON Schema updated to latest version",
    });
  }

  // Update marker file with new hashes
  const updatedMarker: MarkerFile = {
    ...marker,
    artifactHashes: newHashes,
    installedBy: `ralph-manager@${TOOL_VERSION}`,
  };

  const writeResult = writeMarkerFile(resolved, updatedMarker);
  if (!writeResult.ok) return writeResult;

  actions.push({
    file: MARKER_FILENAME,
    action: "updated",
    detail: "Updated artifact hashes in .ralph.json",
  });

  const projectName = path.basename(resolved);

  return ok({
    projectName,
    projectPath: resolved,
    actions,
    profile,
    warnings,
  });
}

// ─── uninstall ────────────────────────────────────────────────────
//
// Remove ralph artifacts. Preserves backlog/progress/log by default.

export function uninstall(projectPath: string, options: UninstallOptions = {}): Result<void> {
  const resolved = path.resolve(projectPath);

  // Must be installed first
  const markerResult = readMarkerFile(resolved);
  if (!markerResult.ok) {
    return err({
      code: ErrorCodes.NOT_INSTALLED,
      message: `Ralph is not installed in ${resolved}`,
      details: { path: resolved },
    });
  }

  const keepBacklog = options.keepBacklog ?? true;
  const keepProgress = options.keepProgress ?? true;
  const keepLog = options.keepLog ?? true;
  const removeClaudeMdSection = options.removeClaudeMdSection ?? true;

  // Remove RALPH.md (always)
  safeUnlink(path.join(resolved, DOT_RALPH, "RALPH.md"));

  // Remove backlog.schema.json (tool-managed)
  safeUnlink(path.join(resolved, DOT_RALPH, "backlog.schema.json"));

  // Remove state.json and DONE file (always — these are loop state)
  safeUnlink(path.join(resolved, DOT_RALPH, "state.json"));
  safeUnlink(path.join(resolved, DOT_RALPH, "DONE"));

  // Conditionally remove data files
  if (!keepBacklog) {
    safeUnlink(path.join(resolved, DOT_RALPH, "backlog.json"));
    safeUnlink(path.join(resolved, DOT_RALPH, "backlog.json.bak"));
  }

  if (!keepProgress) {
    safeUnlink(path.join(resolved, DOT_RALPH, "progress.md"));
  }

  if (!keepLog) {
    safeUnlink(path.join(resolved, DOT_RALPH, "ralph.log"));
  }

  // Remove CLAUDE.md ralph section
  if (removeClaudeMdSection) {
    removeClaudeMdRalphSection(resolved);
  }

  // Remove .ralph.json marker
  safeUnlink(path.join(resolved, MARKER_FILENAME));

  // Try to remove .ralph/ directory if empty
  tryRemoveEmptyDir(path.join(resolved, DOT_RALPH));

  return ok(undefined);
}

// ─── Internal helpers ─────────────────────────────────────────────

/** Build template variables from a profile */
function buildTemplateVars(profile: ProjectProfile): Record<string, string | null | undefined> {
  return {
    projectName: "",
    projectDescription: "",
    testCommand: profile.commands.test,
    typecheckCommand: profile.commands.typecheck,
    lintCommand: profile.commands.lint,
    buildCommand: profile.commands.build,
    formatCommand: profile.commands.format,
    verifyCommand: profile.verify,
    stackDescription: profile.stack,
  };
}

/** Extract the content between managed sentinels from rendered template */
function extractManagedBlock(rendered: string): string | null {
  const startIdx = rendered.indexOf(RALPH_MD_MANAGED_START);
  const endIdx = rendered.indexOf(RALPH_MD_MANAGED_END);

  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) return null;

  const contentStart = startIdx + RALPH_MD_MANAGED_START.length;
  // Trim leading/trailing newline from the inner content
  let inner = rendered.slice(contentStart, endIdx);
  if (inner.startsWith("\n")) inner = inner.slice(1);
  if (inner.endsWith("\n")) inner = inner.slice(0, -1);
  return inner;
}

/** Render RALPH.md from template with profile variables */
function deployRalphMd(
  ralphDir: string,
  templateVars: Record<string, string | null | undefined>,
  artifactsDir?: string,
): Result<InstallAction> {
  const outputPath = path.join(ralphDir, DIR_FILES.ralphMd);

  const contentResult = readArtifact(DIR_FILES.ralphMdTemplate, artifactsDir);
  if (!contentResult.ok) return contentResult;

  const rendered = renderTemplate(contentResult.value, templateVars);
  const existed = fileExists(outputPath);

  if (existed) {
    // Update mode: preserve project-specific content, only replace managed block
    let current: string;
    try {
      current = fs.readFileSync(outputPath, "utf-8");
    } catch {
      // Can't read current — fall through to full write
      const writeResult = atomicWrite(outputPath, rendered);
      if (!writeResult.ok) return writeResult;
      return ok({
        file: ".ralph/RALPH.md",
        action: "rendered" as const,
        detail: "RALPH.md rendered from template",
      });
    }

    // Extract just the managed block from the freshly rendered template
    const newManagedContent = extractManagedBlock(rendered);

    if (newManagedContent !== null && current.includes(RALPH_MD_MANAGED_START)) {
      // Sentinel-aware update: replace only the managed block
      const updated = updateSentinelBlock(
        current,
        RALPH_MD_MANAGED_START,
        RALPH_MD_MANAGED_END,
        newManagedContent,
      );

      if (updated === current) {
        return ok({
          file: ".ralph/RALPH.md",
          action: "skipped" as const,
          detail: "RALPH.md already up to date",
        });
      }

      const writeResult = atomicWrite(outputPath, updated);
      if (!writeResult.ok) return writeResult;

      return ok({
        file: ".ralph/RALPH.md",
        action: "updated" as const,
        detail: "RALPH.md managed section updated, project-specific content preserved",
      });
    }

    // Legacy file without sentinels or template without sentinels — full overwrite
    if (current === rendered) {
      return ok({
        file: ".ralph/RALPH.md",
        action: "skipped" as const,
        detail: "RALPH.md already up to date",
      });
    }

    const writeResult = atomicWrite(outputPath, rendered);
    if (!writeResult.ok) return writeResult;

    return ok({
      file: ".ralph/RALPH.md",
      action: "rendered" as const,
      detail: "RALPH.md re-rendered from template (no managed sentinels found)",
    });
  }

  // First install: write full rendered template
  const writeResult = atomicWrite(outputPath, rendered);
  if (!writeResult.ok) return writeResult;

  return ok({
    file: ".ralph/RALPH.md",
    action: "rendered" as const,
    detail: "RALPH.md rendered from template",
  });
}

/** Create empty backlog.json if missing, validate if exists */
function deployBacklog(
  ralphDir: string,
  projectName?: string,
  projectDescription?: string,
  artifactsDir?: string,
): Result<InstallAction> {
  const backlogPath = path.join(ralphDir, "backlog.json");

  if (fileExists(backlogPath)) {
    // Validate existing backlog
    const validateResult = readJsonFile(backlogPath, BacklogSchema);
    if (!validateResult.ok) {
      return ok({
        file: ".ralph/backlog.json",
        action: "skipped" as const,
        detail: `Existing backlog.json has validation issues: ${validateResult.error.message}`,
      });
    }

    return ok({
      file: ".ralph/backlog.json",
      action: "skipped" as const,
      detail: "Existing backlog.json preserved",
    });
  }

  // Read the template backlog and populate project name/description
  const contentResult = readArtifact(DIR_FILES.backlog, artifactsDir);
  let templateContent: string;
  if (contentResult.ok) {
    templateContent = contentResult.value;
  } else {
    // Fallback: create minimal empty backlog
    templateContent = JSON.stringify({ project: "", description: "", items: [] }, null, 2);
  }

  let backlog: { project: string; description: string; items: unknown[] };
  try {
    backlog = JSON.parse(templateContent) as {
      project: string;
      description: string;
      items: unknown[];
    };
  } catch {
    backlog = { project: "", description: "", items: [] };
  }

  // Fill in project name and description if provided
  if (projectName) backlog.project = projectName;
  if (projectDescription) backlog.description = projectDescription;

  const content = JSON.stringify(backlog, null, 2) + "\n";
  const writeResult = atomicWrite(backlogPath, content);
  if (!writeResult.ok) return writeResult;

  return ok({
    file: ".ralph/backlog.json",
    action: "created" as const,
    detail: "Created empty backlog",
  });
}

/** Write progress.md template if missing */
function deployProgress(ralphDir: string, artifactsDir?: string): Result<InstallAction> {
  const destPath = path.join(ralphDir, "progress.md");

  if (fileExists(destPath)) {
    return ok({
      file: ".ralph/progress.md",
      action: "skipped" as const,
      detail: "Existing progress.md preserved",
    });
  }

  const contentResult = readArtifact(DIR_FILES.progress, artifactsDir);
  let content: string;
  if (contentResult.ok) {
    content = contentResult.value;
  } else {
    // Fallback: create minimal progress.md
    content = "# Progress & Learnings\n\n## Session Log\n";
  }

  const writeResult = atomicWrite(destPath, content);
  if (!writeResult.ok) return writeResult;

  return ok({
    file: ".ralph/progress.md",
    action: "created" as const,
    detail: "Created progress.md template",
  });
}

/** Merge ralph section into CLAUDE.md using the CLAUDE_ADDON.md template */
function deployClaudeMd(projectPath: string, artifactsDir?: string): Result<InstallAction> {
  const contentResult = readArtifact(CLAUDE_ADDON_FILE, artifactsDir);
  if (!contentResult.ok) return contentResult;

  const ralphBlock = extractRalphBlock(contentResult.value);
  const mergeResult = mergeClaudeMd(projectPath, ralphBlock);
  if (!mergeResult.ok) return mergeResult;

  const mergeAction = mergeResult.value.action;

  return ok({
    file: "CLAUDE.md",
    action: mergeAction,
    detail: claudeMdActionDetail(mergeAction),
  });
}

/** Human-readable detail for CLAUDE.md merge actions */
function claudeMdActionDetail(action: string): string {
  switch (action) {
    case "created":
      return "Created CLAUDE.md with ralph section";
    case "merged":
      return "Appended ralph section to existing CLAUDE.md";
    case "skipped":
      return "CLAUDE.md ralph section already up to date";
    case "updated":
      return "Updated ralph section in CLAUDE.md";
    default:
      return `CLAUDE.md: ${action}`;
  }
}

/** Check if a command exists in PATH (no subprocess needed) */
function isCommandInPath(cmd: string): boolean {
  const pathDirs = process.env["PATH"]?.split(path.delimiter) ?? [];
  return pathDirs.some((dir) => {
    try {
      fs.accessSync(path.join(dir, cmd), fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

/** Remove ralph section from CLAUDE.md */
function removeClaudeMdRalphSection(projectPath: string): void {
  const claudeMdPath = path.join(projectPath, "CLAUDE.md");

  if (!fileExists(claudeMdPath)) return;

  try {
    const content = fs.readFileSync(claudeMdPath, "utf-8");

    const startIdx = content.indexOf(CLAUDE_MD_SENTINEL_START);
    const endIdx = content.indexOf(CLAUDE_MD_SENTINEL_END);

    if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) return;

    // Remove from sentinel start to sentinel end (inclusive) plus any trailing newline
    let endOffset = endIdx + CLAUDE_MD_SENTINEL_END.length;
    if (content[endOffset] === "\n") endOffset++;

    // Also remove a leading blank line if present
    let startOffset = startIdx;
    if (startOffset > 0 && content[startOffset - 1] === "\n") {
      startOffset--;
    }

    const newContent = content.slice(0, startOffset) + content.slice(endOffset);

    // If the file is now empty (or just whitespace), remove it entirely
    if (newContent.trim() === "") {
      fs.unlinkSync(claudeMdPath);
    } else {
      atomicWrite(claudeMdPath, newContent);
    }
  } catch {
    // Best effort — don't fail uninstall for CLAUDE.md issues
  }
}

/** Safely unlink a file (no error if missing) */
function safeUnlink(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch {
    // File doesn't exist — that's fine
  }
}

/** Try to remove a directory if it's empty */
function tryRemoveEmptyDir(dirPath: string): void {
  try {
    const entries = fs.readdirSync(dirPath);
    if (entries.length === 0) {
      fs.rmdirSync(dirPath);
    }
  } catch {
    // Directory doesn't exist or not empty — that's fine
  }
}

// ─── Exported constants (for testing) ────────────────────────────

export { DOT_RALPH, DIR_FILES, CLAUDE_ADDON_FILE, RALPH_MD_MANAGED_START, RALPH_MD_MANAGED_END };

// ─── Exported helpers (for testing) ──────────────────────────────

export { buildTemplateVars, isCommandInPath, readArtifact };
