import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Runs the coordinator's contract inside workerd against the real Worker:
// Durable Object storage, D1 (with migrations) and both entrypoints.
export default defineConfig(async () => {
  const migrations = await readD1Migrations(
    fileURLToPath(new URL("./migrations", import.meta.url)),
  );
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          // Same world as the Node run, so the same assertions apply.
          bindings: { SEED_MODE: "fixtures", TEST_MIGRATIONS: migrations },
        },
      }),
    ],
    test: { include: ["test/workers/**/*.test.ts"] },
  };
});
