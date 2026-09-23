import { defineConfig } from "tsup";

// Bundle workspace packages and third-party deps so `dist/` runs with plain `node`.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  clean: true,
  sourcemap: true,
  noExternal: [/.*/],
});
