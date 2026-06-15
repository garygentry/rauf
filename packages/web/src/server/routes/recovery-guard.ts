// ─── Recovery guard helper ───────────────────────────────────────
//
// A small web-server-layer guard wrapping core `checkLock`, used by the
// lightweight recovery mutations (unblock) to refuse a write while a
// loop is live on the backlog root. reset/resume use the heavier
// acquire-and-hold guard from @rauf/loop instead.

import { checkLock, err, ok, ErrorCodes } from "@rauf/core";
import type { Result, BacklogPaths } from "@rauf/core";

/**
 * Reject a recovery mutation when a loop is *live* on this backlog root.
 * "Live" = lock present AND not stale (a stale lock is a crashed loop, not a
 * conflict). Cross-process: detects a detached/CLI loop, not only loops this
 * server started. A checkLock IO failure is treated as "not live" (fail-open)
 * so a transient lock-read error does not block recovery — the subsequent
 * core call still carries core's atomic-write guarantees (rule #2).
 *
 * @param paths - resolved BacklogPaths for the target backlog root
 * @returns ok(void) when no live loop holds the lock; err(LOCK_CONFLICT) otherwise
 */
export function assertNoLiveLoop(paths: BacklogPaths): Result<void> {
  const lock = checkLock(paths);
  if (lock.ok && lock.value.locked && lock.value.stale !== true) {
    return err({
      code: ErrorCodes.LOCK_CONFLICT,
      message: "a loop is running on this backlog root — stop it first",
    });
  }
  return ok(undefined);
}
