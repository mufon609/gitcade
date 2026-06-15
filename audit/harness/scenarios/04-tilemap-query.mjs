/**
 * PROBE 4 / 5 — tilemap queryable at runtime? (buildable / walkable / lane zones)
 *
 * Scene carries a real `tilemap` (4x3 grid; tile index 1 = "road", 0 = buildable).
 * Question: can a data-driven part read the tile at a world (x,y) to reject, say, a
 * tower on the road? We check whether the parsed tilemap reaches the `world` a
 * system sees, and whether any `tileAt` query exists.
 *
 * Expected (hypothesis): the SDK parses & validates `tilemap` in the scene schema
 * but the runtime World never stores it → `world.tilemap` absent, no `tileAt`.
 */
const manifest = {
  name: "Tilemap", slug: "tilemap", version: "1.0.0",
  engine: "gitcade-sdk", sdkVersion: "0.1.1", entryPoint: "main.json", tier: "open",
};
const config = {};

const scene = {
  id: "main",
  size: { width: 200, height: 150 },
  background: "#0b0b12",
  tilemap: {
    tileSize: 50,
    cols: 4,
    rows: 3,
    // row-major: middle row is a horizontal "road" (1), rest buildable (0)
    tiles: [0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0],
  },
  entities: [],
  systems: [],
};

export default {
  sources: { manifest, config, scenes: [scene] },
  actions: [
    { eval: "() => window.__GC.info()", label: "scene-has-tilemap?" },
    { eval: "() => window.__GC.apiSurface()", label: "api-surface (tileAt? world.tilemap?)" },
  ],
};
