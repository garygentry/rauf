import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawnSync } from "node:child_process";

import {
  initProject,
  parseBacklogSeed,
  GITIGNORE_TEMPLATES,
  RAUF_GITIGNORE,
  MARKDOWN_ITEM_RE,
  type InitOptions,
} from "./greenfield.js";
import { readBacklog } from "./backlog.js";
import { defaultBacklogPaths } from "./backlog-root.js";
import { readMarkerFile, MARKER_FILENAME } from "./config.js";
import { fileExists } from "./fs-utils.js";
import { CLAUDE_MD_SENTINEL_START, CLAUDE_MD_SENTINEL_END } from "./claude-md.js";
import { ErrorCodes } from "./errors.js";

// ─── Test Fixtures ────────────────────────────────────────────────

const ARTIFACTS_DIR = path.resolve(__dirname, "../../../artifacts/variants/backlog-json");

let tmpDir: string;

function baseOpts(overrides: Partial<InitOptions> = {}): InitOptions {
  return {
    artifactsDir: ARTIFACTS_DIR,
    ...overrides,
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ralph-greenfield-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── initProject ──────────────────────────────────────────────────

describe("initProject", () => {
  it("creates directory if it does not exist", () => {
    const projectDir = path.join(tmpDir, "new-project");
    const result = initProject(projectDir, baseOpts());
    expect(result.ok).toBe(true);
    expect(fs.existsSync(projectDir)).toBe(true);
  });

  it("creates nested directories (mkdir -p)", () => {
    const projectDir = path.join(tmpDir, "a", "b", "c", "my-project");
    const result = initProject(projectDir, baseOpts());
    expect(result.ok).toBe(true);
    expect(fs.existsSync(projectDir)).toBe(true);
  });

  it("initializes a git repository", () => {
    const projectDir = path.join(tmpDir, "git-project");
    const result = initProject(projectDir, baseOpts());
    expect(result.ok).toBe(true);
    expect(fs.existsSync(path.join(projectDir, ".git"))).toBe(true);
  });

  it("creates an initial commit with .gitignore", () => {
    const projectDir = path.join(tmpDir, "commit-project");
    initProject(projectDir, baseOpts());

    // Verify there is at least one commit
    // spawnSync with array args is safe - used only for test verification
    const log = spawnSync("git", ["log", "--oneline", "-1"], {
      cwd: projectDir,
      encoding: "utf-8",
    });
    expect(log.status).toBe(0);
    expect(log.stdout).toContain("Initial commit");
  });

  it("generates stack-appropriate .gitignore for node-typescript", () => {
    const projectDir = path.join(tmpDir, "node-ts-project");
    initProject(projectDir, baseOpts({ preset: "node-typescript" }));

    const gitignore = fs.readFileSync(path.join(projectDir, ".gitignore"), "utf-8");
    expect(gitignore).toContain("node_modules/");
    expect(gitignore).toContain("*.tsbuildinfo");
    expect(gitignore).toContain(".rauf/state.json");
  });

  it("generates stack-appropriate .gitignore for python", () => {
    const projectDir = path.join(tmpDir, "python-project");
    initProject(projectDir, baseOpts({ preset: "python" }));

    const gitignore = fs.readFileSync(path.join(projectDir, ".gitignore"), "utf-8");
    expect(gitignore).toContain("__pycache__/");
    expect(gitignore).toContain(".venv/");
    expect(gitignore).toContain(".rauf/state.json");
  });

  it("generates stack-appropriate .gitignore for go", () => {
    const projectDir = path.join(tmpDir, "go-project");
    initProject(projectDir, baseOpts({ preset: "go" }));

    const gitignore = fs.readFileSync(path.join(projectDir, ".gitignore"), "utf-8");
    expect(gitignore).toContain("bin/");
    expect(gitignore).toContain(".rauf/DONE");
  });

  it("generates stack-appropriate .gitignore for rust", () => {
    const projectDir = path.join(tmpDir, "rust-project");
    initProject(projectDir, baseOpts({ preset: "rust" }));

    const gitignore = fs.readFileSync(path.join(projectDir, ".gitignore"), "utf-8");
    expect(gitignore).toContain("target/");
    expect(gitignore).toContain("Cargo.lock");
  });

  it("generates minimal .gitignore for custom preset", () => {
    const projectDir = path.join(tmpDir, "custom-project");
    initProject(projectDir, baseOpts({ preset: "custom" }));

    const gitignore = fs.readFileSync(path.join(projectDir, ".gitignore"), "utf-8");
    // Should still have ralph entries
    expect(gitignore).toContain(".rauf/state.json");
    expect(gitignore).toContain(".rauf/rauf.log");
  });

  it("scaffolds CLAUDE.md from greenfield template", () => {
    const projectDir = path.join(tmpDir, "claude-md-project");
    initProject(
      projectDir,
      baseOpts({
        preset: "node-typescript",
        projectName: "My Project",
        projectDescription: "A great project",
        requirements: "Must be fast",
      }),
    );

    const claudeMd = fs.readFileSync(path.join(projectDir, "CLAUDE.md"), "utf-8");
    expect(claudeMd).toContain("# My Project");
    expect(claudeMd).toContain("A great project");
    expect(claudeMd).toContain("Must be fast");
    expect(claudeMd).toContain("node-typescript");
    expect(claudeMd).toContain(CLAUDE_MD_SENTINEL_START);
    expect(claudeMd).toContain(CLAUDE_MD_SENTINEL_END);
  });

  it("installs standard ralph artifacts via installer (no scripts)", () => {
    const projectDir = path.join(tmpDir, "artifacts-project");
    initProject(projectDir, baseOpts());

    // No scripts deployed
    expect(fileExists(path.join(projectDir, "ralph.sh"))).toBe(false);
    expect(fileExists(path.join(projectDir, "ralph-add.sh"))).toBe(false);
    expect(fileExists(path.join(projectDir, "ralph-status.sh"))).toBe(false);

    // Check .rauf/ contents
    expect(fileExists(path.join(projectDir, ".rauf", "RAUF.md"))).toBe(true);
    expect(fileExists(path.join(projectDir, ".rauf", "backlog.json"))).toBe(true);
    expect(fileExists(path.join(projectDir, ".rauf", "progress.md"))).toBe(true);

    // Check marker file
    expect(fileExists(path.join(projectDir, MARKER_FILENAME))).toBe(true);
  });

  it("returns an InstallationReport with all actions", () => {
    const projectDir = path.join(tmpDir, "report-project");
    const result = initProject(projectDir, baseOpts({ projectName: "test-report" }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const report = result.value;
    expect(report.projectName).toBe("test-report");
    expect(report.projectPath).toBe(path.resolve(projectDir));
    expect(report.actions.length).toBeGreaterThan(0);
    expect(report.profile).toBeDefined();

    // Should include pre-install actions (git, gitignore, CLAUDE.md)
    const fileNames = report.actions.map((a) => a.file);
    expect(fileNames).toContain(".git");
    expect(fileNames).toContain(".gitignore");
    expect(fileNames).toContain("CLAUDE.md");
  });

  it("defaults projectName to directory basename", () => {
    const projectDir = path.join(tmpDir, "my-cool-project");
    const result = initProject(projectDir, baseOpts());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.projectName).toBe("my-cool-project");
  });

  it("uses preset profile in marker file", () => {
    const projectDir = path.join(tmpDir, "preset-project");
    initProject(projectDir, baseOpts({ preset: "node-typescript" }));

    const marker = readMarkerFile(projectDir);
    expect(marker.ok).toBe(true);
    if (!marker.ok) return;
    expect(marker.value.profile.stack).toBe("node-typescript");
    expect(marker.value.profile.commands.test).toBe("npm test");
  });

  it("applies profileOverrides on top of preset", () => {
    const projectDir = path.join(tmpDir, "overrides-project");
    initProject(
      projectDir,
      baseOpts({
        preset: "node-typescript",
        profileOverrides: { test: "vitest run" },
      }),
    );

    const marker = readMarkerFile(projectDir);
    expect(marker.ok).toBe(true);
    if (!marker.ok) return;
    expect(marker.value.profile.commands.test).toBe("vitest run");
    // Other commands should be from preset
    expect(marker.value.profile.commands.lint).toBe("npm run lint");
  });

  it("warns if path is outside rootDirectory", () => {
    const projectDir = path.join(tmpDir, "outside-project");
    const rootDir = path.join(tmpDir, "allowed");
    fs.mkdirSync(rootDir, { recursive: true });

    const result = initProject(projectDir, baseOpts({ rootDirectory: rootDir }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.warnings.some((w) => w.includes("outside ROOT_DIRECTORY"))).toBe(true);
  });

  it("does not warn when path is inside rootDirectory", () => {
    const rootDir = tmpDir;
    const projectDir = path.join(tmpDir, "inside-project");

    const result = initProject(projectDir, baseOpts({ rootDirectory: rootDir }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.warnings.some((w) => w.includes("outside ROOT_DIRECTORY"))).toBe(false);
  });

  it("works on existing empty directory", () => {
    const projectDir = path.join(tmpDir, "existing-empty");
    fs.mkdirSync(projectDir, { recursive: true });

    const result = initProject(projectDir, baseOpts());
    expect(result.ok).toBe(true);
  });
});

// ─── initProject: backlog seeding ────────────────────────────────

describe("initProject: backlog seeding", () => {
  it("seeds backlog from JSON seed file (Backlog format)", () => {
    const projectDir = path.join(tmpDir, "seed-json-project");
    const seedPath = path.join(tmpDir, "seed.json");

    const seedData = {
      project: "seed-project",
      description: "Seeded",
      items: [
        {
          id: "001",
          type: "feature",
          priority: 1,
          title: "First feature",
          description: "Implement first feature",
          acceptanceCriteria: ["It works"],
          status: "pending",
          completedAt: null,
        },
        {
          id: "002",
          type: "chore",
          priority: 2,
          title: "Setup CI",
          description: "Configure CI pipeline",
          acceptanceCriteria: ["CI runs"],
          status: "pending",
          completedAt: null,
        },
      ],
    };
    fs.writeFileSync(seedPath, JSON.stringify(seedData));

    const result = initProject(projectDir, baseOpts({ seedFile: seedPath }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Check backlog was seeded
    const backlog = readBacklog(defaultBacklogPaths(projectDir));
    expect(backlog.ok).toBe(true);
    if (!backlog.ok) return;
    expect(backlog.value.items.length).toBe(2);
    // IDs are auto-assigned by addItem (001, 002)
    expect(backlog.value.items[0]!.title).toBe("First feature");
    expect(backlog.value.items[1]!.title).toBe("Setup CI");
  });

  it("seeds backlog from JSON seed file (array format)", () => {
    const projectDir = path.join(tmpDir, "seed-array-project");
    const seedPath = path.join(tmpDir, "seed-array.json");

    const seedData = [
      { type: "feature", priority: 1, title: "Feature A" },
      { type: "bug", priority: 2, title: "Fix B" },
    ];
    fs.writeFileSync(seedPath, JSON.stringify(seedData));

    const result = initProject(projectDir, baseOpts({ seedFile: seedPath }));

    expect(result.ok).toBe(true);

    const backlog = readBacklog(defaultBacklogPaths(projectDir));
    expect(backlog.ok).toBe(true);
    if (!backlog.ok) return;
    expect(backlog.value.items.length).toBe(2);
    expect(backlog.value.items[0]!.type).toBe("feature");
    expect(backlog.value.items[1]!.type).toBe("bug");
  });

  it("seeds backlog from markdown seed file", () => {
    const projectDir = path.join(tmpDir, "seed-md-project");
    const seedPath = path.join(tmpDir, "seed.md");

    const seedContent = [
      "# Project Backlog",
      "",
      "- [ ] [feature] Implement user login",
      "- [ ] [chore] Set up CI pipeline",
      "- [ ] [bug] Fix memory leak",
    ].join("\n");
    fs.writeFileSync(seedPath, seedContent);

    const result = initProject(projectDir, baseOpts({ seedFile: seedPath }));

    expect(result.ok).toBe(true);

    const backlog = readBacklog(defaultBacklogPaths(projectDir));
    expect(backlog.ok).toBe(true);
    if (!backlog.ok) return;
    expect(backlog.value.items.length).toBe(3);
    expect(backlog.value.items[0]!.title).toBe("Implement user login");
    expect(backlog.value.items[0]!.type).toBe("feature");
    expect(backlog.value.items[1]!.type).toBe("chore");
    expect(backlog.value.items[2]!.type).toBe("bug");
  });

  it("seeds backlog from inline items", () => {
    const projectDir = path.join(tmpDir, "seed-inline-project");

    const result = initProject(
      projectDir,
      baseOpts({
        seedItems: [
          { type: "feature", priority: 1, title: "Inline feature" },
          { type: "chore", priority: 2, title: "Inline chore" },
        ],
      }),
    );

    expect(result.ok).toBe(true);

    const backlog = readBacklog(defaultBacklogPaths(projectDir));
    expect(backlog.ok).toBe(true);
    if (!backlog.ok) return;
    expect(backlog.value.items.length).toBe(2);
  });

  it("includes seed action in report", () => {
    const projectDir = path.join(tmpDir, "seed-report-project");
    const seedPath = path.join(tmpDir, "seed-report.md");
    fs.writeFileSync(seedPath, "- [ ] [feature] A task\n");

    const result = initProject(projectDir, baseOpts({ seedFile: seedPath }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const seedAction = result.value.actions.find((a) => a.detail.includes("Seeded"));
    expect(seedAction).toBeDefined();
    expect(seedAction!.detail).toContain("1 backlog item");
  });

  it("auto-assigns IDs sequentially", () => {
    const projectDir = path.join(tmpDir, "seed-ids-project");

    initProject(
      projectDir,
      baseOpts({
        seedItems: [
          { type: "feature", priority: 1, title: "A" },
          { type: "feature", priority: 2, title: "B" },
          { type: "feature", priority: 3, title: "C" },
        ],
      }),
    );

    const backlog = readBacklog(defaultBacklogPaths(projectDir));
    expect(backlog.ok).toBe(true);
    if (!backlog.ok) return;
    expect(backlog.value.items[0]!.id).toBe("001");
    expect(backlog.value.items[1]!.id).toBe("002");
    expect(backlog.value.items[2]!.id).toBe("003");
  });
});

// ─── parseBacklogSeed ────────────────────────────────────────────

describe("parseBacklogSeed", () => {
  describe("JSON format", () => {
    it("parses Backlog schema JSON", () => {
      const seedPath = path.join(tmpDir, "backlog.json");
      const data = {
        project: "test",
        description: "test project",
        items: [
          {
            id: "001",
            type: "feature",
            priority: 1,
            title: "Feature 1",
            description: "Desc",
            acceptanceCriteria: ["AC1"],
            status: "pending",
            completedAt: null,
          },
        ],
      };
      fs.writeFileSync(seedPath, JSON.stringify(data));

      const result = parseBacklogSeed(seedPath);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.length).toBe(1);
      expect(result.value[0]!.title).toBe("Feature 1");
      expect(result.value[0]!.type).toBe("feature");
      expect(result.value[0]!.acceptanceCriteria).toEqual(["AC1"]);
    });

    it("parses array of partial items", () => {
      const seedPath = path.join(tmpDir, "items.json");
      const data = [
        { type: "bug", title: "Fix bug" },
        { title: "No type" },
        { type: "chore", priority: 3, title: "Cleanup" },
      ];
      fs.writeFileSync(seedPath, JSON.stringify(data));

      const result = parseBacklogSeed(seedPath);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.length).toBe(3);
      expect(result.value[0]!.type).toBe("bug");
      expect(result.value[1]!.type).toBe("feature"); // default
      expect(result.value[2]!.priority).toBe(3);
    });

    it("assigns sequential priorities to partial items without priority", () => {
      const seedPath = path.join(tmpDir, "no-priority.json");
      const data = [{ title: "A" }, { title: "B" }, { title: "C" }, { title: "D" }, { title: "E" }];
      fs.writeFileSync(seedPath, JSON.stringify(data));

      const result = parseBacklogSeed(seedPath);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value[0]!.priority).toBe(1);
      expect(result.value[1]!.priority).toBe(2);
      expect(result.value[2]!.priority).toBe(3);
      expect(result.value[3]!.priority).toBe(4);
      expect(result.value[4]!.priority).toBe(4); // capped at 4
    });

    it("errors on invalid JSON", () => {
      const seedPath = path.join(tmpDir, "bad.json");
      fs.writeFileSync(seedPath, "not json {{{");

      const result = parseBacklogSeed(seedPath);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(ErrorCodes.INVALID_JSON);
    });

    it("errors on non-array non-backlog JSON", () => {
      const seedPath = path.join(tmpDir, "scalar.json");
      fs.writeFileSync(seedPath, JSON.stringify({ random: "object" }));

      const result = parseBacklogSeed(seedPath);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });

    it("handles items with all optional fields", () => {
      const seedPath = path.join(tmpDir, "full-items.json");
      const data = [
        {
          type: "feature",
          priority: 1,
          title: "Full item",
          description: "Described",
          acceptanceCriteria: ["AC1", "AC2"],
          notes: "Some notes",
          estimatedIterations: 2,
        },
      ];
      fs.writeFileSync(seedPath, JSON.stringify(data));

      const result = parseBacklogSeed(seedPath);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value[0]!.description).toBe("Described");
      expect(result.value[0]!.acceptanceCriteria).toEqual(["AC1", "AC2"]);
      expect(result.value[0]!.notes).toBe("Some notes");
      expect(result.value[0]!.estimatedIterations).toBe(2);
    });

    it("generates fallback title for items without title", () => {
      const seedPath = path.join(tmpDir, "no-title.json");
      fs.writeFileSync(seedPath, JSON.stringify([{ type: "chore" }]));

      const result = parseBacklogSeed(seedPath);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value[0]!.title).toBe("Item 1");
    });
  });

  describe("Markdown format", () => {
    it("parses - [ ] [type] title format", () => {
      const seedPath = path.join(tmpDir, "tasks.md");
      fs.writeFileSync(
        seedPath,
        [
          "- [ ] [feature] Build login page",
          "- [ ] [bug] Fix crash on startup",
          "- [ ] [chore] Update deps",
        ].join("\n"),
      );

      const result = parseBacklogSeed(seedPath);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.length).toBe(3);
      expect(result.value[0]!.type).toBe("feature");
      expect(result.value[0]!.title).toBe("Build login page");
      expect(result.value[1]!.type).toBe("bug");
      expect(result.value[2]!.type).toBe("chore");
    });

    it("assigns sequential priorities capped at 4", () => {
      const seedPath = path.join(tmpDir, "priorities.md");
      fs.writeFileSync(
        seedPath,
        [
          "- [ ] Task 1",
          "- [ ] Task 2",
          "- [ ] Task 3",
          "- [ ] Task 4",
          "- [ ] Task 5",
          "- [ ] Task 6",
        ].join("\n"),
      );

      const result = parseBacklogSeed(seedPath);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value[0]!.priority).toBe(1);
      expect(result.value[1]!.priority).toBe(2);
      expect(result.value[2]!.priority).toBe(3);
      expect(result.value[3]!.priority).toBe(4);
      expect(result.value[4]!.priority).toBe(4);
      expect(result.value[5]!.priority).toBe(4);
    });

    it("defaults to feature type when type is missing", () => {
      const seedPath = path.join(tmpDir, "no-type.md");
      fs.writeFileSync(seedPath, "- [ ] Just a task\n");

      const result = parseBacklogSeed(seedPath);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value[0]!.type).toBe("feature");
      expect(result.value[0]!.title).toBe("Just a task");
    });

    it("defaults to feature for unknown types", () => {
      const seedPath = path.join(tmpDir, "bad-type.md");
      fs.writeFileSync(seedPath, "- [ ] [epic] Something\n");

      const result = parseBacklogSeed(seedPath);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value[0]!.type).toBe("feature");
    });

    it("ignores non-checklist lines", () => {
      const seedPath = path.join(tmpDir, "mixed.md");
      fs.writeFileSync(
        seedPath,
        [
          "# My Backlog",
          "",
          "Some intro text.",
          "",
          "- [ ] [feature] Real task",
          "- Not a task",
          "Regular line",
          "- [ ] [bug] Another real task",
        ].join("\n"),
      );

      const result = parseBacklogSeed(seedPath);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.length).toBe(2);
    });

    it("handles checked items (- [x])", () => {
      const seedPath = path.join(tmpDir, "checked.md");
      fs.writeFileSync(seedPath, "- [x] [feature] Done task\n");

      const result = parseBacklogSeed(seedPath);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.length).toBe(1);
      expect(result.value[0]!.title).toBe("Done task");
    });

    it("returns empty array for markdown with no tasks", () => {
      const seedPath = path.join(tmpDir, "empty.md");
      fs.writeFileSync(seedPath, "# Just a heading\n\nSome text.\n");

      const result = parseBacklogSeed(seedPath);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.length).toBe(0);
    });

    it("handles case-insensitive type matching", () => {
      const seedPath = path.join(tmpDir, "case.md");
      fs.writeFileSync(seedPath, "- [ ] [Feature] Mixed case\n");

      const result = parseBacklogSeed(seedPath);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value[0]!.type).toBe("feature");
    });
  });

  it("errors on missing seed file", () => {
    const result = parseBacklogSeed(path.join(tmpDir, "nonexistent.json"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(ErrorCodes.FILE_NOT_FOUND);
  });

  it("errors on unsupported file extension", () => {
    const seedPath = path.join(tmpDir, "seed.txt");
    fs.writeFileSync(seedPath, "some content");

    const result = parseBacklogSeed(seedPath);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    expect(result.error.message).toContain(".txt");
  });
});

// ─── MARKDOWN_ITEM_RE ────────────────────────────────────────────

describe("MARKDOWN_ITEM_RE", () => {
  it("matches - [ ] [type] title", () => {
    const match = MARKDOWN_ITEM_RE.exec("- [ ] [feature] Build API");
    expect(match).not.toBeNull();
    expect(match![1]).toBe("feature");
    expect(match![2]).toBe("Build API");
  });

  it("matches - [ ] title (no type)", () => {
    const match = MARKDOWN_ITEM_RE.exec("- [ ] Just a task");
    expect(match).not.toBeNull();
    expect(match![1]).toBeUndefined();
    expect(match![2]).toBe("Just a task");
  });

  it("matches - [x] [type] title (checked)", () => {
    const match = MARKDOWN_ITEM_RE.exec("- [x] [bug] Fix it");
    expect(match).not.toBeNull();
    expect(match![1]).toBe("bug");
    expect(match![2]).toBe("Fix it");
  });

  it("does not match - item (no checkbox)", () => {
    const match = MARKDOWN_ITEM_RE.exec("- item without checkbox");
    expect(match).toBeNull();
  });

  it("does not match empty lines", () => {
    const match = MARKDOWN_ITEM_RE.exec("");
    expect(match).toBeNull();
  });
});

// ─── GITIGNORE_TEMPLATES ─────────────────────────────────────────

describe("GITIGNORE_TEMPLATES", () => {
  it("has templates for all standard presets", () => {
    expect(GITIGNORE_TEMPLATES["node-typescript"]).toBeDefined();
    expect(GITIGNORE_TEMPLATES["node-javascript"]).toBeDefined();
    expect(GITIGNORE_TEMPLATES["python"]).toBeDefined();
    expect(GITIGNORE_TEMPLATES["go"]).toBeDefined();
    expect(GITIGNORE_TEMPLATES["rust"]).toBeDefined();
    expect(GITIGNORE_TEMPLATES["custom"]).toBeDefined();
  });
});

// ─── RAUF_GITIGNORE ─────────────────────────────────────────────

describe("RAUF_GITIGNORE", () => {
  it("includes state.json, DONE, and rauf.log", () => {
    expect(RAUF_GITIGNORE).toContain(".rauf/state.json");
    expect(RAUF_GITIGNORE).toContain(".rauf/DONE");
    expect(RAUF_GITIGNORE).toContain(".rauf/rauf.log");
  });
});

// ─── Error cases ─────────────────────────────────────────────────

describe("initProject: error cases", () => {
  it("errors if artifacts directory is missing template", () => {
    const projectDir = path.join(tmpDir, "no-artifacts-project");
    const result = initProject(projectDir, {
      artifactsDir: path.join(tmpDir, "nonexistent-artifacts"),
    });

    // git init succeeds, but CLAUDE.md template will fail
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(ErrorCodes.FILE_NOT_FOUND);
  });
});
