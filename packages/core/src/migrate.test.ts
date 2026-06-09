import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";

import { rewriteRalphStrings, detectMigrationState, planMigration, migrate } from "./migrate.js";

// ─── Fixtures ────────────────────────────────────────────────────

const created: string[] = [];

afterEach(() => {
  while (created.length) {
    const dir = created.pop()!;
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rauf-migrate-test-"));
  created.push(dir);
  return dir;
}

function legacyMarker(extra?: Record<string, unknown>): string {
  return (
    JSON.stringify(
      {
        ralph: true,
        version: "0.1.0",
        variant: "backlog-json",
        installedAt: "2026-01-01T00:00:00.000Z",
        installedBy: "ralph-manager@0.1.0",
        profile: {
          stack: "typescript",
          packageManager: "pnpm",
          monorepo: false,
          commands: { test: null, typecheck: null, lint: null, build: null, format: null },
          verify: "echo ok",
        },
        artifactHashes: { "RALPH.md": "deadbeef", "ralph.sh": "stalekey" },
        options: { ignoreInTool: false, gitignoreScripts: false, maxIterations: 20 },
        ...extra,
      },
      null,
      2,
    ) + "\n"
  );
}

interface ProjectOpts {
  withRootState?: boolean;
  rootStateStatus?: string;
  claudeMd?: string;
  gitignore?: string;
  biome?: string;
  /** nested spec dirs (relative, e.g. "specs/auth") each with a .ralph/ + state.json */
  nestedSpecs?: string[];
  /** a .ralph dir with NO state.json (report-only) at this relative parent */
  foreignRalphAt?: string;
  /** write a .loop.lock in the root .ralph with this content */
  rootLock?: { pid: number; processStartTime: number | null };
  /** write a .loop.lock in a nested spec's .ralph */
  nestedLock?: { spec: string; pid: number; processStartTime: number | null };
}

function makeLegacyProject(opts: ProjectOpts = {}): string {
  const root = tmp();
  fs.writeFileSync(path.join(root, ".ralph.json"), legacyMarker());

  const dotRalph = path.join(root, ".ralph");
  fs.mkdirSync(dotRalph, { recursive: true });
  fs.writeFileSync(
    path.join(dotRalph, "RALPH.md"),
    "# RALPH guidance\nEmit RALPH_DONE when finished. State lives in .ralph/state.json.\n",
  );
  fs.writeFileSync(path.join(dotRalph, "REVIEW.md"), "# Review for ralph\nUses .ralph/ paths.\n");
  fs.writeFileSync(
    path.join(dotRalph, "backlog.schema.json"),
    JSON.stringify(
      { $id: "https://example/garygentry/ralph/backlog", title: "Ralph Backlog" },
      null,
      2,
    ) + "\n",
  );
  fs.writeFileSync(
    path.join(dotRalph, "backlog.json"),
    JSON.stringify({ project: "p", description: "", items: [] }, null, 2) + "\n",
  );
  fs.writeFileSync(path.join(dotRalph, "progress.md"), "User notes mentioning ralph stay as-is.\n");
  fs.writeFileSync(path.join(dotRalph, "ralph.log"), "historical ralph log line\n");
  fs.mkdirSync(path.join(dotRalph, "archive"), { recursive: true });
  fs.writeFileSync(path.join(dotRalph, "archive", "2026-03-ralph.log"), "archived ralph log\n");

  if (opts.withRootState) {
    fs.writeFileSync(
      path.join(dotRalph, "state.json"),
      JSON.stringify({
        status: opts.rootStateStatus ?? "complete",
        iteration: 8,
        maxIterations: 20,
        currentItem: null,
        lastSignal: "clean",
        startedAt: null,
        updatedAt: null,
        completedItems: [],
        blockedItems: [],
        error: null,
      }),
    );
  }

  if (opts.rootLock) {
    fs.writeFileSync(
      path.join(dotRalph, ".loop.lock"),
      JSON.stringify({ ...opts.rootLock, startedAt: "2026-01-01T00:00:00.000Z" }),
    );
  }

  for (const spec of opts.nestedSpecs ?? []) {
    const specDir = path.join(root, spec, ".ralph");
    fs.mkdirSync(specDir, { recursive: true });
    fs.writeFileSync(
      path.join(specDir, "state.json"),
      JSON.stringify({
        status: "complete",
        iteration: 3,
        maxIterations: 10,
        currentItem: null,
        lastSignal: "clean",
        startedAt: null,
        updatedAt: null,
        completedItems: [],
        blockedItems: [],
        error: null,
      }),
    );
    fs.writeFileSync(path.join(specDir, "ralph.log"), `nested ralph log for ${spec}\n`);
    fs.writeFileSync(path.join(specDir, "progress.md"), `progress for ${spec} mentions ralph\n`);
    fs.writeFileSync(path.join(specDir, "DONE"), "");
  }

  if (opts.nestedLock) {
    const specDir = path.join(root, opts.nestedLock.spec, ".ralph");
    fs.mkdirSync(specDir, { recursive: true });
    fs.writeFileSync(
      path.join(specDir, "state.json"),
      JSON.stringify({
        status: "running",
        iteration: 1,
        maxIterations: 10,
        currentItem: null,
        lastSignal: null,
        startedAt: null,
        updatedAt: null,
        completedItems: [],
        blockedItems: [],
        error: null,
      }),
    );
    fs.writeFileSync(
      path.join(specDir, ".loop.lock"),
      JSON.stringify({
        pid: opts.nestedLock.pid,
        processStartTime: opts.nestedLock.processStartTime,
        startedAt: "x",
      }),
    );
  }

  if (opts.foreignRalphAt !== undefined) {
    const foreignDir = path.join(root, opts.foreignRalphAt, ".ralph");
    fs.mkdirSync(foreignDir, { recursive: true });
    fs.writeFileSync(path.join(foreignDir, "notes.txt"), "not a loop dir\n");
  }

  if (opts.claudeMd !== undefined) {
    fs.writeFileSync(path.join(root, "CLAUDE.md"), opts.claudeMd);
  }
  if (opts.gitignore !== undefined) {
    fs.writeFileSync(path.join(root, ".gitignore"), opts.gitignore);
  }
  if (opts.biome !== undefined) {
    fs.writeFileSync(path.join(root, "biome.json"), opts.biome);
  }

  return root;
}

// ─── rewriteRalphStrings (case-aware) ────────────────────────────

describe("rewriteRalphStrings", () => {
  it("maps each casing correctly", () => {
    expect(rewriteRalphStrings("RALPH_DONE")).toBe("RAUF_DONE");
    expect(rewriteRalphStrings("RALPH_BLOCKED")).toBe("RAUF_BLOCKED");
    expect(rewriteRalphStrings("RALPH_NEEDS_HUMAN")).toBe("RAUF_NEEDS_HUMAN");
    expect(rewriteRalphStrings("RALPH_REVIEW")).toBe("RAUF_REVIEW");
    expect(rewriteRalphStrings("RALPH_ROOT")).toBe("RAUF_ROOT");
    expect(rewriteRalphStrings("X-Ralph-Request")).toBe("X-Rauf-Request");
    expect(rewriteRalphStrings("RalphError")).toBe("RaufError");
    expect(rewriteRalphStrings("RALPH.md")).toBe("RAUF.md");
    expect(rewriteRalphStrings(".ralph.json")).toBe(".rauf.json");
    expect(rewriteRalphStrings(".ralph/")).toBe(".rauf/");
    expect(rewriteRalphStrings("<!-- ralph:managed:start -->")).toBe("<!-- rauf:managed:start -->");
    expect(rewriteRalphStrings("garygentry/ralph")).toBe("garygentry/rauf");
    expect(rewriteRalphStrings("Ralph Backlog")).toBe("Rauf Backlog");
  });

  it("is idempotent on a second pass", () => {
    const once = rewriteRalphStrings("RALPH_DONE .ralph/ RalphError X-Ralph-Request ralph");
    expect(rewriteRalphStrings(once)).toBe(once);
    expect(once).not.toMatch(/ralph/i);
  });
});

// ─── detectMigrationState ────────────────────────────────────────

describe("detectMigrationState", () => {
  it("detects a legacy ralph install", () => {
    const root = makeLegacyProject();
    const r = detectMigrationState(root);
    expect(r.ok && r.value).toBe("legacy_ralph");
  });

  it("detects not_installed for a bare dir", () => {
    const root = tmp();
    const r = detectMigrationState(root);
    expect(r.ok && r.value).toBe("not_installed");
  });

  it("detects already_rauf", () => {
    const root = tmp();
    fs.writeFileSync(
      path.join(root, ".rauf.json"),
      JSON.stringify({ rauf: true, version: "0.1.0" }),
    );
    const r = detectMigrationState(root);
    expect(r.ok && r.value).toBe("already_rauf");
  });

  it("detects partial when both markers exist", () => {
    const root = makeLegacyProject();
    fs.writeFileSync(
      path.join(root, ".rauf.json"),
      JSON.stringify({ rauf: true, version: "0.1.0" }),
    );
    const r = detectMigrationState(root);
    expect(r.ok && r.value).toBe("partial");
  });

  it("detects marker_corrupt for unparseable marker (not not_installed)", () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, ".ralph.json"), "{ this is : not json");
    const r = detectMigrationState(root);
    expect(r.ok && r.value).toBe("marker_corrupt");
  });

  it("errors for a missing directory", () => {
    const r = detectMigrationState(path.join(os.tmpdir(), "does-not-exist-rauf-xyz"));
    expect(r.ok).toBe(false);
  });
});

// ─── planMigration (dry-run, no writes) ──────────────────────────

describe("planMigration", () => {
  it("plans without writing anything", () => {
    const root = makeLegacyProject({ withRootState: true });
    const before = fs.readFileSync(path.join(root, ".ralph", "RALPH.md"), "utf-8");

    const r = planMigration(root);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.dryRun).toBe(true);
    expect(r.value.applied).toBe(false);

    // Nothing mutated.
    expect(fs.existsSync(path.join(root, ".ralph"))).toBe(true);
    expect(fs.existsSync(path.join(root, ".rauf"))).toBe(false);
    expect(fs.existsSync(path.join(root, ".ralph.json"))).toBe(true);
    expect(fs.existsSync(path.join(root, ".rauf.json"))).toBe(false);
    expect(fs.readFileSync(path.join(root, ".ralph", "RALPH.md"), "utf-8")).toBe(before);
    expect(r.value.loopDirsRenamed.some((d) => d.endsWith(".ralph"))).toBe(true);
  });

  it("reports a marker_corrupt plan with a warning", () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, ".ralph.json"), "{corrupt");
    const r = planMigration(root);
    expect(r.ok && r.value.state).toBe("marker_corrupt");
  });
});

// ─── migrate: happy path ─────────────────────────────────────────

describe("migrate (legacy → rauf)", () => {
  it("renames dir, files, marker and rewrites content", () => {
    const root = makeLegacyProject({ withRootState: true });
    const r = migrate(root);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // Dir + marker renamed.
    expect(fs.existsSync(path.join(root, ".rauf"))).toBe(true);
    expect(fs.existsSync(path.join(root, ".ralph"))).toBe(false);
    expect(fs.existsSync(path.join(root, ".rauf.json"))).toBe(true);
    expect(fs.existsSync(path.join(root, ".ralph.json"))).toBe(false);

    // Inner files renamed.
    expect(fs.existsSync(path.join(root, ".rauf", "RAUF.md"))).toBe(true);
    expect(fs.existsSync(path.join(root, ".rauf", "RALPH.md"))).toBe(false);
    expect(fs.existsSync(path.join(root, ".rauf", "rauf.log"))).toBe(true);
    expect(fs.existsSync(path.join(root, ".rauf", "ralph.log"))).toBe(false);

    // Content rewritten.
    const raufMd = fs.readFileSync(path.join(root, ".rauf", "RAUF.md"), "utf-8");
    expect(raufMd).toContain("RAUF_DONE");
    expect(raufMd).toContain(".rauf/state.json");
    expect(raufMd).not.toMatch(/ralph/i);

    const schema = fs.readFileSync(path.join(root, ".rauf", "backlog.schema.json"), "utf-8");
    expect(schema).toContain("garygentry/rauf");
    expect(schema).toContain("Rauf Backlog");

    // Marker rewritten: rauf:true, hash key renamed + recomputed, installedBy, stale key preserved.
    const marker = JSON.parse(fs.readFileSync(path.join(root, ".rauf.json"), "utf-8"));
    expect(marker.rauf).toBe(true);
    expect(marker.ralph).toBeUndefined();
    expect(marker.installedBy).toBe("rauf-manager@0.1.0");
    expect(marker.artifactHashes["RALPH.md"]).toBeUndefined();
    expect(marker.artifactHashes["ralph.sh"]).toBe("stalekey"); // tolerated
    const expectedHash = crypto
      .createHash("sha256")
      .update(fs.readFileSync(path.join(root, ".rauf", "RAUF.md")))
      .digest("hex");
    expect(marker.artifactHashes["RAUF.md"]).toBe(expectedHash);

    // Backups created.
    expect(fs.existsSync(path.join(root, ".ralph.bak"))).toBe(true);
    expect(fs.existsSync(path.join(root, ".ralph.json.bak"))).toBe(true);
  });

  it("preserves user data byte-for-byte (backlog/progress/archive)", () => {
    const root = makeLegacyProject({ withRootState: true });
    const progressBefore = fs.readFileSync(path.join(root, ".ralph", "progress.md"), "utf-8");
    const backlogBefore = fs.readFileSync(path.join(root, ".ralph", "backlog.json"), "utf-8");
    const archiveBefore = fs.readFileSync(
      path.join(root, ".ralph", "archive", "2026-03-ralph.log"),
      "utf-8",
    );

    const r = migrate(root);
    expect(r.ok).toBe(true);

    expect(fs.readFileSync(path.join(root, ".rauf", "progress.md"), "utf-8")).toBe(progressBefore);
    expect(fs.readFileSync(path.join(root, ".rauf", "backlog.json"), "utf-8")).toBe(backlogBefore);
    // Archive filename keeps "ralph" (decision #8) and content is byte-identical.
    expect(fs.existsSync(path.join(root, ".rauf", "archive", "2026-03-ralph.log"))).toBe(true);
    expect(fs.readFileSync(path.join(root, ".rauf", "archive", "2026-03-ralph.log"), "utf-8")).toBe(
      archiveBefore,
    );
  });

  it("is idempotent on a second run", () => {
    const root = makeLegacyProject({ withRootState: true });
    const first = migrate(root);
    expect(first.ok).toBe(true);
    const markerAfterFirst = fs.readFileSync(path.join(root, ".rauf.json"), "utf-8");

    const second = migrate(root);
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value.applied).toBe(false);
    expect(fs.readFileSync(path.join(root, ".rauf.json"), "utf-8")).toBe(markerAfterFirst);
  });
});

// ─── Nested per-spec loop dirs (decision #5 revised) ─────────────

describe("migrate: nested loop dirs", () => {
  it("renames nested .ralph-with-state.json to .rauf, contents byte-identical", () => {
    const root = makeLegacyProject({
      withRootState: true,
      nestedSpecs: ["specs/auth", "specs/datagrid"],
    });
    const authLogBefore = fs.readFileSync(path.join(root, "specs/auth/.ralph/ralph.log"), "utf-8");
    const authStateBefore = fs.readFileSync(
      path.join(root, "specs/auth/.ralph/state.json"),
      "utf-8",
    );

    const r = migrate(root);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    for (const spec of ["specs/auth", "specs/datagrid"]) {
      expect(fs.existsSync(path.join(root, spec, ".rauf"))).toBe(true);
      expect(fs.existsSync(path.join(root, spec, ".ralph"))).toBe(false);
    }
    // Inner files keep their names AND content (no rewrite of nested dirs).
    expect(fs.existsSync(path.join(root, "specs/auth/.rauf/ralph.log"))).toBe(true);
    expect(fs.readFileSync(path.join(root, "specs/auth/.rauf/ralph.log"), "utf-8")).toBe(
      authLogBefore,
    );
    expect(fs.readFileSync(path.join(root, "specs/auth/.rauf/state.json"), "utf-8")).toBe(
      authStateBefore,
    );

    expect(r.value.loopDirsRenamed.length).toBe(3); // root + 2 nested
  });

  it("reports (does not rename) a .ralph dir without state.json", () => {
    const root = makeLegacyProject({ withRootState: true, foreignRalphAt: "vendor" });
    const r = migrate(root);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // Reported, left in place.
    expect(fs.existsSync(path.join(root, "vendor", ".ralph"))).toBe(true);
    expect(fs.existsSync(path.join(root, "vendor", ".rauf"))).toBe(false);
    expect(r.value.foreignDirsReported.some((d) => d.includes("vendor"))).toBe(true);
  });
});

// ─── Lock liveness gate ──────────────────────────────────────────

describe("migrate: lock gate", () => {
  it("migrates past a stale lock + state:running and cleans it", () => {
    const root = makeLegacyProject({
      withRootState: true,
      rootStateStatus: "running",
      rootLock: { pid: 999999999, processStartTime: null },
    });
    const r = migrate(root);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(fs.existsSync(path.join(root, ".rauf"))).toBe(true);
    expect(fs.existsSync(path.join(root, ".rauf", ".loop.lock"))).toBe(false); // cleaned
    expect(r.value.staleLocks.length).toBeGreaterThanOrEqual(1);
  });

  it("refuses when the root lock is live", () => {
    const root = makeLegacyProject({
      withRootState: true,
      rootLock: { pid: process.pid, processStartTime: null },
    });
    const r = migrate(root);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("LOCK_CONFLICT");
    // Untouched.
    expect(fs.existsSync(path.join(root, ".ralph"))).toBe(true);
    expect(fs.existsSync(path.join(root, ".rauf"))).toBe(false);
  });

  it("refuses when a nested per-spec lock is live (gate scans all loop dirs)", () => {
    const root = makeLegacyProject({
      withRootState: true,
      nestedLock: { spec: "specs/live", pid: process.pid, processStartTime: null },
    });
    const r = migrate(root);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("LOCK_CONFLICT");
    expect(fs.existsSync(path.join(root, ".ralph"))).toBe(true);
  });
});

// ─── CLAUDE.md ───────────────────────────────────────────────────

describe("migrate: CLAUDE.md", () => {
  it("rewrites only the managed block and reports out-of-block refs", () => {
    const claudeMd = [
      "# My Project",
      "Some prose that mentions ralph in user text.",
      "<!-- ralph:start -->",
      "Run the ralph loop; state in .ralph/state.json; emit RALPH_DONE.",
      "<!-- ralph:end -->",
      "Trailing note about .ralph/ paths outside the block.",
      "",
    ].join("\n");
    const root = makeLegacyProject({ withRootState: true, claudeMd });

    const r = migrate(root);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const after = fs.readFileSync(path.join(root, "CLAUDE.md"), "utf-8");
    // Block rewritten.
    expect(after).toContain("<!-- rauf:start -->");
    expect(after).toContain(".rauf/state.json");
    expect(after).toContain("RAUF_DONE");
    // Out-of-block prose preserved verbatim.
    expect(after).toContain("Some prose that mentions ralph in user text.");
    expect(after).toContain("Trailing note about .ralph/ paths outside the block.");
    // Reported.
    expect(r.value.claudeMdOutOfBlockRefs.length).toBeGreaterThanOrEqual(2);
  });

  it("warns and skips when CLAUDE.md is missing", () => {
    const root = makeLegacyProject({ withRootState: true });
    const r = migrate(root);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(fs.existsSync(path.join(root, "CLAUDE.md"))).toBe(false);
  });

  it("reports all refs and skips rewrite when sentinels are missing", () => {
    const claudeMd = "# Project\nMentions ralph and .ralph/ but has no managed block.\n";
    const root = makeLegacyProject({ withRootState: true, claudeMd });
    const r = migrate(root);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(fs.readFileSync(path.join(root, "CLAUDE.md"), "utf-8")).toBe(claudeMd); // unchanged
    expect(r.value.claudeMdOutOfBlockRefs.length).toBeGreaterThanOrEqual(1);
    expect(r.value.warnings.some((w) => w.includes("no ralph managed block"))).toBe(true);
  });
});

// ─── .gitignore + foreign config ─────────────────────────────────

describe("migrate: gitignore + foreign config", () => {
  it("rewrites ralph lines in .gitignore and no-ops cleanly when absent", () => {
    const gitignore = "node_modules\n.ralph/ralph.log\n.ralph/state.json\nralph-bin\nsrc/keep.ts\n";
    const root = makeLegacyProject({ withRootState: true, gitignore });
    const r = migrate(root);
    expect(r.ok).toBe(true);
    const after = fs.readFileSync(path.join(root, ".gitignore"), "utf-8");
    expect(after).toContain(".rauf/rauf.log");
    expect(after).toContain(".rauf/state.json");
    expect(after).toContain("rauf-bin");
    expect(after).toContain("src/keep.ts"); // untouched
    expect(after).not.toMatch(/ralph/i);
  });

  it("detects foreign-config refs but does NOT rewrite them", () => {
    const biome = JSON.stringify({ formatter: { ignore: [".ralph", "dist"] } }, null, 2) + "\n";
    const root = makeLegacyProject({ withRootState: true, biome });
    const r = migrate(root);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // biome.json untouched.
    expect(fs.readFileSync(path.join(root, "biome.json"), "utf-8")).toBe(biome);
    // But reported.
    expect(r.value.foreignConfigRefs.some((ref) => ref.path.endsWith("biome.json"))).toBe(true);
  });
});
