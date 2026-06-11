import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { spawnClaude } from "./claude-process.js";

// We test spawnClaude by replacing the "claude" binary with a small
// shell script that echoes args, stdin, and controls exit behavior.
// To do this, we create a temp directory with a mock "claude" script and
// prepend it to PATH.

describe("spawnClaude", () => {
  let tmpDir: string;
  let origPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "ralph-claude-proc-"));
    origPath = process.env.PATH ?? "";
    // Prepend tmpDir to PATH so our mock "claude" is found first
    process.env.PATH = `${tmpDir}:${origPath}`;
  });

  afterEach(() => {
    process.env.PATH = origPath;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeMockClaude(script: string) {
    const mockPath = path.join(tmpDir, "claude");
    fs.writeFileSync(mockPath, `#!/bin/bash\n${script}\n`, { mode: 0o755 });
  }

  describe("flag passing", () => {
    it("passes -p, --dangerously-skip-permissions, and --output-format text", async () => {
      // Script that outputs all arguments to stdout
      writeMockClaude('echo "$@"');

      const result = await spawnClaude("test prompt", {
        sessionTimeoutMinutes: 1,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const stdout = result.value.stdout.trim();
      expect(stdout).toContain("-p");
      expect(stdout).toContain("--dangerously-skip-permissions");
      expect(stdout).toContain("--output-format text");
    });

    it("passes --model flag when model is specified", async () => {
      writeMockClaude('echo "$@"');

      const result = await spawnClaude("test prompt", {
        sessionTimeoutMinutes: 1,
        model: "claude-sonnet-4-6",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const stdout = result.value.stdout.trim();
      expect(stdout).toContain("--model claude-sonnet-4-6");
    });

    it("does not pass --model flag when model is not specified", async () => {
      writeMockClaude('echo "$@"');

      const result = await spawnClaude("test prompt", {
        sessionTimeoutMinutes: 1,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.stdout).not.toContain("--model");
    });
  });

  describe("env overrides", () => {
    it("passes env overrides to the child process", async () => {
      writeMockClaude('echo "$RAUF_TEST_ENV"');

      const result = await spawnClaude("test", {
        sessionTimeoutMinutes: 1,
        env: { RAUF_TEST_ENV: "suppressed" },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.stdout.trim()).toBe("suppressed");
    });

    it("still inherits the parent environment when overrides are given", async () => {
      writeMockClaude('echo "$PATH"');
      // PATH is set by the test harness; the child should still see it even
      // though we only override an unrelated var.
      const result = await spawnClaude("test", {
        sessionTimeoutMinutes: 1,
        env: { RAUF_TEST_ENV: "x" },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.stdout.trim().length).toBeGreaterThan(0);
    });

    it("does not set the override when env is omitted", async () => {
      writeMockClaude('echo "[$RAUF_TEST_ENV]"');

      const result = await spawnClaude("test", {
        sessionTimeoutMinutes: 1,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.stdout.trim()).toBe("[]");
    });
  });

  describe("stdin/stdout/stderr capture", () => {
    it("pipes prompt via stdin", async () => {
      // Script that reads stdin and echoes it to stdout
      writeMockClaude("cat");

      const result = await spawnClaude("hello from stdin", {
        sessionTimeoutMinutes: 1,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.stdout).toBe("hello from stdin");
    });

    it("captures stdout and stderr separately", async () => {
      writeMockClaude('echo "stdout output"\necho "stderr output" >&2');

      const result = await spawnClaude("test", {
        sessionTimeoutMinutes: 1,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.stdout.trim()).toBe("stdout output");
      expect(result.value.stderr.trim()).toBe("stderr output");
    });

    it("handles empty output", async () => {
      writeMockClaude("exit 0");

      const result = await spawnClaude("test", {
        sessionTimeoutMinutes: 1,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.stdout).toBe("");
      expect(result.value.stderr).toBe("");
    });
  });

  describe("exit code and timing", () => {
    it("returns exit code 0 on success", async () => {
      writeMockClaude("exit 0");

      const result = await spawnClaude("test", {
        sessionTimeoutMinutes: 1,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.exitCode).toBe(0);
      expect(result.value.timedOut).toBe(false);
    });

    it("returns non-zero exit code on failure", async () => {
      writeMockClaude("exit 42");

      const result = await spawnClaude("test", {
        sessionTimeoutMinutes: 1,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.exitCode).toBe(42);
      expect(result.value.timedOut).toBe(false);
    });

    it("measures durationMs accurately", async () => {
      writeMockClaude("sleep 0.1");

      const start = Date.now();
      const result = await spawnClaude("test", {
        sessionTimeoutMinutes: 1,
      });
      const elapsed = Date.now() - start;

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // durationMs should be close to elapsed time
      expect(result.value.durationMs).toBeGreaterThanOrEqual(50);
      expect(result.value.durationMs).toBeLessThan(elapsed + 100);
    });
  });

  describe("timeout", () => {
    it("kills process after sessionTimeoutMinutes", async () => {
      // Use 'exec sleep' so sleep replaces bash — SIGTERM reaches it directly
      writeMockClaude("exec sleep 999");

      const result = await spawnClaude("test", {
        // Use a very short timeout for testing (~1 second)
        sessionTimeoutMinutes: 1 / 60,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.timedOut).toBe(true);
      // Process should have been terminated
      expect(result.value.exitCode).not.toBe(0);
    }, 15_000);

    it("sets timedOut to false when process completes before timeout", async () => {
      writeMockClaude("exit 0");

      const result = await spawnClaude("test", {
        sessionTimeoutMinutes: 5,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.timedOut).toBe(false);
    });
  });

  describe("spawn failure", () => {
    it("returns err when command is not found", async () => {
      // Remove our mock claude and set PATH to empty dir
      fs.rmSync(path.join(tmpDir, "claude"), { force: true });
      process.env.PATH = tmpDir;

      const result = await spawnClaude("test", {
        sessionTimeoutMinutes: 1,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("FILE_NOT_FOUND");
      expect(result.error.message).toContain("spawn claude");
    });
  });

  describe("AbortController signal", () => {
    it("kills process when abort signal fires", async () => {
      // Use 'exec sleep' so the process responds to signals directly
      writeMockClaude("exec sleep 999");

      const ac = new AbortController();
      const resultPromise = spawnClaude("test", {
        sessionTimeoutMinutes: 5,
        signal: ac.signal,
      });

      // Abort after a short delay
      setTimeout(() => ac.abort(), 200);

      const result = await resultPromise;

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // Process should have been killed
      expect(result.value.exitCode).not.toBe(0);
      // Should not be marked as timed out (this was external cancellation)
      expect(result.value.timedOut).toBe(false);
    }, 15_000);

    it("handles already-aborted signal", async () => {
      // Use 'exec sleep' so the process responds to signals directly
      writeMockClaude("exec sleep 999");

      const ac = new AbortController();
      ac.abort(); // Pre-abort

      const result = await spawnClaude("test", {
        sessionTimeoutMinutes: 5,
        signal: ac.signal,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.exitCode).not.toBe(0);
    }, 15_000);
  });

  describe("multi-line output", () => {
    it("captures multi-line stdout including signal on last line", async () => {
      writeMockClaude('echo "Line 1"\necho "Line 2"\necho "RAUF_DONE"');

      const result = await spawnClaude("test", {
        sessionTimeoutMinutes: 1,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.stdout).toContain("Line 1");
      expect(result.value.stdout).toContain("Line 2");
      expect(result.value.stdout).toContain("RAUF_DONE");
    });
  });
});
