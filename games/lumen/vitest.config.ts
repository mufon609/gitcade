import { defineConfig } from "vitest/config";

// The validator (`gitcade validate`) defers its smoke boot to `npm test` for any
// game that registers library behaviors the default SDK registry can't supply —
// which Lumen does (move-platformer, ai-patrol, …). This config keeps that test
// self-contained and headless (node env).
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
