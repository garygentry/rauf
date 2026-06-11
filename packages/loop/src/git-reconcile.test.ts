import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { findItemCommit, isTreeClean } from "./git-reconcile.js";

/** Stage everything and commit with a literal message (no rauf wrapping). */
function commit(cwd: string, file: string, contents: string, message: string): void {
  fs.writeFileSync(path.join(cwd, file), contents);
  execSync("git add -A", { cwd, stdio: "ignore" });
  execSync(`git commit -m ${JSON.stringify(message)}`, { cwd, stdio: "ignore" });
}

describe("git-reconcile", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "rauf-reconcile-test-"));
    execSync("git init", { cwd: tmpDir, stdio: "ignore" });
    execSync('git config user.email "test@test.com"', { cwd: tmpDir, stdio: "ignore" });
    execSync('git config user.name "Test"', { cwd: tmpDir, stdio: "ignore" });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("findItemCommit", () => {
    it("returns the commit hash for a committed [rauf] <id>: item", async () => {
      commit(tmpDir, "a.txt", "a", "[rauf] 001: first item");

      const result = await findItemCommit(tmpDir, "001");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).not.toBeNull();
        expect(result.value?.commitHash).toMatch(/^[0-9a-f]{40}$/);

        // Confirm it points at the right commit.
        const head = execSync("git rev-parse HEAD", { cwd: tmpDir, encoding: "utf-8" }).trim();
        expect(result.value?.commitHash).toBe(head);
      }
    });

    it("returns null when no commit matches the id", async () => {
      commit(tmpDir, "a.txt", "a", "[rauf] 001: first item");

      const result = await findItemCommit(tmpDir, "999");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it("anchors the match so id 003 does not match 030 or 0030", async () => {
      commit(tmpDir, "a.txt", "a", "[rauf] 030: thirty");
      commit(tmpDir, "b.txt", "b", "[rauf] 0030: oh-thirty");

      const result = await findItemCommit(tmpDir, "003");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it("treats ERE metacharacters in the id literally (1.0 does not match 1x0)", async () => {
      commit(tmpDir, "a.txt", "a", "[rauf] 1x0: dot-as-wildcard would overmatch this");

      const result = await findItemCommit(tmpDir, "1.0");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it("matches an id containing ERE metacharacters when present verbatim", async () => {
      commit(tmpDir, "a.txt", "a", "[rauf] 1.0: literal dotted id");

      const result = await findItemCommit(tmpDir, "1.0");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).not.toBeNull();
        const head = execSync("git rev-parse HEAD", { cwd: tmpDir, encoding: "utf-8" }).trim();
        expect(result.value?.commitHash).toBe(head);
      }
    });

    it("does not match when [rauf] is not at the start of the message", async () => {
      commit(tmpDir, "a.txt", "a", "fixup of [rauf] 007: not really a rauf commit");

      const result = await findItemCommit(tmpDir, "007");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it("returns the most recent matching commit", async () => {
      commit(tmpDir, "a.txt", "a", "[rauf] 002: first attempt");
      commit(tmpDir, "a.txt", "a2", "[rauf] 002: second attempt");

      const result = await findItemCommit(tmpDir, "002");

      expect(result.ok).toBe(true);
      if (result.ok) {
        const head = execSync("git rev-parse HEAD", { cwd: tmpDir, encoding: "utf-8" }).trim();
        expect(result.value?.commitHash).toBe(head);
      }
    });

    it("returns Result (never throws) when the path is not a git repo", async () => {
      const nonGitDir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "rauf-nogit-"));
      try {
        const result = await findItemCommit(nonGitDir, "001");
        expect(result.ok).toBe(false);
      } finally {
        fs.rmSync(nonGitDir, { recursive: true, force: true });
      }
    });

    describe("with sinceRef (run baseline)", () => {
      it("does NOT match a stale [rauf] <id>: commit before the baseline", async () => {
        // A prior backlog cycle committed item 001…
        commit(tmpDir, "old.txt", "old", "[rauf] 001: stale from a prior cycle");
        // …then the new run starts here (its baseline), with no work yet for 001.
        const baseline = execSync("git rev-parse HEAD", { cwd: tmpDir, encoding: "utf-8" }).trim();
        commit(tmpDir, "unrelated.txt", "x", "[rauf] 002: some other item this run");

        const result = await findItemCommit(tmpDir, "001", baseline);

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value).toBeNull();
        }
      });

      it("matches a commit made after the baseline", async () => {
        commit(tmpDir, "old.txt", "old", "[rauf] 001: stale from a prior cycle");
        const baseline = execSync("git rev-parse HEAD", { cwd: tmpDir, encoding: "utf-8" }).trim();
        // This run actually re-did 001 and committed it after the baseline.
        commit(tmpDir, "new.txt", "new", "[rauf] 001: done this run");
        const head = execSync("git rev-parse HEAD", { cwd: tmpDir, encoding: "utf-8" }).trim();

        const result = await findItemCommit(tmpDir, "001", baseline);

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value).not.toBeNull();
          // The post-baseline commit, NOT the stale one.
          expect(result.value?.commitHash).toBe(head);
        }
      });

      it("falls back to an unbounded search when sinceRef is omitted", async () => {
        commit(tmpDir, "old.txt", "old", "[rauf] 001: stale from a prior cycle");
        const stale = execSync("git rev-parse HEAD", { cwd: tmpDir, encoding: "utf-8" }).trim();
        commit(tmpDir, "unrelated.txt", "x", "[rauf] 002: some other item this run");

        const result = await findItemCommit(tmpDir, "001");

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value?.commitHash).toBe(stale);
        }
      });
    });
  });

  describe("isTreeClean", () => {
    it("returns true on a clean tree", async () => {
      commit(tmpDir, "a.txt", "a", "[rauf] 001: first item");

      const result = await isTreeClean(tmpDir);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(true);
      }
    });

    it("returns false with an uncommitted (modified) change", async () => {
      commit(tmpDir, "a.txt", "a", "[rauf] 001: first item");
      fs.writeFileSync(path.join(tmpDir, "a.txt"), "modified");

      const result = await isTreeClean(tmpDir);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(false);
      }
    });

    it("returns false with an untracked file", async () => {
      commit(tmpDir, "a.txt", "a", "[rauf] 001: first item");
      fs.writeFileSync(path.join(tmpDir, "untracked.txt"), "new");

      const result = await isTreeClean(tmpDir);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(false);
      }
    });

    it("returns Result (never throws) when the path is not a git repo", async () => {
      const nonGitDir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "rauf-nogit-"));
      try {
        const result = await isTreeClean(nonGitDir);
        expect(result.ok).toBe(false);
      } finally {
        fs.rmSync(nonGitDir, { recursive: true, force: true });
      }
    });
  });
});
