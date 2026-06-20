import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

// Integration test: enqueue → worker → live, against a local git-fixture repo.
// Requires Postgres + MinIO + Docker + the builder image + a running worker
// poller (see DECISIONS.md). Long timeout for a real container build.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(here, "src") },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    globals: true,
    testTimeout: 20 * 60 * 1000,
    hookTimeout: 5 * 60 * 1000,
  },
});
