import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it, expect, afterEach, vi } from "vitest";

// Redirect TOOL_CONFIG_DIR (and thus ACTIVE_DIR = ~/.rauf/active) to an isolated
// temp directory so registry writes never touch the real ~/.rauf.
const { TMP_HOME } = vi.hoisted(() => {
  // require() is necessary here: vi.hoisted runs before ESM imports resolve, so
  // the top-of-file node imports are not yet available at hoist time.
  /* eslint-disable @typescript-eslint/no-require-imports */
  const nodeOs = require("node:os") as typeof import("node:os");
  const nodePath = require("node:path") as typeof import("node:path");
  const nodeFs = require("node:fs") as typeof import("node:fs");
  /* eslint-enable @typescript-eslint/no-require-imports */
  const dir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), "rauf-registry-home-"));
  return { TMP_HOME: dir };
});

vi.mock("./config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config.js")>();
  const nodePath = await import("node:path");
  return { ...actual, TOOL_CONFIG_DIR: nodePath.join(TMP_HOME, ".rauf") };
});

import {
  registerLoop,
  deregisterLoop,
  updateLoopStatus,
  listActiveLoops,
  registryEntryPath,
} from "./loop-registry.js";
import { LockFileContentSchema } from "./lock.js";
import { LOCK_FILENAME } from "./backlog-root.js";
import type { ActiveLoopEntry } from "./schemas.js";

const ACTIVE_DIR = path.join(TMP_HOME, ".rauf", "active");

/** Create a fresh state dir under a temp project and an entry pointing at it. */
function makeEntry(overrides: Partial<ActiveLoopEntry> = {}): ActiveLoopEntry {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "rauf-registry-state-"));
  return {
    stateDir,
    projectPath: path.dirname(stateDir),
    backlogRoot: stateDir,
    pid: process.pid,
    startedAt: new Date().toISOString(),
    status: "starting",
    ...overrides,
  };
}

/** Write a .loop.lock in the entry's stateDir recording the given pid. */
function writeLock(stateDir: string, pid: number): void {
  fs.writeFileSync(
    path.join(path.resolve(stateDir), LOCK_FILENAME),
    JSON.stringify({ pid, startedAt: new Date().toISOString(), processStartTime: null }, null, 2) +
      "\n",
  );
}

/** A pid that is essentially certain to be dead. */
const DEAD_PID = 2_147_483_646;

describe("loop-registry", () => {
  afterEach(() => {
    // Clear the active dir between tests so listings don't bleed across cases.
    fs.rmSync(ACTIVE_DIR, { recursive: true, force: true });
  });

  describe("registryEntryPath / key", () => {
    it("derives ~/.rauf/active/<16-hex>.json and is cwd-independent", () => {
      const a = "/a/b/.rauf";
      const b = "/a/b/../b/.rauf"; // resolves to the same path
      const pa = registryEntryPath(a);
      const pb = registryEntryPath(b);

      expect(pa).toBe(pb);
      expect(path.dirname(pa)).toBe(ACTIVE_DIR);
      expect(path.basename(pa)).toMatch(/^[0-9a-f]{16}\.json$/);
    });

    it("derives distinct files for distinct state dirs", () => {
      expect(registryEntryPath("/x/.rauf")).not.toBe(registryEntryPath("/y/.rauf"));
    });
  });

  describe("registerLoop / deregisterLoop", () => {
    it("atomic-writes an ActiveLoopEntry that can be read back", () => {
      const entry = makeEntry();
      const res = registerLoop(entry);
      expect(res.ok).toBe(true);

      const written = JSON.parse(fs.readFileSync(registryEntryPath(entry.stateDir), "utf-8"));
      expect(written).toMatchObject({ stateDir: entry.stateDir, pid: entry.pid });
    });

    it("deregisterLoop is idempotent (no error if already gone)", () => {
      const entry = makeEntry();
      registerLoop(entry);

      expect(deregisterLoop(entry.stateDir).ok).toBe(true);
      expect(fs.existsSync(registryEntryPath(entry.stateDir))).toBe(false);
      // Second call — already gone — still ok.
      expect(deregisterLoop(entry.stateDir).ok).toBe(true);
    });
  });

  describe("updateLoopStatus", () => {
    it("refreshes the status of an existing entry", () => {
      const entry = makeEntry({ status: "starting" });
      registerLoop(entry);

      const res = updateLoopStatus(entry.stateDir, "running");
      expect(res.ok).toBe(true);

      const written = JSON.parse(fs.readFileSync(registryEntryPath(entry.stateDir), "utf-8"));
      expect(written.status).toBe("running");
    });

    it("is a no-op ok when the entry is missing", () => {
      const entry = makeEntry();
      const res = updateLoopStatus(entry.stateDir, "running");
      expect(res.ok).toBe(true);
      expect(fs.existsSync(registryEntryPath(entry.stateDir))).toBe(false);
    });
  });

  describe("listActiveLoops", () => {
    it("returns ok([]) when ACTIVE_DIR is missing", () => {
      const res = listActiveLoops();
      expect(res).toEqual({ ok: true, value: [] });
    });

    it("includes a live loop and excludes it after deregister", () => {
      const entry = makeEntry();
      writeLock(entry.stateDir, entry.pid); // live: our own pid
      registerLoop(entry);

      const listed = listActiveLoops();
      expect(listed.ok).toBe(true);
      if (listed.ok) {
        expect(listed.value.map((e) => e.stateDir)).toContain(entry.stateDir);
      }

      deregisterLoop(entry.stateDir);
      const after = listActiveLoops();
      if (after.ok) {
        expect(after.value.map((e) => e.stateDir)).not.toContain(entry.stateDir);
      }
    });

    it("self-heals a stale entry (dead pid): prunes the file and excludes it", () => {
      const entry = makeEntry({ pid: DEAD_PID });
      writeLock(entry.stateDir, DEAD_PID); // dead pid → not live
      registerLoop(entry);
      expect(fs.existsSync(registryEntryPath(entry.stateDir))).toBe(true);

      const listed = listActiveLoops();
      expect(listed.ok).toBe(true);
      if (listed.ok) {
        expect(listed.value.map((e) => e.stateDir)).not.toContain(entry.stateDir);
      }
      // self-heal: the stale entry file is unlinked.
      expect(fs.existsSync(registryEntryPath(entry.stateDir))).toBe(false);
    });

    it("self-heals an entry with no lock file at all", () => {
      const entry = makeEntry();
      registerLoop(entry); // no writeLock → no .loop.lock → not live

      const listed = listActiveLoops();
      if (listed.ok) {
        expect(listed.value.map((e) => e.stateDir)).not.toContain(entry.stateDir);
      }
      expect(fs.existsSync(registryEntryPath(entry.stateDir))).toBe(false);
    });

    it("skips a corrupt entry file without failing the listing", () => {
      // One live, valid entry.
      const good = makeEntry();
      writeLock(good.stateDir, good.pid);
      registerLoop(good);

      // A corrupt/foreign file alongside it.
      fs.mkdirSync(ACTIVE_DIR, { recursive: true });
      fs.writeFileSync(path.join(ACTIVE_DIR, "deadbeefdeadbeef.json"), "{ not json");

      const listed = listActiveLoops();
      expect(listed.ok).toBe(true);
      if (listed.ok) {
        expect(listed.value.map((e) => e.stateDir)).toEqual([good.stateDir]);
      }
    });

    it("returns live entries sorted deterministically by stateDir", () => {
      // Force two distinct state dirs with known ordering.
      const base = fs.mkdtempSync(path.join(os.tmpdir(), "rauf-registry-sort-"));
      const dirA = path.join(base, "aaa");
      const dirB = path.join(base, "bbb");
      fs.mkdirSync(dirA);
      fs.mkdirSync(dirB);

      for (const d of [dirB, dirA]) {
        writeLock(d, process.pid);
        registerLoop(makeEntry({ stateDir: d, pid: process.pid }));
      }

      const listed = listActiveLoops();
      if (listed.ok) {
        const dirs = listed.value.map((e) => e.stateDir);
        expect(dirs).toEqual([...dirs].sort((x, y) => x.localeCompare(y)));
        expect(dirs).toContain(dirA);
        expect(dirs).toContain(dirB);
      }
    });
  });

  it("lock content written by writeLock validates (sanity for reconciliation)", () => {
    const entry = makeEntry();
    writeLock(entry.stateDir, entry.pid);
    const raw = JSON.parse(
      fs.readFileSync(path.join(path.resolve(entry.stateDir), LOCK_FILENAME), "utf-8"),
    );
    expect(LockFileContentSchema.safeParse(raw).success).toBe(true);
  });
});
