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

describe("--help interception (item 023)", () => {
  it("`loop start --help` prints help and does NOT start the loop or daemon", async () => {
    const output = await withArgv(["loop", "start", "--help"], async () => {
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

  it("`loop start -h` is intercepted the same as --help", async () => {
    const output = await withArgv(["loop", "start", "-h"], async () => {
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
