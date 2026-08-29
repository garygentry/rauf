// ─── Projects API Routes ─────────────────────────────────────────
//
// /api/projects:  list, detail, install, init, update, uninstall
//
// :id = directory name (URL-encoded), resolved to ROOT_DIRECTORY/<id>.
// All mutations require X-Rauf-Request: true (enforced by app-level CSRF
// middleware — not repeated here).
//
// Artifacts are embedded in @rauf/core at build time — no filesystem
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
  resolveBacklogRoot,
  resolveBacklogPaths,
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
  resetProject,
  unblockItems,
  validateBacklog,
  selectNextItem,
  LoopStartOptionsSchema,
  ErrorCodes,
  BacklogItemTypeSchema,
  BacklogItemStatusSchema,
  BacklogItemPrioritySchema,
  AgentDelegationSchema,
  type BacklogPaths,
  type InstallOptions,
  type UninstallOptions,
  type InitOptions,
  type ProfileOverrides,
  type CreateItemInput,
  type UpdateItemInput,
} from "@rauf/core";

import {
  acquireRecoveryLock,
  releaseRecoveryLock,
  recoverInterruptedLoop,
  type RecoverySummary,
} from "@rauf/loop";

import { errorResponse } from "../app.js";
import {
  DEFAULT_MAX_RETRIES,
  DEFAULT_SESSION_TIMEOUT_MINUTES,
  resolveRequestMaxIterations,
} from "../loop-defaults.js";
import { getLoopManager } from "../loop-manager.js";
import { resolveProjectPath as resolveProjectPathShared } from "../resolve-project.js";
import { assertNoLiveLoop } from "./recovery-guard.js";

// ─── Web DTOs ────────────────────────────────────────────────────

/** Success payload for POST /:id/resume (00 §6). */
interface ResumeResult {
  reconciled: RecoverySummary;
  relaunched: boolean;
  reason?: string;
}

// ─── Request body schemas ────────────────────────────────────────

const SweepBodySchema = z.object({
  minAgeDays: z.number().int().nonnegative().optional(),
  backlogRoot: z.string().optional(),
});

const ResetBodySchema = z
  .object({
    clearBacklog: z.boolean().optional(),
    keepProgress: z.boolean().optional(),
    keepLog: z.boolean().optional(),
    backlogRoot: z.string().optional(),
  })
  .strict();

const UnblockBodySchema = z
  .object({
    itemId: z.string().optional(),
    backlogRoot: z.string().optional(),
  })
  .strict();

// ResumeBodySchema (00 §7): reconcile + relaunch body. `.strict()` rejects
// unknown keys. OQ-T2: the answer field is `text`, written as humanAnswer.
const ResumeBodySchema = z
  .object({
    backlogRoot: z.string().optional(),
    retryBlocked: z.boolean().optional(),
    answers: z.array(z.object({ itemId: z.string(), text: z.string() }).strict()).optional(),
  })
  .strict();

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

  /**
   * Resolve BacklogPaths from an optional backlog query/body parameter.
   * Returns defaultBacklogPaths when no param is provided.
   */
  function resolveBacklogPathsFromParam(
    projectPath: string,
    backlogParam: string | undefined,
  ): { ok: true; paths: BacklogPaths } | { ok: false; code: string; message: string } {
    if (!backlogParam) {
      return { ok: true, paths: defaultBacklogPaths(projectPath) };
    }
    const rootResult = resolveBacklogRoot(projectPath, backlogParam);
    if (!rootResult.ok) {
      return { ok: false, code: rootResult.error.code, message: rootResult.error.message };
    }
    const pathsResult = resolveBacklogPaths(projectPath, rootResult.value);
    if (!pathsResult.ok) {
      return { ok: false, code: pathsResult.error.code, message: pathsResult.error.message };
    }
    return { ok: true, paths: pathsResult.value };
  }

  /**
   * Map a recovery `Result` error code to an HTTP status (00 §8.1).
   * Local to the router so the recovery routes agree on the mapping.
   */
  function recoveryErrorStatus(code: string): 400 | 404 | 409 | 500 {
    switch (code) {
      case ErrorCodes.FILE_NOT_FOUND:
        return 404;
      case ErrorCodes.LOCK_CONFLICT:
        return 409;
      case ErrorCodes.IO_ERROR:
        return 500;
      case ErrorCodes.VALIDATION_ERROR:
      case ErrorCodes.INVALID_JSON:
        return 400;
      default:
        return 400;
    }
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

  // ── POST /:id/reset ───────────────────────────────────────────
  //
  // Reset loop state (web equivalent of CLI reset). Acquire-and-hold
  // guarded (D3.4): a live loop → 409; lock released in a finally.

  router.post("/:id/reset", async (c) => {
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
    const parsed = ResetBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json(
        errorResponse("VALIDATION_ERROR", "Invalid request body", parsed.error.flatten()),
        400,
      );
    }
    const body = parsed.data;

    const resolved = resolveBacklogPathsFromParam(projectPath, body.backlogRoot);
    if (!resolved.ok) {
      return c.json(errorResponse(resolved.code, resolved.message), 400);
    }
    const paths = resolved.paths;

    // Guard: acquire-and-hold (D3.4). A live loop → 409; a stale lock is
    // cleared; a missing backlog root → 404 (mapped via recoveryErrorStatus).
    const acquired = acquireRecoveryLock(paths);
    if (!acquired.ok) {
      return c.json(
        errorResponse(acquired.error.code, acquired.error.message, acquired.error.details),
        recoveryErrorStatus(acquired.error.code),
      );
    }

    try {
      const result = resetProject(paths, {
        clearBacklog: body.clearBacklog,
        keepProgress: body.keepProgress,
        keepLog: body.keepLog,
      });
      if (!result.ok) {
        return c.json(
          errorResponse(result.error.code, result.error.message, result.error.details),
          recoveryErrorStatus(result.error.code),
        );
      }
      return c.json({ data: result.value });
    } finally {
      // Always release — reset does not relaunch, so release unconditionally.
      releaseRecoveryLock(paths);
    }
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

    const backlogParam = c.req.query("backlog");
    const resolved = resolveBacklogPathsFromParam(projectPath, backlogParam);
    if (!resolved.ok) {
      return c.json(errorResponse(resolved.code, resolved.message), 400);
    }

    const backlogResult = readBacklog(resolved.paths);
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

    const raw = await c.req.json().catch(() => ({}));
    const backlogRoot =
      typeof raw === "object" && raw !== null
        ? (raw as Record<string, unknown>).backlogRoot
        : undefined;
    const resolved = resolveBacklogPathsFromParam(
      projectPath,
      typeof backlogRoot === "string" ? backlogRoot : undefined,
    );
    if (!resolved.ok) {
      return c.json(errorResponse(resolved.code, resolved.message), 400);
    }

    const result = restoreFromBackup(resolved.paths);
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
  // Sweep done items into .rauf/archive/. Registered before /:id/backlog/:itemId
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

    const resolved = resolveBacklogPathsFromParam(projectPath, parseResult.data.backlogRoot);
    if (!resolved.ok) {
      return c.json(errorResponse(resolved.code, resolved.message), 400);
    }

    const result = sweepBacklog(resolved.paths, { minAgeDays: parseResult.data.minAgeDays });
    if (!result.ok) {
      const status = result.error.code === ErrorCodes.FILE_NOT_FOUND ? 404 : 400;
      return c.json(
        errorResponse(result.error.code, result.error.message, result.error.details),
        status,
      );
    }

    return c.json({ data: result.value });
  });

  // ── POST /:id/backlog/unblock ─────────────────────────────────
  //
  // Unblock all blocked items, or a specific item. Lightweight guard
  // (assertNoLiveLoop). Registered before /:id/backlog/:itemId so
  // "unblock" is never mismatched as an itemId.

  router.post("/:id/backlog/unblock", async (c) => {
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
    const parsed = UnblockBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json(
        errorResponse("VALIDATION_ERROR", "Invalid request body", parsed.error.flatten()),
        400,
      );
    }
    const body = parsed.data;

    const resolved = resolveBacklogPathsFromParam(projectPath, body.backlogRoot);
    if (!resolved.ok) {
      return c.json(errorResponse(resolved.code, resolved.message), 400);
    }
    const paths = resolved.paths;

    // Lightweight guard (D3.4): refuse if a loop is live on this root.
    const live = assertNoLiveLoop(paths);
    if (!live.ok) {
      return c.json(errorResponse(live.error.code, live.error.message), 409);
    }

    const result = unblockItems(paths, body.itemId);
    if (!result.ok) {
      return c.json(
        errorResponse(result.error.code, result.error.message, result.error.details),
        recoveryErrorStatus(result.error.code),
      );
    }
    return c.json({ data: result.value }); // { unblockedCount, unblockedIds }
  });

  // ── GET /:id/backlog/validate ─────────────────────────────────
  //
  // Validate the backlog and return machine-readable findings. GET,
  // read-only — no CSRF header and no lock guard (safe during a live
  // run). Registered before /:id/backlog/:itemId so "validate" is
  // never mismatched as an itemId.

  router.get("/:id/backlog/validate", (c) => {
    const id = c.req.param("id");
    const projectPath = resolveProjectPath(id);
    if (!projectPath) {
      return c.json(errorResponse("INVALID_ID", `Invalid project ID: ${id}`), 400);
    }
    const violation = validateProjectPath(projectPath);
    if (violation) {
      return c.json(errorResponse("PATH_VIOLATION", "Project ID escapes root directory"), 400);
    }

    const resolved = resolveBacklogPathsFromParam(projectPath, c.req.query("backlogRoot"));
    if (!resolved.ok) {
      return c.json(errorResponse(resolved.code, resolved.message), 400);
    }

    const result = validateBacklog(resolved.paths, {});
    if (!result.ok) {
      return c.json(
        errorResponse(result.error.code, result.error.message, result.error.details),
        recoveryErrorStatus(result.error.code),
      );
    }
    return c.json({ data: result.value }); // ValidateBacklogResult { valid, findings }
  });

  // ── POST /:id/resume ──────────────────────────────────────────
  //
  // Reconcile + relaunch (web equivalent of CLI resume, minus --recover).
  // Acquire-and-hold guarded (D3.4): the lock is held across answer
  // injection, recoverInterruptedLoop, and the eligibility decision, then
  // released in a finally BEFORE the relaunch so the loop's own lock
  // acquisition succeeds. The --recover reverify+commit path is CLI-only.

  router.post("/:id/resume", async (c) => {
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
    const parsed = ResumeBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json(
        errorResponse("VALIDATION_ERROR", "Invalid request body", parsed.error.flatten()),
        400,
      );
    }
    const body = parsed.data;

    const resolved = resolveBacklogPathsFromParam(projectPath, body.backlogRoot);
    if (!resolved.ok) {
      return c.json(errorResponse(resolved.code, resolved.message), 400);
    }
    const paths = resolved.paths;

    // Resolve the absolute backlog root for the relaunch options (mirrors the
    // start route). resolveBacklogPathsFromParam already validated it.
    let resolvedBacklogRoot: string | undefined;
    if (body.backlogRoot) {
      const rootResult = resolveBacklogRoot(projectPath, body.backlogRoot);
      if (rootResult.ok) resolvedBacklogRoot = rootResult.value;
    }

    // Guard: acquire-and-hold (D3.4). A live loop → 409; a stale lock is
    // cleared; a missing backlog root → 404 (mapped via recoveryErrorStatus).
    const acquired = acquireRecoveryLock(paths);
    if (!acquired.ok) {
      return c.json(
        errorResponse(acquired.error.code, acquired.error.message, acquired.error.details),
        recoveryErrorStatus(acquired.error.code),
      );
    }

    let relaunch = false;
    let relaunchOptions: ReturnType<typeof LoopStartOptionsSchema.parse> | null = null;
    let reconciled: RecoverySummary | null = null;
    let reason: string | undefined;

    try {
      // 3. Answer injection (OQ-T2: { itemId, text } → humanAnswer).
      for (const { itemId, text } of body.answers ?? []) {
        const upd = updateItem(paths, itemId, {
          humanAnswer: text,
          status: "pending",
          needsHuman: false,
          blockedReason: null,
        });
        if (!upd.ok) {
          return c.json(
            errorResponse(
              upd.error.code,
              `Could not inject answer into ${itemId}: ${upd.error.message}`,
              upd.error.details,
            ),
            recoveryErrorStatus(upd.error.code),
          );
        }
      }

      // 3b. retry-blocked convenience: re-queue genuine blocks before reconciling.
      if (body.retryBlocked) {
        const ub = unblockItems(paths);
        if (!ub.ok) {
          return c.json(
            errorResponse(ub.error.code, ub.error.message, ub.error.details),
            recoveryErrorStatus(ub.error.code),
          );
        }
      }

      // 4. Reconcile (async). recoverInterruptedLoop does NOT touch the lock — we hold it.
      const recovery = await recoverInterruptedLoop(paths);
      if (!recovery.ok) {
        return c.json(
          errorResponse(recovery.error.code, recovery.error.message, recovery.error.details),
          recoveryErrorStatus(recovery.error.code),
        );
      }
      reconciled = recovery.value;

      // 4b. Interrupted-but-uncommitted work is the CLI-only --recover path; surface it.
      if (reconciled.interrupted.length > 0) {
        reason = `${reconciled.interrupted.length} item(s) have uncommitted work — run \`rauf resume --recover\` from the CLI to re-verify and commit before resuming.`;
        relaunch = false;
      } else {
        // 5. Relaunch decision.
        const post = readBacklog(paths);
        if (post.ok && selectNextItem(post.value) === null) {
          reason = "no eligible items";
          relaunch = false;
        } else {
          relaunch = true;
          relaunchOptions = LoopStartOptionsSchema.parse({
            maxIterations: resolveRequestMaxIterations(projectPath, null, resolvedBacklogRoot),
            maxRetries: DEFAULT_MAX_RETRIES,
            sessionTimeoutMinutes: DEFAULT_SESSION_TIMEOUT_MINUTES,
            backlogRoot: resolvedBacklogRoot,
          });
        }
      }
    } finally {
      // Release BEFORE relaunch so the loop's own lock acquisition succeeds.
      releaseRecoveryLock(paths);
    }

    // 6. Relaunch after release.
    let relaunched = false;
    if (relaunch && relaunchOptions) {
      const started = getLoopManager().startLoop(projectPath, relaunchOptions);
      relaunched = started.ok;
      if (!started.ok) reason = started.error; // e.g. "Loop already running…"
    }

    // `reconciled` is set on the only success path; every null-leaving path returns
    // early inside the try. This explicit guard makes that invariant compiler-checked
    // (no non-null assertion) and defends a future non-returning edit from sending null.
    if (!reconciled) {
      return c.json(
        errorResponse(ErrorCodes.IO_ERROR, "resume produced no reconcile summary"),
        500,
      );
    }
    const result: ResumeResult = { reconciled, relaunched, reason };
    return c.json({ data: result });
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

    const backlogParam = c.req.query("backlog");
    const resolved = resolveBacklogPathsFromParam(projectPath, backlogParam);
    if (!resolved.ok) {
      return c.json(errorResponse(resolved.code, resolved.message), 400);
    }

    const monthsResult = listArchiveMonths(resolved.paths);
    if (!monthsResult.ok) {
      return c.json(errorResponse(monthsResult.error.code, monthsResult.error.message), 500);
    }

    const months = monthsResult.value.map((month) => {
      const archiveResult = readArchiveMonth(resolved.paths, month);
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

    const backlogParam = c.req.query("backlog");
    const resolved = resolveBacklogPathsFromParam(projectPath, backlogParam);
    if (!resolved.ok) {
      return c.json(errorResponse(resolved.code, resolved.message), 400);
    }

    const result = readArchiveMonth(resolved.paths, month);
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

  router.delete("/:id/archive/:month", async (c) => {
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

    const raw = await c.req.json().catch(() => ({}));
    const backlogRoot =
      typeof raw === "object" && raw !== null
        ? (raw as Record<string, unknown>).backlogRoot
        : undefined;
    const resolved = resolveBacklogPathsFromParam(
      projectPath,
      typeof backlogRoot === "string" ? backlogRoot : undefined,
    );
    if (!resolved.ok) {
      return c.json(errorResponse(resolved.code, resolved.message), 400);
    }

    const result = purgeArchive(resolved.paths, month);
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

    const backlogRoot =
      typeof raw === "object" && raw !== null
        ? (raw as Record<string, unknown>).backlogRoot
        : undefined;
    const resolved = resolveBacklogPathsFromParam(
      projectPath,
      typeof backlogRoot === "string" ? backlogRoot : undefined,
    );
    if (!resolved.ok) {
      return c.json(errorResponse(resolved.code, resolved.message), 400);
    }

    const result = addItem(resolved.paths, input);
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

    const backlogParam = c.req.query("backlog");
    const resolved = resolveBacklogPathsFromParam(projectPath, backlogParam);
    if (!resolved.ok) {
      return c.json(errorResponse(resolved.code, resolved.message), 400);
    }

    const backlogResult = readBacklog(resolved.paths);
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

    const backlogRoot =
      typeof raw === "object" && raw !== null
        ? (raw as Record<string, unknown>).backlogRoot
        : undefined;
    const resolved = resolveBacklogPathsFromParam(
      projectPath,
      typeof backlogRoot === "string" ? backlogRoot : undefined,
    );
    if (!resolved.ok) {
      return c.json(errorResponse(resolved.code, resolved.message), 400);
    }

    const result = updateItem(resolved.paths, itemId, updates);
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

  router.delete("/:id/backlog/:itemId", async (c) => {
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

    const raw = await c.req.json().catch(() => ({}));
    const backlogRoot =
      typeof raw === "object" && raw !== null
        ? (raw as Record<string, unknown>).backlogRoot
        : undefined;
    const resolved = resolveBacklogPathsFromParam(
      projectPath,
      typeof backlogRoot === "string" ? backlogRoot : undefined,
    );
    if (!resolved.ok) {
      return c.json(errorResponse(resolved.code, resolved.message), 400);
    }

    const result = deleteItem(resolved.paths, itemId);
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
