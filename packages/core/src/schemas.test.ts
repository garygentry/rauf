import { describe, expect, it } from "vitest";
import {
  BacklogItemSchema,
  BacklogSchema,
  MarkerFileSchema,
  LoopStateSchema,
  ToolConfigSchema,
  DerivedStatusSchema,
  BacklogSummarySchema,
  DiscoveredProjectSchema,
  InstallationReportSchema,
  InstallActionSchema,
  ApiErrorSchema,
  RalphErrorSchema,
  BacklogItemIdSchema,
  BacklogItemPrioritySchema,
  BacklogItemTypeSchema,
  BacklogItemStatusSchema,
  ProfileCommandsSchema,
  ProjectProfileSchema,
  MarkerOptionsSchema,
  LoopStateEnumSchema,
  VALID_STATUS_TRANSITIONS,
  LOG_PATTERNS,
  apiSuccessSchema,
} from "./schemas.js";
import { z } from "zod";

// ─── Test Fixtures ─────────────────────────────────────────────────

const validProfile = {
  stack: "node-typescript",
  packageManager: "pnpm",
  monorepo: true,
  commands: {
    test: "pnpm test",
    typecheck: "pnpm -r typecheck",
    lint: "pnpm -r lint",
    build: "pnpm build",
    format: null,
  },
  verify: "pnpm test && pnpm -r typecheck",
};

const validMarkerOptions = {
  ignoreInTool: false,
  gitignoreScripts: false,
  maxIterations: 20,
};

const validMarkerFile = {
  ralph: true as const,
  version: "1",
  variant: "backlog-json" as const,
  installedAt: "2026-02-21T19:00:00Z",
  installedBy: "ralph@0.1.0",
  profile: validProfile,
  artifactHashes: { "ralph.sh": "abc123" },
  options: validMarkerOptions,
};

const validBacklogItem = {
  id: "001",
  type: "feature" as const,
  priority: 1,
  title: "Implement schemas",
  description: "Create Zod schemas for all data types",
  acceptanceCriteria: ["Tests pass"],
  status: "pending" as const,
  completedAt: null,
};

const validBacklog = {
  project: "ralph",
  description: "A tool for managing coding loops",
  items: [validBacklogItem],
};

// ─── BacklogItem ID ────────────────────────────────────────────────

describe("BacklogItemIdSchema", () => {
  it("accepts zero-padded digit strings", () => {
    expect(BacklogItemIdSchema.parse("001")).toBe("001");
    expect(BacklogItemIdSchema.parse("042")).toBe("042");
    expect(BacklogItemIdSchema.parse("999")).toBe("999");
    expect(BacklogItemIdSchema.parse("0001")).toBe("0001");
  });

  it("rejects non-digit strings", () => {
    expect(() => BacklogItemIdSchema.parse("abc")).toThrow();
    expect(() => BacklogItemIdSchema.parse("1a2")).toThrow();
    expect(() => BacklogItemIdSchema.parse("")).toThrow();
  });

  it("rejects IDs shorter than 3 digits", () => {
    expect(() => BacklogItemIdSchema.parse("01")).toThrow();
    expect(() => BacklogItemIdSchema.parse("1")).toThrow();
  });
});

// ─── BacklogItem Type ──────────────────────────────────────────────

describe("BacklogItemTypeSchema", () => {
  it("accepts valid types", () => {
    for (const t of ["bug", "refactor", "feature", "chore"]) {
      expect(BacklogItemTypeSchema.parse(t)).toBe(t);
    }
  });

  it("rejects invalid types", () => {
    expect(() => BacklogItemTypeSchema.parse("task")).toThrow();
    expect(() => BacklogItemTypeSchema.parse("")).toThrow();
  });
});

// ─── BacklogItem Priority ──────────────────────────────────────────

describe("BacklogItemPrioritySchema", () => {
  it("accepts 1-4", () => {
    for (const p of [1, 2, 3, 4]) {
      expect(BacklogItemPrioritySchema.parse(p)).toBe(p);
    }
  });

  it("rejects 0, 5, and non-integers", () => {
    expect(() => BacklogItemPrioritySchema.parse(0)).toThrow();
    expect(() => BacklogItemPrioritySchema.parse(5)).toThrow();
    expect(() => BacklogItemPrioritySchema.parse(1.5)).toThrow();
    expect(() => BacklogItemPrioritySchema.parse(-1)).toThrow();
  });
});

// ─── BacklogItem Status ────────────────────────────────────────────

describe("BacklogItemStatusSchema", () => {
  it("accepts valid statuses", () => {
    for (const s of ["pending", "in_progress", "done", "blocked"]) {
      expect(BacklogItemStatusSchema.parse(s)).toBe(s);
    }
  });

  it("rejects invalid statuses", () => {
    expect(() => BacklogItemStatusSchema.parse("active")).toThrow();
    expect(() => BacklogItemStatusSchema.parse("cancelled")).toThrow();
  });
});

// ─── BacklogItem ───────────────────────────────────────────────────

describe("BacklogItemSchema", () => {
  it("accepts a valid item", () => {
    const result = BacklogItemSchema.parse(validBacklogItem);
    expect(result.id).toBe("001");
    expect(result.type).toBe("feature");
    expect(result.priority).toBe(1);
    expect(result.status).toBe("pending");
  });

  it("accepts optional fields", () => {
    const item = {
      ...validBacklogItem,
      blockedReason: "Waiting on upstream",
      dependsOn: ["001"],
      notes: "See issue #42",
      estimatedIterations: 3,
    };
    const result = BacklogItemSchema.parse(item);
    expect(result.blockedReason).toBe("Waiting on upstream");
    expect(result.dependsOn).toEqual(["001"]);
    expect(result.notes).toBe("See issue #42");
    expect(result.estimatedIterations).toBe(3);
  });

  it("rejects empty title", () => {
    expect(() =>
      BacklogItemSchema.parse({ ...validBacklogItem, title: "" }),
    ).toThrow();
  });

  it("rejects invalid priority", () => {
    expect(() =>
      BacklogItemSchema.parse({ ...validBacklogItem, priority: 5 }),
    ).toThrow();
  });

  it("rejects invalid type", () => {
    expect(() =>
      BacklogItemSchema.parse({ ...validBacklogItem, type: "epic" }),
    ).toThrow();
  });

  it("rejects invalid status", () => {
    expect(() =>
      BacklogItemSchema.parse({ ...validBacklogItem, status: "archived" }),
    ).toThrow();
  });

  it("rejects invalid id format", () => {
    expect(() =>
      BacklogItemSchema.parse({ ...validBacklogItem, id: "1" }),
    ).toThrow();
  });

  it("accepts completedAt as ISO string or null", () => {
    expect(
      BacklogItemSchema.parse({
        ...validBacklogItem,
        completedAt: "2026-02-21T19:00:00Z",
      }).completedAt,
    ).toBe("2026-02-21T19:00:00Z");
    expect(
      BacklogItemSchema.parse({ ...validBacklogItem, completedAt: null })
        .completedAt,
    ).toBeNull();
  });
});

// ─── Backlog ───────────────────────────────────────────────────────

describe("BacklogSchema", () => {
  it("accepts a valid backlog", () => {
    const result = BacklogSchema.parse(validBacklog);
    expect(result.project).toBe("ralph");
    expect(result.items).toHaveLength(1);
  });

  it("accepts empty items array", () => {
    const result = BacklogSchema.parse({
      ...validBacklog,
      items: [],
    });
    expect(result.items).toHaveLength(0);
  });

  it("rejects missing project field", () => {
    expect(() =>
      BacklogSchema.parse({ description: "test", items: [] }),
    ).toThrow();
  });
});

// ─── MarkerFile ────────────────────────────────────────────────────

describe("MarkerFileSchema", () => {
  it("accepts a valid marker file", () => {
    const result = MarkerFileSchema.parse(validMarkerFile);
    expect(result.ralph).toBe(true);
    expect(result.version).toBe("1");
    expect(result.variant).toBe("backlog-json");
  });

  it("rejects ralph !== true (sentinel check)", () => {
    expect(() =>
      MarkerFileSchema.parse({ ...validMarkerFile, ralph: false }),
    ).toThrow();
  });

  it("rejects ralph as a string", () => {
    expect(() =>
      MarkerFileSchema.parse({ ...validMarkerFile, ralph: "true" }),
    ).toThrow();
  });

  it("rejects invalid variant", () => {
    expect(() =>
      MarkerFileSchema.parse({ ...validMarkerFile, variant: "other" }),
    ).toThrow();
  });

  it("rejects missing profile", () => {
    const { profile: _, ...noProfile } = validMarkerFile;
    expect(() => MarkerFileSchema.parse(noProfile)).toThrow();
  });
});

// ─── MarkerOptions ─────────────────────────────────────────────────

describe("MarkerOptionsSchema", () => {
  it("accepts valid options", () => {
    const result = MarkerOptionsSchema.parse(validMarkerOptions);
    expect(result.ignoreInTool).toBe(false);
    expect(result.maxIterations).toBe(20);
  });

  it("rejects non-positive maxIterations", () => {
    expect(() =>
      MarkerOptionsSchema.parse({ ...validMarkerOptions, maxIterations: 0 }),
    ).toThrow();
    expect(() =>
      MarkerOptionsSchema.parse({ ...validMarkerOptions, maxIterations: -1 }),
    ).toThrow();
  });
});

// ─── ProjectProfile ────────────────────────────────────────────────

describe("ProjectProfileSchema", () => {
  it("accepts a valid profile", () => {
    const result = ProjectProfileSchema.parse(validProfile);
    expect(result.stack).toBe("node-typescript");
    expect(result.packageManager).toBe("pnpm");
    expect(result.monorepo).toBe(true);
  });

  it("accepts null packageManager", () => {
    const result = ProjectProfileSchema.parse({
      ...validProfile,
      packageManager: null,
    });
    expect(result.packageManager).toBeNull();
  });

  it("accepts null command values", () => {
    const result = ProjectProfileSchema.parse({
      ...validProfile,
      commands: {
        test: null,
        typecheck: null,
        lint: null,
        build: null,
        format: null,
      },
    });
    expect(result.commands.test).toBeNull();
  });
});

// ─── LoopState ─────────────────────────────────────────────────────

describe("LoopStateSchema", () => {
  const validLoopState = {
    status: "running" as const,
    iteration: 3,
    maxIterations: 20,
    currentItem: "002",
    lastSignal: "clean" as const,
    startedAt: "2026-02-21T19:00:00Z",
    updatedAt: "2026-02-21T19:05:00Z",
    completedItems: ["001"],
    blockedItems: [],
    error: null,
  };

  it("accepts a valid loop state", () => {
    const result = LoopStateSchema.parse(validLoopState);
    expect(result.status).toBe("running");
    expect(result.iteration).toBe(3);
  });

  it("accepts all valid statuses", () => {
    const statuses = [
      "starting",
      "running",
      "paused",
      "complete",
      "paused_human",
      "limit_reached",
      "error",
    ] as const;
    for (const status of statuses) {
      expect(
        LoopStateSchema.parse({ ...validLoopState, status }).status,
      ).toBe(status);
    }
  });

  it("accepts all valid signals", () => {
    for (const signal of ["clean", "blocked", "needs_human", "error"]) {
      expect(
        LoopStateSchema.parse({ ...validLoopState, lastSignal: signal })
          .lastSignal,
      ).toBe(signal);
    }
  });

  it("rejects invalid status", () => {
    expect(() =>
      LoopStateSchema.parse({ ...validLoopState, status: "stopped" }),
    ).toThrow();
  });

  it("rejects negative iteration", () => {
    expect(() =>
      LoopStateSchema.parse({ ...validLoopState, iteration: -1 }),
    ).toThrow();
  });
});

// ─── ToolConfig ────────────────────────────────────────────────────

describe("ToolConfigSchema", () => {
  it("accepts a valid config", () => {
    const result = ToolConfigSchema.parse({
      rootDirectory: "/home/user/projects",
      port: 5173,
      theme: "system",
    });
    expect(result.port).toBe(5173);
    expect(result.theme).toBe("system");
  });

  it("accepts all theme values", () => {
    for (const theme of ["light", "dark", "system"]) {
      expect(
        ToolConfigSchema.parse({
          rootDirectory: "/tmp",
          port: 3000,
          theme,
        }).theme,
      ).toBe(theme);
    }
  });

  it("rejects invalid theme", () => {
    expect(() =>
      ToolConfigSchema.parse({
        rootDirectory: "/tmp",
        port: 3000,
        theme: "blue",
      }),
    ).toThrow();
  });

  it("rejects non-positive port", () => {
    expect(() =>
      ToolConfigSchema.parse({
        rootDirectory: "/tmp",
        port: 0,
        theme: "system",
      }),
    ).toThrow();
  });
});

// ─── DerivedStatus ─────────────────────────────────────────────────

describe("DerivedStatusSchema", () => {
  it("accepts a valid derived status", () => {
    const result = DerivedStatusSchema.parse({
      loopState: "RUNNING",
      stateSource: "state.json",
      iteration: 3,
      maxIterations: 20,
      currentItem: "002",
      lastSignal: "clean",
      startedAt: "2026-02-21T19:00:00Z",
      elapsed: 300,
      backlogSummary: {
        pending: 5,
        inProgress: 1,
        blocked: 0,
        done: 2,
        total: 8,
      },
    });
    expect(result.loopState).toBe("RUNNING");
    expect(result.stateSource).toBe("state.json");
  });

  it("accepts all LoopStateEnum values", () => {
    const values = [
      "IDLE",
      "RUNNING",
      "PAUSED",
      "COMPLETE",
      "PAUSED_HUMAN",
      "LIMIT_REACHED",
      "ERROR",
      "NOT_INSTALLED",
    ];
    for (const v of values) {
      expect(LoopStateEnumSchema.parse(v)).toBe(v);
    }
  });

  it("accepts nullable fields as null", () => {
    const result = DerivedStatusSchema.parse({
      loopState: "IDLE",
      stateSource: "none",
      iteration: null,
      maxIterations: null,
      currentItem: null,
      lastSignal: null,
      startedAt: null,
      elapsed: null,
      backlogSummary: {
        pending: 0,
        inProgress: 0,
        blocked: 0,
        done: 0,
        total: 0,
      },
    });
    expect(result.iteration).toBeNull();
    expect(result.elapsed).toBeNull();
  });
});

// ─── BacklogSummary ────────────────────────────────────────────────

describe("BacklogSummarySchema", () => {
  it("rejects negative counts", () => {
    expect(() =>
      BacklogSummarySchema.parse({
        pending: -1,
        inProgress: 0,
        blocked: 0,
        done: 0,
        total: 0,
      }),
    ).toThrow();
  });
});

// ─── DiscoveredProject ─────────────────────────────────────────────

describe("DiscoveredProjectSchema", () => {
  it("accepts a valid discovered project", () => {
    const result = DiscoveredProjectSchema.parse({
      id: "my-project",
      path: "/home/user/projects/my-project",
      name: "My Project",
      marker: validMarkerFile,
    });
    expect(result.id).toBe("my-project");
  });
});

// ─── InstallationReport ────────────────────────────────────────────

describe("InstallationReportSchema", () => {
  it("accepts a valid report", () => {
    const result = InstallationReportSchema.parse({
      projectName: "my-project",
      projectPath: "/home/user/projects/my-project",
      actions: [
        { file: "ralph.sh", action: "created", detail: "Loop runner script" },
        {
          file: "CLAUDE.md",
          action: "merged",
          detail: "Ralph section added",
        },
      ],
      profile: validProfile,
      warnings: [],
    });
    expect(result.actions).toHaveLength(2);
  });

  it("validates action enum", () => {
    expect(() =>
      InstallActionSchema.parse({
        file: "test",
        action: "deleted",
        detail: "removed",
      }),
    ).toThrow();
  });
});

// ─── API Wrappers ──────────────────────────────────────────────────

describe("ApiErrorSchema", () => {
  it("accepts a valid error response", () => {
    const result = ApiErrorSchema.parse({
      error: {
        code: "NOT_FOUND",
        message: "Project not found",
        details: { projectId: "foo" },
      },
    });
    expect(result.error.code).toBe("NOT_FOUND");
  });

  it("accepts error without details", () => {
    const result = ApiErrorSchema.parse({
      error: { code: "SERVER_ERROR", message: "Unexpected error" },
    });
    expect(result.error.details).toBeUndefined();
  });
});

describe("apiSuccessSchema", () => {
  it("creates a typed success wrapper", () => {
    const schema = apiSuccessSchema(z.object({ id: z.string() }));
    const result = schema.parse({ data: { id: "001" } });
    expect(result.data.id).toBe("001");
  });

  it("rejects invalid data shape", () => {
    const schema = apiSuccessSchema(z.object({ id: z.string() }));
    expect(() => schema.parse({ data: { id: 123 } })).toThrow();
  });
});

// ─── RalphError ────────────────────────────────────────────────────

describe("RalphErrorSchema", () => {
  it("accepts a valid error", () => {
    const result = RalphErrorSchema.parse({
      code: "FILE_NOT_FOUND",
      message: "Could not locate backlog.json",
    });
    expect(result.code).toBe("FILE_NOT_FOUND");
  });
});

// ─── Status Transitions ────────────────────────────────────────────

describe("VALID_STATUS_TRANSITIONS", () => {
  it("pending can transition to in_progress or blocked", () => {
    expect(VALID_STATUS_TRANSITIONS.pending).toEqual([
      "in_progress",
      "blocked",
    ]);
  });

  it("in_progress can transition to done, blocked, or pending", () => {
    expect(VALID_STATUS_TRANSITIONS.in_progress).toEqual([
      "done",
      "blocked",
      "pending",
    ]);
  });

  it("blocked can only transition to pending", () => {
    expect(VALID_STATUS_TRANSITIONS.blocked).toEqual(["pending"]);
  });

  it("done can only transition to pending", () => {
    expect(VALID_STATUS_TRANSITIONS.done).toEqual(["pending"]);
  });
});

// ─── Log Patterns ──────────────────────────────────────────────────

describe("LOG_PATTERNS", () => {
  it("loopStart matches expected format", () => {
    const match = "Ralph Loop starting | max=20 iterations".match(
      LOG_PATTERNS.loopStart,
    );
    expect(match).not.toBeNull();
    expect(match![1]).toBe("20");
  });

  it("iteration matches expected format", () => {
    const match = "--- Iteration 3 / 20 ---".match(LOG_PATTERNS.iteration);
    expect(match).not.toBeNull();
    expect(match![1]).toBe("3");
    expect(match![2]).toBe("20");
  });

  it("status matches expected format", () => {
    const match =
      "Status → pending:5 in_progress:1 blocked:0 done:2 total:8".match(
        LOG_PATTERNS.status,
      );
    expect(match).not.toBeNull();
    expect(match![1]).toBe("5");
    expect(match![5]).toBe("8");
  });

  it("timestamp matches ISO-style log prefix", () => {
    const match = "[2026-02-21 19:05:00] Some message".match(
      LOG_PATTERNS.timestamp,
    );
    expect(match).not.toBeNull();
    expect(match![1]).toBe("2026-02-21 19:05:00");
  });
});
