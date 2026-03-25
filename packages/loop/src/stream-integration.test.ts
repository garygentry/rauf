import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LoopEvent, Backlog, LoopStartOptions } from "@ralph/core";
import { readIterationStatus, defaultBacklogPaths } from "@ralph/core";

import { LoopRunner } from "./runner.js";

// ─── Test Helpers ────────────────────────────────────────────────────

function createTmpDir(): string {
  return fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "ralph-stream-"));
}

function setupProject(tmpDir: string, items: Backlog["items"]) {
  const ralphDir = path.join(tmpDir, ".ralph");
  fs.mkdirSync(ralphDir, { recursive: true });

  const backlog: Backlog = {
    project: "test-project",
    description: "Test project",
    items,
  };
  fs.writeFileSync(path.join(ralphDir, "backlog.json"), JSON.stringify(backlog, null, 2));
  fs.writeFileSync(path.join(ralphDir, "RALPH.md"), "# Test RALPH.md\nVerification: pnpm test\n");

  const marker = {
    ralph: true,
    version: "0.1.0",
    variant: "backlog-json",
    installedAt: new Date().toISOString(),
    installedBy: "test",
    profile: {
      stack: "node-typescript",
      packageManager: "pnpm",
      monorepo: false,
      commands: { test: "pnpm test", typecheck: "pnpm typecheck", lint: "pnpm lint", format: null, build: null },
      verify: "pnpm test && pnpm typecheck && pnpm lint",
    },
    artifactHashes: {},
    options: { ignoreInTool: false, gitignoreScripts: false, maxIterations: 20 },
  };
  fs.writeFileSync(path.join(tmpDir, ".ralph.json"), JSON.stringify(marker, null, 2));

  // git init for gitCommit to work — uses only static commands, no user input
  try {
    execSync("git init", { cwd: tmpDir, stdio: "ignore" });
    execSync('git config user.email "test@test.com"', { cwd: tmpDir, stdio: "ignore" });
    execSync('git config user.name "Test"', { cwd: tmpDir, stdio: "ignore" });
    execSync("git add -A && git commit -m 'init' --allow-empty", { cwd: tmpDir, stdio: "ignore" });
  } catch {
    // git init may fail in some environments
  }
}

function pendingItem(
  id: string,
  title: string,
  overrides?: Partial<Backlog["items"][0]>,
): Backlog["items"][0] {
  return {
    id,
    type: "feature",
    priority: 1,
    title,
    description: `Description for ${title}`,
    acceptanceCriteria: ["Tests pass"],
    status: "pending",
    completedAt: null,
    ...overrides,
  };
}

const DEFAULT_OPTIONS: LoopStartOptions = {
  maxIterations: 10,
  maxRetries: 2,
  sessionTimeoutMinutes: 5,
};

/**
 * Write a mock `claude` bash script that emits valid NDJSON
 * matching Claude CLI `--output-format stream-json`.
 */
function writeMockClaudeNDJSON(
  binDir: string,
  options: {
    tools?: Array<{ name: string }>;
    textChunks?: string[];
    inputTokens?: number;
    outputTokens?: number;
    exitCode?: number;
    sleepBetweenLines?: number;
  } = {},
): void {
  const {
    tools = [],
    textChunks = ["RALPH_DONE"],
    inputTokens = 10000,
    outputTokens = 1500,
    exitCode = 0,
    sleepBetweenLines,
  } = options;

  const lines: string[] = [];
  lines.push("#!/bin/bash");
  lines.push("cat > /dev/null"); // consume stdin prompt

  const sleep = sleepBetweenLines ? `sleep ${sleepBetweenLines}` : "";

  // message_start with input_tokens
  lines.push(
    `echo '{"type":"message_start","message":{"usage":{"input_tokens":${inputTokens}}}}'`,
  );
  if (sleep) lines.push(sleep);

  let blockIndex = 0;

  // Text chunks — each chunk gets its own content block
  for (const chunk of textChunks) {
    lines.push(
      `echo '{"type":"content_block_start","index":${blockIndex},"content_block":{"type":"text"}}'`,
    );
    // Escape single quotes for bash (text chunks are pre-formatted for JSON embedding)
    const escaped = chunk.replace(/'/g, "'\"'\"'");
    lines.push(
      `echo '{"type":"content_block_delta","index":${blockIndex},"delta":{"type":"text_delta","text":"${escaped}"}}'`,
    );
    lines.push(`echo '{"type":"content_block_stop","index":${blockIndex}}'`);
    if (sleep) lines.push(sleep);
    blockIndex++;
  }

  // Tool blocks
  for (const tool of tools) {
    lines.push(
      `echo '{"type":"content_block_start","index":${blockIndex},"content_block":{"type":"tool_use","name":"${tool.name}"}}'`,
    );
    if (sleep) lines.push(sleep);
    lines.push(`echo '{"type":"content_block_stop","index":${blockIndex}}'`);
    blockIndex++;
  }

  // message_delta with output_tokens
  lines.push(`echo '{"type":"message_delta","usage":{"output_tokens":${outputTokens}}}'`);
  if (sleep) lines.push(sleep);

  // message_stop
  lines.push(`echo '{"type":"message_stop"}'`);
  lines.push(`exit ${exitCode}`);

  const mockPath = path.join(binDir, "claude");
  fs.writeFileSync(mockPath, lines.join("\n") + "\n", { mode: 0o755 });
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("Stream Integration (NDJSON pipeline)", () => {
  let tmpDir: string;
  let binDir: string;
  let origPath: string;

  beforeEach(() => {
    tmpDir = createTmpDir();
    binDir = createTmpDir();
    origPath = process.env.PATH ?? "";
    process.env.PATH = `${binDir}:${origPath}`;
  });

  afterEach(() => {
    process.env.PATH = origPath;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(binDir, { recursive: true, force: true });
  });

  it("1: RALPH_DONE via reconstructed text", async () => {
    setupProject(tmpDir, [pendingItem("001", "Stream task")]);
    writeMockClaudeNDJSON(binDir, { textChunks: ["RALPH_DONE"] });

    const events: LoopEvent[] = [];
    const runner = new LoopRunner(tmpDir, DEFAULT_OPTIONS);
    runner.on("signal_parsed", (e) => events.push(e));
    runner.on("item_completed", (e) => events.push(e));

    const result = await runner.start();

    expect(result.completedCount).toBe(1);

    const signalEvent = events.find((e) => e.type === "signal_parsed") as Extract<
      LoopEvent,
      { type: "signal_parsed" }
    >;
    expect(signalEvent).toBeDefined();
    expect(signalEvent.signal).toBe("done");
  });

  it("2: Tool activity events emitted", async () => {
    setupProject(tmpDir, [pendingItem("001", "Tool task")]);
    writeMockClaudeNDJSON(binDir, {
      textChunks: ["RALPH_DONE"],
      tools: [{ name: "Read" }, { name: "Edit" }, { name: "Bash" }],
    });

    const events: LoopEvent[] = [];
    const runner = new LoopRunner(tmpDir, DEFAULT_OPTIONS);
    runner.on("llm_tool_activity", (e) => events.push(e));

    await runner.start();

    const startEvents = events.filter(
      (e) => e.type === "llm_tool_activity" && (e as Extract<LoopEvent, { type: "llm_tool_activity" }>).phase === "start",
    );
    const endEvents = events.filter(
      (e) => e.type === "llm_tool_activity" && (e as Extract<LoopEvent, { type: "llm_tool_activity" }>).phase === "end",
    );

    expect(startEvents).toHaveLength(3);
    expect(endEvents).toHaveLength(3);

    const toolNames = startEvents.map(
      (e) => (e as Extract<LoopEvent, { type: "llm_tool_activity" }>).toolName,
    );
    expect(toolNames).toEqual(["Read", "Edit", "Bash"]);
  });

  it("3: Token update events", async () => {
    setupProject(tmpDir, [pendingItem("001", "Token task")]);
    writeMockClaudeNDJSON(binDir, {
      textChunks: ["RALPH_DONE"],
      inputTokens: 25000,
      outputTokens: 3000,
    });

    const events: LoopEvent[] = [];
    const runner = new LoopRunner(tmpDir, DEFAULT_OPTIONS);
    runner.on("llm_token_update", (e) => events.push(e));

    await runner.start();

    expect(events.length).toBeGreaterThanOrEqual(1);
    const tokenEvent = events[0] as Extract<LoopEvent, { type: "llm_token_update" }>;
    // The first token event comes from message_start with input_tokens only
    expect(tokenEvent.inputTokens).toBe(25000);
  });

  it("4: iteration-status.json lifecycle", async () => {
    setupProject(tmpDir, [pendingItem("001", "Status task")]);
    writeMockClaudeNDJSON(binDir, {
      textChunks: ["RALPH_DONE"],
      tools: [{ name: "Read" }],
    });

    let midRunStatus: ReturnType<typeof readIterationStatus> = null;
    const runner = new LoopRunner(tmpDir, DEFAULT_OPTIONS);
    runner.on("llm_tool_activity", () => {
      if (!midRunStatus) {
        midRunStatus = readIterationStatus(defaultBacklogPaths(tmpDir));
      }
    });

    await runner.start();

    // Mid-run: status file existed with correct itemId
    expect(midRunStatus).not.toBeNull();
    expect(midRunStatus!.itemId).toBe("001");

    // After completion: status file cleared
    expect(readIterationStatus(defaultBacklogPaths(tmpDir))).toBeNull();
  });

  it("5: RALPH_BLOCKED via reconstructed text", async () => {
    setupProject(tmpDir, [pendingItem("001", "Blocked task")]);
    writeMockClaudeNDJSON(binDir, {
      textChunks: ["Cannot proceed.\\n\\nRALPH_BLOCKED:Missing API key"],
    });

    const events: LoopEvent[] = [];
    const runner = new LoopRunner(tmpDir, DEFAULT_OPTIONS);
    runner.on("item_blocked", (e) => events.push(e));

    const result = await runner.start();

    expect(result.blockedCount).toBe(1);
    const blockedEvent = events.find((e) => e.type === "item_blocked") as Extract<
      LoopEvent,
      { type: "item_blocked" }
    >;
    expect(blockedEvent).toBeDefined();
    expect(blockedEvent.reason).toBe("Missing API key");
  });

  it("6: Multi-chunk text reconstruction", async () => {
    setupProject(tmpDir, [pendingItem("001", "Multi-chunk task")]);
    writeMockClaudeNDJSON(binDir, {
      textChunks: ["Let me ", "work.\\n\\n", "RALPH_DONE"],
    });

    const result = await new LoopRunner(tmpDir, DEFAULT_OPTIONS).start();

    expect(result.completedCount).toBe(1);
  });

  it("7: Mixed text + tool ordering", async () => {
    setupProject(tmpDir, [pendingItem("001", "Mixed task")]);

    // Custom script for interleaved text → tool → tool → text ordering
    const binPath = path.join(binDir, "claude");
    const script = `#!/bin/bash
cat > /dev/null
echo '{"type":"message_start","message":{"usage":{"input_tokens":10000}}}'
echo '{"type":"content_block_start","index":0,"content_block":{"type":"text"}}'
echo '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Analyzing..."}}'
echo '{"type":"content_block_stop","index":0}'
echo '{"type":"content_block_start","index":1,"content_block":{"type":"tool_use","name":"Read"}}'
echo '{"type":"content_block_stop","index":1}'
echo '{"type":"content_block_start","index":2,"content_block":{"type":"tool_use","name":"Edit"}}'
echo '{"type":"content_block_stop","index":2}'
echo '{"type":"content_block_start","index":3,"content_block":{"type":"text"}}'
echo '{"type":"content_block_delta","index":3,"delta":{"type":"text_delta","text":"All done.\\n\\nRALPH_DONE"}}'
echo '{"type":"content_block_stop","index":3}'
echo '{"type":"message_delta","usage":{"output_tokens":2000}}'
echo '{"type":"message_stop"}'
exit 0
`;
    fs.writeFileSync(binPath, script, { mode: 0o755 });

    const events: LoopEvent[] = [];
    const runner = new LoopRunner(tmpDir, DEFAULT_OPTIONS);
    runner.on("llm_tool_activity", (e) => events.push(e));
    runner.on("item_completed", (e) => events.push(e));

    const result = await runner.start();

    expect(result.completedCount).toBe(1);

    // Tool events: start(Read), end, start(Edit), end
    const toolStarts = events.filter(
      (e) =>
        e.type === "llm_tool_activity" &&
        (e as Extract<LoopEvent, { type: "llm_tool_activity" }>).phase === "start",
    );
    expect(toolStarts).toHaveLength(2);
    expect(
      (toolStarts[0] as Extract<LoopEvent, { type: "llm_tool_activity" }>).toolName,
    ).toBe("Read");
    expect(
      (toolStarts[1] as Extract<LoopEvent, { type: "llm_tool_activity" }>).toolName,
    ).toBe("Edit");

    // Completion event came after tools
    const completedIdx = events.findIndex((e) => e.type === "item_completed");
    const lastToolIdx = events.length - 1 - [...events].reverse().findIndex((e) => e.type === "llm_tool_activity");
    expect(completedIdx).toBeGreaterThan(lastToolIdx);
  });
});
