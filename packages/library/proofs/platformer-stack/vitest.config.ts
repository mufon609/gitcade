import { defineConfig } from "vitest/config";

// Own config so `gitcade validate`'s deferred `npm test` finds the proof's smoke
// test (vitest otherwise walks up to the library config).
export default defineConfig({
  root: import.meta.dirname,
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});
