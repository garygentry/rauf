import { describe, it, expect } from "vitest";
import { VERSION } from "@rauf/core";
import { runCli } from "./main.js";

// Helper to capture stdout and mock argv
function withArgv(
  args: string[],
  fn: () => Promise<void>,
): Promise<{ stdout: string; stderr: string }> {
  const origArgv = process.argv;
  process.argv = ["node", "rauf", ...args];

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

  return fn().then(() => {
    process.argv = origArgv;
    process.stdout.write = origStdout;
    process.stderr.write = origStderr;
    return { stdout: stdout.join(""), stderr: stderr.join("") };
  });
}

describe("--version flag", () => {
  it("prints version with --version", async () => {
    const output = await withArgv(["--version"], async () => {
      const code = await runCli();
      expect(code).toBe(0);
    });
    expect(output.stdout).toContain(`rauf v${VERSION}`);
  });

  it("prints version with -V", async () => {
    const output = await withArgv(["-V"], async () => {
      const code = await runCli();
      expect(code).toBe(0);
    });
    expect(output.stdout).toContain(`rauf v${VERSION}`);
  });

  it("outputs JSON with --version --json", async () => {
    const output = await withArgv(["--version", "--json"], async () => {
      const code = await runCli();
      expect(code).toBe(0);
    });
    const parsed = JSON.parse(output.stdout);
    expect(parsed).toEqual({ version: VERSION });
  });
});

describe("removed-command remediation (REQ-RMV-01 / 00 §5)", () => {
  it("`loop start` exits USAGE(2) with the targeted message", async () => {
    const output = await withArgv(["loop", "start"], async () => {
      const code = await runCli();
      expect(code).toBe(2);
    });
    const combined = output.stdout + output.stderr;
    expect(combined).toContain("`loop start` was removed in v0.5.0");
    expect(combined).toContain("loop run --detached");
    expect(combined).toContain("-d");
  });

  it("`loop start` with extra args still exits USAGE(2) and executes nothing", async () => {
    const output = await withArgv(["loop", "start", ".", "--follow"], async () => {
      const code = await runCli();
      expect(code).toBe(2);
    });
    const combined = output.stdout + output.stderr;
    expect(combined).toContain("`loop start` was removed in v0.5.0");
    // No server side effects
    expect(combined).not.toContain("Starting daemon");
    expect(combined).not.toContain("Loop started");
  });

  it("remediation message for `loop start` fires before the generic unknown-subcommand error", async () => {
    const output = await withArgv(["loop", "start"], async () => {
      await runCli();
    });
    const combined = output.stdout + output.stderr;
    // The targeted message must appear; the generic "Unknown subcommand" must not
    expect(combined).toContain("`loop start` was removed");
    expect(combined).not.toContain("Unknown subcommand");
  });

  it("`--watch` on a command exits USAGE(2) with the targeted message", async () => {
    const output = await withArgv(["status", "--watch", "."], async () => {
      const code = await runCli();
      expect(code).toBe(2);
    });
    const combined = output.stdout + output.stderr;
    expect(combined).toContain("`--watch` was removed in v0.5.0");
    expect(combined).toContain("--follow");
    expect(combined).toContain("-f");
  });

  it("`--watch` fires before any handler runs (executes nothing)", async () => {
    const output = await withArgv(["loop", "run", "--watch"], async () => {
      const code = await runCli();
      expect(code).toBe(2);
    });
    const combined = output.stdout + output.stderr;
    expect(combined).toContain("`--watch` was removed in v0.5.0");
    expect(combined).not.toContain("Starting daemon");
    expect(combined).not.toContain("Loop started");
  });
});

describe("--help interception (item 023)", () => {
  it("`loop run --help` prints help and does NOT run the loop or daemon", async () => {
    const output = await withArgv(["loop", "run", "--help"], async () => {
      const code = await runCli();
      expect(code).toBe(0);
    });
    // Help was rendered…
    expect(output.stdout).toContain("Usage:");
    expect(output.stdout).toContain("--iterations");
    // …and no loop/daemon side effect fired.
    const combined = output.stdout + output.stderr;
    expect(combined).not.toContain("Starting daemon");
    expect(combined).not.toContain("Server not running");
    expect(combined).not.toContain("Loop started");
  });

  it("`loop run -h` is intercepted the same as --help", async () => {
    const output = await withArgv(["loop", "run", "-h"], async () => {
      const code = await runCli();
      expect(code).toBe(0);
    });
    expect(output.stdout).toContain("Usage:");
    expect(output.stdout).toContain("--iterations");
    const combined = output.stdout + output.stderr;
    expect(combined).not.toContain("Starting daemon");
    expect(combined).not.toContain("Server not running");
  });

  it("`loop run --help` prints the flag list and does not run", async () => {
    const output = await withArgv(["loop", "run", "--help"], async () => {
      const code = await runCli();
      expect(code).toBe(0);
    });
    expect(output.stdout).toContain("Usage:");
    expect(output.stdout).toContain("--iterations");
    expect(output.stdout).toContain("--retries");
    expect(output.stdout).toContain("--timeout");
    expect(output.stdout).toContain("--model");
    expect(output.stdout).toContain("--backlog");
    expect(output.stdout).toContain("--force");
  });
});
