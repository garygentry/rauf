import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { BacklogItem, Backlog, MarkerFile, BacklogPaths, InstructionPaths } from "@ralph/core";
import { defaultBacklogPaths } from "@ralph/core";
import { buildPrompt, buildReviewPrompt } from "./prompt-builder.js";

const RALPH_DIR = ".ralph";

/** Build BacklogPaths for the default .ralph root in a test dir */
function testPaths(tmpDir: string): BacklogPaths {
  return defaultBacklogPaths(tmpDir);
}

/** Build BacklogPaths for a non-default root */
function nonDefaultPaths(tmpDir: string, rootRel: string): BacklogPaths {
  const root = path.join(tmpDir, rootRel);
  const stateDir = path.join(root, ".ralph");
  return {
    projectPath: tmpDir,
    root,
    stateDir,
    backlog: path.join(root, "backlog.json"),
    state: path.join(stateDir, "state.json"),
    log: path.join(stateDir, "ralph.log"),
    done: path.join(stateDir, "DONE"),
    cancel: path.join(stateDir, "CANCEL"),
    progress: path.join(stateDir, "progress.md"),
    iterationStatus: path.join(stateDir, "iteration-status.json"),
    archive: path.join(stateDir, "archive"),
    lock: path.join(stateDir, ".loop.lock"),
  };
}

/** Build InstructionPaths for the default .ralph root in a test dir */
function testInstructionPaths(tmpDir: string): InstructionPaths {
  const ralphMd = path.join(tmpDir, RALPH_DIR, "RALPH.md");
  const reviewMd = path.join(tmpDir, RALPH_DIR, "REVIEW.md");
  return {
    ralphMd: fs.existsSync(ralphMd) ? ralphMd : null,
    reviewMd: fs.existsSync(reviewMd) ? reviewMd : null,
  };
}

function createTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "prompt-builder-test-"));
}

function setupProject(
  tmpDir: string,
  opts: {
    ralphMd?: string;
    progressMd?: string | null;
    /** Optional: set up files in a non-default state directory */
    stateDir?: string;
  } = {},
): void {
  const ralphDir = opts.stateDir ?? path.join(tmpDir, RALPH_DIR);
  fs.mkdirSync(ralphDir, { recursive: true });

  if (opts.ralphMd !== undefined) {
    fs.writeFileSync(path.join(ralphDir, "RALPH.md"), opts.ralphMd);
  }

  if (opts.progressMd !== undefined && opts.progressMd !== null) {
    fs.writeFileSync(path.join(ralphDir, "progress.md"), opts.progressMd);
  }
}

function makeItem(overrides: Partial<BacklogItem> = {}): BacklogItem {
  return {
    id: "007",
    type: "feature",
    priority: 1,
    title: "Test Feature",
    description: "A test feature description",
    acceptanceCriteria: ["Criterion A passes", "Criterion B passes"],
    status: "in_progress",
    completedAt: null,
    ...overrides,
  };
}

function makeBacklog(items: BacklogItem[] = []): Backlog {
  return {
    project: "test-project",
    description: "A test project",
    items:
      items.length > 0
        ? items
        : [
            makeItem(),
            makeItem({ id: "001", title: "Done Item", status: "done", completedAt: "2026-01-01" }),
            makeItem({ id: "002", title: "Pending Item", status: "pending" }),
            makeItem({ id: "003", title: "Blocked Item", status: "blocked" }),
          ],
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = createTmpDir();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("buildPrompt", () => {
  describe("basic prompt structure", () => {
    it("returns ok with the complete prompt string", () => {
      setupProject(tmpDir, {
        ralphMd: "# RALPH Instructions\nDo the work.",
        progressMd: "# Progress\nLearning 1",
      });
      const item = makeItem();
      const backlog = makeBacklog();

      const result = buildPrompt(testPaths(tmpDir), testInstructionPaths(tmpDir), item, backlog);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(typeof result.value).toBe("string");
        expect(result.value.length).toBeGreaterThan(0);
      }
    });

    it("includes RALPH.md content as system context", () => {
      const ralphContent = "## Verification Commands\n\nRun pnpm test && pnpm typecheck";
      setupProject(tmpDir, { ralphMd: ralphContent });

      const result = buildPrompt(
        testPaths(tmpDir),
        testInstructionPaths(tmpDir),
        makeItem(),
        makeBacklog(),
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toContain(ralphContent);
        expect(result.value).toContain("# Ralph — Per-Iteration Instructions");
      }
    });

    it("includes the current item as formatted JSON", () => {
      setupProject(tmpDir, { ralphMd: "instructions" });
      const item = makeItem({ id: "042", title: "Special Task" });

      const result = buildPrompt(
        testPaths(tmpDir),
        testInstructionPaths(tmpDir),
        item,
        makeBacklog(),
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toContain("```json");
        expect(result.value).toContain('"id": "042"');
        expect(result.value).toContain('"title": "Special Task"');
        // All fields present in the JSON
        expect(result.value).toContain('"type": "feature"');
        expect(result.value).toContain('"priority": 1');
        expect(result.value).toContain('"acceptanceCriteria"');
        expect(result.value).toContain('"status": "in_progress"');
      }
    });

    it("includes acceptance criteria as a bulleted list", () => {
      setupProject(tmpDir, { ralphMd: "instructions" });
      const item = makeItem({
        acceptanceCriteria: ["Tests pass", "Types check", "Lint clean"],
      });

      const result = buildPrompt(
        testPaths(tmpDir),
        testInstructionPaths(tmpDir),
        item,
        makeBacklog(),
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toContain("### Acceptance Criteria");
        expect(result.value).toContain("- Tests pass");
        expect(result.value).toContain("- Types check");
        expect(result.value).toContain("- Lint clean");
      }
    });

    it("includes dependencies section", () => {
      setupProject(tmpDir, { ralphMd: "instructions" });
      const item = makeItem({ dependsOn: ["001", "003"] });

      const result = buildPrompt(
        testPaths(tmpDir),
        testInstructionPaths(tmpDir),
        item,
        makeBacklog(),
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toContain("### Dependencies");
        expect(result.value).toContain("This item depends on: 001, 003");
      }
    });

    it("shows 'No dependencies' when dependsOn is absent", () => {
      setupProject(tmpDir, { ralphMd: "instructions" });
      const item = makeItem();
      delete (item as Record<string, unknown>).dependsOn;

      const result = buildPrompt(
        testPaths(tmpDir),
        testInstructionPaths(tmpDir),
        item,
        makeBacklog(),
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toContain("No dependencies");
      }
    });

    it("includes notes section", () => {
      setupProject(tmpDir, { ralphMd: "instructions" });
      const item = makeItem({ notes: "Check the API docs first" });

      const result = buildPrompt(
        testPaths(tmpDir),
        testInstructionPaths(tmpDir),
        item,
        makeBacklog(),
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toContain("### Notes");
        expect(result.value).toContain("Check the API docs first");
      }
    });

    it("shows 'No additional notes' when notes absent", () => {
      setupProject(tmpDir, { ralphMd: "instructions" });
      const item = makeItem();

      const result = buildPrompt(
        testPaths(tmpDir),
        testInstructionPaths(tmpDir),
        item,
        makeBacklog(),
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toContain("No additional notes");
      }
    });

    it("includes spec references when present", () => {
      setupProject(tmpDir, { ralphMd: "instructions" });
      const item = makeItem({
        specReferences: ["docs/SPEC-CORE.md", "docs/ARCHITECTURE.md"],
      });

      const result = buildPrompt(
        testPaths(tmpDir),
        testInstructionPaths(tmpDir),
        item,
        makeBacklog(),
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toContain("### Spec References");
        expect(result.value).toContain("- docs/SPEC-CORE.md");
        expect(result.value).toContain("- docs/ARCHITECTURE.md");
      }
    });

    it("shows 'No spec references' when specReferences absent", () => {
      setupProject(tmpDir, { ralphMd: "instructions" });
      const item = makeItem();

      const result = buildPrompt(
        testPaths(tmpDir),
        testInstructionPaths(tmpDir),
        item,
        makeBacklog(),
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toContain("No spec references");
      }
    });

    it("includes the important reminder with relative paths", () => {
      setupProject(tmpDir, { ralphMd: "instructions" });
      const item = makeItem({ id: "007" });

      const result = buildPrompt(
        testPaths(tmpDir),
        testInstructionPaths(tmpDir),
        item,
        makeBacklog(),
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toContain(
          "**IMPORTANT:** You are working on item 007 ONLY. Do NOT modify .ralph/backlog.json or .ralph/state.json",
        );
      }
    });

    it("includes current task header with item id and title", () => {
      setupProject(tmpDir, { ralphMd: "instructions" });
      const item = makeItem({ id: "012", title: "Build the widget" });

      const result = buildPrompt(
        testPaths(tmpDir),
        testInstructionPaths(tmpDir),
        item,
        makeBacklog(),
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toContain("## Your Current Task");
        expect(result.value).toContain("You are working on item **012**: Build the widget");
      }
    });
  });

  describe("backlog summary", () => {
    it("includes counts of pending/in_progress/blocked/done items", () => {
      setupProject(tmpDir, { ralphMd: "instructions" });
      const items: BacklogItem[] = [
        makeItem({ id: "001", status: "done", completedAt: "2026-01-01" }),
        makeItem({ id: "002", status: "done", completedAt: "2026-01-02" }),
        makeItem({ id: "003", status: "pending" }),
        makeItem({ id: "004", status: "in_progress" }),
        makeItem({ id: "005", status: "blocked" }),
      ];
      const backlog = makeBacklog(items);

      const result = buildPrompt(
        testPaths(tmpDir),
        testInstructionPaths(tmpDir),
        items[3]!,
        backlog,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toContain("- Pending: 1");
        expect(result.value).toContain("- In Progress: 1");
        expect(result.value).toContain("- Blocked: 1");
        expect(result.value).toContain("- Done: 2");
      }
    });

    it("lists blocked item titles", () => {
      setupProject(tmpDir, { ralphMd: "instructions" });
      const items: BacklogItem[] = [
        makeItem({ id: "001", status: "blocked", title: "Blocked Task A" }),
        makeItem({ id: "002", status: "blocked", title: "Blocked Task B" }),
        makeItem({ id: "003", status: "in_progress" }),
      ];
      const backlog = makeBacklog(items);

      const result = buildPrompt(
        testPaths(tmpDir),
        testInstructionPaths(tmpDir),
        items[2]!,
        backlog,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toContain("Blocked items:");
        expect(result.value).toContain("- 001: Blocked Task A");
        expect(result.value).toContain("- 002: Blocked Task B");
      }
    });

    it("does not list blocked items section when none blocked", () => {
      setupProject(tmpDir, { ralphMd: "instructions" });
      const items: BacklogItem[] = [
        makeItem({ id: "001", status: "done", completedAt: "2026-01-01" }),
        makeItem({ id: "002", status: "in_progress" }),
      ];
      const backlog = makeBacklog(items);

      const result = buildPrompt(
        testPaths(tmpDir),
        testInstructionPaths(tmpDir),
        items[1]!,
        backlog,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toContain("- Blocked: 0");
        expect(result.value).not.toContain("Blocked items:");
      }
    });
  });

  describe("progress.md handling", () => {
    it("includes progress.md content when file exists", () => {
      const progressContent = "# Progress\n## Iteration 1\n- Learned about the codebase structure";
      setupProject(tmpDir, {
        ralphMd: "instructions",
        progressMd: progressContent,
      });

      const result = buildPrompt(
        testPaths(tmpDir),
        testInstructionPaths(tmpDir),
        makeItem(),
        makeBacklog(),
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toContain("## Progress Log");
        expect(result.value).toContain(progressContent);
      }
    });

    it("omits progress section when file does not exist", () => {
      setupProject(tmpDir, {
        ralphMd: "instructions",
        progressMd: null,
      });

      const result = buildPrompt(
        testPaths(tmpDir),
        testInstructionPaths(tmpDir),
        makeItem(),
        makeBacklog(),
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).not.toContain("## Progress Log");
      }
    });
  });

  describe("agent delegation", () => {
    it("includes agent delegation hint when estimatedIterations > 1", () => {
      setupProject(tmpDir, { ralphMd: "instructions" });
      const item = makeItem({ estimatedIterations: 3 });

      const result = buildPrompt(
        testPaths(tmpDir),
        testInstructionPaths(tmpDir),
        item,
        makeBacklog(),
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toContain("### Multi-Iteration Guidance");
        expect(result.value).toContain("estimated to take 3 iterations");
      }
    });

    it("does not include delegation hint when estimatedIterations is 1", () => {
      setupProject(tmpDir, { ralphMd: "instructions" });
      const item = makeItem({ estimatedIterations: 1 });

      const result = buildPrompt(
        testPaths(tmpDir),
        testInstructionPaths(tmpDir),
        item,
        makeBacklog(),
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).not.toContain("### Multi-Iteration Guidance");
      }
    });

    it("does not include delegation hint when estimatedIterations is absent", () => {
      setupProject(tmpDir, { ralphMd: "instructions" });
      const item = makeItem();

      const result = buildPrompt(
        testPaths(tmpDir),
        testInstructionPaths(tmpDir),
        item,
        makeBacklog(),
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).not.toContain("### Multi-Iteration Guidance");
      }
    });

    it("includes full agent delegation section when agentDelegation is set", () => {
      setupProject(tmpDir, { ralphMd: "instructions" });
      const item = makeItem({
        agentDelegation: {
          strategy: "parallel-subtasks",
          recommendedConcurrency: 3,
          subtasks: ["Implement module A", "Implement module B", "Write tests"],
        },
      });

      const result = buildPrompt(
        testPaths(tmpDir),
        testInstructionPaths(tmpDir),
        item,
        makeBacklog(),
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toContain("### Agent Delegation");
        expect(result.value).toContain("**Strategy:** parallel-subtasks");
        expect(result.value).toContain("**Recommended concurrency:** 3 parallel agents");
        expect(result.value).toContain("1. Implement module A");
        expect(result.value).toContain("2. Implement module B");
        expect(result.value).toContain("3. Write tests");
        expect(result.value).toContain("Use Task tool to create sub-agents");
      }
    });

    it("handles agent delegation with only strategy", () => {
      setupProject(tmpDir, { ralphMd: "instructions" });
      const item = makeItem({
        agentDelegation: {
          strategy: "sequential",
        },
      });

      const result = buildPrompt(
        testPaths(tmpDir),
        testInstructionPaths(tmpDir),
        item,
        makeBacklog(),
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toContain("### Agent Delegation");
        expect(result.value).toContain("**Strategy:** sequential");
        expect(result.value).not.toContain("**Recommended concurrency:**");
        expect(result.value).not.toContain("**Subtasks to delegate:**");
      }
    });
  });

  describe("missing RALPH.md", () => {
    it("returns err when RALPH.md does not exist", () => {
      // Create .ralph dir but no RALPH.md
      fs.mkdirSync(path.join(tmpDir, RALPH_DIR), { recursive: true });

      const result = buildPrompt(
        testPaths(tmpDir),
        testInstructionPaths(tmpDir),
        makeItem(),
        makeBacklog(),
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("FILE_NOT_FOUND");
        expect(result.error.message).toContain("RALPH.md");
      }
    });

    it("returns err when .ralph directory does not exist", () => {
      const result = buildPrompt(
        testPaths(tmpDir),
        testInstructionPaths(tmpDir),
        makeItem(),
        makeBacklog(),
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("FILE_NOT_FOUND");
      }
    });
  });

  describe("section delimiters", () => {
    it("has clearly delimited sections with headers", () => {
      setupProject(tmpDir, {
        ralphMd: "System instructions here",
        progressMd: "Some progress",
      });

      const result = buildPrompt(
        testPaths(tmpDir),
        testInstructionPaths(tmpDir),
        makeItem(),
        makeBacklog(),
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Check for distinct section headers
        expect(result.value).toContain("# Ralph — Per-Iteration Instructions");
        expect(result.value).toContain("## Your Current Task");
        expect(result.value).toContain("### Acceptance Criteria");
        expect(result.value).toContain("### Dependencies");
        expect(result.value).toContain("### Notes");
        expect(result.value).toContain("### Spec References");
        expect(result.value).toContain("### Backlog Summary");
        expect(result.value).toContain("## Full Backlog Context");
        expect(result.value).toContain("## Progress Log");
        expect(result.value).toContain("**IMPORTANT:**");
      }
    });

    it("includes full backlog as JSON", () => {
      setupProject(tmpDir, { ralphMd: "instructions" });
      const backlog = makeBacklog();

      const result = buildPrompt(
        testPaths(tmpDir),
        testInstructionPaths(tmpDir),
        makeItem(),
        backlog,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toContain("## Full Backlog Context (read-only");
        expect(result.value).toContain('"project": "test-project"');
        expect(result.value).toContain('"description": "A test project"');
      }
    });
  });

  describe("edge cases", () => {
    it("handles empty backlog items array", () => {
      setupProject(tmpDir, { ralphMd: "instructions" });
      const backlog: Backlog = { project: "empty", description: "empty project", items: [] };

      const result = buildPrompt(
        testPaths(tmpDir),
        testInstructionPaths(tmpDir),
        makeItem(),
        backlog,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toContain("- Pending: 0");
        expect(result.value).toContain("- In Progress: 0");
        expect(result.value).toContain("- Blocked: 0");
        expect(result.value).toContain("- Done: 0");
      }
    });

    it("handles item with empty acceptance criteria", () => {
      setupProject(tmpDir, { ralphMd: "instructions" });
      const item = makeItem({ acceptanceCriteria: [] });

      const result = buildPrompt(
        testPaths(tmpDir),
        testInstructionPaths(tmpDir),
        item,
        makeBacklog(),
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toContain("### Acceptance Criteria");
      }
    });

    it("handles empty progress.md file", () => {
      setupProject(tmpDir, {
        ralphMd: "instructions",
        progressMd: "",
      });

      const result = buildPrompt(
        testPaths(tmpDir),
        testInstructionPaths(tmpDir),
        makeItem(),
        makeBacklog(),
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Empty progress.md still gets included (file exists)
        expect(result.value).toContain("## Progress Log");
      }
    });
  });

  describe("Active Backlog Root section", () => {
    it("is always injected for default root", () => {
      setupProject(tmpDir, { ralphMd: "instructions" });

      const result = buildPrompt(
        testPaths(tmpDir),
        testInstructionPaths(tmpDir),
        makeItem(),
        makeBacklog(),
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toContain("## Active Backlog Root");
        expect(result.value).toContain(
          "You are working against the backlog at: .ralph/backlog.json",
        );
        expect(result.value).toContain("State directory: .ralph/");
        expect(result.value).toContain("Progress log: .ralph/progress.md");
        expect(result.value).toContain("Do NOT modify files outside this state directory.");
      }
    });

    it("is injected with correct relative paths for non-default root", () => {
      const paths = nonDefaultPaths(tmpDir, "specs/auth");
      const stateDir = paths.stateDir;
      fs.mkdirSync(stateDir, { recursive: true });
      fs.writeFileSync(path.join(stateDir, "RALPH.md"), "instructions");

      const instrPaths: InstructionPaths = {
        ralphMd: path.join(stateDir, "RALPH.md"),
        reviewMd: null,
      };

      const result = buildPrompt(paths, instrPaths, makeItem(), makeBacklog());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toContain("## Active Backlog Root");
        expect(result.value).toContain(
          "You are working against the backlog at: specs/auth/backlog.json",
        );
        expect(result.value).toContain("State directory: specs/auth/.ralph/");
        expect(result.value).toContain("Progress log: specs/auth/.ralph/progress.md");
      }
    });
  });

  describe("non-default root handling", () => {
    it("reads RALPH.md from per-root stateDir", () => {
      const paths = nonDefaultPaths(tmpDir, "specs/auth");
      fs.mkdirSync(paths.stateDir, { recursive: true });
      fs.writeFileSync(path.join(paths.stateDir, "RALPH.md"), "per-root instructions");

      const instrPaths: InstructionPaths = {
        ralphMd: path.join(paths.stateDir, "RALPH.md"),
        reviewMd: null,
      };

      const result = buildPrompt(paths, instrPaths, makeItem(), makeBacklog());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toContain("per-root instructions");
      }
    });

    it("reads RALPH.md from project-level fallback", () => {
      // Set up project-level RALPH.md
      setupProject(tmpDir, { ralphMd: "project-level instructions" });
      const paths = nonDefaultPaths(tmpDir, "specs/auth");
      fs.mkdirSync(paths.stateDir, { recursive: true });

      // instructionPaths resolved to project-level fallback
      const instrPaths: InstructionPaths = {
        ralphMd: path.join(tmpDir, ".ralph", "RALPH.md"),
        reviewMd: null,
      };

      const result = buildPrompt(paths, instrPaths, makeItem(), makeBacklog());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toContain("project-level instructions");
      }
    });

    it("returns error when RALPH.md missing everywhere", () => {
      const paths = nonDefaultPaths(tmpDir, "specs/auth");
      fs.mkdirSync(paths.stateDir, { recursive: true });

      const instrPaths: InstructionPaths = { ralphMd: null, reviewMd: null };

      const result = buildPrompt(paths, instrPaths, makeItem(), makeBacklog());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("FILE_NOT_FOUND");
        expect(result.error.message).toContain("RALPH.md");
      }
    });

    it("reads progress.md always from stateDir", () => {
      const paths = nonDefaultPaths(tmpDir, "specs/auth");
      fs.mkdirSync(paths.stateDir, { recursive: true });
      fs.writeFileSync(path.join(paths.stateDir, "RALPH.md"), "instructions");
      fs.writeFileSync(path.join(paths.stateDir, "progress.md"), "per-root progress");

      const instrPaths: InstructionPaths = {
        ralphMd: path.join(paths.stateDir, "RALPH.md"),
        reviewMd: null,
      };

      const result = buildPrompt(paths, instrPaths, makeItem(), makeBacklog());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toContain("per-root progress");
      }
    });

    it("uses relative paths in the important reminder for non-default root", () => {
      const paths = nonDefaultPaths(tmpDir, "specs/auth");
      fs.mkdirSync(paths.stateDir, { recursive: true });
      fs.writeFileSync(path.join(paths.stateDir, "RALPH.md"), "instructions");

      const instrPaths: InstructionPaths = {
        ralphMd: path.join(paths.stateDir, "RALPH.md"),
        reviewMd: null,
      };

      const result = buildPrompt(paths, instrPaths, makeItem({ id: "042" }), makeBacklog());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toContain(
          "Do NOT modify specs/auth/backlog.json or specs/auth/.ralph/state.json",
        );
      }
    });
  });
});

describe("buildReviewPrompt", () => {
  function setupReviewProject(
    dir: string,
    opts: {
      reviewMd?: string;
      progressMd?: string | null;
      markerFile?: boolean;
    } = {},
  ): void {
    const ralphDir = path.join(dir, RALPH_DIR);
    fs.mkdirSync(ralphDir, { recursive: true });

    if (opts.reviewMd !== undefined) {
      fs.writeFileSync(path.join(ralphDir, "REVIEW.md"), opts.reviewMd);
    }

    if (opts.progressMd !== undefined && opts.progressMd !== null) {
      fs.writeFileSync(path.join(ralphDir, "progress.md"), opts.progressMd);
    }

    if (opts.markerFile !== false) {
      const marker: MarkerFile = {
        ralph: true,
        version: "1",
        variant: "backlog-json",
        installedAt: "2026-01-01T00:00:00Z",
        installedBy: "test",
        profile: {
          stack: "TypeScript",
          packageManager: "pnpm",
          monorepo: false,
          commands: {
            test: "pnpm test",
            typecheck: "tsc --noEmit",
            lint: "eslint .",
            build: null,
            format: null,
          },
          verify: "pnpm test && pnpm typecheck",
        },
        artifactHashes: {},
        options: { ignoreInTool: false, gitignoreScripts: false, maxIterations: 20 },
      };
      fs.writeFileSync(path.join(dir, ".ralph.json"), JSON.stringify(marker, null, 2));
    }
  }

  it("returns ok with review prompt using embedded template", () => {
    setupReviewProject(tmpDir);
    const items = [
      makeItem({ id: "001", title: "Feature A", status: "done", completedAt: "2026-01-01" }),
    ];

    const result = buildReviewPrompt(
      testPaths(tmpDir),
      testInstructionPaths(tmpDir),
      items,
      "diff --git a/file.ts b/file.ts\n+added line",
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain("Post-Loop Review Pass");
      expect(result.value).toContain("pnpm test && pnpm typecheck");
      expect(result.value).toContain("Feature A");
      expect(result.value).toContain("+added line");
    }
  });

  it("uses local REVIEW.md when it exists", () => {
    setupReviewProject(tmpDir, {
      reviewMd:
        "# Custom Review\n\nReview with {{verifyCommand}}\n\n{{completedItemsDetail}}\n\n{{gitDiff}}",
    });
    const items = [
      makeItem({ id: "001", title: "My Task", status: "done", completedAt: "2026-01-01" }),
    ];

    const result = buildReviewPrompt(
      testPaths(tmpDir),
      testInstructionPaths(tmpDir),
      items,
      "some diff",
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain("# Custom Review");
      expect(result.value).toContain("pnpm test && pnpm typecheck");
      expect(result.value).toContain("My Task");
      expect(result.value).toContain("some diff");
    }
  });

  it("truncates large git diffs", () => {
    setupReviewProject(tmpDir);
    const items = [makeItem({ id: "001", title: "X", status: "done", completedAt: "2026-01-01" })];
    const largeDiff = "x".repeat(200_000);

    const result = buildReviewPrompt(
      testPaths(tmpDir),
      testInstructionPaths(tmpDir),
      items,
      largeDiff,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain("[diff truncated at 100KB]");
      // Should not contain the full 200KB diff
      expect(result.value.length).toBeLessThan(200_000);
    }
  });

  it("includes acceptance criteria for each item", () => {
    setupReviewProject(tmpDir);
    const items = [
      makeItem({
        id: "001",
        title: "Feature A",
        status: "done",
        completedAt: "2026-01-01",
        acceptanceCriteria: ["AC one", "AC two"],
      }),
    ];

    const result = buildReviewPrompt(testPaths(tmpDir), testInstructionPaths(tmpDir), items, "");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain("AC one");
      expect(result.value).toContain("AC two");
    }
  });

  it("includes progress.md content", () => {
    setupReviewProject(tmpDir, { progressMd: "Learned that foo is important" });
    const items = [makeItem({ id: "001", title: "X", status: "done", completedAt: "2026-01-01" })];

    const result = buildReviewPrompt(testPaths(tmpDir), testInstructionPaths(tmpDir), items, "");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain("Learned that foo is important");
    }
  });

  it("uses per-root REVIEW.md via instructionPaths", () => {
    const paths = nonDefaultPaths(tmpDir, "specs/auth");
    fs.mkdirSync(paths.stateDir, { recursive: true });

    // Write a custom REVIEW.md in the non-default root's state dir
    const reviewPath = path.join(paths.stateDir, "REVIEW.md");
    fs.writeFileSync(
      reviewPath,
      "# Per-Root Review\n\nRun: {{verifyCommand}}\n\n{{completedItemsDetail}}\n\n{{gitDiff}}",
    );

    // Write marker file at project root
    const marker: MarkerFile = {
      ralph: true,
      version: "1",
      variant: "backlog-json",
      installedAt: "2026-01-01T00:00:00Z",
      installedBy: "test",
      profile: {
        stack: "TypeScript",
        packageManager: "pnpm",
        monorepo: false,
        commands: { test: "pnpm test", typecheck: "tsc", lint: null, build: null, format: null },
        verify: "pnpm test && pnpm typecheck",
      },
      artifactHashes: {},
      options: { ignoreInTool: false, gitignoreScripts: false, maxIterations: 20 },
    };
    fs.writeFileSync(path.join(tmpDir, ".ralph.json"), JSON.stringify(marker));

    const instrPaths: InstructionPaths = { ralphMd: null, reviewMd: reviewPath };
    const items = [
      makeItem({ id: "001", title: "Auth", status: "done", completedAt: "2026-01-01" }),
    ];

    const result = buildReviewPrompt(paths, instrPaths, items, "diff content");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain("# Per-Root Review");
      expect(result.value).toContain("Auth");
      expect(result.value).toContain("diff content");
    }
  });

  it("falls back to embedded template when reviewMd is null", () => {
    setupReviewProject(tmpDir);
    const instrPaths: InstructionPaths = { ralphMd: null, reviewMd: null };
    const items = [makeItem({ id: "001", title: "X", status: "done", completedAt: "2026-01-01" })];

    const result = buildReviewPrompt(testPaths(tmpDir), instrPaths, items, "some diff");

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Falls back to embedded REVIEW.md.tmpl
      expect(result.value).toContain("Post-Loop Review Pass");
    }
  });

  it("reads progress.md from per-root stateDir", () => {
    const paths = nonDefaultPaths(tmpDir, "specs/auth");
    fs.mkdirSync(paths.stateDir, { recursive: true });
    fs.writeFileSync(path.join(paths.stateDir, "progress.md"), "per-root review progress");

    // Write marker file at project root
    const marker: MarkerFile = {
      ralph: true,
      version: "1",
      variant: "backlog-json",
      installedAt: "2026-01-01T00:00:00Z",
      installedBy: "test",
      profile: {
        stack: "TypeScript",
        packageManager: "pnpm",
        monorepo: false,
        commands: { test: "pnpm test", typecheck: "tsc", lint: null, build: null, format: null },
        verify: "pnpm test",
      },
      artifactHashes: {},
      options: { ignoreInTool: false, gitignoreScripts: false, maxIterations: 20 },
    };
    fs.writeFileSync(path.join(tmpDir, ".ralph.json"), JSON.stringify(marker));

    const instrPaths: InstructionPaths = { ralphMd: null, reviewMd: null };
    const items = [makeItem({ id: "001", title: "X", status: "done", completedAt: "2026-01-01" })];

    const result = buildReviewPrompt(paths, instrPaths, items, "");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain("per-root review progress");
    }
  });
});
