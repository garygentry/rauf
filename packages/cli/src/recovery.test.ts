import { describe, it, expect } from "vitest";

import * as recovery from "./recovery.js";

// The shared reconcile/resume core moved to `@rauf/loop` (packages/loop/src/
// recovery.ts); its behavior is unit-tested there (recovery.test.ts). Here we
// only smoke-test that `./recovery` still surfaces both the re-exported moved
// symbols AND the retained CLI-only `--recover` symbols, so a future accidental
// drop of the re-export is caught.

describe("recovery module surface", () => {
  it("re-exports the relocated shared core from @rauf/loop", () => {
    expect(typeof recovery.detectInterruptedItems).toBe("function");
    expect(typeof recovery.reconcileAndRequeue).toBe("function");
    expect(typeof recovery.acquireRecoveryLock).toBe("function");
    expect(typeof recovery.releaseRecoveryLock).toBe("function");
    expect(typeof recovery.recoverInterruptedLoop).toBe("function");
  });

  it("retains the CLI-only --recover symbols", () => {
    expect(typeof recovery.defaultVerifyRunner).toBe("function");
    expect(typeof recovery.reverifyAndCommitInterrupted).toBe("function");
  });
});
