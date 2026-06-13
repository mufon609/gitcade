import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  server: { port: 3005 },
  build: { outDir: "dist", emptyOutDir: true, target: "es2021" },
});
