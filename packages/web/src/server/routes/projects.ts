// ─── Projects API Routes ─────────────────────────────────────────
//
// /api/projects:  list, detail, install, init, update, uninstall
//
// :id = directory name (URL-encoded), resolved to ROOT_DIRECTORY/<id>.
// All mutations require X-Ralph-Request: true (enforced by app-level CSRF
// middleware — not repeated here).
//
// Artifacts are embedded in @ralph/core at build time — no filesystem
// path resolution needed for install/init/update.

import * as path from "node:path";

import { Hono } from "hono";
import { z } from "zod";

import {
  discoverProjects,
  install,
  update,
  checkArtifactStaleness,
  uninstall,
  initProject,
  preflight,
  detectProfile,
  readMarkerFile,
  readToolConfig,
  resolveRootDirectory,
  validatePath,
  readBacklog,
  addItem,
  updateItem,
  deleteItem,
  restoreFromBackup,
  defaultBacklogPaths,
  sweepBacklog,
  listArchiveMonths,
  readArchiveMonth,
  purgeArchive,
  ErrorCodes,
  BacklogItemTypeSchema,
  BacklogItemStatusSchema,
  BacklogItemPrioritySchema,
  AgentDelegationSchema,
  type InstallOptions,
  type UninstallOptions,
  type InitOptions,
  type ProfileOverrides,
  type CreateItemInput,
  type UpdateItemInput,
} from "@ralph/core";

import { errorResponse } from "../app.js";
import { resolveProjectPath as resolveProjectPathShared } from "../resolve-project.js";

// ─── Request body schemas ────────────────────────────────────────

const SweepBodySchema = z.object({
  minAgeDays: z.number().int().nonnegative().optional(),
});

const CreateItemBodySchema = z.object({
  type: BacklogItemTypeSchema,
  priority: BacklogItemPrioritySchema,
  title: z.string().min(1, "title must be a non-empty string"),
  description: z.string().optional(),
  acceptanceCriteria: z.array(z.string()).optional(),
  dependsOn: z.array(z.string()).optional(),
  notes: z.string().optional(),
  estimatedIterations: z.number().int().positive().optional(),
  agentDelegation: AgentDelegationSchema.optional(),
  specReferences: z.array(z.string()).optional(),
});

const UpdateItemBodySchema = z
  .object({
    type: BacklogItemTypeSchema,
    priority: BacklogItemPrioritySchema,
    title: z.string(),
    status: BacklogItemStatusSchema,
    description: z.string(),
    acceptanceCriteria: z.array(z.string()),
    blockedReason: z.string(),
    dependsOn: z.array(z.string()),
    notes: z.string(),
    estimatedIterations: z.number().int().positive(),
    agentDelegation: AgentDelegationSchema,
    specReferences: z.array(z.string()),
  })
  .partial();

const ProfileOverridesSchema = z
  .object({
    test: z.string(),
    typecheck: z.string(),
    lint: z.string(),
    build: z.string(),
    format: z.string(),
  })
  .partial();

const SeedItemSchema = z.object({
  type: BacklogItemTypeSchema,
  priority: BacklogItemPrioritySchema,
  title: z.string().min(1),
  description: z.string().optional(),
  acceptanceCriteria: z.array(z.string()).optional(),
  dependsOn: z.array(z.string()).optional(),
  notes: z.string().optional(),
  estimatedIterations: z.number().int().positive().optional(),
  agentDelegation: AgentDelegationSchema.optional(),
  specReferences: z.array(z.string()).optional(),
});

const InitBodySchema = z.object({
  targetPath: z.string().min(1, "targetPath is required"),
  name: z.string().optional(),
  description: z.string().optional(),
  preset: z.string().optional(),
  requirements: z.string().optional(),
  profileOverrides: ProfileOverridesSchema.optional(),
  seedItems: z.array(SeedItemSchema).optional(),
});

// ─── Artifacts resolution ────────────────────────────────────────
//
// ─── createProjectsRouter ────────────────────────────────────────
//
// Returns a Hono router for /api/projects routes.
// rootDirectoryOverride lets tests inject a controlled directory.

export function createProjectsRouter(rootDirectoryOverride?: string): Hono {
  const router = new Hono();

  // ── Helpers ───────────────────────────────────────────────────

  function getRootDirectory(): string {
    if (rootDirectoryOverride !== undefined) return rootDirectoryOverride;
    const configResult = readToolConfig();
    return configResult.ok ? configResult.value.rootDirectory : resolveRootDirectory();
  }

  /**
   * Decode a raw `:id` param and build the absolute project path.
   * Returns null if the id contains illegal path components (/, ..).
   */
  function resolveProjectPath(id: string): string | null {
    return resolveProjectPathShared(id, getRootDirectory());
  }

  /**
   * Validate that a resolved project path is actually within ROOT_DIRECTORY.
   * Returns an error response string (code) or null when valid.
   */
  function validateProjectPath(projectPath: string): string | null {
    const rootDir = getRootDirectory();
    const pathResult = validatePath(projectPath, [rootDir]);
    return pathResult.ok ? null : pathResult.error.code;
  }

  // ── GET /api/projects ─────────────────────────────────────────

  router.get("/", (c) => {
    const rootDir = getRootDirectory();
    const result = discoverProjects(rootDir);
    if (!result.ok) {
      return c.json(
        errorResponse("DISCOVERY_ERROR", result.error.message, result.error.details),
        500,
      );
    }
    return c.json({ data: { projects: result.value.projects, ignored: result.value.ignored } });
  });

  // ── GET /api/projects/:id ─────────────────────────────────────

  router.get("/:id", (c) => {
    const id = c.req.param("id");
    const projectPath = resolveProjectPath(id);
    if (!projectPath) {
      return c.json(errorResponse("INVALID_ID", `Invalid project ID: ${id}`), 400);
    }

    const violation = validateProjectPath(projectPath);
    if (violation) {
      return c.json(errorResponse("PATH_VIOLATION", "Project ID escapes root directory"), 400);
    }

    const markerResult = readMarkerFile(projectPath);
    if (!markerResult.ok) {
      return c.json(errorResponse("NOT_FOUND", `Project not found: ${id}`), 404);
    }

    const project = {
      id,
      path: projectPath,
      name: id,
      marker: markerResult.value,
    };

    return c.json({ data: project });
  });

  // ── POST /api/projects/init ───────────────────────────────────
  //
  // Create a new greenfield project. Route registered before /:id/...
  // so it is matched first.

  router.post("/init", async (c) => {
    const raw = await c.req.json().catch(() => null);
    if (raw === null || typeof raw !== "object") {
      return c.json(errorResponse("INVALID_BODY", "Request body is required"), 400);
    }

    const parseResult = InitBodySchema.safeParse(raw);
    if (!parseResult.success) {
      return c.json(
        errorResponse("VALIDATION_ERROR", "Invalid request body", parseResult.error.flatten()),
        400,
      );
    }

    const { targetPath, name, description, preset, requirements, profileOverrides, seedItems } =
      parseResult.data;

    const opts: InitOptions = {
      projectName: name,
      projectDescription: description,
      preset,
      requirements,
      profileOverrides,
      seedItems: seedItems as CreateItemInput[] | undefined,
      rootDirectory: getRootDirectory(),
    };

    const result = initProject(targetPath, opts);
    if (!result.ok) {
      const status = result.error.code === ErrorCodes.FILE_NOT_FOUND ? 404 : 400;
      return c.json(
        errorResponse(result.error.code, result.error.message, result.error.details),
        status,
      );
    }

    return c.json({ data: result.value }, 201);
  });

  // ── POST /api/projects/preflight ─────────────────────────────
  //
  // Run preflight checks on a target directory. Used by the install
  // wizard before committing to install. Accepts an absolute path
  // or a path relative to ROOT_DIRECTORY.

  router.post("/preflight", async (c) => {
    const raw = await c.req.json().catch(() => null);
    if (raw === null || typeof raw !== "object") {
      return c.json(errorResponse("INVALID_BODY", "Request body is required"), 400);
    }

    const parseResult = z.object({ targetPath: z.string().min(1) }).safeParse(raw);
    if (!parseResult.success) {
      return c.json(
        errorResponse("VALIDATION_ERROR", "targetPath is required", parseResult.error.flatten()),
        400,
      );
    }

    const { targetPath } = parseResult.data;

    // Resolve: absolute paths pass through, relative resolved against ROOT_DIRECTORY
    const rootDir = getRootDirectory();
    const resolved = path.isAbsolute(targetPath)
      ? path.resolve(targetPath)
      : path.resolve(rootDir, targetPath);

    const result = preflight(resolved);
    const profile = detectProfile(resolved);

    return c.json({ data: { ...result, resolvedPath: resolved, detectedProfile: profile } });
  });

  // ── POST /api/projects/:id/install ────────────────────────────

  router.post("/:id/install", async (c) => {
    const id = c.req.param("id");
    const projectPath = resolveProjectPath(id);
    if (!projectPath) {
      return c.json(errorResponse("INVALID_ID", `Invalid project ID: ${id}`), 400);
    }

    const violation = validateProjectPath(projectPath);
    if (violation) {
      return c.json(errorResponse("PATH_VIOLATION", "Project ID escapes root directory"), 400);
    }

    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

    const opts: InstallOptions = {
      profileOverrides:
        typeof body.profileOverrides === "object" && body.profileOverrides !== null
          ? (body.profileOverrides as ProfileOverrides)
          : undefined,
    };

    const result = install(projectPath, opts);
    if (!result.ok) {
      const status = result.error.code === ErrorCodes.FILE_NOT_FOUND ? 404 : 400;
      return c.json(
        errorResponse(result.error.code, result.error.message, result.error.details),
        status,
      );
    }

    return c.json({ data: result.value });
  });

  // ── GET /api/projects/:id/artifact-status ─────────────────────

  router.get("/:id/artifact-status", (c) => {
    const id = c.req.param("id");
    const projectPath = resolveProjectPath(id);
    if (!projectPath) {
      return c.json(errorResponse("INVALID_ID", `Invalid project ID: ${id}`), 400);
    }

    const violation = validateProjectPath(projectPath);
    if (violation) {
      return c.json(errorResponse("PATH_VIOLATION", "Project ID escapes root directory"), 400);
    }

    const result = checkArtifactStaleness(projectPath);
    if (!result.ok) {
      const status = result.error.code === ErrorCodes.NOT_INSTALLED ? 404 : 400;
      return c.json(errorResponse(result.error.code, result.error.message), status);
    }
    return c.json({ data: result.value });
  });

  // ── POST /api/projects/:id/update ─────────────────────────────

  router.post("/:id/update", async (c) => {
    const id = c.req.param("id");
    const projectPath = resolveProjectPath(id);
    if (!projectPath) {
      return c.json(errorResponse("INVALID_ID", `Invalid project ID: ${id}`), 400);
    }

    const violation = validateProjectPath(projectPath);
    if (violation) {
      return c.json(errorResponse("PATH_VIOLATION", "Project ID escapes root directory"), 400);
    }

    const result = update(projectPath);
    if (!result.ok) {
      const status = result.error.code === ErrorCodes.NOT_INSTALLED ? 404 : 400;
      return c.json(
        errorResponse(result.error.code, result.error.message, result.error.details),
        status,
      );
    }

    return c.json({ data: result.value });
  });

  // ── POST /api/projects/:id/uninstall ──────────────────────────

  router.post("/:id/uninstall", async (c) => {
    const id = c.req.param("id");
    const projectPath = resolveProjectPath(id);
    if (!projectPath) {
      return c.json(errorResponse("INVALID_ID", `Invalid project ID: ${id}`), 400);
    }

    const violation = validateProjectPath(projectPath);
    if (violation) {
      return c.json(errorResponse("PATH_VIOLATION", "Project ID escapes root directory"), 400);
    }

    // Verify project exists before uninstalling
    const markerResult = readMarkerFile(projectPath);
    if (!markerResult.ok) {
      return c.json(errorResponse("NOT_FOUND", `Project not found: ${id}`), 404);
    }

    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

    const opts: UninstallOptions = {
      keepBacklog: typeof body.keepBacklog === "boolean" ? body.keepBacklog : true,
      keepProgress: typeof body.keepProgress === "boolean" ? body.keepProgress : true,
      keepLog: typeof body.keepLog === "boolean" ? body.keepLog : true,
    };

    const result = uninstall(projectPath, opts);
    if (!result.ok) {
      return c.json(
        errorResponse(result.error.code, result.error.message, result.error.details),
        400,
      );
    }

    return c.json({ data: null });
  });

  // ─────────────────────────────────────────────────────────────
  // Backlog CRUD routes
  // /api/projects/:id/backlog[/:itemId]
  // ─────────────────────────────────────────────────────────────

  // ── GET /:id/backlog ─────────────────────────────────────────
  //
  // List backlog items with optional ?status, ?type, ?sort filters.

  router.get("/:id/backlog", (c) => {
    const id = c.req.param("id");
    const projectPath = resolveProjectPath(id);
    if (!projectPath) {
      return c.json(errorResponse("INVALID_ID", `Invalid project ID: ${id}`), 400);
    }
    const violation = validateProjectPath(projectPath);
    if (violation) {
      return c.json(errorResponse("PATH_VIOLATION", "Project ID escapes root directory"), 400);
    }

    const backlogResult = readBacklog(defaultBacklogPaths(projectPath));
    if (!backlogResult.ok) {
      const status = backlogResult.error.code === ErrorCodes.FILE_NOT_FOUND ? 404 : 500;
      return c.json(errorResponse(backlogResult.error.code, backlogResult.error.message), status);
    }

    let items = backlogResult.value.items;

    const statusFilter = c.req.query("status");
    const typeFilter = c.req.query("type");
    const sortParam = c.req.query("sort") ?? "priority";

    if (statusFilter) {
      items = items.filter((item) => item.status === statusFilter);
    }
    if (typeFilter) {
      items = items.filter((item) => item.type === typeFilter);
    }

    items = [...items].sort((a, b) => {
      if (sortParam === "id") return a.id.localeCompare(b.id);
      if (sortParam === "status") return a.status.localeCompare(b.status);
      return a.priority - b.priority;
    });

    return c.json({ data: items });
  });

  // ── POST /:id/backlog/restore ─────────────────────────────────
  //
  // Restore backlog from .bak backup. Registered before /:id/backlog/:itemId
  // so "restore" is never mismatched as an itemId.

  router.post("/:id/backlog/restore", async (c) => {
    const id = c.req.param("id");
    const projectPath = resolveProjectPath(id);
    if (!projectPath) {
      return c.json(errorResponse("INVALID_ID", `Invalid project ID: ${id}`), 400);
    }
    const violation = validateProjectPath(projectPath);
    if (violation) {
      return c.json(errorResponse("PATH_VIOLATION", "Project ID escapes root directory"), 400);
    }

    const result = restoreFromBackup(defaultBacklogPaths(projectPath));
    if (!result.ok) {
      const status = result.error.code === ErrorCodes.FILE_NOT_FOUND ? 404 : 400;
      return c.json(
        errorResponse(result.error.code, result.error.message, result.error.details),
        status,
      );
    }

    return c.json({ data: null });
  });

  // ── POST /:id/backlog/sweep ───────────────────────────────────
  //
  // Sweep done items into .ralph/archive/. Registered before /:id/backlog/:itemId
  // so "sweep" is never mismatched as an itemId.

  router.post("/:id/backlog/sweep", async (c) => {
    const id = c.req.param("id");
    const projectPath = resolveProjectPath(id);
    if (!projectPath) {
      return c.json(errorResponse("INVALID_ID", `Invalid project ID: ${id}`), 400);
    }
    const violation = validateProjectPath(projectPath);
    if (violation) {
      return c.json(errorResponse("PATH_VIOLATION", "Project ID escapes root directory"), 400);
    }

    const raw = await c.req.json().catch(() => ({}));
    const parseResult = SweepBodySchema.safeParse(raw);
    if (!parseResult.success) {
      return c.json(
        errorResponse("VALIDATION_ERROR", "Invalid request body", parseResult.error.flatten()),
        400,
      );
    }

    const result = sweepBacklog(defaultBacklogPaths(projectPath), { minAgeDays: parseResult.data.minAgeDays });
    if (!result.ok) {
      const status = result.error.code === ErrorCodes.FILE_NOT_FOUND ? 404 : 400;
      return c.json(
        errorResponse(result.error.code, result.error.message, result.error.details),
        status,
      );
    }

    return c.json({ data: result.value });
  });

  // ── GET /:id/archive ──────────────────────────────────────────
  //
  // List archive months with item counts.

  router.get("/:id/archive", (c) => {
    const id = c.req.param("id");
    const projectPath = resolveProjectPath(id);
    if (!projectPath) {
      return c.json(errorResponse("INVALID_ID", `Invalid project ID: ${id}`), 400);
    }
    const violation = validateProjectPath(projectPath);
    if (violation) {
      return c.json(errorResponse("PATH_VIOLATION", "Project ID escapes root directory"), 400);
    }

    const monthsResult = listArchiveMonths(defaultBacklogPaths(projectPath));
    if (!monthsResult.ok) {
      return c.json(errorResponse(monthsResult.error.code, monthsResult.error.message), 500);
    }

    const months = monthsResult.value.map((month) => {
      const archiveResult = readArchiveMonth(defaultBacklogPaths(projectPath), month);
      return { month, count: archiveResult.ok ? archiveResult.value.items.length : 0 };
    });

    return c.json({ data: { months } });
  });

  // ── GET /:id/archive/:month ───────────────────────────────────
  //
  // Read one archive month file.

  router.get("/:id/archive/:month", (c) => {
    const id = c.req.param("id");
    const month = c.req.param("month");
    const projectPath = resolveProjectPath(id);
    if (!projectPath) {
      return c.json(errorResponse("INVALID_ID", `Invalid project ID: ${id}`), 400);
    }
    const violation = validateProjectPath(projectPath);
    if (violation) {
      return c.json(errorResponse("PATH_VIOLATION", "Project ID escapes root directory"), 400);
    }

    const result = readArchiveMonth(defaultBacklogPaths(projectPath), month);
    if (!result.ok) {
      const status = result.error.code === ErrorCodes.FILE_NOT_FOUND ? 404 : 400;
      return c.json(
        errorResponse(result.error.code, result.error.message, result.error.details),
        status,
      );
    }

    return c.json({ data: result.value });
  });

  // ── DELETE /:id/archive/:month ────────────────────────────────
  //
  // Purge a specific archive month.

  router.delete("/:id/archive/:month", (c) => {
    const id = c.req.param("id");
    const month = c.req.param("month");
    const projectPath = resolveProjectPath(id);
    if (!projectPath) {
      return c.json(errorResponse("INVALID_ID", `Invalid project ID: ${id}`), 400);
    }
    const violation = validateProjectPath(projectPath);
    if (violation) {
      return c.json(errorResponse("PATH_VIOLATION", "Project ID escapes root directory"), 400);
    }

    const result = purgeArchive(defaultBacklogPaths(projectPath), month);
    if (!result.ok) {
      const status = result.error.code === ErrorCodes.FILE_NOT_FOUND ? 404 : 400;
      return c.json(
        errorResponse(result.error.code, result.error.message, result.error.details),
        status,
      );
    }

    return c.json({ data: result.value });
  });

  // ── POST /:id/backlog ─────────────────────────────────────────
  //
  // Create a new backlog item. Returns 201 with the created item.

  router.post("/:id/backlog", async (c) => {
    const id = c.req.param("id");
    const projectPath = resolveProjectPath(id);
    if (!projectPath) {
      return c.json(errorResponse("INVALID_ID", `Invalid project ID: ${id}`), 400);
    }
    const violation = validateProjectPath(projectPath);
    if (violation) {
      return c.json(errorResponse("PATH_VIOLATION", "Project ID escapes root directory"), 400);
    }

    const raw = await c.req.json().catch(() => null);
    if (raw === null || typeof raw !== "object") {
      return c.json(errorResponse("INVALID_BODY", "Request body is required"), 400);
    }

    const parseResult = CreateItemBodySchema.safeParse(raw);
    if (!parseResult.success) {
      return c.json(
        errorResponse("VALIDATION_ERROR", "Invalid request body", parseResult.error.flatten()),
        400,
      );
    }

    const input: CreateItemInput = parseResult.data;

    const result = addItem(defaultBacklogPaths(projectPath), input);
    if (!result.ok) {
      const status = result.error.code === ErrorCodes.FILE_NOT_FOUND ? 404 : 400;
      return c.json(
        errorResponse(result.error.code, result.error.message, result.error.details),
        status,
      );
    }

    return c.json({ data: result.value }, 201);
  });

  // ── GET /:id/backlog/:itemId ──────────────────────────────────

  router.get("/:id/backlog/:itemId", (c) => {
    const id = c.req.param("id");
    const itemId = c.req.param("itemId");
    const projectPath = resolveProjectPath(id);
    if (!projectPath) {
      return c.json(errorResponse("INVALID_ID", `Invalid project ID: ${id}`), 400);
    }
    const violation = validateProjectPath(projectPath);
    if (violation) {
      return c.json(errorResponse("PATH_VIOLATION", "Project ID escapes root directory"), 400);
    }

    const backlogResult = readBacklog(defaultBacklogPaths(projectPath));
    if (!backlogResult.ok) {
      const status = backlogResult.error.code === ErrorCodes.FILE_NOT_FOUND ? 404 : 500;
      return c.json(errorResponse(backlogResult.error.code, backlogResult.error.message), status);
    }

    const item = backlogResult.value.items.find((i) => i.id === itemId);
    if (!item) {
      return c.json(errorResponse("NOT_FOUND", `Item not found: ${itemId}`), 404);
    }

    return c.json({ data: item });
  });

  // ── PUT /:id/backlog/:itemId ──────────────────────────────────
  //
  // Update an existing item. Enforces status transition validation via core.

  router.put("/:id/backlog/:itemId", async (c) => {
    const id = c.req.param("id");
    const itemId = c.req.param("itemId");
    const projectPath = resolveProjectPath(id);
    if (!projectPath) {
      return c.json(errorResponse("INVALID_ID", `Invalid project ID: ${id}`), 400);
    }
    const violation = validateProjectPath(projectPath);
    if (violation) {
      return c.json(errorResponse("PATH_VIOLATION", "Project ID escapes root directory"), 400);
    }

    const raw = await c.req.json().catch(() => null);
    if (raw === null) {
      return c.json(errorResponse("INVALID_BODY", "Request body is required"), 400);
    }

    const parseResult = UpdateItemBodySchema.safeParse(raw);
    if (!parseResult.success) {
      return c.json(
        errorResponse("VALIDATION_ERROR", "Invalid request body", parseResult.error.flatten()),
        400,
      );
    }

    const updates: UpdateItemInput = parseResult.data;

    const result = updateItem(defaultBacklogPaths(projectPath), itemId, updates);
    if (!result.ok) {
      const status =
        result.error.code === ErrorCodes.FILE_NOT_FOUND
          ? 404
          : result.error.code === ErrorCodes.CONFLICT
            ? 409
            : 400;
      return c.json(
        errorResponse(result.error.code, result.error.message, result.error.details),
        status,
      );
    }

    return c.json({ data: result.value });
  });

  // ── DELETE /:id/backlog/:itemId ───────────────────────────────
  //
  // Delete a backlog item. Blocked for in_progress items when loop is active.

  router.delete("/:id/backlog/:itemId", (c) => {
    const id = c.req.param("id");
    const itemId = c.req.param("itemId");
    const projectPath = resolveProjectPath(id);
    if (!projectPath) {
      return c.json(errorResponse("INVALID_ID", `Invalid project ID: ${id}`), 400);
    }
    const violation = validateProjectPath(projectPath);
    if (violation) {
      return c.json(errorResponse("PATH_VIOLATION", "Project ID escapes root directory"), 400);
    }

    const result = deleteItem(defaultBacklogPaths(projectPath), itemId);
    if (!result.ok) {
      const status =
        result.error.code === ErrorCodes.CONFLICT
          ? 409
          : result.error.code === ErrorCodes.FILE_NOT_FOUND
            ? 404
            : 400;
      return c.json(
        errorResponse(result.error.code, result.error.message, result.error.details),
        status,
      );
    }

    return c.json({ data: null });
  });

  return router;
}
