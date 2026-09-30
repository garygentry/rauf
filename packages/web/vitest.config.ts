import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    passWithNoTests: true,
    // Isolated HOME + live-Anthropic-API guard for every test file (#146).
    setupFiles: ["../../vitest.hermetic-setup.ts"],
  },
});
