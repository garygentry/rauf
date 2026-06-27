import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { BacklogItem, Backlog, MarkerFile, BacklogPaths, InstructionPaths } from "@rauf/core";
import { defaultBacklogPaths } from "@rauf/core";
import { buildPrompt, buildReviewPrompt } from "./prompt-builder.js";

const RAUF_DIR = ".rauf";

/** Build BacklogPaths for the default .rauf root in a test dir */
function testPaths(tmpDir: string): BacklogPaths {
  return defaultBacklogPaths(tmpDir);
}

/** Build BacklogPaths for a non-default root */
function nonDefaultPaths(tmpDir: string, rootRel: string): BacklogPaths {
  const root = path.join(tmpDir, rootRel);
  const stateDir = path.join(root, ".rauf");
  return {
    projectPath: tmpDir,
    root,
    stateDir,
    backlog: path.join(root, "backlog.json"),
    state: path.join(stateDir, "state.json"),
    log: path.join(stateDir, "rauf.log"),
    done: path.join(stateDir, "DONE"),
    cancel: path.join(stateDir, "CANCEL"),
    progress: path.join(stateDir, "progress.md"),
    iterationStatus: path.join(stateDir, "iteration-status.json"),
    archive: path.join(stateDir, "archive"),
    lock: path.join(stateDir, ".loop.lock"),
    eventsLog: path.join(stateDir, "events.ndjson"),
  };
}

/** Build InstructionPaths for the default .rauf root in a test dir */
function testInstructionPaths(tmpDir: string): InstructionPaths {
  const raufMd = path.join(tmpDir, RAUF_DIR, "RAUF.md");
  const reviewMd = path.join(tmpDir, RAUF_DIR, "REVIEW.md");
  return {
    raufMd: fs.existsSync(raufMd) ? raufMd : null,
    reviewMd: fs.existsSync(reviewMd) ? reviewMd : null,
  };
}

function createTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "prompt-builder-test-"));
}

function setupProject(
  tmpDir: string,
  opts: {
    raufMd?: string;
    progressMd?: string | null;
    /** Optional: set up files in a non-default state directory */
    stateDir?: string;
  } = {},
): void {
  const raufDir = opts.stateDir ?? path.join(tmpDir, RAUF_DIR);
  fs.mkdirSync(raufDir, { recursive: true });

  if (opts.raufMd !== undefined) {
    fs.writeFileSync(path.join(raufDir, "RAUF.md"), opts.raufMd);
  }

  if (opts.progressMd !== undefined && opts.progressMd !== null) {
    fs.writeFileSync(path.join(raufDir, "progress.md"), opts.progressMd);
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
    schemaVersion: "1",
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
        raufMd: "# RAUF Instructions\nDo the work.",
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

    it("includes RAUF.md content as system context", () => {
      const raufContent = "## Verification Commands\n\nRun pnpm test && pnpm typecheck";
      setupProject(tmpDir, { raufMd: raufContent });

      const result = buildPrompt(
        testPaths(tmpDir),
        testInstructionPaths(tmpDir),
        makeItem(),
        makeBacklog(),
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toContain(raufContent);
        expect(result.value).toContain("# Rauf — Per-Iteration Instructions");
      }
    });

    it("includes the current item as formatted JSON", () => {
      setupProject(tmpDir, { raufMd: "instructions" });
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
      setupProject(tmpDir, { raufMd: "instructions" });
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
      setupProject(tmpDir, { raufMd: "instructions" });
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
      setupProject(tmpDir, { raufMd: "instructions" });
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
      setupProject(tmpDir, { raufMd: "instructions" });
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
      setupProject(tmpDir, { raufMd: "instructions" });
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
      setupProject(tmpDir, { raufMd: "instructions" });
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
      setupProject(tmpDir, { raufMd: "instructions" });
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
      setupProject(tmpDir, { raufMd: "instructions" });
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
          "**IMPORTANT:** You are working on item 007 ONLY. Do NOT modify .rauf/backlog.json or .rauf/state.json",
        );
      }
    });

    it("includes current task header with item id and title", () => {
      setupProject(tmpDir, { raufMd: "instructions" });
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
      setupProject(tmpDir, { raufMd: "instructions" });
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
      setupProject(tmpDir, { raufMd: "instructions" });
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
      setupProject(tmpDir, { raufMd: "instructions" });
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
        raufMd: "instructions",
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
        raufMd: "instructions",
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
      setupProject(tmpDir, { raufMd: "instructions" });
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
        expect(result.value).not.toMatch(/Task tool/i);
      }
    });

    it("does not include delegation hint when estimatedIterations is 1", () => {
      setupProject(tmpDir, { raufMd: "instructions" });
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
      setupProject(tmpDir, { raufMd: "instructions" });
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
      setupProject(tmpDir, { raufMd: "instructions" });
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
        // Delegation language must be host-agnostic — no Claude-only "Task tool" reference leaks
        // into the prompt sent to whichever provider runs the iteration (P0 review).
        expect(result.value).toMatch(/subagent\/delegation|inline/i);
        expect(result.value).not.toMatch(/Task tool/i);
        expect(result.value).not.toContain("Claude Code Tasks");
      }
    });

    it("handles agent delegation with only strategy", () => {
      setupProject(tmpDir, { raufMd: "instructions" });
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

  describe("missing RAUF.md", () => {
    it("returns err when RAUF.md does not exist", () => {
      // Create .rauf dir but no RAUF.md
      fs.mkdirSync(path.join(tmpDir, RAUF_DIR), { recursive: true });

      const result = buildPrompt(
        testPaths(tmpDir),
        testInstructionPaths(tmpDir),
        makeItem(),
        makeBacklog(),
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("FILE_NOT_FOUND");
        expect(result.error.message).toContain("RAUF.md");
      }
    });

    it("returns err when .rauf directory does not exist", () => {
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
        raufMd: "System instructions here",
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
        expect(result.value).toContain("# Rauf — Per-Iteration Instructions");
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
      setupProject(tmpDir, { raufMd: "instructions" });
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

  describe("Human's Answer section", () => {
    it("includes the section with the answer text when item.humanAnswer is set", () => {
      setupProject(tmpDir, { raufMd: "instructions" });
      const item = makeItem({ humanAnswer: "use schema v5" });

      const result = buildPrompt(
        testPaths(tmpDir),
        testInstructionPaths(tmpDir),
        item,
        makeBacklog([item]),
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toContain("## Human's Answer to Your Previous Question");
        expect(result.value).toContain("use schema v5");
      }
    });

    it("omits the section when item.humanAnswer is not set", () => {
      setupProject(tmpDir, { raufMd: "instructions" });
      const item = makeItem();

      const result = buildPrompt(
        testPaths(tmpDir),
        testInstructionPaths(tmpDir),
        item,
        makeBacklog([item]),
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).not.toContain("## Human's Answer to Your Previous Question");
      }
    });

    it("positions the answer section after the task and before the backlog summary", () => {
      setupProject(tmpDir, { raufMd: "instructions" });
      const item = makeItem({ humanAnswer: "answer-token-xyz" });

      const result = buildPrompt(
        testPaths(tmpDir),
        testInstructionPaths(tmpDir),
        item,
        makeBacklog([item]),
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        const taskIdx = result.value.indexOf("## Your Current Task");
        const answerIdx = result.value.indexOf("## Human's Answer to Your Previous Question");
        const summaryIdx = result.value.indexOf("### Backlog Summary");
        expect(taskIdx).toBeGreaterThanOrEqual(0);
        expect(answerIdx).toBeGreaterThan(taskIdx);
        expect(summaryIdx).toBeGreaterThan(answerIdx);
      }
    });
  });

  describe("edge cases", () => {
    it("handles empty backlog items array", () => {
      setupProject(tmpDir, { raufMd: "instructions" });
      const backlog: Backlog = {
        schemaVersion: "1",
        project: "empty",
        description: "empty project",
        items: [],
      };

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
      setupProject(tmpDir, { raufMd: "instructions" });
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
        raufMd: "instructions",
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
      setupProject(tmpDir, { raufMd: "instructions" });

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
          "You are working against the backlog at: .rauf/backlog.json",
        );
        expect(result.value).toContain("State directory: .rauf/");
        expect(result.value).toContain("Progress log: .rauf/progress.md");
        expect(result.value).toContain("Do NOT modify files outside this state directory.");
      }
    });

    it("is injected with correct relative paths for non-default root", () => {
      const paths = nonDefaultPaths(tmpDir, "specs/auth");
      const stateDir = paths.stateDir;
      fs.mkdirSync(stateDir, { recursive: true });
      fs.writeFileSync(path.join(stateDir, "RAUF.md"), "instructions");

      const instrPaths: InstructionPaths = {
        raufMd: path.join(stateDir, "RAUF.md"),
        reviewMd: null,
      };

      const result = buildPrompt(paths, instrPaths, makeItem(), makeBacklog());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toContain("## Active Backlog Root");
        expect(result.value).toContain(
          "You are working against the backlog at: specs/auth/backlog.json",
        );
        expect(result.value).toContain("State directory: specs/auth/.rauf/");
        expect(result.value).toContain("Progress log: specs/auth/.rauf/progress.md");
      }
    });
  });

  describe("non-default root handling", () => {
    it("reads RAUF.md from per-root stateDir", () => {
      const paths = nonDefaultPaths(tmpDir, "specs/auth");
      fs.mkdirSync(paths.stateDir, { recursive: true });
      fs.writeFileSync(path.join(paths.stateDir, "RAUF.md"), "per-root instructions");

      const instrPaths: InstructionPaths = {
        raufMd: path.join(paths.stateDir, "RAUF.md"),
        reviewMd: null,
      };

      const result = buildPrompt(paths, instrPaths, makeItem(), makeBacklog());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toContain("per-root instructions");
      }
    });

    it("reads RAUF.md from project-level fallback", () => {
      // Set up project-level RAUF.md
      setupProject(tmpDir, { raufMd: "project-level instructions" });
      const paths = nonDefaultPaths(tmpDir, "specs/auth");
      fs.mkdirSync(paths.stateDir, { recursive: true });

      // instructionPaths resolved to project-level fallback
      const instrPaths: InstructionPaths = {
        raufMd: path.join(tmpDir, ".rauf", "RAUF.md"),
        reviewMd: null,
      };

      const result = buildPrompt(paths, instrPaths, makeItem(), makeBacklog());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toContain("project-level instructions");
      }
    });

    it("returns error when RAUF.md missing everywhere", () => {
      const paths = nonDefaultPaths(tmpDir, "specs/auth");
      fs.mkdirSync(paths.stateDir, { recursive: true });

      const instrPaths: InstructionPaths = { raufMd: null, reviewMd: null };

      const result = buildPrompt(paths, instrPaths, makeItem(), makeBacklog());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("FILE_NOT_FOUND");
        expect(result.error.message).toContain("RAUF.md");
      }
    });

    it("reads progress.md always from stateDir", () => {
      const paths = nonDefaultPaths(tmpDir, "specs/auth");
      fs.mkdirSync(paths.stateDir, { recursive: true });
      fs.writeFileSync(path.join(paths.stateDir, "RAUF.md"), "instructions");
      fs.writeFileSync(path.join(paths.stateDir, "progress.md"), "per-root progress");

      const instrPaths: InstructionPaths = {
        raufMd: path.join(paths.stateDir, "RAUF.md"),
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
      fs.writeFileSync(path.join(paths.stateDir, "RAUF.md"), "instructions");

      const instrPaths: InstructionPaths = {
        raufMd: path.join(paths.stateDir, "RAUF.md"),
        reviewMd: null,
      };

      const result = buildPrompt(paths, instrPaths, makeItem({ id: "042" }), makeBacklog());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toContain(
          "Do NOT modify specs/auth/backlog.json or specs/auth/.rauf/state.json",
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
    const raufDir = path.join(dir, RAUF_DIR);
    fs.mkdirSync(raufDir, { recursive: true });

    if (opts.reviewMd !== undefined) {
      fs.writeFileSync(path.join(raufDir, "REVIEW.md"), opts.reviewMd);
    }

    if (opts.progressMd !== undefined && opts.progressMd !== null) {
      fs.writeFileSync(path.join(raufDir, "progress.md"), opts.progressMd);
    }

    if (opts.markerFile !== false) {
      const marker: MarkerFile = {
        rauf: true,
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
      fs.writeFileSync(path.join(dir, ".rauf.json"), JSON.stringify(marker, null, 2));
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
      rauf: true,
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
    fs.writeFileSync(path.join(tmpDir, ".rauf.json"), JSON.stringify(marker));

    const instrPaths: InstructionPaths = { raufMd: null, reviewMd: reviewPath };
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
    const instrPaths: InstructionPaths = { raufMd: null, reviewMd: null };
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
      rauf: true,
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
    fs.writeFileSync(path.join(tmpDir, ".rauf.json"), JSON.stringify(marker));

    const instrPaths: InstructionPaths = { raufMd: null, reviewMd: null };
    const items = [makeItem({ id: "001", title: "X", status: "done", completedAt: "2026-01-01" })];

    const result = buildReviewPrompt(paths, instrPaths, items, "");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain("per-root review progress");
    }
  });
});
