import { describe, it, expect } from "vitest";
import { VERSION } from "@ralph/core";
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
    expect(output.stdout).toContain(`ralph v${VERSION}`);
  });

  it("prints version with -V", async () => {
    const output = await withArgv(["-V"], async () => {
      const code = await runCli();
      expect(code).toBe(0);
    });
    expect(output.stdout).toContain(`ralph v${VERSION}`);
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
