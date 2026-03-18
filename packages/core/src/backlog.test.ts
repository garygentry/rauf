import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  readBacklog,
  writeBacklog,
  addItem,
  updateItem,
  deleteItem,
  validateStatusTransition,
  restoreFromBackup,
  selectNextItem,
  resetStalledItems,
  ensureBacklog,
  BACKLOG_DIR,
  BACKLOG_FILENAME,
  STATE_FILENAME,
} from "./backlog.js";
import type { CreateItemInput, UpdateItemInput } from "./backlog.js";
import { ErrorCodes } from "./errors.js";
import { VALID_STATUS_TRANSITIONS } from "./schemas.js";
import type { Backlog, BacklogItem, LoopState, MarkerFile } from "./schemas.js";

// ─── Helpers ──────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ralph-backlog-"));
  // Create .ralph directory
  fs.mkdirSync(path.join(tmpDir, BACKLOG_DIR));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Create a minimal valid Backlog object */
function makeBacklog(items: BacklogItem[] = [], overrides: Partial<Backlog> = {}): Backlog {
  return {
    project: "test-project",
    description: "A test project",
    items,
    ...overrides,
  };
}

/** Create a minimal valid BacklogItem */
function makeItem(overrides: Partial<BacklogItem> = {}): BacklogItem {
  return {
    id: "001",
    type: "feature",
    priority: 1,
    title: "Test item",
    description: "A test description",
    acceptanceCriteria: ["Criterion 1"],
    status: "pending",
    completedAt: null,
    ...overrides,
  };
}

/** Write a backlog.json directly (for test setup) */
function writeBacklogRaw(backlog: Backlog): void {
  const filePath = path.join(tmpDir, BACKLOG_DIR, BACKLOG_FILENAME);
  fs.writeFileSync(filePath, JSON.stringify(backlog, null, 2) + "\n");
}

/** Write a state.json directly (for test setup) */
function writeStateJson(state: LoopState): void {
  const filePath = path.join(tmpDir, BACKLOG_DIR, STATE_FILENAME);
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2) + "\n");
}

/** Write a .ralph.json marker file (for smart default tests) */
function writeMarkerFile(marker: MarkerFile): void {
  const filePath = path.join(tmpDir, ".ralph.json");
  fs.writeFileSync(filePath, JSON.stringify(marker, null, 2) + "\n");
}

function makeMarker(verify = "pnpm test && pnpm typecheck"): MarkerFile {
  return {
    ralph: true,
    version: "1",
    variant: "backlog-json",
    installedAt: "2026-01-01T00:00:00Z",
    installedBy: "ralph@0.1.0",
    profile: {
      stack: "node-typescript",
      packageManager: "pnpm",
      monorepo: false,
      commands: {
        test: "pnpm test",
        typecheck: "pnpm typecheck",
        lint: null,
        build: null,
        format: null,
      },
      verify,
    },
    artifactHashes: {},
    options: {
      ignoreInTool: false,
      gitignoreScripts: false,
      maxIterations: 20,
    },
  };
}

function makeLoopState(overrides: Partial<LoopState> = {}): LoopState {
  return {
    status: "running",
    iteration: 1,
    maxIterations: 20,
    currentItem: "001",
    lastSignal: "clean",
    startedAt: "2026-01-01T00:00:00Z",
    updatedAt: new Date().toISOString(),
    completedItems: [],
    blockedItems: [],
    error: null,
    ...overrides,
  };
}

// ─── readBacklog ─────────────────────────────────────────────────

describe("readBacklog", () => {
  it("reads and validates a valid backlog.json", () => {
    const backlog = makeBacklog([makeItem()]);
    writeBacklogRaw(backlog);

    const result = readBacklog(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.project).toBe("test-project");
    expect(result.value.items).toHaveLength(1);
    expect(result.value.items[0]!.id).toBe("001");
  });

  it("reads empty items array", () => {
    const backlog = makeBacklog([]);
    writeBacklogRaw(backlog);

    const result = readBacklog(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.items).toHaveLength(0);
  });

  it("returns FILE_NOT_FOUND when backlog.json is missing", () => {
    const result = readBacklog(tmpDir);
    // Remove the file (only .ralph dir exists)
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe(ErrorCodes.FILE_NOT_FOUND);
  });

  it("returns INVALID_JSON for malformed JSON", () => {
    const filePath = path.join(tmpDir, BACKLOG_DIR, BACKLOG_FILENAME);
    fs.writeFileSync(filePath, "{ not valid json }}}");

    const result = readBacklog(tmpDir);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe(ErrorCodes.INVALID_JSON);
  });

  it("returns VALIDATION_ERROR for schema-invalid JSON", () => {
    const filePath = path.join(tmpDir, BACKLOG_DIR, BACKLOG_FILENAME);
    fs.writeFileSync(filePath, JSON.stringify({ project: 123, items: "not-array" }));

    const result = readBacklog(tmpDir);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  it("returns VALIDATION_ERROR for items with invalid fields", () => {
    const filePath = path.join(tmpDir, BACKLOG_DIR, BACKLOG_FILENAME);
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        project: "test",
        description: "test",
        items: [{ id: "abc", type: "invalid", priority: 0 }],
      }),
    );

    const result = readBacklog(tmpDir);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });
});

// ─── writeBacklog ────────────────────────────────────────────────

describe("writeBacklog", () => {
  it("writes valid JSON atomically", () => {
    const backlog = makeBacklog([makeItem()]);

    const result = writeBacklog(tmpDir, backlog);
    expect(result.ok).toBe(true);

    const filePath = path.join(tmpDir, BACKLOG_DIR, BACKLOG_FILENAME);
    expect(fs.existsSync(filePath)).toBe(true);

    const content = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    expect(content.project).toBe("test-project");
    expect(content.items).toHaveLength(1);
  });

  it("creates .bak backup when overwriting", () => {
    const backlog1 = makeBacklog([makeItem({ title: "Original" })]);
    writeBacklogRaw(backlog1);

    const backlog2 = makeBacklog([makeItem({ title: "Updated" })]);
    const result = writeBacklog(tmpDir, backlog2);
    expect(result.ok).toBe(true);

    // Check .bak exists with original content
    const bakPath = path.join(tmpDir, BACKLOG_DIR, `${BACKLOG_FILENAME}.bak`);
    expect(fs.existsSync(bakPath)).toBe(true);

    const bakContent = JSON.parse(fs.readFileSync(bakPath, "utf-8"));
    expect(bakContent.items[0].title).toBe("Original");
  });

  it("does not leave .tmp files", () => {
    const backlog = makeBacklog([]);
    writeBacklog(tmpDir, backlog);

    const tmpFile = path.join(tmpDir, BACKLOG_DIR, `${BACKLOG_FILENAME}.tmp`);
    expect(fs.existsSync(tmpFile)).toBe(false);
  });

  it("produces pretty-printed JSON with trailing newline", () => {
    const backlog = makeBacklog([makeItem()]);
    writeBacklog(tmpDir, backlog);

    const filePath = path.join(tmpDir, BACKLOG_DIR, BACKLOG_FILENAME);
    const raw = fs.readFileSync(filePath, "utf-8");
    expect(raw.split("\n").length).toBeGreaterThan(1);
    expect(raw.endsWith("\n")).toBe(true);
  });

  it("round-trips with readBacklog", () => {
    const backlog = makeBacklog([
      makeItem({ id: "001", title: "First" }),
      makeItem({ id: "002", title: "Second", dependsOn: ["001"] }),
    ]);
    writeBacklog(tmpDir, backlog);

    const result = readBacklog(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toEqual(backlog);
  });
});

// ─── validateStatusTransition ────────────────────────────────────

describe("validateStatusTransition", () => {
  it("allows same status (no-op)", () => {
    expect(validateStatusTransition("pending", "pending")).toBe(true);
    expect(validateStatusTransition("in_progress", "in_progress")).toBe(true);
    expect(validateStatusTransition("done", "done")).toBe(true);
    expect(validateStatusTransition("blocked", "blocked")).toBe(true);
  });

  it("allows all valid transitions from VALID_STATUS_TRANSITIONS", () => {
    for (const [from, targets] of Object.entries(VALID_STATUS_TRANSITIONS)) {
      for (const to of targets) {
        expect(
          validateStatusTransition(from as BacklogItem["status"], to as BacklogItem["status"]),
        ).toBe(true);
      }
    }
  });

  it("rejects pending → done", () => {
    expect(validateStatusTransition("pending", "done")).toBe(false);
  });

  it("rejects done → in_progress", () => {
    expect(validateStatusTransition("done", "in_progress")).toBe(false);
  });

  it("rejects done → blocked", () => {
    expect(validateStatusTransition("done", "blocked")).toBe(false);
  });

  it("rejects blocked → in_progress", () => {
    expect(validateStatusTransition("blocked", "in_progress")).toBe(false);
  });

  it("rejects blocked → done", () => {
    expect(validateStatusTransition("blocked", "done")).toBe(false);
  });
});

// ─── addItem ─────────────────────────────────────────────────────

describe("addItem", () => {
  it("auto-assigns zero-padded ID (max+1)", () => {
    writeBacklogRaw(makeBacklog([makeItem({ id: "001" }), makeItem({ id: "003" })]));

    const input: CreateItemInput = {
      type: "feature",
      priority: 2,
      title: "New item",
      acceptanceCriteria: ["Test AC"],
    };

    const result = addItem(tmpDir, input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // max is 003, so next is 004
    expect(result.value.id).toBe("004");
  });

  it("assigns ID 001 for empty backlog", () => {
    writeBacklogRaw(makeBacklog([]));

    const input: CreateItemInput = {
      type: "bug",
      priority: 1,
      title: "First item",
      acceptanceCriteria: ["Fix the bug"],
    };

    const result = addItem(tmpDir, input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.id).toBe("001");
  });

  it("handles IDs that need more than 3 digits", () => {
    writeBacklogRaw(makeBacklog([makeItem({ id: "999" })]));

    const input: CreateItemInput = {
      type: "chore",
      priority: 3,
      title: "Over 999",
      acceptanceCriteria: ["Done"],
    };

    const result = addItem(tmpDir, input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.id).toBe("1000");
  });

  it("sets status=pending and completedAt=null", () => {
    writeBacklogRaw(makeBacklog([]));

    const input: CreateItemInput = {
      type: "feature",
      priority: 1,
      title: "Test status",
      acceptanceCriteria: ["Done"],
    };

    const result = addItem(tmpDir, input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.status).toBe("pending");
    expect(result.value.completedAt).toBeNull();
  });

  it("injects smart default criterion when no AC provided", () => {
    writeBacklogRaw(makeBacklog([]));

    const input: CreateItemInput = {
      type: "feature",
      priority: 1,
      title: "No AC",
    };

    const result = addItem(tmpDir, input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.acceptanceCriteria).toHaveLength(1);
    expect(result.value.acceptanceCriteria[0]).toBe("All verification checks pass");
  });

  it("injects smart default from marker file verify command", () => {
    writeBacklogRaw(makeBacklog([]));
    writeMarkerFile(makeMarker("pnpm test && pnpm typecheck"));

    const input: CreateItemInput = {
      type: "feature",
      priority: 1,
      title: "With marker",
    };

    const result = addItem(tmpDir, input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.acceptanceCriteria).toHaveLength(1);
    expect(result.value.acceptanceCriteria[0]).toBe("pnpm test && pnpm typecheck passes");
  });

  it("injects smart default criterion for empty AC array", () => {
    writeBacklogRaw(makeBacklog([]));

    const input: CreateItemInput = {
      type: "feature",
      priority: 1,
      title: "Empty AC",
      acceptanceCriteria: [],
    };

    const result = addItem(tmpDir, input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.acceptanceCriteria).toHaveLength(1);
  });

  it("preserves explicit acceptance criteria", () => {
    writeBacklogRaw(makeBacklog([]));

    const input: CreateItemInput = {
      type: "feature",
      priority: 1,
      title: "With AC",
      acceptanceCriteria: ["Tests pass", "Linting clean"],
    };

    const result = addItem(tmpDir, input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.acceptanceCriteria).toEqual(["Tests pass", "Linting clean"]);
  });

  it("validates dependsOn references exist", () => {
    writeBacklogRaw(makeBacklog([makeItem({ id: "001" })]));

    const input: CreateItemInput = {
      type: "feature",
      priority: 1,
      title: "Depends on missing",
      acceptanceCriteria: ["Done"],
      dependsOn: ["001", "999"],
    };

    const result = addItem(tmpDir, input);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    expect(result.error.message).toContain("999");
    expect(result.error.details?.missingIds).toEqual(["999"]);
  });

  it("accepts valid dependsOn references", () => {
    writeBacklogRaw(makeBacklog([makeItem({ id: "001" }), makeItem({ id: "002" })]));

    const input: CreateItemInput = {
      type: "feature",
      priority: 1,
      title: "Valid deps",
      acceptanceCriteria: ["Done"],
      dependsOn: ["001", "002"],
    };

    const result = addItem(tmpDir, input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.dependsOn).toEqual(["001", "002"]);
  });

  it("rejects empty title", () => {
    writeBacklogRaw(makeBacklog([]));

    const input: CreateItemInput = {
      type: "feature",
      priority: 1,
      title: "",
      acceptanceCriteria: ["Done"],
    };

    const result = addItem(tmpDir, input);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    expect(result.error.message).toContain("Title");
  });

  it("rejects whitespace-only title", () => {
    writeBacklogRaw(makeBacklog([]));

    const input: CreateItemInput = {
      type: "feature",
      priority: 1,
      title: "   ",
      acceptanceCriteria: ["Done"],
    };

    const result = addItem(tmpDir, input);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  it("preserves optional fields when provided", () => {
    writeBacklogRaw(makeBacklog([]));

    const input: CreateItemInput = {
      type: "feature",
      priority: 2,
      title: "Full item",
      description: "Detailed description",
      acceptanceCriteria: ["Test 1", "Test 2"],
      notes: "Some notes",
      estimatedIterations: 3,
    };

    const result = addItem(tmpDir, input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.description).toBe("Detailed description");
    expect(result.value.notes).toBe("Some notes");
    expect(result.value.estimatedIterations).toBe(3);
  });

  it("defaults description to empty string", () => {
    writeBacklogRaw(makeBacklog([]));

    const input: CreateItemInput = {
      type: "feature",
      priority: 1,
      title: "No description",
      acceptanceCriteria: ["Done"],
    };

    const result = addItem(tmpDir, input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.description).toBe("");
  });

  it("does not include dependsOn when not provided", () => {
    writeBacklogRaw(makeBacklog([]));

    const input: CreateItemInput = {
      type: "feature",
      priority: 1,
      title: "No deps",
      acceptanceCriteria: ["Done"],
    };

    const result = addItem(tmpDir, input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.dependsOn).toBeUndefined();
  });

  it("passes through agentDelegation when provided", () => {
    writeBacklogRaw(makeBacklog([]));

    const input: CreateItemInput = {
      type: "feature",
      priority: 1,
      title: "With delegation",
      acceptanceCriteria: ["Done"],
      agentDelegation: {
        recommendedConcurrency: 3,
        strategy: "Parallel execution",
        subtasks: ["Task A", "Task B", "Task C"],
      },
    };

    const result = addItem(tmpDir, input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.agentDelegation).toEqual({
      recommendedConcurrency: 3,
      strategy: "Parallel execution",
      subtasks: ["Task A", "Task B", "Task C"],
    });
  });

  it("passes through specReferences when provided", () => {
    writeBacklogRaw(makeBacklog([]));

    const input: CreateItemInput = {
      type: "feature",
      priority: 1,
      title: "With specs",
      acceptanceCriteria: ["Done"],
      specReferences: ["docs/auth-spec.md", "docs/ARCHITECTURE.md"],
    };

    const result = addItem(tmpDir, input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.specReferences).toEqual(["docs/auth-spec.md", "docs/ARCHITECTURE.md"]);
  });

  it("does not include agentDelegation when not provided", () => {
    writeBacklogRaw(makeBacklog([]));

    const input: CreateItemInput = {
      type: "feature",
      priority: 1,
      title: "No delegation",
      acceptanceCriteria: ["Done"],
    };

    const result = addItem(tmpDir, input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.agentDelegation).toBeUndefined();
    expect(result.value.specReferences).toBeUndefined();
  });

  it("round-trips agentDelegation through write/read", () => {
    writeBacklogRaw(makeBacklog([]));

    const input: CreateItemInput = {
      type: "feature",
      priority: 1,
      title: "Delegation round-trip",
      acceptanceCriteria: ["Done"],
      agentDelegation: {
        recommendedConcurrency: 2,
        strategy: "Independent modules",
        subtasks: ["Module A", "Module B"],
      },
      specReferences: ["docs/spec.md"],
    };

    addItem(tmpDir, input);

    const result = readBacklog(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const item = result.value.items[0]!;
    expect(item.agentDelegation).toEqual({
      recommendedConcurrency: 2,
      strategy: "Independent modules",
      subtasks: ["Module A", "Module B"],
    });
    expect(item.specReferences).toEqual(["docs/spec.md"]);
  });

  it("persists the new item to disk", () => {
    writeBacklogRaw(makeBacklog([makeItem({ id: "001" })]));

    const input: CreateItemInput = {
      type: "bug",
      priority: 1,
      title: "Persisted",
      acceptanceCriteria: ["Done"],
    };

    addItem(tmpDir, input);

    // Read back from disk
    const result = readBacklog(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.items).toHaveLength(2);
    expect(result.value.items[1]!.title).toBe("Persisted");
  });

  it("returns error when backlog.json is missing", () => {
    // Don't write backlog.json — .ralph dir exists but no file
    const input: CreateItemInput = {
      type: "feature",
      priority: 1,
      title: "Missing backlog",
      acceptanceCriteria: ["Done"],
    };

    const result = addItem(tmpDir, input);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe(ErrorCodes.FILE_NOT_FOUND);
  });

  it("propagates source and reviewBatch fields", () => {
    writeBacklogRaw(makeBacklog([]));

    const input: CreateItemInput = {
      type: "bug",
      priority: 2,
      title: "Review fix item",
      description: "Found during review",
      acceptanceCriteria: ["Fix applied"],
      source: "review",
      reviewBatch: "2026-03-17T12:00:00.000Z",
    };

    const result = addItem(tmpDir, input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.source).toBe("review");
    expect(result.value.reviewBatch).toBe("2026-03-17T12:00:00.000Z");

    // Verify it persists in the file
    const backlog = readBacklog(tmpDir);
    expect(backlog.ok).toBe(true);
    if (!backlog.ok) return;

    const item = backlog.value.items[0]!;
    expect(item.source).toBe("review");
    expect(item.reviewBatch).toBe("2026-03-17T12:00:00.000Z");
  });

  it("omits source and reviewBatch when not provided", () => {
    writeBacklogRaw(makeBacklog([]));

    const input: CreateItemInput = {
      type: "feature",
      priority: 1,
      title: "Normal item",
      acceptanceCriteria: ["Done"],
    };

    const result = addItem(tmpDir, input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.source).toBeUndefined();
    expect(result.value.reviewBatch).toBeUndefined();
  });
});

// ─── updateItem ──────────────────────────────────────────────────

describe("updateItem", () => {
  it("updates basic fields", () => {
    writeBacklogRaw(makeBacklog([makeItem({ id: "001" })]));

    const updates: UpdateItemInput = {
      title: "Updated title",
      description: "Updated description",
      priority: 3,
    };

    const result = updateItem(tmpDir, "001", updates);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.title).toBe("Updated title");
    expect(result.value.description).toBe("Updated description");
    expect(result.value.priority).toBe(3);
  });

  it("allows valid status transition: pending → in_progress", () => {
    writeBacklogRaw(makeBacklog([makeItem({ id: "001", status: "pending" })]));

    const result = updateItem(tmpDir, "001", { status: "in_progress" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.status).toBe("in_progress");
  });

  it("allows valid status transition: in_progress → done", () => {
    writeBacklogRaw(makeBacklog([makeItem({ id: "001", status: "in_progress" })]));

    const result = updateItem(tmpDir, "001", { status: "done" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.status).toBe("done");
  });

  it("allows valid status transition: in_progress → blocked", () => {
    writeBacklogRaw(makeBacklog([makeItem({ id: "001", status: "in_progress" })]));

    const result = updateItem(tmpDir, "001", {
      status: "blocked",
      blockedReason: "Waiting on dependency",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.status).toBe("blocked");
    expect(result.value.blockedReason).toBe("Waiting on dependency");
  });

  it("allows valid status transition: blocked → pending", () => {
    writeBacklogRaw(makeBacklog([makeItem({ id: "001", status: "blocked" })]));

    const result = updateItem(tmpDir, "001", { status: "pending" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.status).toBe("pending");
  });

  it("allows valid status transition: done → pending", () => {
    writeBacklogRaw(makeBacklog([makeItem({ id: "001", status: "done" })]));

    const result = updateItem(tmpDir, "001", { status: "pending" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.status).toBe("pending");
  });

  it("rejects invalid transition: pending → done", () => {
    writeBacklogRaw(makeBacklog([makeItem({ id: "001", status: "pending" })]));

    const result = updateItem(tmpDir, "001", { status: "done" });
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe(ErrorCodes.TRANSITION_INVALID);
    expect(result.error.message).toContain("pending");
    expect(result.error.message).toContain("done");
  });

  it("rejects invalid transition: done → in_progress", () => {
    writeBacklogRaw(makeBacklog([makeItem({ id: "001", status: "done" })]));

    const result = updateItem(tmpDir, "001", { status: "in_progress" });
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe(ErrorCodes.TRANSITION_INVALID);
  });

  it("rejects invalid transition: blocked → done", () => {
    writeBacklogRaw(makeBacklog([makeItem({ id: "001", status: "blocked" })]));

    const result = updateItem(tmpDir, "001", { status: "done" });
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe(ErrorCodes.TRANSITION_INVALID);
  });

  it("auto-sets completedAt on done", () => {
    writeBacklogRaw(makeBacklog([makeItem({ id: "001", status: "in_progress" })]));

    const before = new Date().toISOString();
    const result = updateItem(tmpDir, "001", { status: "done" });
    const after = new Date().toISOString();

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.completedAt).not.toBeNull();
    // completedAt should be between before and after
    expect(result.value.completedAt! >= before).toBe(true);
    expect(result.value.completedAt! <= after).toBe(true);
  });

  it("does not set completedAt for non-done transitions", () => {
    writeBacklogRaw(makeBacklog([makeItem({ id: "001", status: "pending" })]));

    const result = updateItem(tmpDir, "001", { status: "in_progress" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.completedAt).toBeNull();
  });

  it("validates dependsOn references", () => {
    writeBacklogRaw(makeBacklog([makeItem({ id: "001" })]));

    const result = updateItem(tmpDir, "001", { dependsOn: ["999"] });
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    expect(result.error.message).toContain("999");
  });

  it("allows valid dependsOn update", () => {
    writeBacklogRaw(makeBacklog([makeItem({ id: "001" }), makeItem({ id: "002" })]));

    const result = updateItem(tmpDir, "002", { dependsOn: ["001"] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.dependsOn).toEqual(["001"]);
  });

  it("returns error for non-existent item", () => {
    writeBacklogRaw(makeBacklog([makeItem({ id: "001" })]));

    const result = updateItem(tmpDir, "999", { title: "Nope" });
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    expect(result.error.message).toContain("999");
  });

  it("allows same status (no transition check needed)", () => {
    writeBacklogRaw(makeBacklog([makeItem({ id: "001", status: "pending" })]));

    const result = updateItem(tmpDir, "001", { status: "pending" });
    expect(result.ok).toBe(true);
  });

  it("updates acceptance criteria", () => {
    writeBacklogRaw(makeBacklog([makeItem({ id: "001" })]));

    const result = updateItem(tmpDir, "001", {
      acceptanceCriteria: ["New criterion 1", "New criterion 2"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.acceptanceCriteria).toEqual(["New criterion 1", "New criterion 2"]);
  });

  it("persists updates to disk", () => {
    writeBacklogRaw(makeBacklog([makeItem({ id: "001" })]));

    updateItem(tmpDir, "001", { title: "Persisted update" });

    const result = readBacklog(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.items[0]!.title).toBe("Persisted update");
  });

  it("only modifies specified fields", () => {
    const original = makeItem({
      id: "001",
      title: "Original",
      description: "Original desc",
      notes: "Original notes",
    });
    writeBacklogRaw(makeBacklog([original]));

    const result = updateItem(tmpDir, "001", { title: "Updated" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.title).toBe("Updated");
    expect(result.value.description).toBe("Original desc");
    expect(result.value.notes).toBe("Original notes");
  });

  it("updates agentDelegation", () => {
    writeBacklogRaw(makeBacklog([makeItem({ id: "001" })]));

    const result = updateItem(tmpDir, "001", {
      agentDelegation: {
        recommendedConcurrency: 3,
        strategy: "Parallel",
        subtasks: ["A", "B", "C"],
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.agentDelegation).toEqual({
      recommendedConcurrency: 3,
      strategy: "Parallel",
      subtasks: ["A", "B", "C"],
    });
  });

  it("updates specReferences", () => {
    writeBacklogRaw(makeBacklog([makeItem({ id: "001" })]));

    const result = updateItem(tmpDir, "001", {
      specReferences: ["docs/spec.md"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.specReferences).toEqual(["docs/spec.md"]);
  });
});

// ─── deleteItem ──────────────────────────────────────────────────

describe("deleteItem", () => {
  it("deletes an existing item", () => {
    writeBacklogRaw(makeBacklog([makeItem({ id: "001" }), makeItem({ id: "002" })]));

    const result = deleteItem(tmpDir, "001");
    expect(result.ok).toBe(true);

    // Verify removed from disk
    const backlog = readBacklog(tmpDir);
    expect(backlog.ok).toBe(true);
    if (!backlog.ok) return;

    expect(backlog.value.items).toHaveLength(1);
    expect(backlog.value.items[0]!.id).toBe("002");
  });

  it("returns error for non-existent item", () => {
    writeBacklogRaw(makeBacklog([makeItem({ id: "001" })]));

    const result = deleteItem(tmpDir, "999");
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    expect(result.error.message).toContain("999");
  });

  it("blocks deletion of in_progress item when loop is running", () => {
    writeBacklogRaw(makeBacklog([makeItem({ id: "001", status: "in_progress" })]));
    writeStateJson(makeLoopState({ status: "running", currentItem: "001" }));

    const result = deleteItem(tmpDir, "001");
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe(ErrorCodes.CONFLICT);
    expect(result.error.message).toContain("in-progress");
    expect(result.error.message).toContain("loop is active");
  });

  it("blocks deletion of in_progress item when loop is starting", () => {
    writeBacklogRaw(makeBacklog([makeItem({ id: "001", status: "in_progress" })]));
    writeStateJson(makeLoopState({ status: "starting" }));

    const result = deleteItem(tmpDir, "001");
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe(ErrorCodes.CONFLICT);
  });

  it("allows deletion of in_progress item when loop is paused", () => {
    writeBacklogRaw(makeBacklog([makeItem({ id: "001", status: "in_progress" })]));
    writeStateJson(makeLoopState({ status: "paused" }));

    const result = deleteItem(tmpDir, "001");
    expect(result.ok).toBe(true);
  });

  it("allows deletion of in_progress item when loop is complete", () => {
    writeBacklogRaw(makeBacklog([makeItem({ id: "001", status: "in_progress" })]));
    writeStateJson(makeLoopState({ status: "complete" }));

    const result = deleteItem(tmpDir, "001");
    expect(result.ok).toBe(true);
  });

  it("allows deletion of in_progress item when no state.json", () => {
    writeBacklogRaw(makeBacklog([makeItem({ id: "001", status: "in_progress" })]));
    // No state.json — loop not active

    const result = deleteItem(tmpDir, "001");
    expect(result.ok).toBe(true);
  });

  it("allows deletion of pending item regardless of loop state", () => {
    writeBacklogRaw(makeBacklog([makeItem({ id: "001", status: "pending" })]));
    writeStateJson(makeLoopState({ status: "running" }));

    const result = deleteItem(tmpDir, "001");
    expect(result.ok).toBe(true);
  });

  it("allows deletion of done item regardless of loop state", () => {
    writeBacklogRaw(makeBacklog([makeItem({ id: "001", status: "done" })]));
    writeStateJson(makeLoopState({ status: "running" }));

    const result = deleteItem(tmpDir, "001");
    expect(result.ok).toBe(true);
  });

  it("allows deletion of blocked item regardless of loop state", () => {
    writeBacklogRaw(makeBacklog([makeItem({ id: "001", status: "blocked" })]));
    writeStateJson(makeLoopState({ status: "running" }));

    const result = deleteItem(tmpDir, "001");
    expect(result.ok).toBe(true);
  });
});

// ─── restoreFromBackup ──────────────────────────────────────────

describe("restoreFromBackup", () => {
  it("restores from .bak file", () => {
    const original = makeBacklog([makeItem({ title: "Original" })]);
    const modified = makeBacklog([makeItem({ title: "Modified" })]);

    // Write original, then overwrite to create .bak
    writeBacklogRaw(original);
    writeBacklog(tmpDir, modified);

    // Verify current is modified
    const beforeRestore = readBacklog(tmpDir);
    expect(beforeRestore.ok).toBe(true);
    if (!beforeRestore.ok) return;
    expect(beforeRestore.value.items[0]!.title).toBe("Modified");

    // Restore from backup
    const result = restoreFromBackup(tmpDir);
    expect(result.ok).toBe(true);

    // Verify current is back to original
    const afterRestore = readBacklog(tmpDir);
    expect(afterRestore.ok).toBe(true);
    if (!afterRestore.ok) return;
    expect(afterRestore.value.items[0]!.title).toBe("Original");
  });

  it("returns FILE_NOT_FOUND when no .bak exists", () => {
    writeBacklogRaw(makeBacklog([]));
    // No .bak file

    const result = restoreFromBackup(tmpDir);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe(ErrorCodes.FILE_NOT_FOUND);
    expect(result.error.message).toContain("No backup");
  });

  it("overwrites current backlog with .bak content", () => {
    const backlogPath = path.join(tmpDir, BACKLOG_DIR, BACKLOG_FILENAME);
    const bakPath = `${backlogPath}.bak`;

    // Write original and .bak manually
    const bakContent = makeBacklog([makeItem({ title: "Backup version" })]);
    const currentContent = makeBacklog([makeItem({ title: "Current version" })]);

    fs.writeFileSync(bakPath, JSON.stringify(bakContent, null, 2) + "\n");
    fs.writeFileSync(backlogPath, JSON.stringify(currentContent, null, 2) + "\n");

    const result = restoreFromBackup(tmpDir);
    expect(result.ok).toBe(true);

    const restored = readBacklog(tmpDir);
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.value.items[0]!.title).toBe("Backup version");
  });
});

// ─── selectNextItem ──────────────────────────────────────────────

describe("selectNextItem", () => {
  it("returns highest-priority pending item", () => {
    const backlog = makeBacklog([
      makeItem({ id: "001", priority: 3, status: "pending" }),
      makeItem({ id: "002", priority: 1, status: "pending" }),
      makeItem({ id: "003", priority: 2, status: "pending" }),
    ]);

    const result = selectNextItem(backlog);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("002");
  });

  it("returns null when no pending items exist", () => {
    const backlog = makeBacklog([
      makeItem({ id: "001", status: "done", completedAt: "2026-01-01T00:00:00Z" }),
      makeItem({ id: "002", status: "in_progress" }),
      makeItem({ id: "003", status: "blocked" }),
    ]);

    expect(selectNextItem(backlog)).toBeNull();
  });

  it("returns null for empty backlog", () => {
    const backlog = makeBacklog([]);
    expect(selectNextItem(backlog)).toBeNull();
  });

  it("skips items whose dependsOn includes non-done items", () => {
    const backlog = makeBacklog([
      makeItem({ id: "001", priority: 1, status: "pending", dependsOn: ["002"] }),
      makeItem({ id: "002", priority: 2, status: "in_progress" }),
      makeItem({ id: "003", priority: 3, status: "pending" }),
    ]);

    const result = selectNextItem(backlog);
    expect(result).not.toBeNull();
    // 001 has higher priority but depends on 002 which is in_progress
    expect(result!.id).toBe("003");
  });

  it("selects item when all dependencies are done", () => {
    const backlog = makeBacklog([
      makeItem({ id: "001", priority: 2, status: "done", completedAt: "2026-01-01T00:00:00Z" }),
      makeItem({ id: "002", priority: 1, status: "pending", dependsOn: ["001"] }),
    ]);

    const result = selectNextItem(backlog);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("002");
  });

  it("breaks priority ties by lower item ID (lexicographic)", () => {
    const backlog = makeBacklog([
      makeItem({ id: "003", priority: 1, status: "pending" }),
      makeItem({ id: "001", priority: 1, status: "pending" }),
      makeItem({ id: "002", priority: 1, status: "pending" }),
    ]);

    const result = selectNextItem(backlog);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("001");
  });

  it("items without dependsOn are always eligible if pending", () => {
    const backlog = makeBacklog([
      makeItem({ id: "001", priority: 2, status: "pending" }),
      makeItem({ id: "002", priority: 1, status: "pending", dependsOn: ["003"] }),
      makeItem({ id: "003", priority: 3, status: "pending" }),
    ]);

    // 002 has highest priority but depends on 003 (pending, not done)
    // 001 has no deps, priority 2
    // 003 has no deps, priority 3
    const result = selectNextItem(backlog);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("001");
  });

  it("handles diamond dependency pattern", () => {
    // Diamond: D depends on B and C, B and C depend on A
    const backlog = makeBacklog([
      makeItem({ id: "001", priority: 1, status: "done", completedAt: "2026-01-01T00:00:00Z" }), // A
      makeItem({
        id: "002",
        priority: 1,
        status: "done",
        completedAt: "2026-01-02T00:00:00Z",
        dependsOn: ["001"],
      }), // B
      makeItem({
        id: "003",
        priority: 1,
        status: "done",
        completedAt: "2026-01-03T00:00:00Z",
        dependsOn: ["001"],
      }), // C
      makeItem({ id: "004", priority: 1, status: "pending", dependsOn: ["002", "003"] }), // D
    ]);

    const result = selectNextItem(backlog);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("004");
  });

  it("blocks diamond dependency when one branch is not done", () => {
    const backlog = makeBacklog([
      makeItem({ id: "001", priority: 1, status: "done", completedAt: "2026-01-01T00:00:00Z" }),
      makeItem({
        id: "002",
        priority: 1,
        status: "done",
        completedAt: "2026-01-02T00:00:00Z",
        dependsOn: ["001"],
      }),
      makeItem({ id: "003", priority: 1, status: "in_progress", dependsOn: ["001"] }),
      makeItem({ id: "004", priority: 1, status: "pending", dependsOn: ["002", "003"] }),
    ]);

    // 004 depends on 003 which is in_progress — not eligible
    expect(selectNextItem(backlog)).toBeNull();
  });

  it("handles missing dependsOn IDs gracefully (treats as unsatisfied)", () => {
    const backlog = makeBacklog([
      makeItem({ id: "001", priority: 1, status: "pending", dependsOn: ["999"] }),
    ]);

    // dependsOn references non-existent item — not in done set
    expect(selectNextItem(backlog)).toBeNull();
  });

  it("skips blocked and in_progress items", () => {
    const backlog = makeBacklog([
      makeItem({ id: "001", priority: 1, status: "blocked" }),
      makeItem({ id: "002", priority: 1, status: "in_progress" }),
      makeItem({ id: "003", priority: 2, status: "pending" }),
    ]);

    const result = selectNextItem(backlog);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("003");
  });

  it("handles empty dependsOn array as no dependencies", () => {
    const backlog = makeBacklog([
      makeItem({ id: "001", priority: 1, status: "pending", dependsOn: [] }),
    ]);

    const result = selectNextItem(backlog);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("001");
  });

  it("complex chain: selects correct item in multi-level dependencies", () => {
    // A(done) → B(done) → C(pending), D(pending, no deps)
    const backlog = makeBacklog([
      makeItem({ id: "001", priority: 1, status: "done", completedAt: "2026-01-01T00:00:00Z" }),
      makeItem({
        id: "002",
        priority: 1,
        status: "done",
        completedAt: "2026-01-02T00:00:00Z",
        dependsOn: ["001"],
      }),
      makeItem({ id: "003", priority: 1, status: "pending", dependsOn: ["002"] }),
      makeItem({ id: "004", priority: 2, status: "pending" }),
    ]);

    // Both 003 and 004 are eligible; 003 has higher priority (1 < 2)
    const result = selectNextItem(backlog);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("003");
  });

  it("tie-breaking uses lexicographic comparison on zero-padded IDs", () => {
    const backlog = makeBacklog([
      makeItem({ id: "010", priority: 2, status: "pending" }),
      makeItem({ id: "002", priority: 2, status: "pending" }),
      makeItem({ id: "009", priority: 2, status: "pending" }),
    ]);

    const result = selectNextItem(backlog);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("002");
  });
});

// ─── resetStalledItems ───────────────────────────────────────────

describe("resetStalledItems", () => {
  it("resets all in_progress items to pending", () => {
    writeBacklogRaw(
      makeBacklog([
        makeItem({ id: "001", status: "in_progress" }),
        makeItem({ id: "002", status: "in_progress" }),
        makeItem({ id: "003", status: "pending" }),
      ]),
    );

    const result = resetStalledItems(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.resetCount).toBe(2);

    // Verify on disk
    const backlog = readBacklog(tmpDir);
    expect(backlog.ok).toBe(true);
    if (!backlog.ok) return;

    expect(backlog.value.items[0]!.status).toBe("pending");
    expect(backlog.value.items[1]!.status).toBe("pending");
    expect(backlog.value.items[2]!.status).toBe("pending");
  });

  it("returns count of reset items", () => {
    writeBacklogRaw(
      makeBacklog([
        makeItem({ id: "001", status: "in_progress" }),
        makeItem({ id: "002", status: "pending" }),
        makeItem({ id: "003", status: "in_progress" }),
        makeItem({ id: "004", status: "done", completedAt: "2026-01-01T00:00:00Z" }),
      ]),
    );

    const result = resetStalledItems(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.resetCount).toBe(2);
  });

  it("handles empty backlog gracefully", () => {
    writeBacklogRaw(makeBacklog([]));

    const result = resetStalledItems(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.resetCount).toBe(0);
  });

  it("handles no in_progress items gracefully", () => {
    writeBacklogRaw(
      makeBacklog([
        makeItem({ id: "001", status: "pending" }),
        makeItem({ id: "002", status: "done", completedAt: "2026-01-01T00:00:00Z" }),
        makeItem({ id: "003", status: "blocked" }),
      ]),
    );

    const result = resetStalledItems(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.resetCount).toBe(0);
  });

  it("returns error when backlog.json is missing", () => {
    // .ralph dir exists but no backlog.json
    const result = resetStalledItems(tmpDir);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe(ErrorCodes.FILE_NOT_FOUND);
  });

  it("uses updateItem for proper validation", () => {
    writeBacklogRaw(makeBacklog([makeItem({ id: "001", status: "in_progress" })]));

    const result = resetStalledItems(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Verify item was properly reset on disk
    const backlog = readBacklog(tmpDir);
    expect(backlog.ok).toBe(true);
    if (!backlog.ok) return;

    expect(backlog.value.items[0]!.status).toBe("pending");
  });
});

// ─── ensureBacklog ──────────────────────────────────────────────

describe("ensureBacklog", () => {
  it("no-ops when backlog.json already exists", () => {
    const backlog = makeBacklog([makeItem()]);
    writeBacklog(tmpDir, backlog);

    const result = ensureBacklog(tmpDir);
    expect(result.ok).toBe(true);

    // Verify existing backlog unchanged
    const read = readBacklog(tmpDir);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.items).toHaveLength(1);
    expect(read.value.items[0]!.title).toBe("Test item");
  });

  it("creates empty backlog.json when .ralph/ exists but backlog.json missing", () => {
    // .ralph/ dir created by beforeEach, no backlog.json
    const result = ensureBacklog(tmpDir);
    expect(result.ok).toBe(true);

    const read = readBacklog(tmpDir);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.items).toHaveLength(0);
    expect(read.value.project).toBe(path.basename(tmpDir));
  });

  it("uses directory basename as project name", () => {
    const result = ensureBacklog(tmpDir);
    expect(result.ok).toBe(true);

    const read = readBacklog(tmpDir);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.project).toBe(path.basename(tmpDir));
    expect(read.value.description).toBe("");
  });

  it("returns NOT_INSTALLED when .ralph/ dir does not exist", () => {
    // Use a path without .ralph/ dir
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "ralph-no-install-"));
    try {
      const result = ensureBacklog(emptyDir);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(ErrorCodes.NOT_INSTALLED);
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});
