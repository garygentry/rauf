import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync, execSync } from "node:child_process";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { describeCommit, exactExcludePathspec, gitCommit } from "./git-commit.js";

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

  it("excludes .rauf/ runtime files (lock, state, DONE, .bak) but commits work + backlog.json", async () => {
    // Simulate a project whose .gitignore does NOT cover runtime files: the
    // pathspec exclude in gitCommit must keep them out of the commit anyway,
    // in both the root .rauf/ and a nested backlog dir.
    fs.mkdirSync(path.join(tmpDir, ".rauf"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "specs/feat/.rauf"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "work.ts"), "export const x = 1;");
    fs.writeFileSync(path.join(tmpDir, ".rauf", "backlog.json"), "{}");
    fs.writeFileSync(path.join(tmpDir, ".rauf", ".loop.lock"), "pid");
    fs.writeFileSync(path.join(tmpDir, ".rauf", "state.json"), "{}");
    fs.writeFileSync(path.join(tmpDir, ".rauf", "DONE"), "done");
    fs.writeFileSync(path.join(tmpDir, ".rauf", "backlog.json.bak"), "{}");
    fs.writeFileSync(path.join(tmpDir, "specs/feat/.rauf", ".loop.lock"), "pid");
    fs.writeFileSync(path.join(tmpDir, "specs/feat/.rauf", "state.json"), "{}");

    const result = await gitCommit(tmpDir, "005", "work + runtime");
    expect(result.ok).toBe(true);

    const files = execSync("git show --name-only --format=", {
      cwd: tmpDir,
      encoding: "utf-8",
    });
    // Work + the real backlog are committed…
    expect(files).toContain("work.ts");
    expect(files).toContain(".rauf/backlog.json");
    // …but the runtime files (root + nested) are NOT.
    expect(files).not.toContain(".loop.lock");
    expect(files).not.toContain(".rauf/state.json");
    expect(files).not.toContain(".rauf/DONE");
    expect(files).not.toContain("backlog.json.bak");
  });
});

describe("describeCommit", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "ralph-git-describe-"));
    execSync("git init", { cwd: tmpDir, stdio: "ignore" });
    execSync('git config user.email "test@test.com"', { cwd: tmpDir, stdio: "ignore" });
    execSync('git config user.name "Test"', { cwd: tmpDir, stdio: "ignore" });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("resolves an abbreviated hash to the full sha and counts the files it touched", async () => {
    fs.writeFileSync(path.join(tmpDir, "a.txt"), "a");
    fs.mkdirSync(path.join(tmpDir, "sub"));
    fs.writeFileSync(path.join(tmpDir, "sub", "b.txt"), "b");
    const commit = await gitCommit(tmpDir, "001", "two files");
    expect(commit.ok).toBe(true);
    const short = commit.ok ? commit.value.commitHash : "";

    const described = await describeCommit(tmpDir, short);
    const head = execSync("git rev-parse HEAD", { cwd: tmpDir, encoding: "utf-8" }).trim();
    expect(described).toEqual({ sha: head, filesChanged: 2 });
  });

  it("returns null for an unknown ref instead of throwing", async () => {
    expect(await describeCommit(tmpDir, "deadbeef")).toBeNull();
  });
});

describe("exactExcludePathspec (#172)", () => {
  it("backslash-anchors the first character so the pathspec has no literal leading directory", () => {
    expect(exactExcludePathspec(path.join("specs", "f", "backlog.json"), { dir: false })).toBe(
      ":(exclude,glob)\\specs/f/backlog.json",
    );
    expect(exactExcludePathspec(".rauf", { dir: true })).toBe(":(exclude,glob)\\.rauf/**");
    // Metacharacters are escaped; one already leading is not double-anchored.
    expect(exactExcludePathspec("a*b/[x]?", { dir: false })).toBe(
      ":(exclude,glob)\\a\\*b/\\[x\\]\\?",
    );
    expect(exactExcludePathspec("*odd", { dir: false })).toBe(":(exclude,glob)\\*odd");
  });

  // String shape alone can't prove git matches it (a `[Ü]` / `[!]` class looked
  // right but matched nothing). Ask git: each path must vanish from `status`,
  // while a sibling with the same name elsewhere must not.
  it.each([
    ["ASCII", "specs"],
    ["non-ASCII first character", "Über"],
    ["astral first character", "\u{1F680}x"],
    ["leading !", "!x"],
    ["leading ^", "^y"],
    ["glob metacharacters", "a*b[1]?"],
  ])("excludes exactly the given path through git — %s", (_label, top) => {
    const repo = fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "rauf-exclude-"));
    try {
      execSync("git init -q", { cwd: repo });
      const backlogRel = path.join(top, "f", "backlog.json");
      const stateRel = path.join(top, "f", ".rauf");
      fs.mkdirSync(path.join(repo, stateRel), { recursive: true });
      fs.writeFileSync(path.join(repo, backlogRel), "{}\n");
      fs.writeFileSync(path.join(repo, stateRel, "state.json"), "{}\n");
      fs.mkdirSync(path.join(repo, "other", "f"), { recursive: true });
      fs.writeFileSync(path.join(repo, "other", "f", "backlog.json"), "{}\n");
      const status = execFileSync(
        "git",
        [
          "-c",
          "core.quotePath=false",
          "status",
          "--porcelain",
          "--untracked-files=all",
          "--",
          ".",
          exactExcludePathspec(stateRel, { dir: true }),
          exactExcludePathspec(backlogRel, { dir: false }),
        ],
        { cwd: repo, encoding: "utf-8" },
      );
      expect(status.trim().split("\n")).toEqual(["?? other/f/backlog.json"]);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});
