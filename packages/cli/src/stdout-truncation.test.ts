// ─── Stdout Truncation Regression Test (#81, #82) ──────────────────
//
// `rauf --json` output silently truncated at exactly 65,536 bytes (the
// Linux pipe buffer size) whenever stdout was a real OS pipe. Root cause:
// both CLI entry points (scripts/binary-entry.ts, packages/cli/src/index.ts)
// called `process.exit(code)` immediately after `runCli()` resolved, which
// terminates the process synchronously — discarding any stdout writes still
// queued past the pipe buffer, since pipe writes are asynchronous (writes to
// files/TTYs are synchronous, so those were unaffected). The fix replaces
// `process.exit(code)` with `process.exitCode = code` in both entry points,
// letting the event loop drain queued writes before the process exits
// naturally.
//
// This bug is specific to real OS pipe backpressure — it does not reproduce
// via in-process function calls or vitest mocks, so this test spawns the
// actual `packages/cli/src/index.ts` entry point as a subprocess and pipes
// its stdout through a deliberately slow reader (`sleep 1; cat`) so the
// pipe buffer genuinely fills before anything drains, exactly reproducing
// the conditions that used to truncate the output.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as child_process from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_ENTRY = path.join(__dirname, "index.ts");

/** Item count large enough to push pretty-printed --json output well past 64 KiB. */
const ITEM_COUNT = 300;

/** Single-quote a path for safe interpolation into a `bash -c` command string. */
function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rauf-cli-stdout-trunc-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Create a project dir with a `.rauf/backlog.json` large enough to exceed 64 KiB as JSON. */
function createLargeBacklog(projectDir: string, itemCount: number): void {
  const raufDir = path.join(projectDir, ".rauf");
  fs.mkdirSync(raufDir, { recursive: true });

  const padding = "x".repeat(200);
  const items = Array.from({ length: itemCount }, (_, i) => ({
    id: `item-${i}`,
    type: "feature",
    priority: 1,
    title: `Backlog item number ${i}`,
    description: `Description padding for item ${i}: ${padding}`,
    status: "pending",
    completedAt: null,
    acceptanceCriteria: [`Criterion A for item ${i}`, `Criterion B for item ${i}`],
  }));

  const backlog = {
    project: "stdout-truncation-fixture",
    description: "Fixture project for the #81/#82 stdout truncation regression test",
    items,
  };

  fs.writeFileSync(path.join(raufDir, "backlog.json"), JSON.stringify(backlog, null, 2));
}

describe("stdout truncation on piped output (#81, #82)", () => {
  it("delivers `rauf backlog list --json` output larger than the 64 KiB pipe buffer intact", () => {
    createLargeBacklog(tmpDir, ITEM_COUNT);

    const outFile = path.join(tmpDir, "stdout.json");
    // `sleep 1; cat` deliberately delays draining the pipe so the OS pipe
    // buffer (64 KiB on Linux) genuinely fills before anything reads it —
    // the exact condition that exposed the truncation bug. Reading the
    // captured output from a file (rather than a Node stream) avoids any
    // reader-side timing quirks of the test harness itself.
    const cmd = `bun ${shQuote(CLI_ENTRY)} backlog list ${shQuote(tmpDir)} --json | (sleep 1; cat) > ${shQuote(outFile)}`;

    const result = child_process.spawnSync("bash", ["-c", cmd], {
      encoding: "utf-8",
      timeout: 20_000,
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);

    const output = fs.readFileSync(outFile, "utf-8");
    // Sanity check that this test actually exercises the pipe-buffer boundary.
    expect(output.length).toBeGreaterThan(65_536);

    // The regression: truncated output is not valid JSON. With the fix,
    // the full payload arrives intact regardless of the pipe buffer size.
    const parsed = JSON.parse(output) as unknown[];
    expect(parsed).toHaveLength(ITEM_COUNT);
  }, 20_000);
});
