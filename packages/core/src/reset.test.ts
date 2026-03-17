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
  });

  it("returns error when no backlog file exists", () => {
    // No backlog.json written — just the .ralph dir
    const result = resetProject(tmpDir);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe(ErrorCodes.FILE_NOT_FOUND);
  });
});
