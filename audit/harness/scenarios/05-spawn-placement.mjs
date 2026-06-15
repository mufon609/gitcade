/**
 * PROBE 6 — spawn placement helpers (grid-snap / free-cell / occupied-cell).
 *
 * Question: does anything place a spawn at a chosen-by-the-engine cell (random
 * free cell, snapped to a grid, avoiding occupied cells), or must a game compute
 * literal coordinates? (Snake's "first food on the wall" symptom.)
 *
 * Method: run a wave-spawner with NO spawnPoints. The contract says it then falls
 * back to "prototype position". If the engine had free-cell/grid placement, spawns
 * would scatter; if placement is purely literal, every spawn stacks on the single
 * prototype coordinate. We read the spawned entity positions back.
 *
 * Expected: all spawns share ONE identical (x,y) — no distribution primitive.
 */
const manifest = {
  name: "SpawnPlace", slug: "spawnplace", version: "1.0.0",
  engine: "gitcade-sdk", sdkVersion: "0.1.1", entryPoint: "main.json", tier: "open",
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
        // NO spawnPoints → contract fallback is the prototype position.
      },
    },
  ],
};

export default {
  sources: { manifest, config, scenes: [scene] },
  actions: [{ step: 90, label: "after many spawns (positions identical?)" }],
};
