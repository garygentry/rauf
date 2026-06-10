import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

import { type Result, ok, err, ErrorCodes } from "./errors.js";
import { ensureDir, atomicWrite, validatePath } from "./fs-utils.js";
import { renderTemplate } from "./template.js";
import { install, type InstallOptions, readArtifact } from "./installer.js";
import { getPreset, mergeProfileOverrides, type ProfileOverrides } from "./profile.js";
import { writeMarkerFile, readMarkerFile } from "./config.js";
import { addItem, type CreateItemInput } from "./backlog.js";
import { defaultBacklogPaths } from "./backlog-root.js";
import {
  BacklogSchema,
  normalizeBacklogItems,
  type InstallationReport,
  type InstallAction,
  type ProjectProfile,
  type MarkerOptions,
  type BacklogItemType,
} from "./schemas.js";

// ─── Constants ────────────────────────────────────────────────────

const CLAUDE_GREENFIELD_TEMPLATE = "CLAUDE_GREENFIELD.md.tmpl";

/** Stack-appropriate .gitignore content */
const GITIGNORE_TEMPLATES: Record<string, string> = {
  "node-typescript": [
    "node_modules/",
    "dist/",
    "*.tsbuildinfo",
    ".env",
    ".env.*",
    "!.env.example",
  ].join("\n"),
  "node-javascript": ["node_modules/", "dist/", ".env", ".env.*", "!.env.example"].join("\n"),
  python: [
    "__pycache__/",
    "*.py[cod]",
    "*$py.class",
    ".venv/",
    "venv/",
    ".env",
    "dist/",
    "*.egg-info/",
    ".mypy_cache/",
    ".ruff_cache/",
  ].join("\n"),
  go: ["bin/", "*.exe", "*.exe~", "*.dll", "*.so", "*.dylib"].join("\n"),
  rust: ["target/", "Cargo.lock"].join("\n"),
  custom: "",
};

/**
 * Rauf-specific entries appended to every .gitignore. Uses `**` so the rules
 * apply to nested backlog dirs (e.g. specs/<feature>/.rauf/) as well as the
 * project-root .rauf/. Keep backlog.json, progress.md, RAUF.md, and archive/
 * tracked.
 */
const RAUF_GITIGNORE = [
  "",
  "# Rauf loop runtime state (never tracked, any backlog dir)",
  "**/.rauf/state.json",
  "**/.rauf/DONE",
  "**/.rauf/CANCEL",
  "**/.rauf/rauf.log",
  "**/.rauf/iteration-status.json",
  "**/.rauf/.loop.lock",
  // backlog.json.bak sits beside backlog.json (root .rauf/ or specs/<feature>/).
  "**/backlog.json.bak",
].join("\n");

// ─── Types ────────────────────────────────────────────────────────

export interface InitOptions {
  /** Path to canonical artifacts on disk (optional — defaults to embedded artifacts) */
  artifactsDir?: string;
  /** Project name (defaults to directory basename) */
  projectName?: string;
  /** Project description for CLAUDE.md */
  projectDescription?: string;
  /** Requirements text for CLAUDE.md (greenfield-only template variable) */
  requirements?: string;
  /** Tech stack preset: "node-typescript" | "python" | "go" | "rust" | "custom" */
  preset?: string;
  /** Profile command overrides applied on top of preset */
  profileOverrides?: ProfileOverrides;
  /** Path to a seed file (.json or .md) for pre-populating backlog */
  seedFile?: string;
  /** Inline backlog seed items */
  seedItems?: CreateItemInput[];
  /** Root directory for path validation */
  rootDirectory?: string;
  /** Marker file options */
  options?: Partial<MarkerOptions>;
}

// ─── initProject ──────────────────────────────────────────────────
//
// Greenfield initialization: create a new project directory from
// scratch with git, .gitignore, CLAUDE.md, ralph artifacts, and
// optional backlog seed.

export function initProject(targetPath: string, options: InitOptions): Result<InstallationReport> {
  const resolved = path.resolve(targetPath);
  const artifactsDir = options.artifactsDir ? path.resolve(options.artifactsDir) : undefined;
  const projectName = options.projectName || path.basename(resolved);
  const warnings: string[] = [];
  const preInstallActions: InstallAction[] = [];

  // 1. Create directory (mkdir -p)
  const mkdirResult = ensureDir(resolved);
  if (!mkdirResult.ok) return mkdirResult;

  // 2. Validate path is under ROOT_DIRECTORY (warning, not blocking)
  if (options.rootDirectory) {
    const pathResult = validatePath(resolved, [options.rootDirectory]);
    if (!pathResult.ok) {
      warnings.push(
        `Path "${resolved}" is outside ROOT_DIRECTORY "${path.resolve(options.rootDirectory)}". ` +
          "The project will be created but may not appear in discovery.",
      );
    }
  }

  // 3. git init + .gitignore + initial commit
  const gitResult = initGitRepo(resolved, options.preset ?? "custom");
  if (!gitResult.ok) return gitResult;
  preInstallActions.push(...gitResult.value);

  // 4. Configure profile from preset (+ optional overrides)
  const presetName = options.preset ?? "custom";
  let profile = getPreset(presetName);
  if (options.profileOverrides) {
    profile = mergeProfileOverrides(profile, options.profileOverrides);
  }

  // 5. Scaffold CLAUDE.md from CLAUDE_GREENFIELD.md.tmpl
  const claudeMdResult = scaffoldClaudeMd(
    resolved,
    profile,
    projectName,
    options.projectDescription ?? "",
    options.requirements ?? "",
    artifactsDir,
  );
  if (!claudeMdResult.ok) return claudeMdResult;
  preInstallActions.push(claudeMdResult.value);

  // 6. Install standard ralph artifacts via installer
  const installOpts: InstallOptions = {
    artifactsDir,
    profileOverrides: profileToOverrides(profile),
    projectName,
    projectDescription: options.projectDescription,
    options: options.options,
  };

  const installResult = install(resolved, installOpts);
  if (!installResult.ok) return installResult;

  const report = installResult.value;

  // Patch marker file with correct profile (installer's detectProfile
  // returns "unknown" stack on an empty directory — we know the real stack)
  const patchResult = patchMarkerProfile(resolved, profile);
  if (!patchResult.ok) {
    warnings.push("Could not patch marker file with preset profile");
  }

  // 7. Seed backlog if seed source provided
  const seedActions: InstallAction[] = [];
  const seedResult = seedBacklog(resolved, options.seedFile, options.seedItems);
  if (!seedResult.ok) return seedResult;
  seedActions.push(...seedResult.value);

  // 8. Return combined report
  const allActions = [...preInstallActions, ...report.actions, ...seedActions];

  return ok({
    projectName,
    projectPath: resolved,
    actions: allActions,
    profile,
    warnings: [...warnings, ...report.warnings],
  });
}

// ─── parseBacklogSeed ─────────────────────────────────────────────
//
// Parse a seed file into CreateItemInput[]. Supports:
// - JSON: Backlog schema (use .items) or array of partial items
// - Markdown: `- [ ] [type] title` format

export function parseBacklogSeed(seedPath: string): Result<CreateItemInput[]> {
  const resolved = path.resolve(seedPath);

  let content: string;
  try {
    content = fs.readFileSync(resolved, "utf-8");
  } catch (e) {
    return err({
      code: ErrorCodes.FILE_NOT_FOUND,
      message: `Seed file not found: ${resolved}`,
      details: {
        path: resolved,
        cause: e instanceof Error ? e.message : String(e),
      },
    });
  }

  const ext = path.extname(resolved).toLowerCase();

  if (ext === ".json") {
    return parseJsonSeed(content, resolved);
  }

  if (ext === ".md" || ext === ".markdown") {
    return parseMarkdownSeed(content);
  }

  return err({
    code: ErrorCodes.VALIDATION_ERROR,
    message: `Unsupported seed file format: "${ext}". Use .json or .md`,
    details: { path: resolved, extension: ext },
  });
}

// ─── Internal: Git initialization ─────────────────────────────────
//
// Uses spawnSync with array arguments (safe against shell injection).
// All arguments are hardcoded strings — no user input in commands.

function initGitRepo(projectPath: string, preset: string): Result<InstallAction[]> {
  const actions: InstallAction[] = [];

  // git init
  const gitInit = spawnSync("git", ["init"], {
    cwd: projectPath,
    stdio: "pipe",
    encoding: "utf-8",
  });

  if (gitInit.status !== 0) {
    return err({
      code: ErrorCodes.FILE_NOT_FOUND,
      message: `git init failed: ${gitInit.stderr || "unknown error"}`,
      details: { path: projectPath },
    });
  }

  actions.push({
    file: ".git",
    action: "created",
    detail: "Initialized git repository",
  });

  // Create .gitignore
  const gitignoreContent = generateGitignore(preset);
  const gitignorePath = path.join(projectPath, ".gitignore");
  const writeResult = atomicWrite(gitignorePath, gitignoreContent);
  if (!writeResult.ok) return writeResult;

  actions.push({
    file: ".gitignore",
    action: "created",
    detail: `Generated ${preset} .gitignore`,
  });

  // Stage and commit
  const gitAdd = spawnSync("git", ["add", ".gitignore"], {
    cwd: projectPath,
    stdio: "pipe",
    encoding: "utf-8",
  });

  if (gitAdd.status !== 0) {
    return err({
      code: ErrorCodes.FILE_NOT_FOUND,
      message: `git add failed: ${gitAdd.stderr || "unknown error"}`,
      details: { path: projectPath },
    });
  }

  const gitCommit = spawnSync("git", ["commit", "-m", "Initial commit"], {
    cwd: projectPath,
    stdio: "pipe",
    encoding: "utf-8",
    env: {
      ...process.env,
      // Ensure git commit works in CI/headless environments
      GIT_AUTHOR_NAME: process.env["GIT_AUTHOR_NAME"] || "Rauf",
      GIT_AUTHOR_EMAIL: process.env["GIT_AUTHOR_EMAIL"] || "ralph@localhost",
      GIT_COMMITTER_NAME: process.env["GIT_COMMITTER_NAME"] || "Rauf",
      GIT_COMMITTER_EMAIL: process.env["GIT_COMMITTER_EMAIL"] || "ralph@localhost",
    },
  });

  if (gitCommit.status !== 0) {
    return err({
      code: ErrorCodes.FILE_NOT_FOUND,
      message: `git commit failed: ${gitCommit.stderr || "unknown error"}`,
      details: { path: projectPath },
    });
  }

  return ok(actions);
}

// ─── Internal: .gitignore generation ──────────────────────────────

function generateGitignore(preset: string): string {
  const base = GITIGNORE_TEMPLATES[preset] ?? GITIGNORE_TEMPLATES["custom"]!;
  const parts = [base, RAUF_GITIGNORE].filter(Boolean);
  return parts.join("\n") + "\n";
}

// ─── Internal: Scaffold CLAUDE.md from greenfield template ────────

function scaffoldClaudeMd(
  projectPath: string,
  profile: ProjectProfile,
  projectName: string,
  projectDescription: string,
  requirements: string,
  artifactsDir?: string,
): Result<InstallAction> {
  const contentResult = readArtifact(CLAUDE_GREENFIELD_TEMPLATE, artifactsDir);
  if (!contentResult.ok) return contentResult;
  const templateContent = contentResult.value;

  const variables: Record<string, string | null | undefined> = {
    projectName,
    projectDescription,
    requirements,
    stackDescription: profile.stack,
    testCommand: profile.commands.test,
    typecheckCommand: profile.commands.typecheck,
    lintCommand: profile.commands.lint,
    buildCommand: profile.commands.build,
    verifyCommand: profile.verify,
  };

  const rendered = renderTemplate(templateContent, variables);
  const claudeMdPath = path.join(projectPath, "CLAUDE.md");

  const writeResult = atomicWrite(claudeMdPath, rendered);
  if (!writeResult.ok) return writeResult;

  return ok({
    file: "CLAUDE.md",
    action: "created" as const,
    detail: "Scaffolded CLAUDE.md from greenfield template",
  });
}

// ─── Internal: Patch marker with correct profile ──────────────────

function patchMarkerProfile(projectPath: string, profile: ProjectProfile): Result<void> {
  const markerResult = readMarkerFile(projectPath);
  if (!markerResult.ok) return markerResult;

  const updatedMarker = {
    ...markerResult.value,
    profile,
  };

  return writeMarkerFile(projectPath, updatedMarker);
}

// ─── Internal: Convert profile to overrides ───────────────────────

function profileToOverrides(profile: ProjectProfile): ProfileOverrides {
  return {
    test: profile.commands.test ?? "",
    typecheck: profile.commands.typecheck ?? "",
    lint: profile.commands.lint ?? "",
    build: profile.commands.build ?? "",
    format: profile.commands.format ?? "",
  };
}

// ─── Internal: Seed backlog ───────────────────────────────────────

function seedBacklog(
  projectPath: string,
  seedFile?: string,
  seedItems?: CreateItemInput[],
): Result<InstallAction[]> {
  const actions: InstallAction[] = [];

  // Collect items to seed from file or inline
  let items: CreateItemInput[] = [];

  if (seedFile) {
    const parseResult = parseBacklogSeed(seedFile);
    if (!parseResult.ok) return parseResult;
    items = parseResult.value;
  }

  if (seedItems && seedItems.length > 0) {
    items = [...items, ...seedItems];
  }

  if (items.length === 0) {
    return ok(actions);
  }

  // Add each item via the backlog module (proper ID assignment)
  let addedCount = 0;
  for (const item of items) {
    const addResult = addItem(defaultBacklogPaths(projectPath), item);
    if (!addResult.ok) return addResult;
    addedCount++;
  }

  actions.push({
    file: ".rauf/backlog.json",
    action: "updated" as const,
    detail: `Seeded ${addedCount} backlog item${addedCount === 1 ? "" : "s"}`,
  });

  return ok(actions);
}

// ─── Internal: JSON seed parsing ──────────────────────────────────

function parseJsonSeed(content: string, filePath: string): Result<CreateItemInput[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    return err({
      code: ErrorCodes.INVALID_JSON,
      message: `Invalid JSON in seed file: ${filePath}`,
      details: {
        path: filePath,
        cause: e instanceof Error ? e.message : String(e),
      },
    });
  }

  // Try parsing as full Backlog schema (normalize dependencies→dependsOn first)
  const backlogResult = BacklogSchema.safeParse(normalizeBacklogItems(parsed));
  if (backlogResult.success) {
    return ok(backlogItemsToInputs(backlogResult.data.items));
  }

  // Try parsing as array of items
  if (Array.isArray(parsed)) {
    return ok(partialItemsToInputs(parsed));
  }

  return err({
    code: ErrorCodes.VALIDATION_ERROR,
    message: "Seed JSON must be a Backlog object or an array of items",
    details: { path: filePath },
  });
}

// ─── Internal: Markdown seed parsing ──────────────────────────────

const MARKDOWN_ITEM_RE = /^-\s+\[[ x]\]\s+(?:\[(\w+)\]\s+)?(.+)$/;

const VALID_TYPES = new Set<string>(["bug", "refactor", "feature", "chore"]);

function parseMarkdownSeed(content: string): Result<CreateItemInput[]> {
  const lines = content.split("\n");
  const items: CreateItemInput[] = [];
  let position = 0;

  for (const line of lines) {
    const match = MARKDOWN_ITEM_RE.exec(line.trim());
    if (!match) continue;

    const rawType = match[1]?.toLowerCase();
    const title = match[2]!.trim();

    if (!title) continue;

    const type: BacklogItemType =
      rawType && VALID_TYPES.has(rawType) ? (rawType as BacklogItemType) : "feature";

    // Priority from position: 1, 2, 3, 4, 4, 4, ...
    const priority = Math.min(position + 1, 4) as 1 | 2 | 3 | 4;
    position++;

    items.push({ type, priority, title });
  }

  return ok(items);
}

// ─── Internal: Convert BacklogItem[] → CreateItemInput[] ──────────

function backlogItemsToInputs(
  items: Array<{
    type: BacklogItemType;
    priority: 1 | 2 | 3 | 4;
    title: string;
    description?: string;
    acceptanceCriteria?: string[];
    dependsOn?: string[];
    notes?: string;
    estimatedIterations?: number;
  }>,
): CreateItemInput[] {
  return items.map((item) => ({
    type: item.type,
    priority: item.priority,
    title: item.title,
    ...(item.description ? { description: item.description } : {}),
    ...(item.acceptanceCriteria && item.acceptanceCriteria.length > 0
      ? { acceptanceCriteria: item.acceptanceCriteria }
      : {}),
    ...(item.dependsOn && item.dependsOn.length > 0 ? { dependsOn: item.dependsOn } : {}),
    ...(item.notes ? { notes: item.notes } : {}),
    ...(item.estimatedIterations ? { estimatedIterations: item.estimatedIterations } : {}),
  }));
}

// ─── Internal: Convert partial JSON items → CreateItemInput[] ─────

function partialItemsToInputs(items: unknown[]): CreateItemInput[] {
  return items.map((raw, index) => {
    const item = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;

    const type =
      typeof item["type"] === "string" && VALID_TYPES.has(item["type"])
        ? (item["type"] as BacklogItemType)
        : "feature";

    const priority =
      typeof item["priority"] === "number" && item["priority"] >= 1 && item["priority"] <= 4
        ? (item["priority"] as 1 | 2 | 3 | 4)
        : (Math.min(index + 1, 4) as 1 | 2 | 3 | 4);

    const title =
      typeof item["title"] === "string" && item["title"].trim()
        ? item["title"].trim()
        : `Item ${index + 1}`;

    const input: CreateItemInput = { type, priority, title };

    if (typeof item["description"] === "string") input.description = item["description"];
    if (Array.isArray(item["acceptanceCriteria"]))
      input.acceptanceCriteria = item["acceptanceCriteria"].filter(
        (c): c is string => typeof c === "string",
      );
    if (Array.isArray(item["dependsOn"]))
      input.dependsOn = item["dependsOn"].filter((d): d is string => typeof d === "string");
    if (typeof item["notes"] === "string") input.notes = item["notes"];
    if (typeof item["estimatedIterations"] === "number")
      input.estimatedIterations = item["estimatedIterations"];

    return input;
  });
}

// ─── Exported constants (for testing) ─────────────────────────────

export { CLAUDE_GREENFIELD_TEMPLATE, GITIGNORE_TEMPLATES, RAUF_GITIGNORE, MARKDOWN_ITEM_RE };
