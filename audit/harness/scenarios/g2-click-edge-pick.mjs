/**
 * ACCEPTANCE PROBE — G2 (pointer click edge + entity pick).  [SDK-0.2.0-DESIGN.md §G2]
 *
 * STATUS: FAILS on 0.1.x. Flips to PASS once sdk@0.2.0 adds
 *   Input.justPressed()/justReleased()/clicked() and World.entityAt()/pick().
 *
 * Asserts (after 0.2.0):
 *  (a) after a click on rect "b" (world 150,120), `input.justReleased()` reports
 *      the tap for EXACTLY one tick, then clears;
 *  (b) `world.entityAt(150,120,"pickable")` returns entity "b" (topmost by layer).
 *
 * On 0.1.x: pointers are deleted on up with no edge, and there is no entityAt
 * (out-03-pointer-pick.json) — apiSurface shows input.justPressed:false,
 * world.entityAt:false.
 */
const manifest = {
  name: "PickG2", slug: "pickg2", version: "1.0.0",
  engine: "gitcade-sdk", sdkVersion: "0.2.0", entryPoint: "main.json", tier: "open",
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
    { eval: "() => window.__GC.apiSurface()", label: "api-surface (justPressed? entityAt?)" },
    // Click the centre of rect "b" (world 150,120), hold one frame, release.
    { click: { x: 150, y: 120 }, holdFrames: 1, label: "click-on-b" },
    // PASS target: pick resolves the clicked entity.
    { eval: "() => window.__GC.entityAt && window.__GC.entityAt(150, 120, 'pickable')", label: "entityAt(150,120) → expect b" },
    // PASS target: edge readable for one tick, then cleared next tick.
    { eval: "() => window.__GC.justReleased && window.__GC.justReleased()", label: "justReleased (one-tick edge)" },
    { step: 1, label: "next tick — edge should be cleared" },
    { eval: "() => window.__GC.justReleased && window.__GC.justReleased()", label: "justReleased after a tick (expect empty)" },
  ],
};
