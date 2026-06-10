import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ErrorCodes } from "@rauf/core";

import { checkLoopPreconditions } from "./git-status.js";

// ─── Test Helpers ────────────────────────────────────────────────────

function createTmpDir(): string {
  return fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "rauf-git-status-"));
}

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

/** Initialize a git repo with one commit on the given initial branch. */
function initRepo(cwd: string, initialBranch = "main"): void {
  git(cwd, ["init", "-b", initialBranch]);
  git(cwd, ["config", "user.email", "test@example.com"]);
  git(cwd, ["config", "user.name", "Test User"]);
  fs.writeFileSync(path.join(cwd, "README.md"), "# test\n");
  git(cwd, ["add", "README.md"]);
  git(cwd, ["commit", "-m", "initial"]);
}

/** Make the working tree dirty by writing an untracked file. */
function makeDirty(cwd: string): void {
  fs.writeFileSync(path.join(cwd, "scratch.txt"), "uncommitted\n");
}

// ─── Tests ───────────────────────────────────────────────────────────

describe("checkLoopPreconditions", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("errors on main with a clean tree", async () => {
    initRepo(tmpDir, "main");

    const result = await checkLoopPreconditions(tmpDir);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCodes.CONFLICT);
      expect(result.error.message.toLowerCase()).toContain("main");
    }
  });

  it("errors on master with a clean tree", async () => {
    initRepo(tmpDir, "master");

    const result = await checkLoopPreconditions(tmpDir);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCodes.CONFLICT);
    }
  });

  it("succeeds on a feature branch with a clean tree", async () => {
    initRepo(tmpDir, "main");
    git(tmpDir, ["checkout", "-b", "feature/work"]);

    const result = await checkLoopPreconditions(tmpDir);

    expect(result.ok).toBe(true);
  });

  it("errors on a feature branch with a dirty tree", async () => {
    initRepo(tmpDir, "main");
    git(tmpDir, ["checkout", "-b", "feature/work"]);
    makeDirty(tmpDir);

    const result = await checkLoopPreconditions(tmpDir);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCodes.CONFLICT);
      expect(result.error.message.toLowerCase()).toContain("uncommitted");
    }
  });

  it("errors on main with a dirty tree", async () => {
    initRepo(tmpDir, "main");
    makeDirty(tmpDir);

    const result = await checkLoopPreconditions(tmpDir);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCodes.CONFLICT);
    }
  });

  it("errors on a detached HEAD", async () => {
    initRepo(tmpDir, "main");
    // Create a second commit so we have a hash to detach onto.
    fs.writeFileSync(path.join(tmpDir, "second.txt"), "second\n");
    git(tmpDir, ["add", "second.txt"]);
    git(tmpDir, ["commit", "-m", "second"]);
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: tmpDir }).toString().trim();
    git(tmpDir, ["checkout", head]);

    const result = await checkLoopPreconditions(tmpDir);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCodes.CONFLICT);
      expect(result.error.message.toLowerCase()).toContain("detached");
    }
  });

  it("succeeds when the directory is not a git repository", async () => {
    const result = await checkLoopPreconditions(tmpDir);

    expect(result.ok).toBe(true);
  });
});
