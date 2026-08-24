import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";

import { acquireLock, resolveBacklogPaths } from "@rauf/core";

import { handleResume, parseAnswerFlags, resolveResumeTargetPath } from "./resume-commands.js";
import { handleLoopRun } from "./loop-commands.js";
import { parseArgs } from "./parser.js";
import { detectInterruptedItems } from "./recovery.js";
import { ExitCode } from "./commands.js";
import type { CommandContext } from "./commands.js";
import { configureOutput } from "./formatter.js";

// ─── Fixtures ──────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rauf-cli-resume-"));
  configureOutput({ noColor: true, quiet: true, json: false });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function git(cwd: string, args: string): void {
  execSync(`git ${args}`, { cwd, stdio: "ignore" });
}

/** Project dir that is its own git repo with runtime files git-ignored. */
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

function commitItemWork(projectDir: string, id: string): void {
  fs.writeFileSync(path.join(projectDir, `work-${id}.txt`), `work for ${id}\n`);
  git(projectDir, "add -A");
  git(projectDir, `commit -m "[rauf] ${id}: did the work"`);
}

/** Write a minimal valid .rauf.json marker carrying a verify command. */
function writeMarker(projectDir: string, verify: string, provider?: string): void {
  const marker = {
    rauf: true,
    version: "1.0.0",
    variant: "backlog-json",
    installedAt: "2026-01-01T00:00:00.000Z",
    installedBy: "test",
    profile: {
      stack: "custom",
      packageManager: null,
      monorepo: false,
      commands: { test: null, typecheck: null, lint: null, build: null, format: null },
      verify,
    },
    artifactHashes: {},
    options: {
      ignoreInTool: false,
      gitignoreScripts: false,
      maxIterations: 20,
      ...(provider ? { provider } : {}),
    },
  };
  fs.writeFileSync(path.join(projectDir, ".rauf.json"), JSON.stringify(marker, null, 2) + "\n");
}

/** Subject lines of `[rauf] <id>:` commits in the project's git log. */
function raufCommitSubjects(projectDir: string, id: string): string {
  return execSync(`git log --grep="^\\[rauf\\] ${id}:" --format=%s`, {
    cwd: projectDir,
    encoding: "utf-8",
  }).trim();
}

function writeState(projectDir: string, status: string): void {
  const state = {
    status,
    iteration: 2,
    maxIterations: 20,
    currentItem: null,
    lastSignal: null,
    startedAt: "2026-06-11T00:00:00.000Z",
    updatedAt: "2026-06-11T00:00:00.000Z",
    completedItems: [],
    blockedItems: [],
    deferredItems: [],
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

/** A runLoop stub that records the ctx it was launched with. */
function captureRunLoop() {
  const calls: CommandContext[] = [];
  const runLoop = async (ctx: CommandContext): Promise<number> => {
    calls.push(ctx);
    return ExitCode.SUCCESS;
  };
  return { calls, runLoop };
}

// ─── Tests ─────────────────────────────────────────────────────────

describe("handleResume — lock handling", () => {
  it("refuses when a live loop holds the lock and does not relaunch", async () => {
    const projectDir = createProject([item("001", "pending")]);
    writeState(projectDir, "paused_usage_limit");
    fs.writeFileSync(
      path.join(projectDir, ".rauf", ".loop.lock"),
      JSON.stringify({ pid: process.pid, startedAt: "now", processStartTime: null }),
    );

    const { calls, runLoop } = captureRunLoop();
    const code = await handleResume(makeCtx({ args: [projectDir] }), { runLoop });

    expect(code).toBe(ExitCode.USAGE);
    expect(calls).toHaveLength(0);
    // state.json untouched (not cleared) when refusing.
    expect(fs.existsSync(path.join(projectDir, ".rauf", "state.json"))).toBe(true);
  });

  it("clears a stale lock and proceeds", async () => {
    const projectDir = createProject([item("001", "pending")]);
    const lockPath = path.join(projectDir, ".rauf", ".loop.lock");
    fs.writeFileSync(
      lockPath,
      JSON.stringify({ pid: 2147483646, startedAt: "old", processStartTime: null }),
    );

    const { calls, runLoop } = captureRunLoop();
    const code = await handleResume(makeCtx({ args: [projectDir] }), { runLoop });

    expect(code).toBe(ExitCode.SUCCESS);
    expect(fs.existsSync(lockPath)).toBe(false);
    expect(calls).toHaveLength(1);
  });
});

describe("handleResume — resumable-state detection", () => {
  for (const status of ["paused_usage_limit", "limit_reached", "error"] as const) {
    it(`detects ${status} and resumes`, async () => {
      const projectDir = createProject([
        item("001", "blocked", { deferred: true }),
        item("002", "pending"),
      ]);
      writeState(projectDir, status);

      const { calls, runLoop } = captureRunLoop();
      const code = await handleResume(makeCtx({ args: [projectDir] }), { runLoop });

      expect(code).toBe(ExitCode.SUCCESS);
      expect(calls).toHaveLength(1);
      // deferred false-block was requeued; state.json cleared.
      expect(readBacklogItems(projectDir)["001"]?.status).toBe("pending");
      expect(fs.existsSync(path.join(projectDir, ".rauf", "state.json"))).toBe(false);
      // Launch forwards --allow-dirty and the project path.
      expect(calls[0]!.flags.get("allow-dirty")).toBe(true);
      expect(calls[0]!.args[0]).toBe(projectDir);
    });
  }

  it("detects a dead lock with non-done items and resumes (no state.json)", async () => {
    const projectDir = createProject([item("001", "pending")]);
    fs.writeFileSync(
      path.join(projectDir, ".rauf", ".loop.lock"),
      JSON.stringify({ pid: 2147483646, startedAt: "old", processStartTime: null }),
    );

    const { calls, runLoop } = captureRunLoop();
    const code = await handleResume(makeCtx({ args: [projectDir] }), { runLoop });

    expect(code).toBe(ExitCode.SUCCESS);
    expect(calls).toHaveLength(1);
  });

  it("preserves a project-level Copilot provider when relaunching", async () => {
    const projectDir = createProject([item("001", "pending")]);
    writeMarker(projectDir, "pnpm test", "copilot");
    writeState(projectDir, "error");

    const { calls, runLoop } = captureRunLoop();
    const code = await handleResume(makeCtx({ args: [projectDir] }), { runLoop });

    expect(code).toBe(ExitCode.SUCCESS);
    expect(calls).toHaveLength(1);
    const marker = JSON.parse(fs.readFileSync(path.join(projectDir, ".rauf.json"), "utf-8")) as {
      options: { provider?: string };
    };
    expect(marker.options.provider).toBe("copilot");
  });
});

describe("handleResume — recovery before relaunch", () => {
  it("promotes a committed-clean item to done before resuming", async () => {
    const projectDir = createProject([
      item("001", "blocked", { deferred: true }),
      item("002", "pending"),
    ]);
    writeState(projectDir, "paused_usage_limit");
    commitItemWork(projectDir, "001");

    const { calls, runLoop } = captureRunLoop();
    const code = await handleResume(makeCtx({ args: [projectDir] }), { runLoop });

    expect(code).toBe(ExitCode.SUCCESS);
    const after = readBacklogItems(projectDir);
    expect(after["001"]?.status).toBe("done");
    expect(after["001"]?.deferred).toBeUndefined();
    // 002 still pending → loop relaunches.
    expect(calls).toHaveLength(1);
  });

  it("resets a stalled in_progress item to pending before resuming", async () => {
    const projectDir = createProject([item("001", "in_progress")]);
    writeState(projectDir, "error");

    const { calls, runLoop } = captureRunLoop();
    const code = await handleResume(makeCtx({ args: [projectDir] }), { runLoop });

    expect(code).toBe(ExitCode.SUCCESS);
    expect(readBacklogItems(projectDir)["001"]?.status).toBe("pending");
    expect(calls).toHaveLength(1);
  });
});

describe("handleResume — nothing to resume", () => {
  it("returns success without relaunching when all items are done", async () => {
    const projectDir = createProject([item("001", "done")]);
    writeState(projectDir, "complete");

    const { calls, runLoop } = captureRunLoop();
    const code = await handleResume(makeCtx({ args: [projectDir] }), { runLoop });

    expect(code).toBe(ExitCode.SUCCESS);
    expect(calls).toHaveLength(0);
  });

  it("does not relaunch when only genuine blocks remain after recovery", async () => {
    const projectDir = createProject([
      item("001", "blocked", { blockedReason: "RAUF_BLOCKED: missing dep" }),
    ]);
    writeState(projectDir, "error");

    const { calls, runLoop } = captureRunLoop();
    const code = await handleResume(makeCtx({ args: [projectDir] }), { runLoop });

    expect(code).toBe(ExitCode.SUCCESS);
    // Genuine block stays blocked; no eligible pending item → no relaunch.
    expect(readBacklogItems(projectDir)["001"]?.status).toBe("blocked");
    expect(calls).toHaveLength(0);
  });
});

describe("handleResume — review pass stopped by a usage limit (#146)", () => {
  function markReviewPending(projectDir: string): void {
    const p = path.join(projectDir, ".rauf", "state.json");
    const state = JSON.parse(fs.readFileSync(p, "utf-8")) as Record<string, unknown>;
    fs.writeFileSync(p, JSON.stringify({ ...state, reviewPending: true }, null, 2) + "\n");
  }

  const cases: Array<[string, object[]]> = [
    ["all items are done", [item("001", "done")]],
    [
      "only genuine blocks remain",
      [item("001", "done"), item("002", "blocked", { blockedReason: "RAUF_BLOCKED: dep" })],
    ],
    ["eligible items remain (review first)", [item("001", "done"), item("002", "pending")]],
  ];
  for (const [label, items] of cases) {
    it(`re-runs the standalone review when ${label}`, async () => {
      const projectDir = createProject(items);
      writeState(projectDir, "paused_usage_limit");
      markReviewPending(projectDir);

      const { calls, runLoop } = captureRunLoop();
      const reviewCalls: CommandContext[] = [];
      const runReview = async (ctx: CommandContext): Promise<number> => {
        reviewCalls.push(ctx);
        return ExitCode.SUCCESS;
      };
      const code = await handleResume(makeCtx({ args: [projectDir] }), { runLoop, runReview });

      expect(code).toBe(ExitCode.SUCCESS);
      expect(calls).toHaveLength(0);
      expect(reviewCalls).toHaveLength(1);
      expect(reviewCalls[0]!.args[0]).toBe(projectDir);
    });
  }

  it("passes the interrupted review's exact scope (reviewItemIds) to the review", async () => {
    const projectDir = createProject([item("001", "done"), item("002", "done")]);
    writeState(projectDir, "paused_usage_limit");
    const p = path.join(projectDir, ".rauf", "state.json");
    const state = JSON.parse(fs.readFileSync(p, "utf-8")) as Record<string, unknown>;
    fs.writeFileSync(
      p,
      JSON.stringify({ ...state, reviewPending: true, reviewItemIds: ["002"] }, null, 2),
    );

    const reviewCalls: CommandContext[] = [];
    await handleResume(makeCtx({ args: [projectDir] }), {
      runLoop: captureRunLoop().runLoop,
      runReview: async (ctx) => {
        reviewCalls.push(ctx);
        return ExitCode.SUCCESS;
      },
    });

    expect(reviewCalls[0]!.flags.get("items")).toBe("002");
  });

  it("failure lifecycle: a failed re-run stays pending and exits non-zero; a later success clears it", async () => {
    const projectDir = createProject([item("001", "done"), item("002", "done")]);
    writeMarker(projectDir, "true");
    writeState(projectDir, "paused_usage_limit");
    const statePath = path.join(projectDir, ".rauf", "state.json");
    const state = JSON.parse(fs.readFileSync(statePath, "utf-8")) as Record<string, unknown>;
    fs.writeFileSync(
      statePath,
      JSON.stringify({ ...state, error: null, reviewPending: true, reviewItemIds: ["002"] }),
    );

    // Mock agent on PATH: records its prompt (stdin), then answers per MOCK_REVIEW_MODE.
    const binDir = path.join(tmpDir, "bin");
    fs.mkdirSync(binDir);
    const argsFile = path.join(tmpDir, "agent-args.txt");
    fs.writeFileSync(
      path.join(binDir, "claude"),
      `#!/bin/bash\ncat >> "${argsFile}"\nif [ "$MOCK_REVIEW_MODE" = ok ]; then echo RAUF_DONE; else echo "no signal here"; fi\n`,
      { mode: 0o755 },
    );
    const origPath = process.env.PATH;
    process.env.PATH = `${binDir}:${origPath}`;
    configureOutput({ noColor: true, quiet: false, json: false });
    const out: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      out.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      process.env.MOCK_REVIEW_MODE = "fail";
      const failCode = await handleResume(makeCtx({ args: [projectDir] }));
      expect(failCode).toBe(ExitCode.ERROR);
      expect(out.join("")).not.toContain("no issues found");
      const afterFail = JSON.parse(fs.readFileSync(statePath, "utf-8"));
      expect(afterFail.reviewPending).toBe(true);
      expect(afterFail.reviewItemIds).toEqual(["002"]);

      // Only the pending scope was reviewed.
      const prompt = fs.readFileSync(argsFile, "utf-8");
      expect(prompt).toContain("Item 002");
      expect(prompt).not.toContain("Item 001");

      process.env.MOCK_REVIEW_MODE = "ok";
      const okCode = await handleResume(makeCtx({ args: [projectDir] }));
      expect(okCode).toBe(ExitCode.SUCCESS);
      const afterOk = JSON.parse(fs.readFileSync(statePath, "utf-8"));
      expect(afterOk.reviewPending).toBeUndefined();
      expect(afterOk.status).toBe("idle");
    } finally {
      process.stdout.write = origWrite;
      process.env.PATH = origPath;
      delete process.env.MOCK_REVIEW_MODE;
    }
  });

  it("restores the pending marker after recovery, before the review runs (#149)", async () => {
    const projectDir = createProject([item("001", "done"), item("002", "pending")]);
    writeState(projectDir, "paused_usage_limit");
    const statePath = path.join(projectDir, ".rauf", "state.json");
    const state = JSON.parse(fs.readFileSync(statePath, "utf-8")) as Record<string, unknown>;
    fs.writeFileSync(
      statePath,
      JSON.stringify({ ...state, reviewPending: true, reviewItemIds: ["001"] }),
    );

    // A review that fails to start (e.g. a live loop took the lock) must leave it pending.
    let seen: Record<string, unknown> | null = null;
    const code = await handleResume(makeCtx({ args: [projectDir] }), {
      runLoop: captureRunLoop().runLoop,
      runReview: async () => {
        seen = JSON.parse(fs.readFileSync(statePath, "utf-8")) as Record<string, unknown>;
        return ExitCode.USAGE;
      },
    });

    expect(code).toBe(ExitCode.USAGE);
    expect(seen).toMatchObject({ status: "idle", reviewPending: true, reviewItemIds: ["001"] });
    const after = JSON.parse(fs.readFileSync(statePath, "utf-8"));
    expect(after.reviewPending).toBe(true);
    expect(after.reviewItemIds).toEqual(["001"]);
  });

  it("hands its lock to the run with no gap a competitor can take (#149)", async () => {
    const projectDir = createProject([item("001", "done"), item("002", "pending")]);
    writeState(projectDir, "paused_usage_limit");
    const resolved = resolveBacklogPaths(projectDir, path.join(projectDir, ".rauf"));
    if (!resolved.ok) throw new Error(resolved.error.message);
    const lockPath = resolved.value.lock;

    // Loop relaunch: at hand-off the lock is still held, flagged for adoption.
    const loopSeen: Array<{ adopt?: boolean; competitor: string | null }> = [];
    await handleResume(makeCtx({ args: [projectDir] }), {
      runLoop: async (ctx) => {
        const r = acquireLock(resolved.value);
        loopSeen.push({ adopt: ctx.adoptLock, competitor: r.ok ? null : r.error.code });
        return ExitCode.SUCCESS;
      },
    });
    expect(loopSeen).toEqual([{ adopt: true, competitor: "LOCK_CONFLICT" }]);
    // A stub that never adopts it: resume releases the lock afterwards.
    expect(fs.existsSync(lockPath)).toBe(false);

    // Review re-run: same.
    const p = resolved.value.state;
    writeState(projectDir, "paused_usage_limit");
    const st = JSON.parse(fs.readFileSync(p, "utf-8")) as Record<string, unknown>;
    fs.writeFileSync(p, JSON.stringify({ ...st, reviewPending: true, reviewItemIds: ["001"] }));
    const reviewSeen: Array<{ adopt?: boolean; competitor: string | null }> = [];
    await handleResume(makeCtx({ args: [projectDir] }), {
      runLoop: captureRunLoop().runLoop,
      runReview: async (ctx) => {
        const r = acquireLock(resolved.value);
        reviewSeen.push({ adopt: ctx.adoptLock, competitor: r.ok ? null : r.error.code });
        return ExitCode.SUCCESS;
      },
    });
    expect(reviewSeen).toEqual([{ adopt: true, competitor: "LOCK_CONFLICT" }]);
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it("forwards --detached through the real loop-run dispatch to the server launch", async () => {
    const projectDir = createProject([item("001", "pending")]);
    writeState(projectDir, "paused_usage_limit");
    const resolved = resolveBacklogPaths(projectDir, path.join(projectDir, ".rauf"));
    if (!resolved.ok) throw new Error(resolved.error.message);
    const forwarded: Array<boolean> = [];
    const detachedCalls: Array<{ adopt?: boolean; locked: boolean }> = [];
    const code = await handleResume(
      makeCtx({ args: [projectDir], flags: new Map([["detached", true]]) }),
      {
        // The REAL handleLoopRun dispatch, with only the server launch stubbed.
        runLoop: (ctx) => {
          forwarded.push(ctx.flags.get("detached") === true);
          return handleLoopRun(ctx, {
            runDetached: async (dctx) => {
              detachedCalls.push({
                adopt: dctx.adoptLock,
                locked: fs.existsSync(resolved.value.lock),
              });
              return ExitCode.SUCCESS;
            },
          });
        },
      },
    );
    expect(code).toBe(ExitCode.SUCCESS);
    expect(forwarded).toEqual([true]);
    // Delegated to the server (not run in the foreground), after resume released
    // its lock: the server process cannot adopt this process's lock.
    expect(detachedCalls).toEqual([{ adopt: undefined, locked: false }]);
  });

  it("accepts the -d short alias for a detached resume", async () => {
    const projectDir = createProject([item("001", "pending")]);
    writeState(projectDir, "paused_usage_limit");
    let detachedRuns = 0;
    const ctx = makeCtx({
      args: [projectDir],
      flags: parseArgs(["resume", projectDir, "-d"]).flags,
    });
    await handleResume(ctx, {
      runLoop: (c) =>
        handleLoopRun(c, {
          runDetached: async () => {
            detachedRuns++;
            return ExitCode.SUCCESS;
          },
        }),
    });
    expect(detachedRuns).toBe(1);
  });

  it("relaunches the loop as usual when no review is pending", async () => {
    const projectDir = createProject([item("001", "done"), item("002", "pending")]);
    writeState(projectDir, "paused_usage_limit");

    const { calls, runLoop } = captureRunLoop();
    let reviewed = 0;
    const code = await handleResume(makeCtx({ args: [projectDir] }), {
      runLoop,
      runReview: async () => {
        reviewed++;
        return ExitCode.SUCCESS;
      },
    });

    expect(code).toBe(ExitCode.SUCCESS);
    expect(calls).toHaveLength(1);
    expect(reviewed).toBe(0);
  });
});

// ─── Interrupted-iteration detection + --recover ───────────────────

describe("detectInterruptedItems", () => {
  it("reports a dirty tree's in_progress item with no baseline commit as interrupted", async () => {
    const projectDir = createProject([item("001", "in_progress"), item("002", "pending")]);
    // Uncommitted work, no [rauf] 001: commit → interrupted iteration.
    fs.writeFileSync(path.join(projectDir, "work.txt"), "half-done\n");

    const resolved = resolveBacklogPaths(projectDir, path.join(projectDir, ".rauf"));
    if (!resolved.ok) throw new Error(resolved.error.message);
    const result = await detectInterruptedItems(resolved.value);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([{ id: "001", title: "Item 001" }]);
    }
  });

  it("reports nothing on a clean tree", async () => {
    const projectDir = createProject([item("001", "in_progress")]);
    const resolved = resolveBacklogPaths(projectDir, path.join(projectDir, ".rauf"));
    if (!resolved.ok) throw new Error(resolved.error.message);
    const result = await detectInterruptedItems(resolved.value);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual([]);
  });
});

describe("handleResume — interrupted iterations", () => {
  it("surfaces interrupted work and does NOT mutate or relaunch without --recover", async () => {
    const projectDir = createProject([item("001", "in_progress"), item("002", "pending")]);
    writeState(projectDir, "error");
    fs.writeFileSync(path.join(projectDir, "work.txt"), "half-done\n");

    const { calls, runLoop } = captureRunLoop();
    const code = await handleResume(makeCtx({ args: [projectDir] }), { runLoop });

    expect(code).toBe(ExitCode.SUCCESS);
    // Default surfaces only: no relaunch, no mutation.
    expect(calls).toHaveLength(0);
    expect(readBacklogItems(projectDir)["001"]?.status).toBe("in_progress");
    expect(fs.existsSync(path.join(projectDir, ".rauf", "state.json"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, "work.txt"))).toBe(true);
  });

  it("--recover re-runs verify and, on green, commits the work and marks it done", async () => {
    const projectDir = createProject([item("001", "in_progress"), item("002", "pending")]);
    writeState(projectDir, "error");
    writeMarker(projectDir, "echo verify-ok");
    fs.writeFileSync(path.join(projectDir, "work.txt"), "verified work\n");

    const verifyCalls: string[] = [];
    const runVerify = async (_cwd: string, command: string) => {
      verifyCalls.push(command);
      return { passed: true, output: "ok" };
    };

    const { calls, runLoop } = captureRunLoop();
    const code = await handleResume(
      makeCtx({ args: [projectDir], flags: new Map([["recover", true]]) }),
      { runLoop, runVerify },
    );

    expect(code).toBe(ExitCode.SUCCESS);
    // Verify command came from the marker profile.
    expect(verifyCalls).toEqual(["echo verify-ok"]);
    // Item committed + marked done; a [rauf] 001: commit landed.
    expect(readBacklogItems(projectDir)["001"]?.status).toBe("done");
    expect(raufCommitSubjects(projectDir, "001")).toContain("[rauf] 001:");
    // 002 still pending → loop relaunches.
    expect(calls).toHaveLength(1);
  });

  it("--recover halts (never executes) an unvalidated dispatcher-guessed command when the stored profile is empty", async () => {
    // Real-world scenario the adversarial review flagged: a stale/empty
    // stored profile.verify falls back to a fresh detectProfile() scan in
    // resolveVerifyCommand(). Before the fix, if a dispatcher script (e.g.
    // this repo's own scripts/verify.sh pattern) was present, that fallback
    // would guess a `bash scripts/verify.sh <subcommand>` command and
    // EXECUTE it here to decide whether to auto-commit interrupted work —
    // even though the guessed subcommand names were never validated against
    // what the script actually supports. A script that exits 0 for ANY
    // subcommand (a common shell-script default) would then get interrupted,
    // unverified work silently auto-committed as "verified".
    const projectDir = createProject([item("001", "in_progress")]);
    writeState(projectDir, "error");
    writeMarker(projectDir, ""); // empty stored verify → resolveVerifyCommand falls back to detectProfile()
    fs.mkdirSync(path.join(projectDir, "scripts"), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, "scripts", "verify.sh"),
      "#!/usr/bin/env bash\nexit 0\n", // exits 0 for literally any argument
    );
    fs.writeFileSync(path.join(projectDir, "work.txt"), "unverified work\n");

    const verifyCalls: string[] = [];
    const runVerify = async (_cwd: string, command: string) => {
      verifyCalls.push(command);
      return { passed: true, output: "ok" }; // would report "passed" if it were ever run
    };

    const { calls, runLoop } = captureRunLoop();
    const code = await handleResume(
      makeCtx({ args: [projectDir], flags: new Map([["recover", true]]) }),
      { runLoop, runVerify },
    );

    // Same halt behavior as "no verify command configured" — before dispatcher
    // guessing existed, an empty profile with no verify command deterministically
    // halted recovery this way. Fix 1 restores that behavior for this specific
    // path instead of substituting an unvalidated guess.
    expect(code).toBe(ExitCode.ERROR);
    expect(verifyCalls).toEqual([]); // the guessed command was NEVER executed
    expect(readBacklogItems(projectDir)["001"]?.status).toBe("in_progress");
    expect(fs.existsSync(path.join(projectDir, "work.txt"))).toBe(true);
    expect(raufCommitSubjects(projectDir, "001")).toBe("");
    expect(calls).toHaveLength(0); // no relaunch
  });

  it("--recover leaves the work untouched and reports when re-verify fails", async () => {
    const projectDir = createProject([item("001", "in_progress")]);
    writeState(projectDir, "error");
    writeMarker(projectDir, "exit 1");
    fs.writeFileSync(path.join(projectDir, "work.txt"), "broken work\n");

    const runVerify = async () => ({ passed: false, output: "FAIL" });

    const { calls, runLoop } = captureRunLoop();
    const code = await handleResume(
      makeCtx({ args: [projectDir], flags: new Map([["recover", true]]) }),
      { runLoop, runVerify },
    );

    expect(code).toBe(ExitCode.ERROR);
    // Work left untouched: item stays in_progress, no commit, nothing relaunched.
    expect(readBacklogItems(projectDir)["001"]?.status).toBe("in_progress");
    expect(fs.existsSync(path.join(projectDir, "work.txt"))).toBe(true);
    expect(raufCommitSubjects(projectDir, "001")).toBe("");
    expect(calls).toHaveLength(0);
  });
});

// ─── --answer parsing ──────────────────────────────────────────────

describe("parseAnswerFlags", () => {
  it("parses a single --answer <id> <text> pair", () => {
    const argv = ["resume", ".", "--answer", "003", "use schema v5"];
    expect(parseAnswerFlags(argv)).toEqual([{ itemId: "003", text: "use schema v5" }]);
  });

  it("parses multiple repeated --answer pairs in order", () => {
    const argv = ["resume", "--answer", "003", "answer A", "--answer", "004", "answer B"];
    expect(parseAnswerFlags(argv)).toEqual([
      { itemId: "003", text: "answer A" },
      { itemId: "004", text: "answer B" },
    ]);
  });

  it("skips a malformed --answer with a missing item ID or text", () => {
    expect(parseAnswerFlags(["resume", "--answer"])).toEqual([]);
    expect(parseAnswerFlags(["resume", "--answer", "003"])).toEqual([]);
    expect(parseAnswerFlags(["resume", "--answer", "--force", "x"])).toEqual([]);
  });

  it("returns an empty array when no --answer is present", () => {
    expect(parseAnswerFlags(["resume", ".", "--force"])).toEqual([]);
  });
});

describe("resolveResumeTargetPath", () => {
  it("defaults to '.' for the no-path --answer form (answer text not read as path)", () => {
    // Generic parser consumes "003" as the --answer value and leaks the text into args.
    const ctx = makeCtx({
      args: ["use schema v5"],
      rawArgv: ["resume", "--answer", "003", "use schema v5"],
    });
    expect(resolveResumeTargetPath(ctx)).toBe(".");
  });

  it("uses an explicit path even when --answer is present", () => {
    const ctx = makeCtx({
      args: ["/proj", "use schema v5"],
      rawArgv: ["resume", "/proj", "--answer", "003", "use schema v5"],
    });
    expect(resolveResumeTargetPath(ctx)).toBe("/proj");
  });

  it("excludes operands from multiple --answer pairs", () => {
    const ctx = makeCtx({
      args: ["/proj", "answer A", "answer B"],
      rawArgv: ["resume", "/proj", "--answer", "003", "answer A", "--answer", "004", "answer B"],
    });
    expect(resolveResumeTargetPath(ctx)).toBe("/proj");
  });

  it("returns the explicit path with no --answer", () => {
    expect(
      resolveResumeTargetPath(makeCtx({ args: ["/proj"], rawArgv: ["resume", "/proj"] })),
    ).toBe("/proj");
  });

  it("defaults to '.' with no args", () => {
    expect(resolveResumeTargetPath(makeCtx())).toBe(".");
  });
});

// ─── resume --answer mutation ──────────────────────────────────────

/** Read full item records (incl. humanAnswer / needsHuman) from a project. */
function readFullItems(
  projectDir: string,
): Record<string, { status: string; humanAnswer?: string; needsHuman?: boolean }> {
  const raw = fs.readFileSync(path.join(projectDir, ".rauf", "backlog.json"), "utf-8");
  const parsed = JSON.parse(raw) as {
    items: { id: string; status: string; humanAnswer?: string; needsHuman?: boolean }[];
  };
  const map: Record<string, { status: string; humanAnswer?: string; needsHuman?: boolean }> = {};
  for (const i of parsed.items)
    map[i.id] = { status: i.status, humanAnswer: i.humanAnswer, needsHuman: i.needsHuman };
  return map;
}

describe("handleResume — --answer injection", () => {
  it("re-queues a paused-human item to pending with humanAnswer set and needsHuman cleared", async () => {
    const projectDir = createProject([
      item("003", "blocked", { needsHuman: true, blockedReason: "schema version unclear" }),
    ]);
    writeState(projectDir, "paused_human");

    const { calls, runLoop } = captureRunLoop();
    const code = await handleResume(
      makeCtx({
        args: [projectDir],
        rawArgv: ["resume", projectDir, "--answer", "003", "use schema v5"],
      }),
      { runLoop },
    );

    expect(code).toBe(ExitCode.SUCCESS);
    const items = readFullItems(projectDir);
    expect(items["003"]?.status).toBe("pending");
    expect(items["003"]?.humanAnswer).toBe("use schema v5");
    expect(items["003"]?.needsHuman).toBe(false);
    // A pending item remains → the loop relaunches.
    expect(calls).toHaveLength(1);
  });
});

describe("handleResume — allow-dirty-for-item owner detection (#115)", () => {
  it("threads the needs-human owner (not the answered item) so the relaunch prefers it", async () => {
    // 003 is the set-aside needs-human item that owns the dirty tree; 001 is an
    // ordinary, higher-priority pending item that would otherwise be selected
    // first. The owner is detected from backlog state — threaded here with no
    // --answer at all, proving it does not come from the answer operand.
    const projectDir = createProject([
      item("001", "pending", { priority: 1 }),
      item("003", "blocked", { needsHuman: true, blockedReason: "which approach?" }),
    ]);
    writeState(projectDir, "paused_human");

    const { calls, runLoop } = captureRunLoop();
    const code = await handleResume(makeCtx({ args: [projectDir] }), { runLoop });

    expect(code).toBe(ExitCode.SUCCESS);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.flags.get("allow-dirty")).toBe(true);
    expect(calls[0]!.flags.get("allow-dirty-for-item")).toBe("003");
  });

  it("leaves allow-dirty-for-item unset when the owner is ambiguous (several needs-human items)", async () => {
    const projectDir = createProject([
      item("001", "pending"),
      item("002", "blocked", { needsHuman: true }),
      item("003", "blocked", { needsHuman: true }),
    ]);
    writeState(projectDir, "paused_human");

    const { calls, runLoop } = captureRunLoop();
    const code = await handleResume(makeCtx({ args: [projectDir] }), { runLoop });

    expect(code).toBe(ExitCode.SUCCESS);
    expect(calls).toHaveLength(1);
    // Ambiguous owner → fall back to the order-based exemption (#109), unchanged.
    expect(calls[0]!.flags.get("allow-dirty")).toBe(true);
    expect(calls[0]!.flags.has("allow-dirty-for-item")).toBe(false);
  });
});
