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
  ErrorCodes,
  type InstallOptions,
  type UpdateOptions,
  type UninstallOptions,
  type InitOptions,
  type ProfileOverrides,
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
    return c.json({ data: result.value.projects });
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

  return router;
}
