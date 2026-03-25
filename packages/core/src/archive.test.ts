import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import { sweepBacklog, listArchiveMonths, readArchiveMonth, purgeArchive } from "./archive.js";
import { writeBacklog } from "./backlog.js";
import { defaultBacklogPaths } from "./backlog-root.js";
import { ErrorCodes } from "./errors.js";
import type { Backlog, BacklogItem } from "./schemas.js";

// ─── Helpers ──────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ralph-archive-"));
  fs.mkdirSync(path.join(tmpDir, ".ralph"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeBacklog(items: BacklogItem[]): Backlog {
  return { project: "test-project", description: "A test project", items };
}

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

function writeSeedBacklog(items: BacklogItem[]): void {
  const result = writeBacklog(defaultBacklogPaths(tmpDir), makeBacklog(items));
  if (!result.ok) throw new Error(`Seed failed: ${result.error.message}`);
}

function readBacklogFile(): Backlog {
  const raw = fs.readFileSync(path.join(tmpDir, ".ralph", "backlog.json"), "utf-8");
  return JSON.parse(raw) as Backlog;
}

function readArchiveFile(month: string): unknown {
  const raw = fs.readFileSync(path.join(tmpDir, ".ralph", "archive", `${month}.json`), "utf-8");
  return JSON.parse(raw);
}

// ─── Tests ────────────────────────────────────────────────────────

describe("sweepBacklog", () => {
  it("1. no done items — no writes, returns archivedCount: 0", () => {
    writeSeedBacklog([
      makeItem({ id: "001", status: "pending" }),
      makeItem({ id: "002", status: "in_progress" }),
    ]);

    const result = sweepBacklog(tmpDir);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.archivedCount).toBe(0);
    expect(result.value.archivedMonths).toEqual([]);

    // Archive dir should not exist
    expect(fs.existsSync(path.join(tmpDir, ".ralph", "archive"))).toBe(false);
    // Backlog unchanged
    expect(readBacklogFile().items).toHaveLength(2);
  });

  it("2. done items → archive file created, items removed from backlog", () => {
    writeSeedBacklog([
      makeItem({ id: "001", status: "done", completedAt: "2026-02-15T10:00:00.000Z" }),
      makeItem({ id: "002", status: "pending" }),
    ]);

    const result = sweepBacklog(tmpDir);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.archivedCount).toBe(1);
    expect(result.value.archivedMonths).toEqual(["2026-02"]);

    // Archive file exists with correct content
    const archive = readArchiveFile("2026-02") as { month: string; items: BacklogItem[] };
    expect(archive.month).toBe("2026-02");
    expect(archive.items).toHaveLength(1);
    expect(archive.items[0]!.id).toBe("001");

    // Only pending item remains in backlog
    const remaining = readBacklogFile().items;
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.id).toBe("002");
  });

  it("3. minAgeDays: 7 — recent done items stay in backlog", () => {
    const recentDate = new Date(Date.now() - 2 * 86_400_000).toISOString(); // 2 days ago
    const oldDate = new Date(Date.now() - 10 * 86_400_000).toISOString(); // 10 days ago

    writeSeedBacklog([
      makeItem({ id: "001", status: "done", completedAt: recentDate }),
      makeItem({ id: "002", status: "done", completedAt: oldDate }),
    ]);

    const result = sweepBacklog(tmpDir, { minAgeDays: 7 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.archivedCount).toBe(1);

    const remaining = readBacklogFile().items;
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.id).toBe("001");
  });

  it("4. second run is a no-op if no new done items; first archive preserved", () => {
    writeSeedBacklog([
      makeItem({ id: "001", status: "done", completedAt: "2026-02-01T00:00:00.000Z" }),
    ]);

    const first = sweepBacklog(tmpDir);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.archivedCount).toBe(1);

    // Second run — backlog now has no done items
    const second = sweepBacklog(tmpDir);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.archivedCount).toBe(0);

    // Archive still has the original item
    const archive = readArchiveFile("2026-02") as { items: BacklogItem[] };
    expect(archive.items).toHaveLength(1);
  });

  it("5. done items across 2 months → two archive files created", () => {
    writeSeedBacklog([
      makeItem({ id: "001", status: "done", completedAt: "2026-01-20T00:00:00.000Z" }),
      makeItem({ id: "002", status: "done", completedAt: "2026-02-05T00:00:00.000Z" }),
    ]);

    const result = sweepBacklog(tmpDir);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.archivedCount).toBe(2);
    expect(result.value.archivedMonths).toEqual(["2026-01", "2026-02"]);

    const jan = readArchiveFile("2026-01") as { items: BacklogItem[] };
    expect(jan.items).toHaveLength(1);
    expect(jan.items[0]!.id).toBe("001");

    const feb = readArchiveFile("2026-02") as { items: BacklogItem[] };
    expect(feb.items).toHaveLength(1);
    expect(feb.items[0]!.id).toBe("002");
  });

  it("6. done item with completedAt: null → falls back to current month", () => {
    writeSeedBacklog([makeItem({ id: "001", status: "done", completedAt: null })]);

    const result = sweepBacklog(tmpDir);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.archivedCount).toBe(1);

    const currentMonth = new Date().toISOString().slice(0, 7);
    expect(result.value.archivedMonths).toEqual([currentMonth]);

    const archive = readArchiveFile(currentMonth) as { items: BacklogItem[] };
    expect(archive.items[0]!.id).toBe("001");
  });

  it("14. non-ralph path → FILE_NOT_FOUND error", () => {
    const result = sweepBacklog("/nonexistent/path");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(ErrorCodes.FILE_NOT_FOUND);
  });
});

describe("listArchiveMonths", () => {
  it("7. no archive dir → ok([])", () => {
    writeSeedBacklog([]);

    const result = listArchiveMonths(tmpDir);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
  });

  it("8. after sweep → correct sorted months", () => {
    writeSeedBacklog([
      makeItem({ id: "001", status: "done", completedAt: "2026-02-15T00:00:00.000Z" }),
      makeItem({ id: "002", status: "done", completedAt: "2026-01-10T00:00:00.000Z" }),
    ]);
    sweepBacklog(tmpDir);

    const result = listArchiveMonths(tmpDir);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual(["2026-01", "2026-02"]);
  });
});

describe("readArchiveMonth", () => {
  it("9. non-existent month → FILE_NOT_FOUND error", () => {
    writeSeedBacklog([]);

    const result = readArchiveMonth(tmpDir, "2026-01");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(ErrorCodes.FILE_NOT_FOUND);
  });

  it("10. existing month → correct items returned", () => {
    writeSeedBacklog([
      makeItem({ id: "001", status: "done", completedAt: "2026-02-10T00:00:00.000Z" }),
    ]);
    sweepBacklog(tmpDir);

    const result = readArchiveMonth(tmpDir, "2026-02");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.month).toBe("2026-02");
    expect(result.value.items).toHaveLength(1);
    expect(result.value.items[0]!.id).toBe("001");
  });
});

describe("purgeArchive", () => {
  it("11. specific month → only that file deleted", () => {
    writeSeedBacklog([
      makeItem({ id: "001", status: "done", completedAt: "2026-01-10T00:00:00.000Z" }),
      makeItem({ id: "002", status: "done", completedAt: "2026-02-10T00:00:00.000Z" }),
    ]);
    sweepBacklog(tmpDir);

    const result = purgeArchive(tmpDir, "2026-01");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.purgedCount).toBe(1);
    expect(result.value.purgedMonths).toEqual(["2026-01"]);

    // Only 2026-01 deleted; 2026-02 still exists
    expect(fs.existsSync(path.join(tmpDir, ".ralph", "archive", "2026-01.json"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, ".ralph", "archive", "2026-02.json"))).toBe(true);
  });

  it("12. purge all → all files deleted", () => {
    writeSeedBacklog([
      makeItem({ id: "001", status: "done", completedAt: "2026-01-10T00:00:00.000Z" }),
      makeItem({ id: "002", status: "done", completedAt: "2026-02-10T00:00:00.000Z" }),
    ]);
    sweepBacklog(tmpDir);

    const result = purgeArchive(tmpDir);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.purgedCount).toBe(2);
    expect(result.value.purgedMonths).toEqual(["2026-01", "2026-02"]);

    expect(fs.existsSync(path.join(tmpDir, ".ralph", "archive", "2026-01.json"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, ".ralph", "archive", "2026-02.json"))).toBe(false);
  });

  it("13. non-existent month → ok with purgedCount: 0", () => {
    writeSeedBacklog([]);

    const result = purgeArchive(tmpDir, "2026-01");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.purgedCount).toBe(0);
    expect(result.value.purgedMonths).toEqual([]);
  });
});
