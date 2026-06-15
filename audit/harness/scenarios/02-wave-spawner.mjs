/**
 * PROBE 2 — wave-spawner spawn-point round-robin (the helicopter "obstacles only
 * at the top" suspicion).
 *
 * Scene: a wave-spawner with waveSize:1 and THREE distinct spawnPoints at y=40,
 * y=120, y=200 (all x=280). advanceOnClear:false + a short waveDelay so waves
 * proceed on the timer and pile up many spawns. Prototype is a static rect (no
 * movement) so each spawn stays put at its spawn coordinate and we can read the
 * distinct Y positions back.
 *
 * Expected if round-robin works: spawned entities occupy ALL THREE ys
 * (40,120,200) cycling. Expected if the suspected `cursor % cursor.length` NaN
 * bug were present: every spawn pins to spawnPoints[0] (y=40 only).
 */
const manifest = {
  name: "WaveRR", slug: "waverr", version: "1.0.0",
  engine: "gitcade-sdk", sdkVersion: "0.1.1", entryPoint: "main.json", tier: "open",
};
const config = {};

const obstacle = {
  id: "ob",
  sprite: { kind: "shape", shape: "rect", color: "#f7768e" },
  size: { w: 16, h: 16 },
  position: { x: 280, y: 0 },
  behaviors: [],
  tags: ["obstacle"],
};

const scene = {
  id: "main",
  size: { width: 320, height: 240 },
  background: "#0b0b12",
  entities: [],
  systems: [
    {
      type: "wave-spawner",
      params: {
        prototype: obstacle,
        interval: 0.1,
        waveSize: 1,
        waveDelay: 0.1,
        maxWaves: 0,
        advanceOnClear: false,
        countTag: "obstacle",
        spawnPoints: [
          { x: 280, y: 40 },
          { x: 280, y: 120 },
          { x: 280, y: 200 },
        ],
      },
    },
  ],
};

export default {
  sources: { manifest, config, scenes: [scene] },
  actions: [
    { step: 30, label: "t+0.5s" },
    { step: 60, label: "t+1.5s" },
    { step: 60, label: "t+2.5s (many spawns)" },
  ],
};
