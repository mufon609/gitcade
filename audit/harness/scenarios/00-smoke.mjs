/**
 * Harness self-test: a single rect moving right via the SDK `velocity` behavior.
 * Confirms the harness can boot a scene, render, advance the sim, hash the canvas
 * (hash must change as the rect moves), and read back entity positions.
 *
 * Expected: entity x advances by vx*dt each frame (60 px/s → +1px/frame);
 * canvas hash changes between samples.
 */
const manifest = {
  name: "Smoke",
  slug: "smoke",
  version: "1.0.0",
  engine: "gitcade-sdk",
  sdkVersion: "0.1.1",
  entryPoint: "main.json",
  tier: "open",
};

const config = {};

const scene = {
  id: "main",
  size: { width: 400, height: 300 },
  background: "#101018",
  entities: [
    {
      id: "mover",
      sprite: { kind: "shape", shape: "rect", color: "#39d353" },
      size: { w: 20, h: 20 },
      position: { x: 50, y: 140 },
      behaviors: [{ type: "velocity", params: { vx: 60, vy: 0 } }],
      tags: ["mover"],
    },
  ],
  systems: [],
};

export default {
  sources: { manifest, config, scenes: [scene] },
  actions: [
    { step: 30, label: "t+0.5s" },
    { step: 30, label: "t+1.0s" },
    { step: 30, label: "t+1.5s" },
  ],
};
