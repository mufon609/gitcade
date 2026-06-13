import { defineConfig } from "tsup";

// Dual ESM + CJS build with type declarations. The library is pure logic that
// composes against @gitcade/sdk (a peer dependency, left external so consumers
// supply the single pinned SDK instance). Zero runtime dependencies of its own.
export default defineConfig({
  entry: {
    index: "src/index.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  treeshake: true,
  target: "es2021",
  external: ["@gitcade/sdk"],
});
