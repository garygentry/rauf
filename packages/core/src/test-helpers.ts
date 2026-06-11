import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Backlog, LoopState } from "./schemas.js";

interface BacklogRootConfig {
  /** Relative path from project root (e.g., "specs/auth", ".rauf") */
  path: string;
  /** Backlog content. If omitted, creates a minimal empty backlog */
  backlog?: Partial<Backlog>;
  /** State.json content. If omitted, no state.json is created */
  state?: Partial<LoopState>;
  /** Whether to create a RAUF.md in this root's state dir */
  hasRaufMd?: boolean;
  /** Whether to create a REVIEW.md in this root's state dir */
  hasReviewMd?: boolean;
  /** Whether to place backlog.json in the root (true) or stateDir (false). Default: true */
  backlogInRoot?: boolean;
}

interface MultiRootProject {
  /** Absolute path to the temporary project root */
  projectPath: string;
  /** Remove the temp directory and all contents */
  cleanup: () => void;
}

/**
 * Create a temporary project directory with multi-root structure.
 *
 * Always creates:
 * - .rauf.json marker file
 * - .rauf/ default root with empty backlog.json
 * - .rauf/RAUF.md (project-level instructions)
 *
 * Additional roots are created per the `roots` array. For each root:
 * - Creates the root directory
 * - Creates .rauf/ state subdirectory (unless root IS .rauf/)
 * - Writes backlog.json (in root or stateDir per backlogInRoot flag)
 * - Optionally writes state.json, RAUF.md, REVIEW.md
 *
 * @param options - Root configurations (default root is always created)
 * @returns Project path and cleanup function
 */
export function createMultiRootProject(options?: {
  roots?: BacklogRootConfig[];
}): MultiRootProject {
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), "ralph-test-"));

  // Create .rauf.json marker
  fs.writeFileSync(
    path.join(projectPath, ".rauf.json"),
    JSON.stringify({
      rauf: true,
      version: "0.1.0",
      variant: "backlog-json",
      installedAt: new Date().toISOString(),
      installedBy: "test",
      profile: {
        stack: "typescript",
        packageManager: "pnpm",
        monorepo: false,
        commands: { test: null, typecheck: null, lint: null, build: null, format: null },
        verify: "echo ok",
      },
      artifactHashes: {},
      options: { ignoreInTool: false, gitignoreScripts: false, maxIterations: 20 },
    }),
  );

  // Create default root (.rauf/) with empty backlog and RAUF.md
  const defaultDir = path.join(projectPath, ".rauf");
  fs.mkdirSync(defaultDir, { recursive: true });
  writeBacklogFile(path.join(defaultDir, "backlog.json"), {
    schemaVersion: "1",
    project: "test",
    description: "",
    items: [],
  });
  fs.writeFileSync(path.join(defaultDir, "RAUF.md"), "# Default RAUF.md\n");

  // Create additional roots
  for (const root of options?.roots ?? []) {
    if (root.path === ".rauf") continue; // default already created

    const rootDir = path.join(projectPath, root.path);
    fs.mkdirSync(rootDir, { recursive: true });

    // Determine state dir
    const stateDir = path.basename(rootDir) === ".rauf" ? rootDir : path.join(rootDir, ".rauf");
    fs.mkdirSync(stateDir, { recursive: true });

    // Write backlog.json
    const backlogContent: Backlog = {
      schemaVersion: "1",
      project: root.backlog?.project ?? "test",
      description: root.backlog?.description ?? "",
      items: root.backlog?.items ?? [],
    };
    const backlogLocation =
      (root.backlogInRoot ?? true)
        ? path.join(rootDir, "backlog.json")
        : path.join(stateDir, "backlog.json");
    writeBacklogFile(backlogLocation, backlogContent);

    // Write state.json if provided
    if (root.state) {
      const stateContent: LoopState = {
        status: "idle",
        iteration: 0,
        maxIterations: 20,
        currentItem: null,
        lastSignal: null,
        startedAt: null,
        updatedAt: null,
        completedItems: [],
        blockedItems: [],
        deferredItems: [],
        error: null,
        ...root.state,
      };
      fs.writeFileSync(path.join(stateDir, "state.json"), JSON.stringify(stateContent, null, 2));
    }

    // Write instruction files if requested
    if (root.hasRaufMd) {
      fs.writeFileSync(path.join(stateDir, "RAUF.md"), `# RAUF.md for ${root.path}\n`);
    }
    if (root.hasReviewMd) {
      fs.writeFileSync(path.join(stateDir, "REVIEW.md"), `# REVIEW.md for ${root.path}\n`);
    }
  }

  return {
    projectPath,
    cleanup: () => fs.rmSync(projectPath, { recursive: true, force: true }),
  };
}

function writeBacklogFile(filePath: string, backlog: Backlog): void {
  fs.writeFileSync(filePath, JSON.stringify(backlog, null, 2) + "\n");
}
