import { describe, expect, it } from "vitest";
import {
  AgentDelegationSchema,
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
  ProjectProfileSchema,
  MarkerOptionsSchema,
  LoopStateEnumSchema,
  VALID_STATUS_TRANSITIONS,
  LOG_PATTERNS,
  apiSuccessSchema,
  LoopEventSchema,
  LoopStartOptionsSchema,
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
    expect(() => BacklogItemSchema.parse({ ...validBacklogItem, title: "" })).toThrow();
  });

  it("rejects invalid priority", () => {
    expect(() => BacklogItemSchema.parse({ ...validBacklogItem, priority: 5 })).toThrow();
  });

  it("rejects invalid type", () => {
    expect(() => BacklogItemSchema.parse({ ...validBacklogItem, type: "epic" })).toThrow();
  });

  it("rejects invalid status", () => {
    expect(() => BacklogItemSchema.parse({ ...validBacklogItem, status: "archived" })).toThrow();
  });

  it("rejects invalid id format", () => {
    expect(() => BacklogItemSchema.parse({ ...validBacklogItem, id: "1" })).toThrow();
  });

  it("accepts completedAt as ISO string or null", () => {
    expect(
      BacklogItemSchema.parse({
        ...validBacklogItem,
        completedAt: "2026-02-21T19:00:00Z",
      }).completedAt,
    ).toBe("2026-02-21T19:00:00Z");
    expect(
      BacklogItemSchema.parse({ ...validBacklogItem, completedAt: null }).completedAt,
    ).toBeNull();
  });

  it("accepts model field as optional string", () => {
    const result = BacklogItemSchema.parse({
      ...validBacklogItem,
      model: "claude-opus-4-6",
    });
    expect(result.model).toBe("claude-opus-4-6");
  });

  it("accepts item without model field (backward compat)", () => {
    const result = BacklogItemSchema.parse(validBacklogItem);
    expect(result.model).toBeUndefined();
  });

  it("rejects model as non-string", () => {
    expect(() => BacklogItemSchema.parse({ ...validBacklogItem, model: 42 })).toThrow();
  });

  it("accepts agentDelegation with all fields", () => {
    const result = BacklogItemSchema.parse({
      ...validBacklogItem,
      agentDelegation: {
        recommendedConcurrency: 3,
        strategy: "Implement each module independently",
        subtasks: ["Implement auth", "Add tests", "Update docs"],
      },
    });
    expect(result.agentDelegation).toBeDefined();
    expect(result.agentDelegation!.recommendedConcurrency).toBe(3);
    expect(result.agentDelegation!.strategy).toBe("Implement each module independently");
    expect(result.agentDelegation!.subtasks).toEqual([
      "Implement auth",
      "Add tests",
      "Update docs",
    ]);
  });

  it("accepts agentDelegation with partial fields", () => {
    const result = BacklogItemSchema.parse({
      ...validBacklogItem,
      agentDelegation: { strategy: "Parallel execution" },
    });
    expect(result.agentDelegation!.strategy).toBe("Parallel execution");
    expect(result.agentDelegation!.recommendedConcurrency).toBeUndefined();
    expect(result.agentDelegation!.subtasks).toBeUndefined();
  });

  it("accepts agentDelegation as empty object", () => {
    const result = BacklogItemSchema.parse({
      ...validBacklogItem,
      agentDelegation: {},
    });
    expect(result.agentDelegation).toEqual({});
  });

  it("accepts item without agentDelegation (backward compat)", () => {
    const result = BacklogItemSchema.parse(validBacklogItem);
    expect(result.agentDelegation).toBeUndefined();
  });

  it("rejects agentDelegation.recommendedConcurrency < 2", () => {
    expect(() =>
      BacklogItemSchema.parse({
        ...validBacklogItem,
        agentDelegation: { recommendedConcurrency: 1 },
      }),
    ).toThrow();
  });

  it("accepts specReferences as array of strings", () => {
    const result = BacklogItemSchema.parse({
      ...validBacklogItem,
      specReferences: ["docs/auth-spec.md", "docs/ARCHITECTURE.md"],
    });
    expect(result.specReferences).toEqual(["docs/auth-spec.md", "docs/ARCHITECTURE.md"]);
  });

  it("accepts empty specReferences array", () => {
    const result = BacklogItemSchema.parse({
      ...validBacklogItem,
      specReferences: [],
    });
    expect(result.specReferences).toEqual([]);
  });

  it("accepts item without specReferences (backward compat)", () => {
    const result = BacklogItemSchema.parse(validBacklogItem);
    expect(result.specReferences).toBeUndefined();
  });

  it("rejects specReferences as non-array", () => {
    expect(() =>
      BacklogItemSchema.parse({ ...validBacklogItem, specReferences: "docs/spec.md" }),
    ).toThrow();
  });

  it("accepts optional provider string", () => {
    const result = BacklogItemSchema.parse({
      ...validBacklogItem,
      provider: "generic-cli",
    });
    expect(result.provider).toBe("generic-cli");
  });

  it("accepts item without provider (backward compat)", () => {
    const result = BacklogItemSchema.parse(validBacklogItem);
    expect(result.provider).toBeUndefined();
  });
});

// ─── AgentDelegation ──────────────────────────────────────────────

describe("AgentDelegationSchema", () => {
  it("accepts full delegation object", () => {
    const result = AgentDelegationSchema.parse({
      recommendedConcurrency: 3,
      strategy: "Each module is independent",
      subtasks: ["Task A", "Task B"],
    });
    expect(result.recommendedConcurrency).toBe(3);
    expect(result.subtasks).toHaveLength(2);
  });

  it("accepts empty object (all fields optional)", () => {
    const result = AgentDelegationSchema.parse({});
    expect(result).toEqual({});
  });

  it("rejects recommendedConcurrency below 2", () => {
    expect(() => AgentDelegationSchema.parse({ recommendedConcurrency: 1 })).toThrow();
    expect(() => AgentDelegationSchema.parse({ recommendedConcurrency: 0 })).toThrow();
  });

  it("accepts recommendedConcurrency of exactly 2", () => {
    const result = AgentDelegationSchema.parse({ recommendedConcurrency: 2 });
    expect(result.recommendedConcurrency).toBe(2);
  });

  it("rejects non-integer recommendedConcurrency", () => {
    expect(() => AgentDelegationSchema.parse({ recommendedConcurrency: 2.5 })).toThrow();
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
    expect(() => BacklogSchema.parse({ description: "test", items: [] })).toThrow();
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
    expect(() => MarkerFileSchema.parse({ ...validMarkerFile, ralph: false })).toThrow();
  });

  it("rejects ralph as a string", () => {
    expect(() => MarkerFileSchema.parse({ ...validMarkerFile, ralph: "true" })).toThrow();
  });

  it("rejects invalid variant", () => {
    expect(() => MarkerFileSchema.parse({ ...validMarkerFile, variant: "other" })).toThrow();
  });

  it("rejects missing profile", () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { profile: _profile, ...noProfile } = validMarkerFile;
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
    expect(() => MarkerOptionsSchema.parse({ ...validMarkerOptions, maxIterations: 0 })).toThrow();
    expect(() => MarkerOptionsSchema.parse({ ...validMarkerOptions, maxIterations: -1 })).toThrow();
  });

  it("accepts model field as optional string", () => {
    const result = MarkerOptionsSchema.parse({
      ...validMarkerOptions,
      model: "claude-sonnet-4-6",
    });
    expect(result.model).toBe("claude-sonnet-4-6");
  });

  it("accepts options without model field (backward compat)", () => {
    const result = MarkerOptionsSchema.parse(validMarkerOptions);
    expect(result.model).toBeUndefined();
  });

  it("rejects model as non-string", () => {
    expect(() => MarkerOptionsSchema.parse({ ...validMarkerOptions, model: true })).toThrow();
  });

  it("accepts sessionTimeout as optional positive integer", () => {
    const result = MarkerOptionsSchema.parse({
      ...validMarkerOptions,
      sessionTimeout: 60,
    });
    expect(result.sessionTimeout).toBe(60);
  });

  it("accepts options without sessionTimeout (backward compat)", () => {
    const result = MarkerOptionsSchema.parse(validMarkerOptions);
    expect(result.sessionTimeout).toBeUndefined();
  });

  it("rejects sessionTimeout of 0 or negative", () => {
    expect(() => MarkerOptionsSchema.parse({ ...validMarkerOptions, sessionTimeout: 0 })).toThrow();
    expect(() =>
      MarkerOptionsSchema.parse({ ...validMarkerOptions, sessionTimeout: -1 }),
    ).toThrow();
  });

  it("rejects non-integer sessionTimeout", () => {
    expect(() =>
      MarkerOptionsSchema.parse({ ...validMarkerOptions, sessionTimeout: 30.5 }),
    ).toThrow();
  });

  it("accepts optional provider string", () => {
    const result = MarkerOptionsSchema.parse({
      ...validMarkerOptions,
      provider: "claude-cli",
    });
    expect(result.provider).toBe("claude-cli");
  });

  it("accepts optional providerConfig record", () => {
    const result = MarkerOptionsSchema.parse({
      ...validMarkerOptions,
      provider: "generic-cli",
      providerConfig: { binary: "/usr/bin/aider", args: ["--yes"] },
    });
    expect(result.providerConfig).toEqual({ binary: "/usr/bin/aider", args: ["--yes"] });
  });

  it("accepts options without provider fields (backward compat)", () => {
    const result = MarkerOptionsSchema.parse(validMarkerOptions);
    expect(result.provider).toBeUndefined();
    expect(result.providerConfig).toBeUndefined();
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
      expect(LoopStateSchema.parse({ ...validLoopState, status }).status).toBe(status);
    }
  });

  it("accepts all valid signals", () => {
    for (const signal of ["clean", "blocked", "needs_human", "error"]) {
      expect(LoopStateSchema.parse({ ...validLoopState, lastSignal: signal }).lastSignal).toBe(
        signal,
      );
    }
  });

  it("rejects invalid status", () => {
    expect(() => LoopStateSchema.parse({ ...validLoopState, status: "stopped" })).toThrow();
  });

  it("rejects negative iteration", () => {
    expect(() => LoopStateSchema.parse({ ...validLoopState, iteration: -1 })).toThrow();
  });

  it("accepts sleeping_limit status", () => {
    const result = LoopStateSchema.safeParse({
      ...validLoopState,
      status: "sleeping_limit",
      currentItem: null,
      lastSignal: "error",
      sleepUntil: "2026-02-22T10:00:00Z",
      error: "5-hour usage limit hit",
    });
    expect(result.success).toBe(true);
  });

  it("accepts weekly_limit status", () => {
    const result = LoopStateSchema.safeParse({
      ...validLoopState,
      status: "weekly_limit",
      currentItem: null,
      lastSignal: "error",
      sleepUntil: "2026-02-27T05:00:00Z",
      error: "Weekly usage limit exhausted",
    });
    expect(result.success).toBe(true);
  });

  it("allows sleepUntil to be null", () => {
    const result = LoopStateSchema.safeParse({
      ...validLoopState,
      sleepUntil: null,
    });
    expect(result.success).toBe(true);
  });

  it("allows sleepUntil to be absent", () => {
    const result = LoopStateSchema.safeParse(validLoopState);
    expect(result.success).toBe(true);
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

  it("accepts optional defaultProvider string", () => {
    const result = ToolConfigSchema.parse({
      rootDirectory: "/tmp",
      port: 5173,
      theme: "system",
      defaultProvider: "generic-cli",
    });
    expect(result.defaultProvider).toBe("generic-cli");
  });

  it("accepts optional providers record of records", () => {
    const result = ToolConfigSchema.parse({
      rootDirectory: "/tmp",
      port: 5173,
      theme: "system",
      providers: {
        "generic-cli": { binary: "/usr/bin/aider", args: ["--yes"] },
        "openai-codex": { model: "gpt-4" },
      },
    });
    expect(result.providers).toEqual({
      "generic-cli": { binary: "/usr/bin/aider", args: ["--yes"] },
      "openai-codex": { model: "gpt-4" },
    });
  });

  it("accepts config without provider fields (backward compat)", () => {
    const result = ToolConfigSchema.parse({
      rootDirectory: "/tmp",
      port: 5173,
      theme: "system",
    });
    expect(result.defaultProvider).toBeUndefined();
    expect(result.providers).toBeUndefined();
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
    expect(VALID_STATUS_TRANSITIONS.pending).toEqual(["in_progress", "blocked"]);
  });

  it("in_progress can transition to done, blocked, or pending", () => {
    expect(VALID_STATUS_TRANSITIONS.in_progress).toEqual(["done", "blocked", "pending"]);
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
    const match = "Loop started (maxIterations=20)".match(LOG_PATTERNS.loopStart);
    expect(match).not.toBeNull();
    expect(match![1]).toBe("20");
  });

  it("iteration matches expected format", () => {
    const match = "--- Iteration 3 / 20 ---".match(LOG_PATTERNS.iteration);
    expect(match).not.toBeNull();
    expect(match![1]).toBe("3");
    expect(match![2]).toBe("20");
  });

  it("done matches item completed format", () => {
    const match = "Item 001 completed: Implement user auth".match(LOG_PATTERNS.done);
    expect(match).not.toBeNull();
  });

  it("blocked matches item blocked format", () => {
    const match = "Item 003 blocked: Missing API key".match(LOG_PATTERNS.blocked);
    expect(match).not.toBeNull();
    expect(match![1]).toBe("Missing API key");
  });

  it("needsHuman matches item needs human input format", () => {
    const match = "Item 005 needs human input: Design review needed".match(
      LOG_PATTERNS.needsHuman,
    );
    expect(match).not.toBeNull();
    expect(match![1]).toBe("Design review needed");
  });

  it("complete matches loop completed format", () => {
    const match = "Loop completed".match(LOG_PATTERNS.complete);
    expect(match).not.toBeNull();
  });

  it("limitReached matches max iterations format", () => {
    const match = "Max iterations reached (20)".match(LOG_PATTERNS.limitReached);
    expect(match).not.toBeNull();
    expect(match![1]).toBe("20");
  });

  it("timestamp matches ISO-style log prefix", () => {
    const match = "[2026-02-21 19:05:00] Some message".match(LOG_PATTERNS.timestamp);
    expect(match).not.toBeNull();
    expect(match![1]).toBe("2026-02-21 19:05:00");
  });
});

// ─── LoopStartOptions ─────────────────────────────────────────────

describe("LoopStartOptionsSchema", () => {
  it("accepts valid options", () => {
    const result = LoopStartOptionsSchema.parse({
      maxIterations: 20,
      maxRetries: 3,
      sessionTimeoutMinutes: 60,
    });
    expect(result.maxIterations).toBe(20);
    expect(result.maxRetries).toBe(3);
    expect(result.model).toBeUndefined();
    expect(result.sessionTimeoutMinutes).toBe(60);
  });

  it("accepts optional model string", () => {
    const result = LoopStartOptionsSchema.parse({
      maxIterations: 10,
      maxRetries: 2,
      model: "claude-sonnet-4-6",
      sessionTimeoutMinutes: 120,
    });
    expect(result.model).toBe("claude-sonnet-4-6");
  });

  it("rejects zero maxIterations", () => {
    expect(() =>
      LoopStartOptionsSchema.parse({
        maxIterations: 0,
        maxRetries: 3,
        sessionTimeoutMinutes: 60,
      }),
    ).toThrow();
  });

  it("rejects negative maxRetries", () => {
    expect(() =>
      LoopStartOptionsSchema.parse({
        maxIterations: 10,
        maxRetries: -1,
        sessionTimeoutMinutes: 60,
      }),
    ).toThrow();
  });

  it("rejects non-integer maxIterations", () => {
    expect(() =>
      LoopStartOptionsSchema.parse({
        maxIterations: 3.5,
        maxRetries: 2,
        sessionTimeoutMinutes: 60,
      }),
    ).toThrow();
  });

  it("rejects zero sessionTimeoutMinutes", () => {
    expect(() =>
      LoopStartOptionsSchema.parse({
        maxIterations: 10,
        maxRetries: 2,
        sessionTimeoutMinutes: 0,
      }),
    ).toThrow();
  });

  it("rejects missing required fields", () => {
    expect(() => LoopStartOptionsSchema.parse({})).toThrow();
    expect(() => LoopStartOptionsSchema.parse({ maxIterations: 10 })).toThrow();
  });

  it("accepts optional provider string", () => {
    const result = LoopStartOptionsSchema.parse({
      maxIterations: 20,
      maxRetries: 3,
      sessionTimeoutMinutes: 60,
      provider: "generic-cli",
    });
    expect(result.provider).toBe("generic-cli");
  });

  it("accepts options without provider (backward compat)", () => {
    const result = LoopStartOptionsSchema.parse({
      maxIterations: 20,
      maxRetries: 3,
      sessionTimeoutMinutes: 60,
    });
    expect(result.provider).toBeUndefined();
  });
});

// ─── LoopEvent ────────────────────────────────────────────────────

describe("LoopEventSchema", () => {
  const base = {
    timestamp: "2026-02-27T10:00:00Z",
    projectPath: "/home/user/projects/my-project",
  };

  describe("loop_started", () => {
    it("accepts valid event", () => {
      const result = LoopEventSchema.parse({
        ...base,
        type: "loop_started",
        maxIterations: 20,
      });
      expect(result.type).toBe("loop_started");
    });

    it("accepts optional model", () => {
      const result = LoopEventSchema.parse({
        ...base,
        type: "loop_started",
        maxIterations: 20,
        model: "claude-sonnet-4-6",
      });
      expect(result.type).toBe("loop_started");
      if (result.type === "loop_started") {
        expect(result.model).toBe("claude-sonnet-4-6");
      }
    });

    it("rejects zero maxIterations", () => {
      expect(() =>
        LoopEventSchema.parse({
          ...base,
          type: "loop_started",
          maxIterations: 0,
        }),
      ).toThrow();
    });
  });

  describe("iteration_start", () => {
    it("accepts valid event", () => {
      const result = LoopEventSchema.parse({
        ...base,
        type: "iteration_start",
        iteration: 3,
        maxIterations: 20,
      });
      expect(result.type).toBe("iteration_start");
      if (result.type === "iteration_start") {
        expect(result.iteration).toBe(3);
        expect(result.maxIterations).toBe(20);
      }
    });

    it("rejects non-positive iteration", () => {
      expect(() =>
        LoopEventSchema.parse({
          ...base,
          type: "iteration_start",
          iteration: 0,
          maxIterations: 20,
        }),
      ).toThrow();
    });
  });

  describe("item_selected", () => {
    it("accepts valid event", () => {
      const result = LoopEventSchema.parse({
        ...base,
        type: "item_selected",
        itemId: "001",
        title: "Implement feature",
        priority: 1,
      });
      expect(result.type).toBe("item_selected");
      if (result.type === "item_selected") {
        expect(result.itemId).toBe("001");
        expect(result.title).toBe("Implement feature");
        expect(result.priority).toBe(1);
      }
    });
  });

  describe("llm_spawned", () => {
    it("accepts valid event with provider", () => {
      const result = LoopEventSchema.parse({
        ...base,
        type: "llm_spawned",
        itemId: "001",
        provider: "claude-cli",
        timeoutMinutes: 60,
      });
      expect(result.type).toBe("llm_spawned");
      if (result.type === "llm_spawned") {
        expect(result.provider).toBe("claude-cli");
        expect(result.model).toBeUndefined();
        expect(result.timeoutMinutes).toBe(60);
      }
    });

    it("accepts optional model", () => {
      const result = LoopEventSchema.parse({
        ...base,
        type: "llm_spawned",
        itemId: "001",
        provider: "claude-cli",
        model: "claude-opus-4-6",
        timeoutMinutes: 120,
      });
      if (result.type === "llm_spawned") {
        expect(result.model).toBe("claude-opus-4-6");
      }
    });

    it("rejects missing provider field", () => {
      expect(() =>
        LoopEventSchema.parse({
          ...base,
          type: "llm_spawned",
          itemId: "001",
          timeoutMinutes: 60,
        }),
      ).toThrow();
    });
  });

  describe("llm_exited", () => {
    it("accepts valid event with provider", () => {
      const result = LoopEventSchema.parse({
        ...base,
        type: "llm_exited",
        itemId: "001",
        provider: "claude-cli",
        exitCode: 0,
        timedOut: false,
        durationMs: 45000,
      });
      expect(result.type).toBe("llm_exited");
      if (result.type === "llm_exited") {
        expect(result.provider).toBe("claude-cli");
        expect(result.exitCode).toBe(0);
        expect(result.timedOut).toBe(false);
        expect(result.durationMs).toBe(45000);
      }
    });

    it("accepts timed out event", () => {
      const result = LoopEventSchema.parse({
        ...base,
        type: "llm_exited",
        itemId: "001",
        provider: "claude-cli",
        exitCode: 137,
        timedOut: true,
        durationMs: 3600000,
      });
      if (result.type === "llm_exited") {
        expect(result.timedOut).toBe(true);
      }
    });

    it("rejects missing provider field", () => {
      expect(() =>
        LoopEventSchema.parse({
          ...base,
          type: "llm_exited",
          itemId: "001",
          exitCode: 0,
          timedOut: false,
          durationMs: 1000,
        }),
      ).toThrow();
    });
  });

  describe("signal_parsed", () => {
    it("accepts done signal", () => {
      const result = LoopEventSchema.parse({
        ...base,
        type: "signal_parsed",
        itemId: "001",
        signal: "done",
      });
      if (result.type === "signal_parsed") {
        expect(result.signal).toBe("done");
        expect(result.reason).toBeUndefined();
      }
    });

    it("accepts blocked signal with reason", () => {
      const result = LoopEventSchema.parse({
        ...base,
        type: "signal_parsed",
        itemId: "001",
        signal: "blocked",
        reason: "Missing API key",
      });
      if (result.type === "signal_parsed") {
        expect(result.signal).toBe("blocked");
        expect(result.reason).toBe("Missing API key");
      }
    });

    it("accepts needs_human signal", () => {
      const result = LoopEventSchema.parse({
        ...base,
        type: "signal_parsed",
        itemId: "001",
        signal: "needs_human",
        reason: "Design decision needed",
      });
      if (result.type === "signal_parsed") {
        expect(result.signal).toBe("needs_human");
      }
    });

    it("accepts none signal", () => {
      const result = LoopEventSchema.parse({
        ...base,
        type: "signal_parsed",
        itemId: "001",
        signal: "none",
      });
      if (result.type === "signal_parsed") {
        expect(result.signal).toBe("none");
      }
    });

    it("rejects invalid signal value", () => {
      expect(() =>
        LoopEventSchema.parse({
          ...base,
          type: "signal_parsed",
          itemId: "001",
          signal: "invalid",
        }),
      ).toThrow();
    });
  });

  describe("item_completed", () => {
    it("accepts valid event", () => {
      const result = LoopEventSchema.parse({
        ...base,
        type: "item_completed",
        itemId: "001",
        title: "Implement feature",
      });
      expect(result.type).toBe("item_completed");
      if (result.type === "item_completed") {
        expect(result.itemId).toBe("001");
        expect(result.title).toBe("Implement feature");
      }
    });
  });

  describe("item_blocked", () => {
    it("accepts valid event", () => {
      const result = LoopEventSchema.parse({
        ...base,
        type: "item_blocked",
        itemId: "001",
        reason: "Dependency not met",
      });
      expect(result.type).toBe("item_blocked");
      if (result.type === "item_blocked") {
        expect(result.reason).toBe("Dependency not met");
      }
    });

    it("rejects missing reason", () => {
      expect(() =>
        LoopEventSchema.parse({
          ...base,
          type: "item_blocked",
          itemId: "001",
        }),
      ).toThrow();
    });
  });

  describe("item_retried", () => {
    it("accepts valid event", () => {
      const result = LoopEventSchema.parse({
        ...base,
        type: "item_retried",
        itemId: "001",
        attempt: 2,
        maxRetries: 3,
      });
      expect(result.type).toBe("item_retried");
      if (result.type === "item_retried") {
        expect(result.attempt).toBe(2);
        expect(result.maxRetries).toBe(3);
      }
    });

    it("rejects zero attempt", () => {
      expect(() =>
        LoopEventSchema.parse({
          ...base,
          type: "item_retried",
          itemId: "001",
          attempt: 0,
          maxRetries: 3,
        }),
      ).toThrow();
    });
  });

  describe("needs_human", () => {
    it("accepts valid event", () => {
      const result = LoopEventSchema.parse({
        ...base,
        type: "needs_human",
        itemId: "002",
        reason: "Need API key for integration",
      });
      expect(result.type).toBe("needs_human");
      if (result.type === "needs_human") {
        expect(result.reason).toBe("Need API key for integration");
      }
    });
  });

  describe("usage_limit_hit", () => {
    it("accepts 5h limit", () => {
      const result = LoopEventSchema.parse({
        ...base,
        type: "usage_limit_hit",
        limitType: "5h",
        utilization: 100,
      });
      expect(result.type).toBe("usage_limit_hit");
      if (result.type === "usage_limit_hit") {
        expect(result.limitType).toBe("5h");
        expect(result.utilization).toBe(100);
      }
    });

    it("accepts 7d limit", () => {
      const result = LoopEventSchema.parse({
        ...base,
        type: "usage_limit_hit",
        limitType: "7d",
        utilization: 105.5,
      });
      if (result.type === "usage_limit_hit") {
        expect(result.limitType).toBe("7d");
        expect(result.utilization).toBe(105.5);
      }
    });

    it("rejects invalid limitType", () => {
      expect(() =>
        LoopEventSchema.parse({
          ...base,
          type: "usage_limit_hit",
          limitType: "1h",
          utilization: 100,
        }),
      ).toThrow();
    });
  });

  describe("usage_limit_cleared", () => {
    it("accepts valid event", () => {
      const result = LoopEventSchema.parse({
        ...base,
        type: "usage_limit_cleared",
        limitType: "5h",
      });
      expect(result.type).toBe("usage_limit_cleared");
      if (result.type === "usage_limit_cleared") {
        expect(result.limitType).toBe("5h");
      }
    });
  });

  describe("sleep_start", () => {
    it("accepts valid event", () => {
      const result = LoopEventSchema.parse({
        ...base,
        type: "sleep_start",
        sleepUntil: "2026-02-27T15:00:00Z",
        reason: "5-hour usage limit reached",
      });
      expect(result.type).toBe("sleep_start");
      if (result.type === "sleep_start") {
        expect(result.sleepUntil).toBe("2026-02-27T15:00:00Z");
        expect(result.reason).toBe("5-hour usage limit reached");
      }
    });
  });

  describe("sleep_end", () => {
    it("accepts valid event with only base fields", () => {
      const result = LoopEventSchema.parse({
        ...base,
        type: "sleep_end",
      });
      expect(result.type).toBe("sleep_end");
    });
  });

  describe("loop_completed", () => {
    it("accepts valid event", () => {
      const result = LoopEventSchema.parse({
        ...base,
        type: "loop_completed",
        completedCount: 5,
        blockedCount: 1,
      });
      expect(result.type).toBe("loop_completed");
      if (result.type === "loop_completed") {
        expect(result.completedCount).toBe(5);
        expect(result.blockedCount).toBe(1);
      }
    });

    it("accepts zero counts", () => {
      const result = LoopEventSchema.parse({
        ...base,
        type: "loop_completed",
        completedCount: 0,
        blockedCount: 0,
      });
      if (result.type === "loop_completed") {
        expect(result.completedCount).toBe(0);
      }
    });

    it("rejects negative counts", () => {
      expect(() =>
        LoopEventSchema.parse({
          ...base,
          type: "loop_completed",
          completedCount: -1,
          blockedCount: 0,
        }),
      ).toThrow();
    });
  });

  describe("loop_error", () => {
    it("accepts valid event", () => {
      const result = LoopEventSchema.parse({
        ...base,
        type: "loop_error",
        error: "Failed to read backlog.json",
      });
      expect(result.type).toBe("loop_error");
      if (result.type === "loop_error") {
        expect(result.error).toBe("Failed to read backlog.json");
      }
    });
  });

  describe("loop_cancelled", () => {
    it("accepts valid event with only base fields", () => {
      const result = LoopEventSchema.parse({
        ...base,
        type: "loop_cancelled",
      });
      expect(result.type).toBe("loop_cancelled");
    });
  });

  describe("discriminated union behavior", () => {
    it("rejects unknown event type", () => {
      expect(() =>
        LoopEventSchema.parse({
          ...base,
          type: "unknown_event",
        }),
      ).toThrow();
    });

    it("rejects missing type field", () => {
      expect(() =>
        LoopEventSchema.parse({
          ...base,
          maxIterations: 20,
        }),
      ).toThrow();
    });

    it("rejects missing base fields", () => {
      expect(() =>
        LoopEventSchema.parse({
          type: "loop_started",
          maxIterations: 20,
        }),
      ).toThrow();
    });

    it("parses all 17 event types", () => {
      const events = [
        { type: "loop_started", maxIterations: 20 },
        { type: "iteration_start", iteration: 1, maxIterations: 20 },
        { type: "item_selected", itemId: "001", title: "Task", priority: 1 },
        { type: "llm_spawned", itemId: "001", provider: "claude-cli", timeoutMinutes: 60 },
        {
          type: "llm_exited",
          itemId: "001",
          provider: "claude-cli",
          exitCode: 0,
          timedOut: false,
          durationMs: 1000,
        },
        { type: "signal_parsed", itemId: "001", signal: "done" },
        { type: "item_completed", itemId: "001", title: "Task" },
        { type: "item_blocked", itemId: "001", reason: "Blocked" },
        { type: "item_retried", itemId: "001", attempt: 1, maxRetries: 3 },
        { type: "needs_human", itemId: "001", reason: "Need input" },
        { type: "usage_limit_hit", limitType: "5h", utilization: 100 },
        { type: "usage_limit_cleared", limitType: "7d" },
        {
          type: "sleep_start",
          sleepUntil: "2026-02-27T15:00:00Z",
          reason: "Limit",
        },
        { type: "sleep_end" },
        { type: "loop_completed", completedCount: 5, blockedCount: 1 },
        { type: "loop_error", error: "Something failed" },
        { type: "loop_cancelled" },
      ];

      for (const event of events) {
        const result = LoopEventSchema.safeParse({ ...base, ...event });
        expect(result.success, `Event type "${event.type}" should parse`).toBe(true);
      }
      expect(events).toHaveLength(17);
    });
  });
});
