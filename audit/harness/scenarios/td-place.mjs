/**
 * Tower Defense placement regression (the headline "towers on the road" complaint
 * + the #4 snapToGrid swap). Drives the real game from title → play, then clicks:
 *  - a BUILDABLE tile off-center → expect a tower SNAPPED to the cell center;
 *  - a ROAD tile → expect NO tower placed (build-denied).
 * Confirms economy is real (gold deducted only on a successful build) and the click
 * edge / transaction path works end to end.
 */
export default {
  slug: "tower-defense",
  actions: [
    { emit: "start-pressed", label: "to-play" },
    { step: 3, label: "play-settled" },
    // isBuildable probes (pure data, no placement).
    { eval: "() => ({ buildable_100_100: window.__GC.isBuildable(100,100), road_100_140: window.__GC.isBuildable(100,140), tile_100_100: window.__GC.tileAt(100,100), tile_100_140: window.__GC.tileAt(100,140) })", label: "tile-probe" },
    // Click a buildable cell OFF-center (107,93) → snapToGrid should land it at (100,100).
    { click: { x: 107, y: 93 }, holdFrames: 1, label: "click-buildable-offcenter" },
    { step: 3, label: "after-buildable-click" },
    // Click a ROAD cell (100,140) → must be refused.
    { click: { x: 100, y: 140 }, holdFrames: 1, label: "click-road" },
    { step: 3, label: "after-road-click" },
    // Click another buildable cell (300,220) → second tower.
    { click: { x: 300, y: 220 }, holdFrames: 1, label: "click-buildable-2" },
    { step: 3, label: "after-second" },
  ],
};
