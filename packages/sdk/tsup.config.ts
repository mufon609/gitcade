import { defineConfig } from "tsup";

// Dual ESM + CJS build with type declarations. The CLI is shipped as a thin
// checked-in shim (bin/gitcade.mjs) that imports the built ESM entry, so we do
// NOT need a shebang baked into the bundle. zod is the only runtime dependency
// and is intentionally left external (installed by consumers).
export default defineConfig({
  entry: {
    index: "src/index.ts",
    "validate/index": "src/validate/index.ts",
    cli: "src/validate/cli.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  treeshake: true,
  target: "es2021",
  external: ["zod"],
});
