// ─── Profile and Config API Routes ───────────────────────────────
//
// Profile routes (mounted at /api/projects):
//   GET  /:id/profile         → { data: ProjectProfile }
//   PUT  /:id/profile         → { data: ProjectProfile }
//   POST /:id/profile/detect  → { data: ProjectProfile }
//
// Config routes (mounted at /api/config):
//   GET  /                    → { data: ToolConfig }
//   PUT  /                    → { data: ToolConfig }
//
// Profile mutations (PUT, POST) require X-Ralph-Request: true
// (enforced by app-level CSRF middleware).

import * as path from "node:path";

import { Hono } from "hono";

import {
  readMarkerFile,
  writeMarkerFile,
  readToolConfig,
  writeToolConfig,
  detectProfile,
  resolveRootDirectory,
  validatePath,
  ProjectProfileSchema,
  ToolConfigSchema,
  ErrorCodes,
} from "@ralph/core";

import { errorResponse } from "../app.js";

// ─── createProfileRouter ─────────────────────────────────────────
//
// Returns a Hono router for /api/projects/:id/profile routes.
// rootDirectoryOverride lets tests inject a controlled directory.

export function createProfileRouter(rootDirectoryOverride?: string): Hono {
  const router = new Hono();

  // ── Helpers ───────────────────────────────────────────────────

  function getRootDirectory(): string {
    if (rootDirectoryOverride !== undefined) return rootDirectoryOverride;
    const configResult = readToolConfig();
    return configResult.ok ? configResult.value.rootDirectory : resolveRootDirectory();
  }

  /**
   * Decode a raw `:id` param and build the absolute project path.
   * Returns null if the id contains illegal path components.
   */
  function resolveProjectPath(id: string): string | null {
    const decoded = decodeURIComponent(id);
    if (decoded.includes("/") || decoded.includes("\\") || decoded === "." || decoded === "..") {
      return null;
    }
    return path.join(getRootDirectory(), decoded);
  }

  /** Validate that a resolved path is within ROOT_DIRECTORY. Returns error code or null. */
  function validateProjectPath(projectPath: string): string | null {
    const rootDir = getRootDirectory();
    const pathResult = validatePath(projectPath, [rootDir]);
    return pathResult.ok ? null : pathResult.error.code;
  }

  // ── GET /:id/profile ──────────────────────────────────────────
  //
  // Returns the ProjectProfile stored in .ralph.json.
  // 404 when the project doesn't have ralph installed.

  router.get("/:id/profile", (c) => {
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
      const status = markerResult.error.code === ErrorCodes.FILE_NOT_FOUND ? 404 : 500;
      return c.json(errorResponse(markerResult.error.code, markerResult.error.message), status);
    }

    return c.json({ data: markerResult.value.profile });
  });

  // ── POST /:id/profile/detect ──────────────────────────────────
  //
  // Auto-detect the tech stack for the project and return the
  // inferred ProjectProfile. Does NOT save — the caller can PUT
  // the result back to persist it.
  //
  // Registered before PUT /:id/profile so "detect" is not matched
  // as a literal profile replacement.

  router.post("/:id/profile/detect", (c) => {
    const id = c.req.param("id");
    const projectPath = resolveProjectPath(id);
    if (!projectPath) {
      return c.json(errorResponse("INVALID_ID", `Invalid project ID: ${id}`), 400);
    }
    const violation = validateProjectPath(projectPath);
    if (violation) {
      return c.json(errorResponse("PATH_VIOLATION", "Project ID escapes root directory"), 400);
    }

    const detected = detectProfile(projectPath);
    return c.json({ data: detected });
  });

  // ── PUT /:id/profile ──────────────────────────────────────────
  //
  // Replace the ProjectProfile in .ralph.json with the body.
  // Body must conform to ProjectProfileSchema.
  // Returns the saved profile on success.

  router.put("/:id/profile", async (c) => {
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
      const status = markerResult.error.code === ErrorCodes.FILE_NOT_FOUND ? 404 : 500;
      return c.json(errorResponse(markerResult.error.code, markerResult.error.message), status);
    }

    const body = (await c.req.json().catch(() => null)) as unknown;
    if (body === null || typeof body !== "object") {
      return c.json(errorResponse("INVALID_BODY", "Request body is required"), 400);
    }

    const parseResult = ProjectProfileSchema.safeParse(body);
    if (!parseResult.success) {
      return c.json(
        errorResponse("VALIDATION_ERROR", "Invalid profile data", parseResult.error.flatten()),
        400,
      );
    }

    const updatedMarker = { ...markerResult.value, profile: parseResult.data };
    const writeResult = writeMarkerFile(projectPath, updatedMarker);
    if (!writeResult.ok) {
      return c.json(errorResponse(writeResult.error.code, writeResult.error.message), 500);
    }

    return c.json({ data: parseResult.data });
  });

  return router;
}

// ─── createConfigRouter ──────────────────────────────────────────
//
// Returns a Hono router for /api/config routes.
// No project path involved — reads/writes ~/.ralph/config.json.

export function createConfigRouter(): Hono {
  const router = new Hono();

  // ── GET / ─────────────────────────────────────────────────────
  //
  // Returns the current ToolConfig. Returns defaults when
  // ~/.ralph/config.json doesn't exist.

  router.get("/", (c) => {
    const result = readToolConfig();
    if (!result.ok) {
      return c.json(errorResponse(result.error.code, result.error.message), 500);
    }
    return c.json({ data: result.value });
  });

  // ── PUT / ─────────────────────────────────────────────────────
  //
  // Replace the ToolConfig. Body must conform to ToolConfigSchema.
  // Returns the saved config on success.

  router.put("/", async (c) => {
    const body = (await c.req.json().catch(() => null)) as unknown;
    if (body === null || typeof body !== "object") {
      return c.json(errorResponse("INVALID_BODY", "Request body is required"), 400);
    }

    const parseResult = ToolConfigSchema.safeParse(body);
    if (!parseResult.success) {
      return c.json(
        errorResponse("VALIDATION_ERROR", "Invalid config data", parseResult.error.flatten()),
        400,
      );
    }

    const writeResult = writeToolConfig(parseResult.data);
    if (!writeResult.ok) {
      return c.json(errorResponse(writeResult.error.code, writeResult.error.message), 500);
    }

    return c.json({ data: parseResult.data });
  });

  return router;
}
