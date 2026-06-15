/**
 * ACCEPTANCE PROBE — G4 (spawn placement: free-cell scatter).  [SDK-0.2.0-DESIGN.md §G4]
 *
 * STATUS: FAILS on 0.1.x. Flips to PASS once library@0.2.0 adds the free-cell
 *   placement helper and `wave-spawner` gains the `placement:"free-cell"` param
 *   (using world.rng for deterministic replay).
 *
 * Baseline (0.1.x, out-05-spawn-placement.json): with no spawnPoints every spawn
 *   stacks on the prototype's literal (100,75).
 *
 * Asserts (after 0.2.0): with placement:"free-cell", N spawns occupy N DISTINCT,
 *   in-bounds, non-overlapping grid cells.
 */
const manifest = {
  name: "FreeCellG4", slug: "freecellg4", version: "1.0.0",
  engine: "gitcade-sdk", sdkVersion: "0.2.0", libraryVersion: "0.2.0",
  entryPoint: "main.json", tier: "ecosystem",
};
const config = {};

const proto = {
  id: "e",
  sprite: { kind: "shape", shape: "rect", color: "#bb9af7" },
  size: { w: 12, h: 12 },
  position: { x: 100, y: 75 },
  behaviors: [],
  tags: ["spawned"],
};

const scene = {
  id: "main",
  size: { width: 200, height: 150 },
  background: "#0b0b12",
  entities: [],
  systems: [
    {
      type: "wave-spawner",
      params: {
        prototype: proto,
        interval: 0.1,
        waveSize: 5,
        waveDelay: 0.1,
        maxWaves: 0,
        advanceOnClear: false,
        countTag: "spawned",
        // 0.2.0 additive: scatter across free grid cells instead of literal pos.
        placement: "free-cell",
        tileSize: 20,
        occupiedTag: "spawned",
      },
    },
  ],
};

export default {
  sources: { manifest, config, scenes: [scene] },
  actions: [
    // After many spawns, positions should be DISTINCT (assert in review: unique cx,cy).
    { step: 90, label: "after many spawns (positions distinct & in-bounds?)" },
    { eval: "() => window.__GC.entities().map(e => [e.cx, e.cy])", label: "spawned positions (expect all distinct)" },
  ],
};
