import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import { resetProject } from "./reset.js";
import { writeBacklog } from "./backlog.js";
import { ErrorCodes } from "./errors.js";
import type { Backlog, BacklogItem } from "./schemas.js";

// ─── Helpers ──────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ralph-reset-"));
  fs.mkdirSync(path.join(tmpDir, ".ralph"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

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

function makeBacklog(items: BacklogItem[]): Backlog {
  return { project: "test-project", description: "A test project", items };
}

function writeSeedBacklog(items: BacklogItem[]): void {
  const result = writeBacklog(tmpDir, makeBacklog(items));
  if (!result.ok) throw new Error(`Seed failed: ${result.error.message}`);
}

function writeStateJson(data: object): void {
  fs.writeFileSync(
    path.join(tmpDir, ".ralph", "state.json"),
    JSON.stringify(data, null, 2),
  );
}

function writeDoneMarker(content: string = "complete"): void {
  fs.writeFileSync(path.join(tmpDir, ".ralph", "DONE"), content);
}

function writeCancelMarker(): void {
  fs.writeFileSync(path.join(tmpDir, ".ralph", "CANCEL"), "cancelled");
}

function readBacklogFile(): Backlog {
  const raw = fs.readFileSync(path.join(tmpDir, ".ralph", "backlog.json"), "utf-8");
  return JSON.parse(raw) as Backlog;
}

/** Find a single archive file matching a suffix like "-progress.md" */
function findArchiveFile(dir: string, suffix: string): string | undefined {
  if (!fs.existsSync(dir)) return undefined;
  return fs.readdirSync(dir).find((f) => f.endsWith(suffix));
}

// ─── Tests ────────────────────────────────────────────────────────

describe("resetProject", () => {
  it("sweeps done items, resets in_progress, clears markers", () => {
    const doneItem = makeItem({
      id: "001",
      status: "done",
      completedAt: "2026-01-15T12:00:00.000Z",
    });
    const inProgressItem = makeItem({
      id: "002",
      status: "in_progress",
      title: "WIP task",
    });
    const pendingItem = makeItem({
      id: "003",
      status: "pending",
      title: "Upcoming task",
    });

    writeSeedBacklog([doneItem, inProgressItem, pendingItem]);
    writeStateJson({
      status: "complete",
      iteration: 3,
      maxIterations: 5,
      currentItem: null,
      lastSignal: "clean",
      startedAt: "2026-01-15T10:00:00.000Z",
      updatedAt: "2026-01-15T12:00:00.000Z",
    });
    writeDoneMarker();
    writeCancelMarker();

    const result = resetProject(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.sweptCount).toBe(1);
    expect(result.value.sweptMonths).toEqual(["2026-01"]);
    expect(result.value.stalledResetCount).toBe(1);
    expect(result.value.stateCleared).toBe(true);
    expect(result.value.doneCleared).toBe(true);
    expect(result.value.cancelCleared).toBe(true);
    expect(result.value.backlogCleared).toBe(false);
    expect(result.value.progressArchived).toBe(false);

    // Verify backlog state
    const backlog = readBacklogFile();
    expect(backlog.items).toHaveLength(2);
    expect(backlog.items[0]!.status).toBe("pending"); // was in_progress
    expect(backlog.items[1]!.status).toBe("pending"); // was already pending

    // Verify state.json deleted
    expect(fs.existsSync(path.join(tmpDir, ".ralph", "state.json"))).toBe(false);

    // Verify markers deleted
    expect(fs.existsSync(path.join(tmpDir, ".ralph", "DONE"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, ".ralph", "CANCEL"))).toBe(false);

    // Verify archive created
    expect(fs.existsSync(path.join(tmpDir, ".ralph", "archive", "2026-01.json"))).toBe(true);
  });

  it("with clearBacklog: true — empties backlog items, preserves metadata", () => {
    writeSeedBacklog([
      makeItem({ id: "001", status: "pending" }),
      makeItem({ id: "002", status: "done", completedAt: "2026-02-10T00:00:00.000Z" }),
    ]);

    const result = resetProject(tmpDir, { clearBacklog: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.backlogCleared).toBe(true);
    expect(result.value.sweptCount).toBe(1);

    const backlog = readBacklogFile();
    expect(backlog.items).toHaveLength(0);
    expect(backlog.project).toBe("test-project");
    expect(backlog.description).toBe("A test project");
  });

  it("idempotent — succeeds when no state files exist", () => {
    writeSeedBacklog([makeItem({ id: "001", status: "pending" })]);

    const result = resetProject(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.sweptCount).toBe(0);
    expect(result.value.stalledResetCount).toBe(0);
    expect(result.value.stateCleared).toBe(false);
    expect(result.value.backlogCleared).toBe(false);
    expect(result.value.progressArchived).toBe(false);
  });

  it("returns error when no backlog file exists", () => {
    // No backlog.json written — just the .ralph dir
    const result = resetProject(tmpDir);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe(ErrorCodes.FILE_NOT_FOUND);
  });

  it("clearBacklog with progress.md — archives it and deploys fresh template", () => {
    writeSeedBacklog([makeItem({ id: "001", status: "pending" })]);
    const progressPath = path.join(tmpDir, ".ralph", "progress.md");
    fs.writeFileSync(progressPath, "# Old learnings\n\nSome accumulated context.");

    const result = resetProject(tmpDir, { clearBacklog: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.progressArchived).toBe(true);

    // Verify archive file exists with old content (timestamp-based name)
    const archiveDir = path.join(tmpDir, ".ralph", "archive");
    const progressArchive = findArchiveFile(archiveDir, "-progress.md");
    expect(progressArchive).toBeDefined();
    expect(progressArchive).toMatch(/^\d{8}-\d{6}-progress\.md$/);
    expect(fs.readFileSync(path.join(archiveDir, progressArchive!), "utf-8")).toBe("# Old learnings\n\nSome accumulated context.");

    // Verify fresh progress.md was deployed (not the old content)
    expect(fs.existsSync(progressPath)).toBe(true);
    const freshContent = fs.readFileSync(progressPath, "utf-8");
    expect(freshContent).not.toContain("Old learnings");
  });

  it("clearBacklog without progress.md — progressArchived false, no error", () => {
    writeSeedBacklog([makeItem({ id: "001", status: "pending" })]);
    // No progress.md created

    const result = resetProject(tmpDir, { clearBacklog: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.progressArchived).toBe(false);
    expect(result.value.backlogCleared).toBe(true);
  });

  it("no clearBacklog with progress.md — file untouched", () => {
    writeSeedBacklog([makeItem({ id: "001", status: "pending" })]);
    const progressPath = path.join(tmpDir, ".ralph", "progress.md");
    fs.writeFileSync(progressPath, "# Existing learnings");

    const result = resetProject(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.progressArchived).toBe(false);
    expect(fs.readFileSync(progressPath, "utf-8")).toBe("# Existing learnings");
  });

  // ─── Log archiving tests ────────────────────────────────────────

  it("clearBacklog with ralph.log — archives it", () => {
    writeSeedBacklog([makeItem({ id: "001", status: "pending" })]);
    const logPath = path.join(tmpDir, ".ralph", "ralph.log");
    fs.writeFileSync(logPath, "2026-03-01 some log entry\n2026-03-02 another entry\n");

    const result = resetProject(tmpDir, { clearBacklog: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.logArchived).toBe(true);

    // Verify archive file exists with old content (timestamp-based name)
    const archiveDir = path.join(tmpDir, ".ralph", "archive");
    const logArchive = findArchiveFile(archiveDir, "-ralph.log");
    expect(logArchive).toBeDefined();
    expect(logArchive).toMatch(/^\d{8}-\d{6}-ralph\.log$/);
    expect(fs.readFileSync(path.join(archiveDir, logArchive!), "utf-8")).toContain("some log entry");

    // Verify original log removed (not recreated — appendLog creates on first write)
    expect(fs.existsSync(logPath)).toBe(false);
  });

  it("clearBacklog without ralph.log — logArchived false, no error", () => {
    writeSeedBacklog([makeItem({ id: "001", status: "pending" })]);

    const result = resetProject(tmpDir, { clearBacklog: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.logArchived).toBe(false);
  });

  it("no clearBacklog with ralph.log — file untouched", () => {
    writeSeedBacklog([makeItem({ id: "001", status: "pending" })]);
    const logPath = path.join(tmpDir, ".ralph", "ralph.log");
    fs.writeFileSync(logPath, "existing log data");

    const result = resetProject(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.logArchived).toBe(false);
    expect(fs.readFileSync(logPath, "utf-8")).toBe("existing log data");
  });

  // ─── Opt-out flag tests ─────────────────────────────────────────

  it("clearBacklog with keepProgress — log archived, progress untouched", () => {
    writeSeedBacklog([makeItem({ id: "001", status: "pending" })]);
    const progressPath = path.join(tmpDir, ".ralph", "progress.md");
    const logPath = path.join(tmpDir, ".ralph", "ralph.log");
    fs.writeFileSync(progressPath, "# Keep me");
    fs.writeFileSync(logPath, "archive me\n");

    const result = resetProject(tmpDir, { clearBacklog: true, keepProgress: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.progressArchived).toBe(false);
    expect(result.value.logArchived).toBe(true);
    expect(fs.readFileSync(progressPath, "utf-8")).toBe("# Keep me");
    expect(fs.existsSync(logPath)).toBe(false);
  });

  it("clearBacklog with keepLog — progress archived, log untouched", () => {
    writeSeedBacklog([makeItem({ id: "001", status: "pending" })]);
    const progressPath = path.join(tmpDir, ".ralph", "progress.md");
    const logPath = path.join(tmpDir, ".ralph", "ralph.log");
    fs.writeFileSync(progressPath, "# Archive me");
    fs.writeFileSync(logPath, "keep me\n");

    const result = resetProject(tmpDir, { clearBacklog: true, keepLog: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.progressArchived).toBe(true);
    expect(result.value.logArchived).toBe(false);
    expect(fs.existsSync(progressPath)).toBe(true);
    const freshContent = fs.readFileSync(progressPath, "utf-8");
    expect(freshContent).not.toContain("Archive me");
    expect(fs.readFileSync(logPath, "utf-8")).toBe("keep me\n");
  });
});
