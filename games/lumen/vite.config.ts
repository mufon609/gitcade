import { defineConfig } from "vite";

// Static build: `npm run build` outputs a self-contained /dist the GitCade build
// worker uploads as the game artifact. Relative base so the artifact server can
// serve it from /artifacts/{game}/{branch}/ without absolute-path breakage.
// `public/assets/lumen` (the committed original art — NOT synced from the library)
// is copied into dist automatically by Vite.
export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2021",
  },
});
