import type { Config } from "tailwindcss";

// GitCade uses the same flat, geometric, 8-color arcade aesthetic as the
// procedural game art (packages/library palette). Kept minimal here.
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        arcade: {
          bg: "#11131a",
          panel: "#1b1f2a",
          edge: "#2b3142",
          ink: "#e6e9f0",
          mute: "#8b93a7",
          accent: "#5ec8ff",
          good: "#56d364",
          bad: "#ff6b6b",
          warn: "#ffce56",
        },
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
