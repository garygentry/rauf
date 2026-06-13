import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";

import { handleReset } from "./reset-commands.js";
import { handleBacklogValidate } from "./backlog-commands.js";
import { ExitCode } from "./commands.js";
import type { CommandContext } from "./commands.js";
import { configureOutput } from "./formatter.js";

// ─── Fixtures ──────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rauf-cli-reset-"));
  configureOutput({ noColor: true, quiet: true, json: false });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function git(cwd: string, args: string): void {
  execSync(`git ${args}`, { cwd, stdio: "ignore" });
}

/**
 * Create a project dir that is its own git repo with a populated
 * .rauf/backlog.json. Runtime state files (state.json) are git-ignored so the
 * working tree can be clean even with loop state present.
 */
function createProject(items: object[]): string {
  const projectDir = path.join(tmpDir, "proj");
  const raufDir = path.join(projectDir, ".rauf");
  fs.mkdirSync(raufDir, { recursive: true });

  const backlog = {
    schemaVersion: "1",
    project: "test-project",
    description: "Test project backlog",
    items,
  };
  fs.writeFileSync(path.join(raufDir, "backlog.json"), JSON.stringify(backlog, null, 2) + "\n");
  fs.writeFileSync(
    path.join(projectDir, ".gitignore"),
    [
      ".rauf/state.json",
      ".rauf/DONE",
      ".rauf/CANCEL",
      ".rauf/.loop.lock",
      ".rauf/rauf.log",
      "",
    ].join("\n"),
  );

  git(projectDir, "init");
  git(projectDir, 'config user.email "test@test.com"');
  git(projectDir, 'config user.name "Test"');
  git(projectDir, "add -A");
  git(projectDir, 'commit -m "baseline"');

  return projectDir;
}

/** Commit a real source change under a `[rauf] <id>:` message, leaving a clean tree. */
function commitItemWork(projectDir: string, id: string): void {
  fs.writeFileSync(path.join(projectDir, `work-${id}.txt`), `work for ${id}\n`);
  git(projectDir, "add -A");
  git(projectDir, `commit -m "[rauf] ${id}: did the work"`);
}

/** Current HEAD hash of the project's git repo. */
function headHash(projectDir: string): string {
  return execSync("git rev-parse HEAD", { cwd: projectDir, encoding: "utf-8" }).trim();
}

/** Write a minimal valid state.json carrying the given run baseline. */
function writeStateBaseline(projectDir: string, baseCommitHash: string | null): void {
  const state = {
    status: "error",
    iteration: 1,
    maxIterations: 20,
    currentItem: null,
    lastSignal: "error",
    startedAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    completedItems: [],
    blockedItems: [],
    deferredItems: [],
    baseCommitHash,
    error: null,
  };
  fs.writeFileSync(
    path.join(projectDir, ".rauf", "state.json"),
    JSON.stringify(state, null, 2) + "\n",
  );
}

function readBacklogItems(
  projectDir: string,
): Record<string, { status: string; deferred?: boolean }> {
  const raw = fs.readFileSync(path.join(projectDir, ".rauf", "backlog.json"), "utf-8");
  const parsed = JSON.parse(raw) as { items: { id: string; status: string; deferred?: boolean }[] };
  const map: Record<string, { status: string; deferred?: boolean }> = {};
  for (const i of parsed.items) map[i.id] = { status: i.status, deferred: i.deferred };
  return map;
}

function makeCtx(overrides?: Partial<CommandContext>): CommandContext {
  return {
    args: [],
    flags: new Map(),
    globalFlags: { json: false, noColor: true, quiet: true, root: null },
    rawArgv: [],
    ...overrides,
  };
}

function item(id: string, status: string, extra: Record<string, unknown> = {}): object {
  return {
    id,
    type: "feature",
    priority: 2,
    title: `Item ${id}`,
    description: `Description ${id}`,
    status,
    completedAt: status === "done" ? "2026-06-01T00:00:00.000Z" : null,
    acceptanceCriteria: ["Works"],
    ...extra,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────

describe("handleReset — lock handling", () => {
  it("refuses when a live loop holds the lock", async () => {
    const projectDir = createProject([item("001", "blocked", { deferred: true })]);
    // Write a lock owned by THIS (alive) process.
    fs.writeFileSync(
      path.join(projectDir, ".rauf", ".loop.lock"),
      JSON.stringify({ pid: process.pid, startedAt: "now", processStartTime: null }),
    );

    const code = await handleReset(makeCtx({ args: [projectDir] }));
    expect(code).toBe(ExitCode.USAGE);

    // Backlog untouched — deferred item still blocked.
    expect(readBacklogItems(projectDir)["001"]?.status).toBe("blocked");
  });

  it("clears a stale lock and proceeds", async () => {
    const projectDir = createProject([item("001", "blocked", { deferred: true })]);
    const lockPath = path.join(projectDir, ".rauf", ".loop.lock");
    // PID 2^31-ish is guaranteed dead → stale lock.
    fs.writeFileSync(
      lockPath,
      JSON.stringify({ pid: 2147483646, startedAt: "old", processStartTime: null }),
    );

    const code = await handleReset(makeCtx({ args: [projectDir] }));
    expect(code).toBe(ExitCode.SUCCESS);
    expect(fs.existsSync(lockPath)).toBe(false);
    expect(readBacklogItems(projectDir)["001"]?.status).toBe("pending");
  });
});

describe("handleReset — commit reconciliation", () => {
  it("promotes committed-clean non-done items to done", async () => {
    const projectDir = createProject([item("001", "blocked", { deferred: true })]);
    commitItemWork(projectDir, "001");

    const code = await handleReset(makeCtx({ args: [projectDir] }));
    expect(code).toBe(ExitCode.SUCCESS);

    const after = readBacklogItems(projectDir)["001"];
    expect(after?.status).toBe("done");
    expect(after?.deferred).toBeUndefined();
  });

  it("does NOT promote when the tree is dirty", async () => {
    const projectDir = createProject([item("001", "blocked", { deferred: true })]);
    commitItemWork(projectDir, "001");
    // Make the tree dirty with an uncommitted source change.
    fs.writeFileSync(path.join(projectDir, "dirty.txt"), "uncommitted");

    const code = await handleReset(makeCtx({ args: [projectDir] }));
    expect(code).toBe(ExitCode.SUCCESS);

    // No commit-promotion; deferred false-block still requeued to pending.
    expect(readBacklogItems(projectDir)["001"]?.status).toBe("pending");
  });
});

describe("handleReset — baseline-bounded reconciliation (item 018)", () => {
  it("does NOT recover a genuine block from a stale pre-baseline commit", async () => {
    const projectDir = createProject([
      item("001", "blocked", { blockedReason: "RAUF_BLOCKED: real block" }),
    ]);
    // A prior cycle's `[rauf] 001:` commit, then this run's baseline AFTER it.
    commitItemWork(projectDir, "001");
    const baseline = headHash(projectDir);
    writeStateBaseline(projectDir, baseline);

    const code = await handleReset(makeCtx({ args: [projectDir] }));
    expect(code).toBe(ExitCode.SUCCESS);

    // The stale commit predates the baseline → not recovered; genuine block stays.
    expect(readBacklogItems(projectDir)["001"]?.status).toBe("blocked");
  });

  it("recovers a genuine block when its commit landed after the baseline", async () => {
    const projectDir = createProject([
      item("001", "blocked", { blockedReason: "RAUF_BLOCKED: real block" }),
    ]);
    // Baseline is the initial commit; the `[rauf] 001:` commit lands afterward.
    const baseline = headHash(projectDir);
    writeStateBaseline(projectDir, baseline);
    commitItemWork(projectDir, "001");

    const code = await handleReset(makeCtx({ args: [projectDir] }));
    expect(code).toBe(ExitCode.SUCCESS);

    expect(readBacklogItems(projectDir)["001"]?.status).toBe("done");
  });

  it("does NOT recover a genuine block when state carries no baseline", async () => {
    const projectDir = createProject([
      item("001", "blocked", { blockedReason: "RAUF_BLOCKED: real block" }),
    ]);
    // A stale `[rauf] 001:` commit exists but there is no run baseline to bound
    // the search — a genuine block must not be promoted on an unbounded match.
    commitItemWork(projectDir, "001");
    // No state.json written → no baseCommitHash.

    const code = await handleReset(makeCtx({ args: [projectDir] }));
    expect(code).toBe(ExitCode.SUCCESS);

    expect(readBacklogItems(projectDir)["001"]?.status).toBe("blocked");
  });

  it("still recovers a deferred false-block from an unbounded match (no baseline)", async () => {
    const projectDir = createProject([item("001", "blocked", { deferred: true })]);
    commitItemWork(projectDir, "001");
    // No state.json → no baseline; deferred items are not genuine blocks, so the
    // unbounded fallback still recovers legitimately-landed work.

    const code = await handleReset(makeCtx({ args: [projectDir] }));
    expect(code).toBe(ExitCode.SUCCESS);

    expect(readBacklogItems(projectDir)["001"]?.status).toBe("done");
  });
});

describe("handleReset — false-block requeue vs genuine block", () => {
  it("requeues deferred false blocks but keeps genuine agent blocks", async () => {
    const projectDir = createProject([
      item("001", "blocked", { deferred: true, blockedReason: "No signal (deferred by runner)" }),
      item("002", "blocked", { blockedReason: "RAUF_BLOCKED: missing dependency" }),
      item("003", "blocked", { needsHuman: true, blockedReason: "needs an API key" }),
      item("004", "in_progress"),
      item("005", "done"),
    ]);

    const code = await handleReset(makeCtx({ args: [projectDir] }));
    expect(code).toBe(ExitCode.SUCCESS);

    const after = readBacklogItems(projectDir);
    expect(after["001"]?.status).toBe("pending"); // deferred → requeued
    expect(after["001"]?.deferred).toBeUndefined();
    expect(after["002"]?.status).toBe("blocked"); // genuine agent block stays
    expect(after["003"]?.status).toBe("blocked"); // needsHuman stays
    expect(after["004"]?.status).toBe("pending"); // stalled → pending
    expect(after["005"]?.status).toBe("done"); // done kept
  });

  it("reports kept blocks and cleared lock in JSON output", async () => {
    const projectDir = createProject([
      item("001", "blocked", { deferred: true }),
      item("002", "blocked", { blockedReason: "real block" }),
    ]);

    let captured = "";
    const origWrite = process.stdout.write;
    process.stdout.write = ((chunk: string) => {
      captured += chunk;
      return true;
    }) as typeof process.stdout.write;
    try {
      const code = await handleReset(
        makeCtx({
          args: [projectDir],
          globalFlags: { json: true, noColor: true, quiet: true, root: null },
        }),
      );
      expect(code).toBe(ExitCode.SUCCESS);
    } finally {
      process.stdout.write = origWrite;
    }

    const json = JSON.parse(captured) as {
      requeued: string[];
      keptBlocked: { id: string; reason: string }[];
      stateCleared: boolean;
    };
    expect(json.requeued).toEqual(["001"]);
    expect(json.keptBlocked.map((b) => b.id)).toEqual(["002"]);
  });
});

describe("handleReset — state clearing", () => {
  it("clears state.json and DONE", async () => {
    const projectDir = createProject([item("001", "pending")]);
    const statefile = path.join(projectDir, ".rauf", "state.json");
    const donefile = path.join(projectDir, ".rauf", "DONE");
    fs.writeFileSync(statefile, "{}");
    fs.writeFileSync(donefile, "complete");

    const code = await handleReset(makeCtx({ args: [projectDir] }));
    expect(code).toBe(ExitCode.SUCCESS);
    expect(fs.existsSync(statefile)).toBe(false);
    expect(fs.existsSync(donefile)).toBe(false);
  });
});

describe("handleReset -> handleBacklogValidate (item 030)", () => {
  it("backlog stays schema-valid after reset over a mixed backlog", async () => {
    const projectDir = createProject([
      item("001", "blocked", { deferred: true, blockedReason: "No signal (deferred by runner)" }),
      item("002", "in_progress"),
      item("003", "done"),
      item("004", "blocked", { blockedReason: "RAUF_BLOCKED: real block" }),
    ]);

    const resetCode = await handleReset(makeCtx({ args: [projectDir] }));
    expect(resetCode).toBe(ExitCode.SUCCESS);

    const validateCode = await handleBacklogValidate(makeCtx({ args: [projectDir] }));
    expect(validateCode).toBe(ExitCode.SUCCESS);
  });
});
