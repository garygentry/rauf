/**
 * NdjsonTailer — a rotation-aware, malformed-tolerant tail of an append-only
 * NDJSON file, decoupled from any watch mechanism so it is unit-testable by
 * driving {@link NdjsonTailer.poll} against a temp file.
 *
 * rauf is the single writer of `events.ndjson` and rotates it at the START of
 * each run — the old file is moved to `<stateDir>/archive/{ts}-events.ndjson`
 * and a fresh empty file takes its place (rauf `packages/core/src/events-log.ts`).
 * So a live supervisor must survive the file being replaced by name mid-watch.
 * Two independent signals catch a rotation: the file's inode changing, and its
 * size shrinking below our read cursor. Either resets the cursor to 0 and
 * re-reads from the top of the new file.
 *
 * Reads are incremental from a byte offset (never re-reading the whole file), a
 * trailing partial line with no newline yet is buffered until its newline
 * arrives, and a line that is not valid JSON is skipped rather than throwing —
 * a half-flushed or corrupt record must never stall the tail.
 */

import { closeSync, openSync, readSync, statSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";

import type { RaufEvent } from "./types.js";

export class NdjsonTailer {
  private offset = 0;
  private ino: number | null = null;
  /** The file we were reading vanished (rauf renamed it to archive/ at a run
   *  start). Whatever file appears next is a NEW run, even if no poll ever sees
   *  the inode change — so the next read must signal onRotate. */
  private vanished = false;
  private partial = "";
  // A StringDecoder holds back an incomplete trailing multibyte sequence between
  // reads, so a UTF-8 character split across two polls (e.g. an accented char or
  // emoji in an event's `reason`/`title`) decodes correctly instead of turning
  // into replacement chars on each half.
  private decoder = new StringDecoder("utf8");

  /**
   * @param filePath  Absolute path to the NDJSON file (may not exist yet).
   * @param onRecord  Called once per successfully-parsed JSON line, in order.
   * @param onError   Optional; called with a short reason when a line is
   *                  skipped as malformed (for observability/tests).
   * @param onRotate  Optional; called when a rotation is detected (a new inode,
   *                  or the file shrank below the cursor) — the signal a NEW run
   *                  has started, so the consumer can reset per-run state (rauf's
   *                  event `seq` restarts at 0 each run).
   * @param initialIno  Optional; the inode the file had when the consumer last
   *                  watched it (from the persisted mirror). Seeding it lets the
   *                  FIRST poll on reattach detect a rotation that happened while
   *                  no session was watching — the current file having a
   *                  different inode fires `onRotate`, so a stale cursor from a
   *                  previous run does not silently swallow the new run.
   */
  constructor(
    private readonly filePath: string,
    private readonly onRecord: (rec: RaufEvent) => void,
    private readonly onError?: (reason: string) => void,
    private readonly onRotate?: () => void,
    initialIno?: number,
  ) {
    this.ino = typeof initialIno === "number" ? initialIno : null;
  }

  /**
   * Read whatever is new since the last poll and dispatch each complete record.
   * Idempotent and cheap when nothing changed. Safe to call before the file
   * exists (no-op) and across a rotation (resets and re-reads the new file).
   */
  poll(): void {
    let size: number;
    let ino: number;
    try {
      const st = statSync(this.filePath);
      size = st.size;
      ino = st.ino;
    } catch {
      // File gone: pre-launch, or mid-rotation (rauf renamed it to archive/ and
      // the new run has not written yet). Remember that a file we had been
      // reading vanished, so the next file to appear is treated as a rotation.
      if (this.ino !== null || this.offset > 0) this.vanished = true;
      this.offset = 0;
      this.ino = null;
      this.partial = "";
      return;
    }

    // Rotation: a new inode, or the file shrank below our cursor (truncate /
    // replace). Re-read from the top of whatever file is there now, reset the
    // multibyte decoder, and signal the consumer so it can reset per-run state
    // (rauf restarts `seq` at 0 each run — without this a stale cursor from a
    // previous run would silently swallow the whole new run). This only fires
    // on a genuine rotation: the first poll has ino === null, so neither branch
    // trips on initial attach.
    if (this.vanished || (this.ino !== null && ino !== this.ino) || size < this.offset) {
      this.vanished = false;
      this.offset = 0;
      this.partial = "";
      this.decoder = new StringDecoder("utf8");
      this.onRotate?.();
    }
    this.ino = ino;

    if (size <= this.offset) return; // nothing new

    let chunk: string;
    let fd: number | null = null;
    try {
      fd = openSync(this.filePath, "r");
      const length = size - this.offset;
      const buf = Buffer.allocUnsafe(length);
      const read = readSync(fd, buf, 0, length, this.offset);
      // Decode through the StringDecoder so a multibyte char straddling this
      // read's end is held back until its continuation bytes arrive next poll.
      chunk = this.decoder.write(buf.subarray(0, read));
      this.offset += read;
    } catch {
      return; // transient read failure; try again next poll
    } finally {
      if (fd !== null) closeSync(fd);
    }

    this.partial += chunk;
    const lines = this.partial.split("\n");
    // The last element is an incomplete trailing line (empty when the chunk
    // ended on a newline) — hold it until its newline arrives.
    this.partial = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let rec: RaufEvent;
      try {
        rec = JSON.parse(trimmed) as RaufEvent;
      } catch {
        this.onError?.(`skipped malformed NDJSON line (${trimmed.length} chars)`);
        continue;
      }
      if (rec && typeof rec === "object") this.onRecord(rec);
    }
  }
}
