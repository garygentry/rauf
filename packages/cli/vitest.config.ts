import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    passWithNoTests: true,
    // Run test files sequentially. Several CLI handlers (server start/stop,
    // ensureServerRunning) read and write the process-global ~/.rauf/server.json,
    // so parallel test files race on that shared state. Serializing files makes
    // those tests deterministic.
    fileParallelism: false,
  },
});
