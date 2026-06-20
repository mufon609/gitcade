import { defineConfig } from "vitest/config";

// The library's own unit tests (one per part) + the catalog test. They import
// part implementations from source, so no build step is needed to run them. The
// reuse-proof DEMOS live in proofs/* as their own workspace packages (each with
// its own smoke test + `gitcade validate`), because they consume @gitcade/library
// as a built, published-shaped package — exactly as ecosystem games do.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
