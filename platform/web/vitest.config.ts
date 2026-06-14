import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

// Unit tests only — pure logic + the storage-bridge protocol round-trip. The
// integration test (real worker + DB) lives in vitest.integration.config.ts so
// `npm test` stays fast and infra-free.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(here, "src") },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    globals: true,
  },
});
