import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Cover only scripts/release/** — packages run via `pnpm -r test`.
    include: ["scripts/release/**/*.test.ts"],
    exclude: ["packages/**", "node_modules/**"],
  },
});
