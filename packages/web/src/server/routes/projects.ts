// ─── Projects API Routes ─────────────────────────────────────────
//
// /api/projects:  list, detail, install, init, update, uninstall
//
// :id = directory name (URL-encoded), resolved to ROOT_DIRECTORY/<id>.
// All mutations require X-Ralph-Request: true (enforced by app-level CSRF
// middleware — not repeated here).

import * as path from "node:path";

import { Hono } from "hono";

import {
  discoverProjects,
  install,
  update,
  uninstall,
  initProject,
  readMarkerFile,
  readToolConfig,
  resolveRootDirectory,
  validatePath,
  readBacklog,
  addItem,
  updateItem,
  deleteItem,
  restoreFromBackup,
  ErrorCodes,
  type InstallOptions,
  type UpdateOptions,
  type UninstallOptions,
  type InitOptions,
  type ProfileOverrides,
  type CreateItemInput,
  type UpdateItemInput,
  type BacklogItemType,
  type BacklogItemStatus,
} from "@ralph/core";

import { errorResponse } from "../app.js";

// ─── Artifacts resolution ────────────────────────────────────────
//
// In development, artifacts live at <repo>/artifacts/variants/backlog-json/.
// This file is at packages/web/src/server/routes/ — walk up 5 levels.

function resolveArtifactsDir(): string {
  const routesSrcDir = path.dirname(new URL(import.meta.url).pathname);
  // routes → server → src → web → packages → repo root
  const repoRoot = path.resolve(routesSrcDir, "..", "..", "..", "..", "..");
  return path.join(repoRoot, "artifacts", "variants", "backlog-json");
}

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
    const decoded = decodeURIComponent(id);
    // Reject traversal attempts — the id must be a plain directory name
    if (
      decoded.includes("/") ||
      decoded.includes("\\") ||
      decoded === "." ||
      decoded === ".."
    ) {
      return null;
    }
    return path.join(getRootDirectory(), decoded);
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
      return c.json(
        errorResponse("INVALID_ID", `Invalid project ID: ${id}`),
        400,
      );
    }

    const violation = validateProjectPath(projectPath);
    if (violation) {
      return c.json(
        errorResponse("PATH_VIOLATION", "Project ID escapes root directory"),
        400,
      );
    }

    const markerResult = readMarkerFile(projectPath);
    if (!markerResult.ok) {
      return c.json(
        errorResponse("NOT_FOUND", `Project not found: ${id}`),
        404,
      );
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
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      return c.json(errorResponse("INVALID_BODY", "Request body is required"), 400);
    }

    const { targetPath, name, description, preset, requirements } = body;

    if (!targetPath || typeof targetPath !== "string") {
      return c.json(
        errorResponse("VALIDATION_ERROR", "targetPath is required"),
        400,
      );
    }

    const opts: InitOptions = {
      artifactsDir: resolveArtifactsDir(),
      projectName: typeof name === "string" ? name : undefined,
      projectDescription: typeof description === "string" ? description : undefined,
      preset: typeof preset === "string" ? preset : undefined,
      requirements: typeof requirements === "string" ? requirements : undefined,
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

  // ── POST /api/projects/:id/install ────────────────────────────

  router.post("/:id/install", async (c) => {
    const id = c.req.param("id");
    const projectPath = resolveProjectPath(id);
    if (!projectPath) {
      return c.json(
        errorResponse("INVALID_ID", `Invalid project ID: ${id}`),
        400,
      );
    }

    const violation = validateProjectPath(projectPath);
    if (violation) {
      return c.json(
        errorResponse("PATH_VIOLATION", "Project ID escapes root directory"),
        400,
      );
    }

    const body = ((await c.req.json().catch(() => ({}))) as Record<string, unknown>);

    const opts: InstallOptions = {
      artifactsDir: resolveArtifactsDir(),
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

  // ── POST /api/projects/:id/update ─────────────────────────────

  router.post("/:id/update", async (c) => {
    const id = c.req.param("id");
    const projectPath = resolveProjectPath(id);
    if (!projectPath) {
      return c.json(
        errorResponse("INVALID_ID", `Invalid project ID: ${id}`),
        400,
      );
    }

    const violation = validateProjectPath(projectPath);
    if (violation) {
      return c.json(
        errorResponse("PATH_VIOLATION", "Project ID escapes root directory"),
        400,
      );
    }

    const opts: UpdateOptions = {
      artifactsDir: resolveArtifactsDir(),
    };

    const result = update(projectPath, opts);
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
      return c.json(
        errorResponse("INVALID_ID", `Invalid project ID: ${id}`),
        400,
      );
    }

    const violation = validateProjectPath(projectPath);
    if (violation) {
      return c.json(
        errorResponse("PATH_VIOLATION", "Project ID escapes root directory"),
        400,
      );
    }

    // Verify project exists before uninstalling
    const markerResult = readMarkerFile(projectPath);
    if (!markerResult.ok) {
      return c.json(
        errorResponse("NOT_FOUND", `Project not found: ${id}`),
        404,
      );
    }

    const body = ((await c.req.json().catch(() => ({}))) as Record<string, unknown>);

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
      return c.json(
        errorResponse("INVALID_ID", `Invalid project ID: ${id}`),
        400,
      );
    }
    const violation = validateProjectPath(projectPath);
    if (violation) {
      return c.json(
        errorResponse("PATH_VIOLATION", "Project ID escapes root directory"),
        400,
      );
    }

    const backlogResult = readBacklog(projectPath);
    if (!backlogResult.ok) {
      const status = backlogResult.error.code === ErrorCodes.FILE_NOT_FOUND ? 404 : 500;
      return c.json(
        errorResponse(backlogResult.error.code, backlogResult.error.message),
        status,
      );
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
      return c.json(
        errorResponse("INVALID_ID", `Invalid project ID: ${id}`),
        400,
      );
    }
    const violation = validateProjectPath(projectPath);
    if (violation) {
      return c.json(
        errorResponse("PATH_VIOLATION", "Project ID escapes root directory"),
        400,
      );
    }

    const result = restoreFromBackup(projectPath);
    if (!result.ok) {
      const status = result.error.code === ErrorCodes.FILE_NOT_FOUND ? 404 : 400;
      return c.json(
        errorResponse(result.error.code, result.error.message, result.error.details),
        status,
      );
    }

    return c.json({ data: null });
  });

  // ── POST /:id/backlog ─────────────────────────────────────────
  //
  // Create a new backlog item. Returns 201 with the created item.

  router.post("/:id/backlog", async (c) => {
    const id = c.req.param("id");
    const projectPath = resolveProjectPath(id);
    if (!projectPath) {
      return c.json(
        errorResponse("INVALID_ID", `Invalid project ID: ${id}`),
        400,
      );
    }
    const violation = validateProjectPath(projectPath);
    if (violation) {
      return c.json(
        errorResponse("PATH_VIOLATION", "Project ID escapes root directory"),
        400,
      );
    }

    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      return c.json(errorResponse("INVALID_BODY", "Request body is required"), 400);
    }

    const { type, priority, title } = body;

    const validTypes = ["bug", "refactor", "feature", "chore"];
    if (typeof type !== "string" || !validTypes.includes(type)) {
      return c.json(
        errorResponse("VALIDATION_ERROR", "type must be one of: bug, refactor, feature, chore"),
        400,
      );
    }
    const validPriorities = [1, 2, 3, 4];
    if (typeof priority !== "number" || !validPriorities.includes(priority)) {
      return c.json(
        errorResponse("VALIDATION_ERROR", "priority must be 1, 2, 3, or 4"),
        400,
      );
    }
    if (typeof title !== "string" || !title.trim()) {
      return c.json(
        errorResponse("VALIDATION_ERROR", "title must be a non-empty string"),
        400,
      );
    }

    const input: CreateItemInput = {
      type: type as BacklogItemType,
      priority: priority as 1 | 2 | 3 | 4,
      title,
      description: typeof body.description === "string" ? body.description : undefined,
      acceptanceCriteria: Array.isArray(body.acceptanceCriteria)
        ? (body.acceptanceCriteria as unknown[]).filter(
            (s): s is string => typeof s === "string",
          )
        : undefined,
      dependsOn: Array.isArray(body.dependsOn)
        ? (body.dependsOn as unknown[]).filter((s): s is string => typeof s === "string")
        : undefined,
      notes: typeof body.notes === "string" ? body.notes : undefined,
      estimatedIterations:
        typeof body.estimatedIterations === "number" ? body.estimatedIterations : undefined,
    };

    const result = addItem(projectPath, input);
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
      return c.json(
        errorResponse("INVALID_ID", `Invalid project ID: ${id}`),
        400,
      );
    }
    const violation = validateProjectPath(projectPath);
    if (violation) {
      return c.json(
        errorResponse("PATH_VIOLATION", "Project ID escapes root directory"),
        400,
      );
    }

    const backlogResult = readBacklog(projectPath);
    if (!backlogResult.ok) {
      const status = backlogResult.error.code === ErrorCodes.FILE_NOT_FOUND ? 404 : 500;
      return c.json(
        errorResponse(backlogResult.error.code, backlogResult.error.message),
        status,
      );
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
      return c.json(
        errorResponse("INVALID_ID", `Invalid project ID: ${id}`),
        400,
      );
    }
    const violation = validateProjectPath(projectPath);
    if (violation) {
      return c.json(
        errorResponse("PATH_VIOLATION", "Project ID escapes root directory"),
        400,
      );
    }

    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (body === null) {
      return c.json(errorResponse("INVALID_BODY", "Request body is required"), 400);
    }

    const updates: UpdateItemInput = {};
    const validTypes = ["bug", "refactor", "feature", "chore"];
    const validStatuses = ["pending", "in_progress", "done", "blocked"];
    const validPriorities = [1, 2, 3, 4];

    if (body.type !== undefined) {
      if (typeof body.type !== "string" || !validTypes.includes(body.type)) {
        return c.json(
          errorResponse("VALIDATION_ERROR", "type must be one of: bug, refactor, feature, chore"),
          400,
        );
      }
      updates.type = body.type as BacklogItemType;
    }
    if (body.priority !== undefined) {
      if (typeof body.priority !== "number" || !validPriorities.includes(body.priority)) {
        return c.json(
          errorResponse("VALIDATION_ERROR", "priority must be 1, 2, 3, or 4"),
          400,
        );
      }
      updates.priority = body.priority as 1 | 2 | 3 | 4;
    }
    if (body.title !== undefined) {
      if (typeof body.title !== "string") {
        return c.json(
          errorResponse("VALIDATION_ERROR", "title must be a string"),
          400,
        );
      }
      updates.title = body.title;
    }
    if (body.status !== undefined) {
      if (typeof body.status !== "string" || !validStatuses.includes(body.status)) {
        return c.json(
          errorResponse(
            "VALIDATION_ERROR",
            "status must be one of: pending, in_progress, done, blocked",
          ),
          400,
        );
      }
      updates.status = body.status as BacklogItemStatus;
    }
    if (body.description !== undefined) updates.description = String(body.description);
    if (body.blockedReason !== undefined) updates.blockedReason = String(body.blockedReason);
    if (body.acceptanceCriteria !== undefined) {
      if (!Array.isArray(body.acceptanceCriteria)) {
        return c.json(
          errorResponse("VALIDATION_ERROR", "acceptanceCriteria must be an array"),
          400,
        );
      }
      updates.acceptanceCriteria = (body.acceptanceCriteria as unknown[]).filter(
        (s): s is string => typeof s === "string",
      );
    }
    if (body.dependsOn !== undefined) {
      if (!Array.isArray(body.dependsOn)) {
        return c.json(
          errorResponse("VALIDATION_ERROR", "dependsOn must be an array"),
          400,
        );
      }
      updates.dependsOn = (body.dependsOn as unknown[]).filter(
        (s): s is string => typeof s === "string",
      );
    }
    if (body.notes !== undefined) updates.notes = String(body.notes);
    if (body.estimatedIterations !== undefined) {
      if (typeof body.estimatedIterations !== "number") {
        return c.json(
          errorResponse("VALIDATION_ERROR", "estimatedIterations must be a number"),
          400,
        );
      }
      updates.estimatedIterations = body.estimatedIterations;
    }

    const result = updateItem(projectPath, itemId, updates);
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
      return c.json(
        errorResponse("INVALID_ID", `Invalid project ID: ${id}`),
        400,
      );
    }
    const violation = validateProjectPath(projectPath);
    if (violation) {
      return c.json(
        errorResponse("PATH_VIOLATION", "Project ID escapes root directory"),
        400,
      );
    }

    const result = deleteItem(projectPath, itemId);
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
