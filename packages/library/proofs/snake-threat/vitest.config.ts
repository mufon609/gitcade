import { defineConfig } from "vitest/config";

// Own config so the proof's smoke test is discovered when `gitcade validate`
// runs `npm test` here (otherwise vitest walks up and finds the library config).
export default defineConfig({
  root: import.meta.dirname,
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});
