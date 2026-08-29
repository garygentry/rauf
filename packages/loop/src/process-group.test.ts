import { describe, expect, it, vi } from "vitest";

import { spawnProcessGroup } from "./process-group.js";

const CHILD_SCRIPT = String.raw`
const { spawn } = require("node:child_process");
const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", process.argv[1]], {
  stdio: "ignore",
});
console.log(child.pid);
setInterval(() => {}, 1000);
`;

async function expectProcessGone(pid: number): Promise<void> {
  await vi.waitFor(
    () => {
      expect(() => process.kill(pid, 0)).toThrow();
    },
    { timeout: 2_000, interval: 20 },
  );
}

async function runCleanupCase(cause: "timeout" | "abort") {
  const marker = `rauf-process-group-${cause}-${process.pid}-${Date.now()}`;
  const controller = new AbortController();
  const resultPromise = spawnProcessGroup(process.execPath, ["-e", CHILD_SCRIPT, marker], {
    timeoutMs: cause === "timeout" ? 100 : 10_000,
    signal: controller.signal,
  });
  if (cause === "abort") setTimeout(() => controller.abort(), 100);

  const result = await resultPromise;

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const descendantPid = Number.parseInt(result.value.stdout.trim(), 10);
  expect(descendantPid).toBeGreaterThan(0);
  expect(result.value.timedOut).toBe(cause === "timeout");
  await expectProcessGone(descendantPid);
}

describe("spawnProcessGroup process-tree cleanup", () => {
  it("terminates marked descendants on timeout", async () => {
    await runCleanupCase("timeout");
  });

  it("terminates marked descendants on AbortSignal cancellation", async () => {
    await runCleanupCase("abort");
  });
});
