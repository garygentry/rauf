import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { gitCommit } from "./git-commit.js";

describe("gitCommit", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "ralph-git-test-"));
    // Initialize a fresh git repo
    execSync("git init", { cwd: tmpDir, stdio: "ignore" });
    execSync('git config user.email "test@test.com"', {
      cwd: tmpDir,
      stdio: "ignore",
    });
    execSync('git config user.name "Test"', { cwd: tmpDir, stdio: "ignore" });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("commits new files with correct message format", async () => {
    fs.writeFileSync(path.join(tmpDir, "file.txt"), "hello");
    const result = await gitCommit(tmpDir, "006", "signal-parser.ts");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.commitHash).toMatch(/^[0-9a-f]+$/);
    }

    // Verify the commit message
    const log = execSync("git log --oneline -1", {
      cwd: tmpDir,
      encoding: "utf-8",
    });
    expect(log).toContain("[rauf] 006: signal-parser.ts");
  });

  it("returns ok with empty hash when nothing to commit", async () => {
    // Create initial commit so repo isn't empty
    fs.writeFileSync(path.join(tmpDir, "file.txt"), "hello");
    execSync("git add -A && git commit -m 'initial'", {
      cwd: tmpDir,
      stdio: "ignore",
    });

    // No changes — nothing to commit
    const result = await gitCommit(tmpDir, "001", "no changes");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.commitHash).toBe("");
    }
  });

  it("commits modified files", async () => {
    fs.writeFileSync(path.join(tmpDir, "file.txt"), "hello");
    execSync("git add -A && git commit -m 'initial'", {
      cwd: tmpDir,
      stdio: "ignore",
    });

    // Modify the file
    fs.writeFileSync(path.join(tmpDir, "file.txt"), "updated");
    const result = await gitCommit(tmpDir, "002", "update file");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.commitHash).toMatch(/^[0-9a-f]+$/);
    }

    const log = execSync("git log --oneline -1", {
      cwd: tmpDir,
      encoding: "utf-8",
    });
    expect(log).toContain("[rauf] 002: update file");
  });

  it("commits deleted files", async () => {
    fs.writeFileSync(path.join(tmpDir, "file.txt"), "hello");
    execSync("git add -A && git commit -m 'initial'", {
      cwd: tmpDir,
      stdio: "ignore",
    });

    // Delete the file
    fs.unlinkSync(path.join(tmpDir, "file.txt"));
    const result = await gitCommit(tmpDir, "003", "remove file");

    expect(result.ok).toBe(true);

    const log = execSync("git log --oneline -1", {
      cwd: tmpDir,
      encoding: "utf-8",
    });
    expect(log).toContain("[rauf] 003: remove file");
  });

  it("returns err when projectPath does not exist", async () => {
    const result = await gitCommit("/nonexistent/path", "001", "test");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("CONFLICT");
      expect(result.error.message).toContain("git add failed");
    }
  });

  it("returns err when projectPath is not a git repo", async () => {
    const nonGitDir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "ralph-nogit-"));
    try {
      fs.writeFileSync(path.join(nonGitDir, "file.txt"), "hello");
      const result = await gitCommit(nonGitDir, "001", "test");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("CONFLICT");
      }
    } finally {
      fs.rmSync(nonGitDir, { recursive: true, force: true });
    }
  });

  it("stages all files including nested directories", async () => {
    const subDir = path.join(tmpDir, "src");
    fs.mkdirSync(subDir);
    fs.writeFileSync(path.join(subDir, "a.ts"), "const a = 1;");
    fs.writeFileSync(path.join(subDir, "b.ts"), "const b = 2;");

    const result = await gitCommit(tmpDir, "004", "add source files");

    expect(result.ok).toBe(true);

    // Verify both files were committed
    const files = execSync("git show --name-only --format=", {
      cwd: tmpDir,
      encoding: "utf-8",
    });
    expect(files).toContain("src/a.ts");
    expect(files).toContain("src/b.ts");
  });
});
