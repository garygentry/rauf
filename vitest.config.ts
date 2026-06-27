import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Cover root-level script tests (scripts/release/**, scripts/*.test.ts) —
    // packages run via `pnpm -r test`.
    include: ["scripts/release/**/*.test.ts", "scripts/*.test.ts"],
    exclude: ["packages/**", "node_modules/**"],
  },
});
