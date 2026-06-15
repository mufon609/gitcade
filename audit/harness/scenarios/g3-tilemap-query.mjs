/**
 * ACCEPTANCE PROBE — G3 (runtime tilemap query + per-index properties).  [SDK-0.2.0-DESIGN.md §G3]
 *
 * STATUS: FAILS on 0.1.x. Flips to PASS once sdk@0.2.0 stores the parsed tilemap
 *   on World and adds tileAt()/isBuildable()/cellRect(), and TilemapSchema gains
 *   the per-index `properties` map.
 *
 * Scene: 4x3 grid, middle row is a "road" (tile index 1, buildable:false), rest
 * buildable (index 0, buildable:true). tileSize 50.
 *
 * Asserts (after 0.2.0):
 *   world.tileAt(75,75)   === 1     (middle row = road)
 *   world.isBuildable(75,75) === false   (road not buildable → fixes towers-on-road)
 *   world.isBuildable(25,25) === true    (top row buildable)
 *
 * On 0.1.x: worldHasTilemap:false, world.tileAt:false (out-04-tilemap-query.json).
 */
const manifest = {
  name: "TileG3", slug: "tileg3", version: "1.0.0",
  engine: "gitcade-sdk", sdkVersion: "0.2.0", entryPoint: "main.json", tier: "open",
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
    tiles: [0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0],
    // 0.2.0 additive: per-index property map.
    properties: {
      "0": { buildable: true },
      "1": { lane: true, walkable: true, buildable: false },
    },
  },
  entities: [],
  systems: [],
};

export default {
  sources: { manifest, config, scenes: [scene] },
  actions: [
    { eval: "() => window.__GC.info()", label: "worldHasTilemap? (expect true on 0.2.0)" },
    { eval: "() => window.__GC.apiSurface()", label: "api-surface (tileAt/isBuildable present?)" },
    { eval: "() => window.__GC.tileAt && window.__GC.tileAt(75, 75)", label: "tileAt(75,75) → expect 1 (road)" },
    { eval: "() => window.__GC.isBuildable && window.__GC.isBuildable(75, 75)", label: "isBuildable(75,75) → expect false" },
    { eval: "() => window.__GC.isBuildable && window.__GC.isBuildable(25, 25)", label: "isBuildable(25,25) → expect true" },
  ],
};
