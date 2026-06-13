import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { LOCK_FILENAME } from "./backlog-root.js";
import { TOOL_CONFIG_DIR } from "./config.js";
import { type Result, ok, err, ErrorCodes } from "./errors.js";
import { atomicWrite, ensureDir, fileExists, readJsonFile, validatePath } from "./fs-utils.js";
import { checkLockFile } from "./lock.js";
import { type ActiveLoopEntry, ActiveLoopEntrySchema, type LoopStateStatus } from "./schemas.js";

/**
 * Active-loop registry directory: ~/.rauf/active/. Inside the established sandbox
 * (REQ-SEC-01). One JSON file per running loop, keyed by hash of its resolved state dir.
 */
const ACTIVE_DIR = path.join(TOOL_CONFIG_DIR, "active");

/**
 * Registry key: first 16 hex chars of sha256(resolved state dir). The state dir is
 * resolved with path.resolve() FIRST so the same root always hashes to the same key
 * regardless of how the caller spelled the path (REQ-DISC-03 — cwd-independent).
 */
const key = (stateDir: string): string =>
  createHash("sha256").update(path.resolve(stateDir)).digest("hex").slice(0, 16);

/**
 * Absolute path to a loop's registry entry file: ~/.rauf/active/<key>.json.
 * Pure function — no IO. Exported so callers can locate a specific entry deterministically.
 */
export const registryEntryPath = (stateDir: string): string =>
  path.join(ACTIVE_DIR, `${key(stateDir)}.json`);

/**
 * Register a running loop. Called once at loop start (after the lock is acquired).
 * Writes the loop's own entry file atomically (.tmp → rename), structurally
 * concurrency-safe (one file per loop). Sandbox-guarded against ACTIVE_DIR.
 *
 * @returns ok(undefined) on success; err(IO_ERROR) on write failure;
 *          err(PATH_VIOLATION) if the entry path escapes ~/.rauf/active.
 */
export function registerLoop(entry: ActiveLoopEntry): Result<void> {
  const ensured = ensureDir(ACTIVE_DIR);
  if (!ensured.ok) return ensured;

  const entryPath = registryEntryPath(entry.stateDir);

  const guard = validatePath(entryPath, [ACTIVE_DIR]);
  if (!guard.ok) return guard;

  const write = atomicWrite(entryPath, JSON.stringify(entry, null, 2) + "\n");
  if (!write.ok) {
    return err({
      code: ErrorCodes.IO_ERROR,
      message: `registerLoop failed: ${write.error.message}`,
      details: { path: entryPath },
    });
  }
  return ok(undefined);
}

/**
 * Deregister a loop at exit. IDEMPOTENT: unlink-if-exists. A missing file is NOT an
 * error. Sandbox-guarded against ACTIVE_DIR.
 *
 * @returns ok(undefined) unless an unexpected (non-ENOENT) fs error occurs.
 */
export function deregisterLoop(stateDir: string): Result<void> {
  const entryPath = registryEntryPath(stateDir);

  const guard = validatePath(entryPath, [ACTIVE_DIR]);
  if (!guard.ok) return guard;

  try {
    fs.unlinkSync(entryPath);
  } catch (e) {
    const code = e instanceof Error && "code" in e ? (e as NodeJS.ErrnoException).code : undefined;
    if (code !== "ENOENT") {
      return err({
        code: ErrorCodes.IO_ERROR,
        message: `deregisterLoop failed: ${e instanceof Error ? e.message : String(e)}`,
        details: { path: entryPath },
      });
    }
    // ENOENT — already gone. Idempotent: not an error.
  }
  return ok(undefined);
}

/**
 * Advisory last-known status refresh for THIS loop's entry. REQ-OBS-02: state.json
 * remains the single authoritative status; this entry.status is a convenience only.
 * A missing or corrupt entry is a no-op success — a failed advisory update must never
 * disturb the loop.
 *
 * @returns ok(undefined). Missing/corrupt entry → ok(undefined). Path escape → PATH_VIOLATION.
 */
export function updateLoopStatus(stateDir: string, status: LoopStateStatus): Result<void> {
  const entryPath = registryEntryPath(stateDir);

  const guard = validatePath(entryPath, [ACTIVE_DIR]);
  if (!guard.ok) return guard;

  if (!fileExists(entryPath)) return ok(undefined);

  const read = readJsonFile(entryPath, ActiveLoopEntrySchema);
  if (!read.ok) return ok(undefined);

  const next: ActiveLoopEntry = { ...read.value, status };
  const write = atomicWrite(entryPath, JSON.stringify(next, null, 2) + "\n");
  if (!write.ok) return ok(undefined);
  return ok(undefined);
}

/**
 * List every live loop, machine-wide. For each entry, RECONCILE against ground truth
 * (REQ-DISC-05) before including it:
 *
 *   1. glob ~/.rauf/active/*.json
 *   2. parse each entry. Corrupt/unparseable → SKIP (not fatal).
 *   3. reconcile: read {entry.stateDir}/.loop.lock via checkLockFile + pid match.
 *   4. if NOT live: UNLINK (self-heal) and EXCLUDE.
 *   5. else include.
 *
 * Pure file reads only — no subprocess.
 *
 * @returns ok(ActiveLoopEntry[]) — only confirmed-live loops, sorted by stateDir.
 *          Missing ACTIVE_DIR → ok([]).
 */
export function listActiveLoops(): Result<ActiveLoopEntry[]> {
  if (!fileExists(ACTIVE_DIR)) return ok([]);

  let files: string[];
  try {
    files = fs.readdirSync(ACTIVE_DIR).filter((f) => f.endsWith(".json"));
  } catch (e) {
    return err({
      code: ErrorCodes.IO_ERROR,
      message: `listActiveLoops: cannot read ${ACTIVE_DIR}: ${e instanceof Error ? e.message : String(e)}`,
    });
  }

  const live: ActiveLoopEntry[] = [];
  for (const file of files) {
    const entryPath = path.join(ACTIVE_DIR, file);

    // (2) parse — corrupt/half-written/foreign file → skip, never fatal.
    const read = readJsonFile(entryPath, ActiveLoopEntrySchema);
    if (!read.ok) continue;
    const entry = read.value;

    // (3) reconcile against the per-root lock (ground truth) + pid match.
    const lockPath = path.join(path.resolve(entry.stateDir), LOCK_FILENAME);
    const lockStatus = checkLockFile(lockPath);

    const isLive =
      lockStatus.ok &&
      lockStatus.value.locked &&
      lockStatus.value.stale !== true &&
      (lockStatus.value.pid === undefined || lockStatus.value.pid === entry.pid);

    if (!isLive) {
      // (4) self-heal: prune the stale entry and exclude it.
      try {
        fs.unlinkSync(entryPath);
      } catch {
        // best-effort prune — another reader may have removed it; ignore.
      }
      continue;
    }

    // (5) live — include the reconciled entry.
    live.push(entry);
  }

  live.sort((a, b) => a.stateDir.localeCompare(b.stateDir));
  return ok(live);
}
