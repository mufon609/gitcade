/**
 * PROBE 3 — pointer / click picking.
 *
 * Question: using ONLY the public input API a data-driven part sees, can a
 * behavior detect a click at a world coordinate and identify which entity/cell was
 * clicked? (Needed for tower placement.)
 *
 * Method: place three clickable rects. Click the MIDDLE one and, while the pointer
 * is held down (holdFrames), sample what `world.input.activePointers()` reports and
 * the full API surface. We are looking for:
 *   - does the engine surface the click world-coordinate?  (expected: yes, via
 *     activePointers — but only while DOWN, with no click EDGE event)
 *   - is there any `entityAt`/`pick`/`clicked`/`justPressed` primitive?  (expected:
 *     no — so identifying the clicked entity is hand-rolled per game)
 */
const manifest = {
  name: "Pick", slug: "pick", version: "1.0.0",
  engine: "gitcade-sdk", sdkVersion: "0.1.1", entryPoint: "main.json", tier: "open",
};
const config = {};

const rect = (id, x, color) => ({
  id,
  sprite: { kind: "shape", shape: "rect", color },
  size: { w: 60, h: 60 },
  position: { x, y: 90 },
  behaviors: [],
  tags: ["pickable"],
});

const scene = {
  id: "main",
  size: { width: 300, height: 240 },
  background: "#0b0b12",
  entities: [rect("a", 20, "#7aa2f7"), rect("b", 120, "#9ece6a"), rect("c", 220, "#e0af68")],
  systems: [],
};

export default {
  sources: { manifest, config, scenes: [scene] },
  actions: [
    { eval: "() => window.__GC.apiSurface()", label: "api-surface" },
    // Click the centre of rect "b" (world 150,120) and hold for 3 frames so the
    // sim observes a DOWN pointer; capture what the engine exposes during the hold.
    { click: { x: 150, y: 120 }, holdFrames: 3, label: "click-on-b" },
    { eval: "() => window.__GC.pointers()", label: "pointers-after-click (up)" },
  ],
};
