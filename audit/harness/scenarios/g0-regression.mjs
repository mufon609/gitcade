/**
 * ADDITIVITY REGRESSION PROBE — 0.1.x behavior is byte-identical on 0.2.0.
 *
 * Boots a 0.1.x-shaped scene (NO `flow`, NO tilemap, NO `placement` param) with a
 * library `wave-spawner` and asserts the pre-0.2.0 behavior is unchanged:
 *   - every spawn lands on the prototype's LITERAL position (the documented
 *     out-05-spawn-placement.json baseline: with no spawnPoints / no placement,
 *     spawns STACK on (100,75)). This proves the additive G4 `placement` param
 *     defaults to the old literal path and does not perturb a 0.1.x scene.
 *   - the scene boots and advances frames with no page errors.
 *
 * This is the regression half of the DoD: a current seed-game-shaped scene runs
 * with identical behavior on the 0.2.0 runtime. PASS on 0.2.0; it would also have
 * passed on 0.1.x (that is the point — nothing changed for old content).
 */
const manifest = {
  name: "Regress01x", slug: "regress01x", version: "1.0.0",
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
        // NO `placement` — 0.1.x literal behavior (spawns stack on the prototype pos).
      },
    },
  ],
};

export default {
  sources: { manifest, config, scenes: [scene] },
  actions: [
    { step: 90, label: "after many spawns (0.1.x: all stacked on the literal pos)" },
    { eval: "() => { const cs = window.__GC.entities().map(e => e.cx + ',' + e.cy); return { count: cs.length, distinct: new Set(cs).size, sample: cs[0] }; }", label: "spawn positions (expect distinct:1 — all stacked, 0.1.x unchanged)" },
  ],
};
