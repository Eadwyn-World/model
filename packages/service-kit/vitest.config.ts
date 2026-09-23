import { defineConfig } from "vitest/config";

// Node tests. Workers-runtime tests live in test/workers and run with vitest.workers.config.ts.
export default defineConfig({
  test: { include: ["src/**/__tests__/**/*.test.ts"] },
});
