// ─── Event Log Subsystem ─────────────────────────────────────────
//
// Persists the loop runner's in-memory LoopEvent stream to an append-only
// events.ndjson in each backlog root's state directory, and reads it back.
// This is the keystone of the Phase 1 observation substrate (spec 02): once
// every event is on disk, every observer — CLI, web, external agent —
// reconstructs loop activity from files.
//
// The RUNNER is the single writer per root (REQ-EVT-06); CLI, web, and external
// agents are read-only against events.ndjson. That single-writer invariant is
// what makes torn-write tolerance sufficient (only the trailing line can ever be
// torn — spec 02 §7.2).

import * as fs from "node:fs";
import * as path from "node:path";

import { type Result, ok, err, ErrorCodes } from "./errors.js";
import { appendLine, readNdjson, validatePath, ensureDir, fileExists } from "./fs-utils.js";
import type { BacklogPaths } from "./backlog-root.js";
import { PersistedEventSchema, type PersistedEvent } from "./schemas.js";

// ─── Helpers ────────────────────────────────────────────────────

/**
 * Compact, filesystem-safe timestamp: 20260317-143052.
 *
 * Identical to reset.ts:archiveTimestamp (reset.ts:39-44), which is
 * module-private and not exported, so the archive naming here matches the
 * {ts}-rauf.log / {ts}-progress.md archives reset.ts produces. The duplication
 * (two functions) is intentional — sharing one helper would be a larger refactor
 * than Phase 1 warrants.
 */
function eventsArchiveTimestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

// ─── appendEvent ────────────────────────────────────────────────

/**
 * Append one persisted event to events.ndjson (REQ-EVT-01).
 *
 * The path is sandbox-validated to the backlog root's state directory before
 * writing (REQ-EVT-07 / REQ-SEC-01): an out-of-sandbox path returns
 * PATH_VIOLATION and writes nothing. The record is serialized to a single line
 * via appendLine (one whole-line write per event — REQ-EVT-06).
 *
 * The RUNNER is the single writer; the runner's persistEvent discards this
 * call's Result (best-effort), so a returned err is silently swallowed there.
 *
 * @param paths  Backlog root paths (uses paths.eventsLog, validated to paths.stateDir).
 * @param record A LoopEvent already enriched with seq + schemaVersion (PersistedEvent).
 * @returns ok(undefined) on success; err(PATH_VIOLATION) on sandbox escape;
 *          err(IO_ERROR) on fs failure (propagated from appendLine).
 */
export function appendEvent(paths: BacklogPaths, record: PersistedEvent): Result<void> {
  const guard = validatePath(paths.eventsLog, [paths.stateDir]);
  if (!guard.ok) return guard;
  return appendLine(paths.eventsLog, JSON.stringify(record));
}

// ─── readEvents ─────────────────────────────────────────────────

/**
 * Read the current run's persisted events, in seq order (REQ-EVT-01).
 *
 * This is the history-replay half of `follow`'s "replay then tail" attach
 * (REQ-OBS-04): a late observer calls readEvents to get full current-run
 * context, then watchEvents to receive new records. It reads the CURRENT run
 * only — the file resets per run (rotateEventsLog), so prior runs are NOT
 * stitched in.
 *
 * Torn-line tolerant via readNdjson (REQ-REL-01): a partial trailing line is
 * skipped, earlier records always returned. Absent file → ok([]) (REQ-REL-03),
 * so an existing install with no events.ndjson reads as "no events," not an error.
 *
 * Records are returned in append order; because seq is dense and monotonic,
 * append order IS seq order, so callers may rely on the array being seq-ordered
 * without re-sorting.
 *
 * @param paths Backlog root paths (uses paths.eventsLog).
 * @returns ok(PersistedEvent[]) — possibly empty; err(IO_ERROR) only on a read
 *          failure that is NOT mere absence (absence is ok([])).
 */
export function readEvents(paths: BacklogPaths): Result<PersistedEvent[]> {
  return readNdjson(paths.eventsLog, PersistedEventSchema);
}

// ─── rotateEventsLog ────────────────────────────────────────────

/**
 * Rotate events.ndjson at loop start (REQ-EVT-05 / tech-spec D4).
 *
 * Moves an existing {stateDir}/events.ndjson to
 * {stateDir}/archive/{ts}-events.ndjson, then leaves the path empty so the run
 * begins a fresh file. ts = YYYYMMDD-HHMMSS, identical to reset.ts's archive
 * naming.
 *
 * No-op (returns ok) if the file is absent — a first-ever run has nothing to
 * rotate (REQ-COMPAT-01). The archive directory is created on demand via
 * ensureDir. Path-validated to the state dir before the rename (REQ-SEC-01).
 *
 * Rotation-failure policy (D4 — truncate-on-fail): if the archive rename fails,
 * the function TRUNCATES events.ndjson to empty before returning err, so the new
 * run still begins from a clean file. This preserves the per-run invariants —
 * dense, monotonic seq from 0 and the never-contradict guarantee — at the cost
 * of losing the prior run's archive (acceptable: archiving is itself best-effort).
 *
 * @param paths Backlog root paths (uses paths.eventsLog, paths.archive, paths.stateDir).
 * @returns ok(undefined) on success or no-op; err(IO_ERROR) on mkdir/rename failure
 *          (file is truncated to empty in this case); err(PATH_VIOLATION) if the source
 *          path escapes the sandbox.
 */
export function rotateEventsLog(paths: BacklogPaths): Result<void> {
  // No-op if there is nothing to rotate (first-ever run / REQ-COMPAT-01).
  if (!fileExists(paths.eventsLog)) return ok(undefined);

  const guard = validatePath(paths.eventsLog, [paths.stateDir]);
  if (!guard.ok) return guard;

  const dirResult = ensureDir(paths.archive);
  if (!dirResult.ok) return dirResult;

  const ts = eventsArchiveTimestamp();
  const archivePath = path.join(paths.archive, `${ts}-events.ndjson`);
  try {
    fs.renameSync(paths.eventsLog, archivePath);
    return ok(undefined);
  } catch (e) {
    // Archive rename failed. TRUNCATE to empty (truncate-on-fail, D4) so the new
    // run starts from a clean file instead of appending seq:0,1,… after the prior
    // run's seq:0,1,… — which a reader would interpret as corruption / a stale
    // terminal event (violating seq-monotonicity + never-contradict). The prior
    // run's archive is lost; acceptable per REQ-EVT-05 (archiving is best-effort).
    try {
      fs.writeFileSync(paths.eventsLog, "");
    } catch {
      /* truncate also failed — best-effort; runner ignores the Result either way */
    }
    return err({
      code: ErrorCodes.IO_ERROR,
      message: `Failed to rotate events.ndjson (archive); truncated for a fresh run: ${String(e)}`,
      details: { path: paths.eventsLog },
    });
  }
}

// ─── watchEvents ────────────────────────────────────────────────

/**
 * fs.watch-based tail of events.ndjson (REQ-PERF-02, REQ-OBS-04).
 *
 * Mirrors status.ts:watchLog (status.ts:410): tracks the last byte offset, and
 * on each fs.watch "change" re-reads from that offset to EOF, parses the newly
 * appended whole lines, and invokes onRecords with the new PersistedEvent[].
 *
 * Returns a BARE cleanup function (NOT a { close } handle) so `follow` and the
 * web tail share the same unsubscribe idiom as watchLog.
 *
 * Reliability (TQ-3): fs.watch can MISS fires under rapid writes. By re-reading
 * from the last byte offset on every fire, a single dropped fire is
 * self-correcting on the next one. The caller's --interval poll is both the
 * fallback where fs.watch is unavailable AND a periodic reconciliation safety-net.
 *
 * Torn-line tolerant (REQ-REL-01): the offset is advanced only to the last
 * newline, so a partial trailing line is re-read (and completed) on the next
 * fire — it is never emitted half-parsed.
 *
 * @param paths     Backlog root paths (uses paths.eventsLog).
 * @param onRecords Called with each batch of newly-appended records (never []).
 * @returns A cleanup function that stops watching.
 */
export function watchEvents(
  paths: BacklogPaths,
  onRecords: (records: PersistedEvent[]) => void,
): () => void {
  const eventsLog = paths.eventsLog;
  let lastOffset = 0;

  // Initialize offset from the current file size (0 if not present yet — watching
  // starts from the beginning when the file appears).
  try {
    lastOffset = fs.statSync(eventsLog).size;
  } catch {
    // File doesn't exist yet — start from 0.
  }

  const watcher = fs.watch(eventsLog, { persistent: false }, (eventType) => {
    if (eventType !== "change") return;

    try {
      const stat = fs.statSync(eventsLog);
      if (stat.size <= lastOffset) {
        // File was truncated/rotated — resync to the fresh file.
        lastOffset = stat.size;
        return;
      }

      // Read only the new bytes [lastOffset, stat.size).
      const fd = fs.openSync(eventsLog, "r");
      const buffer = Buffer.alloc(stat.size - lastOffset);
      fs.readSync(fd, buffer, 0, buffer.length, lastOffset);
      fs.closeSync(fd);

      const chunk = buffer.toString("utf-8");
      // Advance the offset only past the last newline actually seen, so a partial
      // trailing line is NOT consumed — it is re-read on the next fire (REQ-REL-01).
      const lastNewline = chunk.lastIndexOf("\n");
      if (lastNewline === -1) {
        // No complete line yet — leave the offset untouched and wait for more.
        return;
      }
      lastOffset += Buffer.byteLength(chunk.slice(0, lastNewline + 1), "utf-8");

      const complete = chunk.slice(0, lastNewline + 1);
      const records: PersistedEvent[] = [];
      for (const line of complete.split("\n")) {
        if (line.trim() === "") continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue; // should not happen for a complete interior line (spec §7.2)
        }
        const r = PersistedEventSchema.safeParse(parsed);
        if (r.success) records.push(r.data);
      }

      if (records.length > 0) {
        onRecords(records);
      }
    } catch {
      // File may have been deleted or is being written — ignore (mirrors watchLog).
    }
  });

  return () => {
    watcher.close();
  };
}
