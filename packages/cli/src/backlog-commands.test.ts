import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  handleBacklogList,
  handleBacklogAdd,
  handleBacklogEdit,
  handleBacklogDelete,
  handleBacklogShow,
  handleBacklogRestore,
  handleBacklogReset,
} from "./backlog-commands.js";
import { ExitCode } from "./commands.js";
import type { CommandContext } from "./commands.js";
import { configureOutput } from "./formatter.js";

// ─── Fixtures ──────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ralph-cli-backlog-"));
  configureOutput({ noColor: true, quiet: true, json: false });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Create a project dir with a populated .ralph/backlog.json */
function createProjectWithBacklog(projectDir: string, items: object[] = []): void {
  const ralphDir = path.join(projectDir, ".ralph");
  fs.mkdirSync(ralphDir, { recursive: true });

  const backlog = {
    project: "test-project",
    description: "Test project backlog",
    items,
  };

  fs.writeFileSync(path.join(ralphDir, "backlog.json"), JSON.stringify(backlog, null, 2));
}

/** Sample backlog items for testing — must match BacklogItemSchema (description required) */
const SAMPLE_ITEMS = [
  {
    id: "001",
    type: "feature",
    priority: 1,
    title: "First task",
    description: "Description of the first task",
    status: "pending",
    completedAt: null,
    acceptanceCriteria: ["Criterion A", "Criterion B"],
  },
  {
    id: "002",
    type: "bug",
    priority: 2,
    title: "Fix the bug",
    description: "A bug that needs fixing",
    status: "in_progress",
    completedAt: null,
    acceptanceCriteria: ["Bug is fixed"],
  },
  {
    id: "003",
    type: "chore",
    priority: 3,
    title: "Cleanup task",
    description: "Cleanup the codebase",
    status: "done",
    completedAt: "2026-02-21T12:00:00.000Z",
    acceptanceCriteria: ["Cleanup done"],
  },
];

function makeCtx(overrides?: Partial<CommandContext>): CommandContext {
  return {
    args: [],
    flags: new Map(),
    globalFlags: {
      json: false,
      noColor: true,
      quiet: false,
      root: null,
    },
    rawArgv: [],
    ...overrides,
  };
}

/** Capture stdout/stderr during an async function call */
async function captureOutput(fn: () => Promise<unknown>) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const origStdout = process.stdout.write;
  const origStderr = process.stderr.write;

  process.stdout.write = ((chunk: string) => {
    stdout.push(chunk);
    return true;
  }) as typeof process.stdout.write;

  process.stderr.write = ((chunk: string) => {
    stderr.push(chunk);
    return true;
  }) as typeof process.stderr.write;

  try {
    await fn();
  } finally {
    process.stdout.write = origStdout;
    process.stderr.write = origStderr;
  }

  return { stdout: stdout.join(""), stderr: stderr.join("") };
}

// ─── handleBacklogList ─────────────────────────────────────────────

describe("handleBacklogList", () => {
  it("returns INVALID_ARGS when no path argument", async () => {
    const code = await handleBacklogList(makeCtx());
    expect(code).toBe(ExitCode.INVALID_ARGS);
  });

  it("returns ERROR for missing backlog root", async () => {
    const projectDir = path.join(tmpDir, "no-backlog");
    fs.mkdirSync(projectDir, { recursive: true });

    const ctx = makeCtx({ args: [projectDir] });
    const code = await handleBacklogList(ctx);
    expect(code).toBe(ExitCode.ERROR);
  });

  it("shows table output for populated backlog", async () => {
    const projectDir = path.join(tmpDir, "project");
    createProjectWithBacklog(projectDir, SAMPLE_ITEMS);

    configureOutput({ noColor: true, quiet: false, json: false });
    const ctx = makeCtx({ args: [projectDir] });

    const output = await captureOutput(async () => {
      const code = await handleBacklogList(ctx);
      expect(code).toBe(ExitCode.SUCCESS);
    });

    // Table should include columns and data
    expect(output.stdout).toContain("ID");
    expect(output.stdout).toContain("Type");
    expect(output.stdout).toContain("Status");
    expect(output.stdout).toContain("Title");
    expect(output.stdout).toContain("001");
    expect(output.stdout).toContain("First task");
    expect(output.stdout).toContain("Fix the bug");
  });

  it("--json outputs raw JSON array", async () => {
    const projectDir = path.join(tmpDir, "project");
    createProjectWithBacklog(projectDir, SAMPLE_ITEMS);

    configureOutput({ noColor: true, quiet: false, json: true });
    const ctx = makeCtx({
      args: [projectDir],
      globalFlags: { json: true, noColor: true, quiet: false, root: null },
    });

    const output = await captureOutput(async () => {
      const code = await handleBacklogList(ctx);
      expect(code).toBe(ExitCode.SUCCESS);
    });

    const parsed = JSON.parse(output.stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(3);
    expect(parsed[0].id).toBe("001");
    expect(parsed[1].id).toBe("002");
  });

  it("--status filter shows only matching items", async () => {
    const projectDir = path.join(tmpDir, "project");
    createProjectWithBacklog(projectDir, SAMPLE_ITEMS);

    configureOutput({ noColor: true, quiet: false, json: true });
    const ctx = makeCtx({
      args: [projectDir],
      flags: new Map([["status", "pending"]]),
      globalFlags: { json: true, noColor: true, quiet: false, root: null },
    });

    const output = await captureOutput(async () => {
      const code = await handleBacklogList(ctx);
      expect(code).toBe(ExitCode.SUCCESS);
    });

    const parsed = JSON.parse(output.stdout);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].status).toBe("pending");
  });

  it("--type filter shows only matching items", async () => {
    const projectDir = path.join(tmpDir, "project");
    createProjectWithBacklog(projectDir, SAMPLE_ITEMS);

    configureOutput({ noColor: true, quiet: false, json: true });
    const ctx = makeCtx({
      args: [projectDir],
      flags: new Map([["type", "bug"]]),
      globalFlags: { json: true, noColor: true, quiet: false, root: null },
    });

    const output = await captureOutput(async () => {
      const code = await handleBacklogList(ctx);
      expect(code).toBe(ExitCode.SUCCESS);
    });

    const parsed = JSON.parse(output.stdout);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].type).toBe("bug");
    expect(parsed[0].id).toBe("002");
  });

  it("--status and --type can be combined", async () => {
    const projectDir = path.join(tmpDir, "project");
    createProjectWithBacklog(projectDir, SAMPLE_ITEMS);

    configureOutput({ noColor: true, quiet: false, json: true });
    const ctx = makeCtx({
      args: [projectDir],
      flags: new Map<string, string | true>([
        ["status", "pending"],
        ["type", "feature"],
      ]),
      globalFlags: { json: true, noColor: true, quiet: false, root: null },
    });

    const output = await captureOutput(async () => {
      const code = await handleBacklogList(ctx);
      expect(code).toBe(ExitCode.SUCCESS);
    });

    const parsed = JSON.parse(output.stdout);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe("001");
  });

  it("invalid --status returns INVALID_ARGS", async () => {
    const projectDir = path.join(tmpDir, "project");
    createProjectWithBacklog(projectDir, SAMPLE_ITEMS);

    const ctx = makeCtx({
      args: [projectDir],
      flags: new Map([["status", "invalid"]]),
    });

    const code = await handleBacklogList(ctx);
    expect(code).toBe(ExitCode.INVALID_ARGS);
  });

  it("invalid --type returns INVALID_ARGS", async () => {
    const projectDir = path.join(tmpDir, "project");
    createProjectWithBacklog(projectDir, SAMPLE_ITEMS);

    const ctx = makeCtx({
      args: [projectDir],
      flags: new Map([["type", "bogus"]]),
    });

    const code = await handleBacklogList(ctx);
    expect(code).toBe(ExitCode.INVALID_ARGS);
  });

  it("empty backlog shows info message, not error", async () => {
    const projectDir = path.join(tmpDir, "empty");
    createProjectWithBacklog(projectDir, []);

    configureOutput({ noColor: true, quiet: false, json: false });
    const ctx = makeCtx({ args: [projectDir] });

    const output = await captureOutput(async () => {
      const code = await handleBacklogList(ctx);
      expect(code).toBe(ExitCode.SUCCESS);
    });

    expect(output.stdout).toContain("No backlog items found");
  });
});

// ─── handleBacklogAdd ──────────────────────────────────────────────

describe("handleBacklogAdd", () => {
  it("returns INVALID_ARGS when no path argument", async () => {
    const code = await handleBacklogAdd(makeCtx());
    expect(code).toBe(ExitCode.INVALID_ARGS);
  });

  it("returns INVALID_ARGS when --title missing", async () => {
    const projectDir = path.join(tmpDir, "project");
    createProjectWithBacklog(projectDir, []);

    const ctx = makeCtx({
      args: [projectDir],
      flags: new Map([["type", "feature"]]),
    });

    const code = await handleBacklogAdd(ctx);
    expect(code).toBe(ExitCode.INVALID_ARGS);
  });

  it("returns INVALID_ARGS when --type missing", async () => {
    const projectDir = path.join(tmpDir, "project");
    createProjectWithBacklog(projectDir, []);

    const ctx = makeCtx({
      args: [projectDir],
      flags: new Map([["title", "My task"]]),
    });

    const code = await handleBacklogAdd(ctx);
    expect(code).toBe(ExitCode.INVALID_ARGS);
  });

  it("returns INVALID_ARGS for invalid --type", async () => {
    const projectDir = path.join(tmpDir, "project");
    createProjectWithBacklog(projectDir, []);

    const ctx = makeCtx({
      args: [projectDir],
      flags: new Map<string, string | true>([
        ["title", "My task"],
        ["type", "invalid"],
      ]),
    });

    const code = await handleBacklogAdd(ctx);
    expect(code).toBe(ExitCode.INVALID_ARGS);
  });

  it("creates an item with required fields", async () => {
    const projectDir = path.join(tmpDir, "project");
    createProjectWithBacklog(projectDir, []);

    configureOutput({ noColor: true, quiet: false, json: true });
    const ctx = makeCtx({
      args: [projectDir],
      flags: new Map<string, string | true>([
        ["title", "New feature"],
        ["type", "feature"],
        ["priority", "2"],
      ]),
      globalFlags: { json: true, noColor: true, quiet: false, root: null },
      rawArgv: [
        "backlog",
        "add",
        projectDir,
        "--title",
        "New feature",
        "--type",
        "feature",
        "--priority",
        "2",
      ],
    });

    const output = await captureOutput(async () => {
      const code = await handleBacklogAdd(ctx);
      expect(code).toBe(ExitCode.SUCCESS);
    });

    const parsed = JSON.parse(output.stdout);
    expect(parsed.title).toBe("New feature");
    expect(parsed.type).toBe("feature");
    expect(parsed.id).toBeDefined();
    expect(parsed.id).toMatch(/^\d{3,}$/);
  });

  it("--ac flag is repeatable and adds multiple criteria", async () => {
    const projectDir = path.join(tmpDir, "project");
    createProjectWithBacklog(projectDir, []);

    configureOutput({ noColor: true, quiet: false, json: true });
    const ctx = makeCtx({
      args: [projectDir],
      flags: new Map<string, string | true>([
        ["title", "Task with criteria"],
        ["type", "feature"],
      ]),
      globalFlags: { json: true, noColor: true, quiet: false, root: null },
      rawArgv: [
        "backlog",
        "add",
        projectDir,
        "--title",
        "Task with criteria",
        "--type",
        "feature",
        "--ac",
        "First criterion",
        "--ac",
        "Second criterion",
        "--ac",
        "Third criterion",
      ],
    });

    const output = await captureOutput(async () => {
      const code = await handleBacklogAdd(ctx);
      expect(code).toBe(ExitCode.SUCCESS);
    });

    const parsed = JSON.parse(output.stdout);
    expect(parsed.acceptanceCriteria).toHaveLength(3);
    expect(parsed.acceptanceCriteria).toContain("First criterion");
    expect(parsed.acceptanceCriteria).toContain("Second criterion");
    expect(parsed.acceptanceCriteria).toContain("Third criterion");
  });

  it("no --ac adds smart default + emits warning", async () => {
    const projectDir = path.join(tmpDir, "project");
    createProjectWithBacklog(projectDir, []);

    // Capture warning output (stderr)
    configureOutput({ noColor: true, quiet: false, json: false });
    const ctx = makeCtx({
      args: [projectDir],
      flags: new Map<string, string | true>([
        ["title", "No AC task"],
        ["type", "chore"],
      ]),
      rawArgv: ["backlog", "add", projectDir, "--title", "No AC task", "--type", "chore"],
    });

    const output = await captureOutput(async () => {
      const code = await handleBacklogAdd(ctx);
      expect(code).toBe(ExitCode.SUCCESS);
    });

    // Warning should be on stderr
    expect(output.stderr).toContain("smart default");

    // Verify the item was created with an AC (smart default)
    const backlogRaw = fs.readFileSync(path.join(projectDir, ".ralph", "backlog.json"), "utf-8");
    const backlog = JSON.parse(backlogRaw);
    expect(backlog.items).toHaveLength(1);
    expect(backlog.items[0].acceptanceCriteria.length).toBeGreaterThan(0);
  });

  it("priority defaults to 2 when not specified", async () => {
    const projectDir = path.join(tmpDir, "project");
    createProjectWithBacklog(projectDir, []);

    configureOutput({ noColor: true, quiet: false, json: true });
    const ctx = makeCtx({
      args: [projectDir],
      flags: new Map<string, string | true>([
        ["title", "Default priority task"],
        ["type", "bug"],
      ]),
      globalFlags: { json: true, noColor: true, quiet: false, root: null },
      rawArgv: ["backlog", "add", projectDir, "--title", "Default priority task", "--type", "bug"],
    });

    const output = await captureOutput(async () => {
      const code = await handleBacklogAdd(ctx);
      expect(code).toBe(ExitCode.SUCCESS);
    });

    const parsed = JSON.parse(output.stdout);
    expect(parsed.priority).toBe(2);
  });

  it("--depends-on parses comma-separated IDs", async () => {
    const projectDir = path.join(tmpDir, "project");
    createProjectWithBacklog(projectDir, SAMPLE_ITEMS);

    configureOutput({ noColor: true, quiet: false, json: true });
    const ctx = makeCtx({
      args: [projectDir],
      flags: new Map<string, string | true>([
        ["title", "Dependent task"],
        ["type", "feature"],
        ["depends-on", "001, 002"],
      ]),
      globalFlags: { json: true, noColor: true, quiet: false, root: null },
      rawArgv: [
        "backlog",
        "add",
        projectDir,
        "--title",
        "Dependent task",
        "--type",
        "feature",
        "--ac",
        "It works",
        "--depends-on",
        "001, 002",
      ],
    });

    const output = await captureOutput(async () => {
      const code = await handleBacklogAdd(ctx);
      expect(code).toBe(ExitCode.SUCCESS);
    });

    const parsed = JSON.parse(output.stdout);
    expect(parsed.dependsOn).toEqual(["001", "002"]);
  });
});

// ─── handleBacklogEdit ─────────────────────────────────────────────

describe("handleBacklogEdit", () => {
  it("returns INVALID_ARGS when missing path and id", async () => {
    const code = await handleBacklogEdit(makeCtx());
    expect(code).toBe(ExitCode.INVALID_ARGS);
  });

  it("returns INVALID_ARGS when id is missing", async () => {
    const projectDir = path.join(tmpDir, "project");
    createProjectWithBacklog(projectDir, SAMPLE_ITEMS);

    const ctx = makeCtx({ args: [projectDir] });
    const code = await handleBacklogEdit(ctx);
    expect(code).toBe(ExitCode.INVALID_ARGS);
  });

  it("updates title when --title provided", async () => {
    const projectDir = path.join(tmpDir, "project");
    createProjectWithBacklog(projectDir, SAMPLE_ITEMS);

    configureOutput({ noColor: true, quiet: false, json: true });
    const ctx = makeCtx({
      args: [projectDir, "001"],
      flags: new Map([["title", "Updated title"]]),
      globalFlags: { json: true, noColor: true, quiet: false, root: null },
    });

    const output = await captureOutput(async () => {
      const code = await handleBacklogEdit(ctx);
      expect(code).toBe(ExitCode.SUCCESS);
    });

    const parsed = JSON.parse(output.stdout);
    expect(parsed.title).toBe("Updated title");
    expect(parsed.id).toBe("001");
  });

  it("updates priority when --priority provided", async () => {
    const projectDir = path.join(tmpDir, "project");
    createProjectWithBacklog(projectDir, SAMPLE_ITEMS);

    configureOutput({ noColor: true, quiet: false, json: true });
    const ctx = makeCtx({
      args: [projectDir, "001"],
      flags: new Map([["priority", "4"]]),
      globalFlags: { json: true, noColor: true, quiet: false, root: null },
    });

    const output = await captureOutput(async () => {
      const code = await handleBacklogEdit(ctx);
      expect(code).toBe(ExitCode.SUCCESS);
    });

    const parsed = JSON.parse(output.stdout);
    expect(parsed.priority).toBe(4);
  });

  it("--ac replaces entire acceptanceCriteria array", async () => {
    const projectDir = path.join(tmpDir, "project");
    createProjectWithBacklog(projectDir, SAMPLE_ITEMS);

    // Original item 001 has ["Criterion A", "Criterion B"]
    configureOutput({ noColor: true, quiet: false, json: true });
    const ctx = makeCtx({
      args: [projectDir, "001"],
      flags: new Map<string, string | true>([]),
      globalFlags: { json: true, noColor: true, quiet: false, root: null },
      rawArgv: ["backlog", "edit", projectDir, "001", "--ac", "Only new criterion"],
    });

    const output = await captureOutput(async () => {
      const code = await handleBacklogEdit(ctx);
      expect(code).toBe(ExitCode.SUCCESS);
    });

    const parsed = JSON.parse(output.stdout);
    // Should have replaced, not appended
    expect(parsed.acceptanceCriteria).toHaveLength(1);
    expect(parsed.acceptanceCriteria[0]).toBe("Only new criterion");
  });

  it("returns VALIDATION for invalid status transition", async () => {
    const projectDir = path.join(tmpDir, "project");
    createProjectWithBacklog(projectDir, SAMPLE_ITEMS);

    // Item 003 is "done" — "done → in_progress" is an invalid transition
    // (VALID_STATUS_TRANSITIONS only allows done → pending)
    const ctx = makeCtx({
      args: [projectDir, "003"],
      flags: new Map([["status", "in_progress"]]),
    });

    const code = await handleBacklogEdit(ctx);
    expect(code).toBe(ExitCode.VALIDATION);
  });

  it("returns INVALID_ARGS for invalid --type", async () => {
    const projectDir = path.join(tmpDir, "project");
    createProjectWithBacklog(projectDir, SAMPLE_ITEMS);

    const ctx = makeCtx({
      args: [projectDir, "001"],
      flags: new Map([["type", "notatype"]]),
    });

    const code = await handleBacklogEdit(ctx);
    expect(code).toBe(ExitCode.INVALID_ARGS);
  });

  it("returns INVALID_ARGS for invalid --status", async () => {
    const projectDir = path.join(tmpDir, "project");
    createProjectWithBacklog(projectDir, SAMPLE_ITEMS);

    const ctx = makeCtx({
      args: [projectDir, "001"],
      flags: new Map([["status", "unknown"]]),
    });

    const code = await handleBacklogEdit(ctx);
    expect(code).toBe(ExitCode.INVALID_ARGS);
  });

  it("shows success without --json when update succeeds", async () => {
    const projectDir = path.join(tmpDir, "project");
    createProjectWithBacklog(projectDir, SAMPLE_ITEMS);

    configureOutput({ noColor: true, quiet: false, json: false });
    const ctx = makeCtx({
      args: [projectDir, "001"],
      flags: new Map([["title", "New title"]]),
    });

    const output = await captureOutput(async () => {
      const code = await handleBacklogEdit(ctx);
      expect(code).toBe(ExitCode.SUCCESS);
    });

    expect(output.stdout).toContain("Updated");
    expect(output.stdout).toContain("001");
  });
});

// ─── handleBacklogDelete ───────────────────────────────────────────

describe("handleBacklogDelete", () => {
  it("returns INVALID_ARGS when missing path and id", async () => {
    const code = await handleBacklogDelete(makeCtx());
    expect(code).toBe(ExitCode.INVALID_ARGS);
  });

  it("returns INVALID_ARGS without --yes (requires confirmation)", async () => {
    const projectDir = path.join(tmpDir, "project");
    createProjectWithBacklog(projectDir, SAMPLE_ITEMS);

    const ctx = makeCtx({ args: [projectDir, "001"] });
    const code = await handleBacklogDelete(ctx);
    expect(code).toBe(ExitCode.INVALID_ARGS);
  });

  it("deletes item with --yes flag", async () => {
    const projectDir = path.join(tmpDir, "project");
    createProjectWithBacklog(projectDir, SAMPLE_ITEMS);

    configureOutput({ noColor: true, quiet: false, json: false });
    const ctx = makeCtx({
      args: [projectDir, "001"],
      flags: new Map([["yes", true as string | true]]),
    });

    const output = await captureOutput(async () => {
      const code = await handleBacklogDelete(ctx);
      expect(code).toBe(ExitCode.SUCCESS);
    });

    expect(output.stdout).toContain("Deleted");
    expect(output.stdout).toContain("001");

    // Verify item removed from backlog
    const backlogRaw = fs.readFileSync(path.join(projectDir, ".ralph", "backlog.json"), "utf-8");
    const backlog = JSON.parse(backlogRaw);
    expect(backlog.items.find((i: { id: string }) => i.id === "001")).toBeUndefined();
  });

  it("--json outputs {deleted: id} on success", async () => {
    const projectDir = path.join(tmpDir, "project");
    createProjectWithBacklog(projectDir, SAMPLE_ITEMS);

    configureOutput({ noColor: true, quiet: false, json: true });
    const ctx = makeCtx({
      args: [projectDir, "001"],
      flags: new Map([["yes", true as string | true]]),
      globalFlags: { json: true, noColor: true, quiet: false, root: null },
    });

    const output = await captureOutput(async () => {
      const code = await handleBacklogDelete(ctx);
      expect(code).toBe(ExitCode.SUCCESS);
    });

    const parsed = JSON.parse(output.stdout);
    expect(parsed.deleted).toBe("001");
  });

  it("returns VALIDATION for nonexistent item id", async () => {
    const projectDir = path.join(tmpDir, "project");
    createProjectWithBacklog(projectDir, SAMPLE_ITEMS);

    // Core deleteItem returns VALIDATION_ERROR (not FILE_NOT_FOUND) for missing items
    const ctx = makeCtx({
      args: [projectDir, "999"],
      flags: new Map([["yes", true as string | true]]),
    });

    const code = await handleBacklogDelete(ctx);
    expect(code).toBe(ExitCode.VALIDATION);
  });
});

// ─── handleBacklogShow ─────────────────────────────────────────────

describe("handleBacklogShow", () => {
  it("returns INVALID_ARGS when missing path and id", async () => {
    const code = await handleBacklogShow(makeCtx());
    expect(code).toBe(ExitCode.INVALID_ARGS);
  });

  it("returns INVALID_ARGS when id is missing", async () => {
    const projectDir = path.join(tmpDir, "project");
    createProjectWithBacklog(projectDir, SAMPLE_ITEMS);

    const ctx = makeCtx({ args: [projectDir] });
    const code = await handleBacklogShow(ctx);
    expect(code).toBe(ExitCode.INVALID_ARGS);
  });

  it("shows item detail in human-readable format", async () => {
    const projectDir = path.join(tmpDir, "project");
    createProjectWithBacklog(projectDir, SAMPLE_ITEMS);

    configureOutput({ noColor: true, quiet: false, json: false });
    const ctx = makeCtx({ args: [projectDir, "001"] });

    const output = await captureOutput(async () => {
      const code = await handleBacklogShow(ctx);
      expect(code).toBe(ExitCode.SUCCESS);
    });

    expect(output.stdout).toContain("001");
    expect(output.stdout).toContain("First task");
    expect(output.stdout).toContain("feature");
    expect(output.stdout).toContain("pending");
    expect(output.stdout).toContain("Criterion A");
    expect(output.stdout).toContain("Criterion B");
  });

  it("--json outputs single item as JSON object", async () => {
    const projectDir = path.join(tmpDir, "project");
    createProjectWithBacklog(projectDir, SAMPLE_ITEMS);

    configureOutput({ noColor: true, quiet: false, json: true });
    const ctx = makeCtx({
      args: [projectDir, "002"],
      globalFlags: { json: true, noColor: true, quiet: false, root: null },
    });

    const output = await captureOutput(async () => {
      const code = await handleBacklogShow(ctx);
      expect(code).toBe(ExitCode.SUCCESS);
    });

    const parsed = JSON.parse(output.stdout);
    expect(parsed.id).toBe("002");
    expect(parsed.title).toBe("Fix the bug");
    expect(parsed.type).toBe("bug");
    expect(parsed.status).toBe("in_progress");
  });

  it("returns NOT_FOUND for nonexistent item id", async () => {
    const projectDir = path.join(tmpDir, "project");
    createProjectWithBacklog(projectDir, SAMPLE_ITEMS);

    const ctx = makeCtx({ args: [projectDir, "999"] });
    const code = await handleBacklogShow(ctx);
    expect(code).toBe(ExitCode.NOT_FOUND);
  });

  it("shows completedAt for done items", async () => {
    const projectDir = path.join(tmpDir, "project");
    createProjectWithBacklog(projectDir, SAMPLE_ITEMS);

    configureOutput({ noColor: true, quiet: false, json: false });
    const ctx = makeCtx({ args: [projectDir, "003"] });

    const output = await captureOutput(async () => {
      const code = await handleBacklogShow(ctx);
      expect(code).toBe(ExitCode.SUCCESS);
    });

    expect(output.stdout).toContain("Completed");
    expect(output.stdout).toContain("2026-02-21");
  });
});

// ─── handleBacklogRestore ──────────────────────────────────────────

describe("handleBacklogRestore", () => {
  it("returns INVALID_ARGS when no path argument", async () => {
    const code = await handleBacklogRestore(makeCtx());
    expect(code).toBe(ExitCode.INVALID_ARGS);
  });

  it("returns INVALID_ARGS without --yes (requires confirmation)", async () => {
    const projectDir = path.join(tmpDir, "project");
    createProjectWithBacklog(projectDir, SAMPLE_ITEMS);

    const ctx = makeCtx({ args: [projectDir] });
    const code = await handleBacklogRestore(ctx);
    expect(code).toBe(ExitCode.INVALID_ARGS);
  });

  it("restores backlog from .bak file with --yes", async () => {
    const projectDir = path.join(tmpDir, "project");
    createProjectWithBacklog(projectDir, SAMPLE_ITEMS);

    const ralphDir = path.join(projectDir, ".ralph");

    // Create a backup file (simulating what atomicWrite does for backlog.json)
    const backupBacklog = {
      project: "test-project",
      description: "Backup backlog",
      items: [
        {
          id: "001",
          type: "feature",
          priority: 1,
          title: "Backup item",
          status: "pending",
          completedAt: null,
          acceptanceCriteria: ["Backup criterion"],
        },
      ],
    };

    fs.writeFileSync(
      path.join(ralphDir, "backlog.json.bak"),
      JSON.stringify(backupBacklog, null, 2),
    );

    configureOutput({ noColor: true, quiet: false, json: false });
    const ctx = makeCtx({
      args: [projectDir],
      flags: new Map([["yes", true as string | true]]),
    });

    const output = await captureOutput(async () => {
      const code = await handleBacklogRestore(ctx);
      expect(code).toBe(ExitCode.SUCCESS);
    });

    expect(output.stdout).toContain("restored");

    // Verify the backlog now contains backup content
    const restored = JSON.parse(fs.readFileSync(path.join(ralphDir, "backlog.json"), "utf-8"));
    expect(restored.items).toHaveLength(1);
    expect(restored.items[0].title).toBe("Backup item");
  });

  it("--json outputs {restored: true, path} on success", async () => {
    const projectDir = path.join(tmpDir, "project");
    createProjectWithBacklog(projectDir, SAMPLE_ITEMS);

    // Create a .bak file
    const ralphDir = path.join(projectDir, ".ralph");
    fs.copyFileSync(path.join(ralphDir, "backlog.json"), path.join(ralphDir, "backlog.json.bak"));

    configureOutput({ noColor: true, quiet: false, json: true });
    const ctx = makeCtx({
      args: [projectDir],
      flags: new Map([["yes", true as string | true]]),
      globalFlags: { json: true, noColor: true, quiet: false, root: null },
    });

    const output = await captureOutput(async () => {
      const code = await handleBacklogRestore(ctx);
      expect(code).toBe(ExitCode.SUCCESS);
    });

    const parsed = JSON.parse(output.stdout);
    expect(parsed.restored).toBe(true);
    expect(parsed.path).toBe(path.resolve(projectDir));
  });

  it("returns error when no .bak file exists", async () => {
    const projectDir = path.join(tmpDir, "project");
    createProjectWithBacklog(projectDir, SAMPLE_ITEMS);

    // No .bak file — restore should fail
    const ctx = makeCtx({
      args: [projectDir],
      flags: new Map([["yes", true as string | true]]),
    });

    const code = await handleBacklogRestore(ctx);
    // Should return an error (not success)
    expect(code).not.toBe(ExitCode.SUCCESS);
  });
});

// ─── Error handling polish ─────────────────────────────────────────

describe("error handling and recovery messages", () => {
  it("malformed backlog.json returns VALIDATION (not ERROR)", async () => {
    const projectDir = path.join(tmpDir, "corrupt-project");
    const ralphDir = path.join(projectDir, ".ralph");
    fs.mkdirSync(ralphDir, { recursive: true });
    fs.writeFileSync(path.join(ralphDir, "backlog.json"), "{ invalid json {{{");

    configureOutput({ noColor: true, quiet: false, json: false });
    const ctx = makeCtx({ args: [projectDir] });

    const code = await handleBacklogList(ctx);
    expect(code).toBe(ExitCode.VALIDATION);
  });

  it("malformed backlog.json includes recovery suggestion on stdout", async () => {
    const projectDir = path.join(tmpDir, "corrupt-project");
    const ralphDir = path.join(projectDir, ".ralph");
    fs.mkdirSync(ralphDir, { recursive: true });
    fs.writeFileSync(path.join(ralphDir, "backlog.json"), "{ invalid json {{{");

    configureOutput({ noColor: true, quiet: false, json: false });
    const ctx = makeCtx({ args: [projectDir] });

    const output = await captureOutput(async () => {
      await handleBacklogList(ctx);
    });

    // Error on stderr, suggestion on stdout
    expect(output.stderr.length).toBeGreaterThan(0);
    expect(output.stdout).toContain("restore");
  });

  it("missing installation returns ERROR with descriptive message", async () => {
    const projectDir = path.join(tmpDir, "no-ralph");
    fs.mkdirSync(projectDir, { recursive: true });

    configureOutput({ noColor: true, quiet: false, json: false });
    const ctx = makeCtx({ args: [projectDir] });

    const output = await captureOutput(async () => {
      const code = await handleBacklogList(ctx);
      expect(code).toBe(ExitCode.ERROR);
    });

    // Error should mention the backlog root or directory not found
    expect(output.stderr).toContain("not found");
  });

  it("--quiet suppresses suggestion but not error", async () => {
    const projectDir = path.join(tmpDir, "no-ralph");
    fs.mkdirSync(projectDir, { recursive: true });

    // beforeEach sets quiet: true, but we need the ctx to reflect it too
    configureOutput({ noColor: true, quiet: true, json: false });
    const ctx = makeCtx({
      args: [projectDir],
      globalFlags: { json: false, noColor: true, quiet: true, root: null },
    });

    const output = await captureOutput(async () => {
      await handleBacklogList(ctx);
    });

    // Error still appears on stderr
    expect(output.stderr.length).toBeGreaterThan(0);
    // Suggestion suppressed (stdout is empty in quiet mode)
    expect(output.stdout).toBe("");
  });

  it("delete without --yes outputs error on stderr (visible even in quiet mode)", async () => {
    const projectDir = path.join(tmpDir, "project");
    createProjectWithBacklog(projectDir, SAMPLE_ITEMS);

    configureOutput({ noColor: true, quiet: true, json: false });
    const ctx = makeCtx({
      args: [projectDir, "001"],
      globalFlags: { json: false, noColor: true, quiet: true, root: null },
    });

    const output = await captureOutput(async () => {
      const code = await handleBacklogDelete(ctx);
      expect(code).toBe(ExitCode.INVALID_ARGS);
    });

    // Error should appear on stderr even with --quiet
    expect(output.stderr.length).toBeGreaterThan(0);
    expect(output.stderr).toContain("requires confirmation");
  });

  it("restore without --yes outputs error on stderr (visible even in quiet mode)", async () => {
    const projectDir = path.join(tmpDir, "project");
    createProjectWithBacklog(projectDir, SAMPLE_ITEMS);

    configureOutput({ noColor: true, quiet: true, json: false });
    const ctx = makeCtx({
      args: [projectDir],
      globalFlags: { json: false, noColor: true, quiet: true, root: null },
    });

    const output = await captureOutput(async () => {
      const code = await handleBacklogRestore(ctx);
      expect(code).toBe(ExitCode.INVALID_ARGS);
    });

    expect(output.stderr.length).toBeGreaterThan(0);
    expect(output.stderr).toContain("requires confirmation");
  });

  it("invalid status transition includes hint about valid transitions", async () => {
    const projectDir = path.join(tmpDir, "project");
    createProjectWithBacklog(projectDir, SAMPLE_ITEMS);

    configureOutput({ noColor: true, quiet: false, json: false });
    const ctx = makeCtx({
      args: [projectDir, "003"],
      flags: new Map([["status", "in_progress"]]),
    });

    const output = await captureOutput(async () => {
      const code = await handleBacklogEdit(ctx);
      expect(code).toBe(ExitCode.VALIDATION);
    });

    // Should mention valid transitions
    expect(output.stdout).toContain("transition");
  });
});

// ─── Command registry integration ──────────────────────────────────

describe("backlog command registry handlers", () => {
  it("all backlog subcommands have handlers registered", async () => {
    const { findCommand } = await import("./commands.js");
    const backlog = findCommand("backlog");
    expect(backlog).toBeDefined();

    const subcommands = backlog!.subcommands!;
    const withHandlers = subcommands.filter((sc) => sc.handler !== undefined);
    expect(withHandlers).toHaveLength(10);

    const names = withHandlers.map((sc) => sc.name);
    expect(names).toContain("list");
    expect(names).toContain("add");
    expect(names).toContain("edit");
    expect(names).toContain("delete");
    expect(names).toContain("show");
    expect(names).toContain("restore");
    expect(names).toContain("sweep");
    expect(names).toContain("archive");
    expect(names).toContain("reset");
    expect(names).toContain("unblock");
  });
});

// ─── handleBacklogReset ─────────────────────────────────────────────

describe("handleBacklogReset", () => {
  it("returns INVALID_ARGS when no path argument", async () => {
    const code = await handleBacklogReset(makeCtx());
    expect(code).toBe(ExitCode.INVALID_ARGS);
  });

  it("returns INVALID_ARGS without --yes (requires confirmation)", async () => {
    const projectDir = path.join(tmpDir, "project");
    createProjectWithBacklog(projectDir, SAMPLE_ITEMS);

    const ctx = makeCtx({ args: [projectDir] });
    const code = await handleBacklogReset(ctx);
    expect(code).toBe(ExitCode.INVALID_ARGS);
  });

  it("resets project state with --yes", async () => {
    const projectDir = path.join(tmpDir, "project");
    createProjectWithBacklog(projectDir, SAMPLE_ITEMS);

    // Add state.json and DONE marker
    const ralphDir = path.join(projectDir, ".ralph");
    fs.writeFileSync(
      path.join(ralphDir, "state.json"),
      JSON.stringify({
        status: "complete",
        iteration: 3,
        maxIterations: 5,
        currentItem: null,
        lastSignal: "clean",
        startedAt: "2026-01-15T10:00:00.000Z",
        updatedAt: "2026-01-15T12:00:00.000Z",
      }),
    );
    fs.writeFileSync(path.join(ralphDir, "DONE"), "complete");

    configureOutput({ noColor: true, quiet: false, json: false });
    const ctx = makeCtx({
      args: [projectDir],
      flags: new Map([["yes", true as string | true]]),
    });

    const output = await captureOutput(async () => {
      const code = await handleBacklogReset(ctx);
      expect(code).toBe(ExitCode.SUCCESS);
    });

    expect(output.stdout).toContain("Reset complete");

    // state.json should be deleted
    expect(fs.existsSync(path.join(ralphDir, "state.json"))).toBe(false);
    // DONE should be deleted
    expect(fs.existsSync(path.join(ralphDir, "DONE"))).toBe(false);
  });

  it("--clear empties backlog items", async () => {
    const projectDir = path.join(tmpDir, "project");
    createProjectWithBacklog(projectDir, SAMPLE_ITEMS);

    configureOutput({ noColor: true, quiet: false, json: true });
    const ctx = makeCtx({
      args: [projectDir],
      flags: new Map<string, string | true>([
        ["yes", true],
        ["clear", true],
      ]),
      globalFlags: { json: true, noColor: true, quiet: false, root: null },
    });

    const output = await captureOutput(async () => {
      const code = await handleBacklogReset(ctx);
      expect(code).toBe(ExitCode.SUCCESS);
    });

    const parsed = JSON.parse(output.stdout);
    expect(parsed.backlogCleared).toBe(true);

    // Verify backlog is empty but metadata preserved
    const backlogRaw = fs.readFileSync(path.join(projectDir, ".ralph", "backlog.json"), "utf-8");
    const backlog = JSON.parse(backlogRaw);
    expect(backlog.items).toHaveLength(0);
    expect(backlog.project).toBe("test-project");
  });
});
