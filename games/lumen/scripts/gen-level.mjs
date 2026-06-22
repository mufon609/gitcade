#!/usr/bin/env node
/**
 * Author games/lumen/src/scenes/level-1.json from a readable grid spec.
 *
 * A 100×15 tilemap (1500 indices) plus ~40 grid-aligned obstacle entities is
 * infeasible to hand-edit without miscounting, so — exactly like `gen-art.mjs` is the
 * deterministic source for the committed PNGs — THIS is the deterministic source for the
 * committed `level-1.json` the engine reads. Re-run `npm run gen:level` and the output is
 * byte-identical. Edit the BEATS here, never the generated JSON.
 *
 * Conventions (see ART.md for the tile index→meaning contract):
 *   tile 0 solid · 1 oneWay · 2 slopeL · 3 slopeR · 4 ladder · 5 decor · -1 empty
 *   grid: 100 cols × 15 rows, 32px tiles → world 3200×480. Floor walk-surface = top of
 *   row 12 (y=384); solid floor at rows 12–13; row 14 is the void band (kill-plane).
 *
 * Balance numbers live in config.json and are emitted here as "$cfg.*" strings; only
 * structural geometry (x/y/w/h, grid sizes, slope heights) is literal — the no-magic-
 * numbers rule the validator enforces.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const TS = 32;
const COLS = 100;
const ROWS = 15;
const FLOOR_TOP_ROW = 12; // walk surface = y = 12*32 = 384
const FLOOR_TOP_Y = FLOOR_TOP_ROW * TS; // 384

// --- tilemap grid -----------------------------------------------------------
const tiles = new Array(COLS * ROWS).fill(-1);
const idx = (c, r) => r * COLS + c;
const set = (c, r, v) => {
  if (c >= 0 && c < COLS && r >= 0 && r < ROWS) tiles[idx(c, r)] = v;
};
const fill = (c0, r0, c1, r1, v) => {
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) set(c, r, v);
};

// Base floor: solid (0) at rows 12–13 across the whole level.
fill(0, 12, COLS - 1, 13, 0);

// Beat 3 — pit (the void gap crossed by the horizontal driftstone).
fill(31, 12, 37, 13, -1);
// Beat 6 — chasm under the riftgate pair.
fill(70, 12, 73, 13, -1);

// Beat 2 — one-way ledges to jump up through / drop through.
fill(16, 10, 19, 10, 1); // ledge A
fill(21, 8, 24, 8, 1); // ledge B

// Beat 5 — slopeR ramp (rises to the right) → high solid platform (the high route).
set(54, 11, 3);
set(55, 10, 3);
set(56, 9, 3);
fill(57, 9, 62, 9, 0); // high platform, top = row 9 (y=288), meets the ramp's top
// …and a ladder to a mote cache (the second route up).
fill(64, 7, 64, 11, 4);

// Beat 7 — high ledge the vertical lift reaches.
fill(81, 6, 85, 6, 0);

// Decorative background stone (5) — dim, non-solid ruins for depth (ART.md idx 5).
const decor = [
  [9, 4], [10, 4], [10, 5],
  [38, 3], [39, 3], [39, 4],
  [66, 5], [67, 5],
  [86, 3], [87, 3], [87, 4],
];
for (const [c, r] of decor) set(c, r, 5);

const properties = {
  "0": { solid: true },
  "1": { oneWay: true },
  "2": { slopeL: TS, slopeR: 0 }, // high on the LEFT (descends right)
  "3": { slopeL: 0, slopeR: TS }, // high on the RIGHT (ascends right)
  "4": { ladder: true },
  "5": {},
};

// --- entity helpers (grid → pixels) -----------------------------------------
const cell = (c, r) => ({ x: c * TS, y: r * TS }); // top-left of a cell
const center16 = (c, r) => ({ x: c * TS + (TS - 16) / 2, y: r * TS + (TS - 16) / 2 });

let moteN = 0;
const mote = (c, r) => ({
  id: `mote-${moteN++}`,
  sprite: { kind: "sheet", src: "assets/lumen/mote.png", frameWidth: 16, frameHeight: 16, frameCount: 4, fps: 10, animations: { spin: { from: 0, to: 3 } } },
  size: { w: 16, h: 16 },
  position: center16(c, r),
  tags: ["mote"],
  layer: 4,
  behaviors: [
    { type: "collect-on-touch", part: "collect-on-touch@1.0.0", params: { collectorTag: "player", value: "$cfg.moteValue", scoreKey: "motes", kind: "mote", sound: "collect" } },
    { type: "sprite-animate", params: { play: "spin" } },
    { type: "tween", part: "tween@1.0.0", params: { property: "scale", from: 1, to: 1.2, duration: "$cfg.moteBobDuration", easing: "in-out-quad", loop: "pingpong" } },
  ],
});

let spikeN = 0;
const spike = (c) => ({
  id: `spike-${spikeN++}`,
  sprite: { kind: "shape", shape: "triangle", color: "#ff4fb0", stroke: "#070512", strokeWidth: 1 },
  size: { w: 32, h: 32 },
  position: cell(c, 11), // sits on the floor (row 11, base at the row-12 surface)
  tags: ["spike"],
  layer: 2,
  behaviors: [{ type: "trigger-zone", part: "trigger-zone@1.0.0", params: { tag: "player", kill: true, enterEvent: "hazard", sound: "hit" } }],
});

let wraithN = 0;
const wraith = (cLeft, cRight) => {
  const y = FLOOR_TOP_Y - 24; // stands on the floor surface
  return {
    id: `wraith-${wraithN++}`,
    sprite: { kind: "sheet", src: "assets/lumen/driftwraith.png", frameWidth: 24, frameHeight: 24, frameCount: 2, fps: 3, animations: { bob: { from: 0, to: 1, fps: 3 } } },
    size: { w: 24, h: 24 },
    position: { x: cLeft * TS, y },
    tags: ["wraith"],
    layer: 4,
    behaviors: [
      { type: "ai-patrol", part: "ai-patrol@1.0.0", params: { points: [{ x: cLeft * TS, y }, { x: cRight * TS, y }], speed: "$cfg.wraithSpeed", waitTime: "$cfg.wraithWaitTime", pingPong: true } },
      { type: "velocity", params: {} },
      { type: "contact-damage", part: "contact-damage@1.0.0", params: { targetTag: "player", damage: "$cfg.wraithDamage", cooldown: "$cfg.damageCooldown", knockback: "$cfg.wraithKnockback" } },
      { type: "face-velocity", part: "face-velocity@1.0.0", params: {} },
      { type: "sprite-animate", params: { play: "bob" } },
    ],
  };
};

const driftstone = (id, points, speedCfg) => ({
  id,
  sprite: { kind: "shape", shape: "rect", color: "#3a2f6b", stroke: "#4fe0cf", strokeWidth: 2 },
  size: { w: 64, h: 16 },
  position: { x: points[0].x, y: points[0].y },
  tags: ["driftstone"],
  collider: { role: "solid", carriable: true },
  layer: 3,
  behaviors: [
    { type: "follow-path", part: "follow-path@1.1.0", params: { points, speed: speedCfg, loop: true } },
    { type: "velocity", params: {} },
  ],
});

const riftgate = (id, c, targetId) => ({
  id,
  sprite: { kind: "image", src: "assets/lumen/riftgate.png" },
  size: { w: 32, h: 48 },
  position: { x: c * TS, y: FLOOR_TOP_Y - 48 },
  tags: ["rift"],
  layer: 3,
  behaviors: [
    { type: "portal", part: "portal@1.0.0", params: { tag: "player", targetId, cooldown: "$cfg.portalCooldown", sound: "collect" } },
    { type: "tween", part: "tween@1.0.0", params: { property: "scale", from: 1, to: 1.12, duration: "$cfg.riftPulseDuration", easing: "in-out-quad", loop: "pingpong" } },
  ],
});

let cpN = 0;
const checkpoint = (c) => ({
  id: `checkpoint-${cpN++}`,
  sprite: { kind: "shape", shape: "rect", color: "#9a5cff" },
  size: { w: 12, h: 40 },
  position: { x: c * TS + 10, y: FLOOR_TOP_Y - 40 },
  tags: ["checkpoint"],
  layer: 2,
  behaviors: [{ type: "trigger-zone", part: "trigger-zone@1.0.0", params: { tag: "player", enterEvent: "checkpoint", once: true, setStateKey: `cp${cpN}`, sound: "collect" } }],
});

// --- entities ---------------------------------------------------------------
const entities = [];

// Beat 1 — spawn plaza: an arc of motes teaching the jump.
entities.push(mote(4, 10), mote(6, 9), mote(8, 8), mote(10, 9), mote(12, 10));

// Beat 2 — one-way ledges + a patrolling driftwraith.
entities.push(mote(17, 9), mote(18, 9), mote(22, 7), mote(23, 7));
entities.push(wraith(15, 20));

// Beat 3 — checkpoint, pit, horizontal carrying driftstone, motes over the gap.
entities.push(checkpoint(28));
entities.push(driftstone("driftstone-h", [{ x: 30 * TS, y: 380 }, { x: 37 * TS, y: 380 }, { x: 30 * TS, y: 380 }], "$cfg.driftstoneSpeed"));
entities.push(mote(33, 11), mote(35, 11));

// Beat 4 — spike corridor (forgiving spacing) with jump-arc mote rewards.
entities.push(spike(44), spike(45), spike(48), spike(49), spike(52), spike(53));
entities.push(mote(46, 9), mote(50, 9));

// Beat 5 — slope ramp → high platform (motes), and a ladder to a mote cache.
entities.push(mote(58, 8), mote(60, 8), mote(62, 8));
entities.push(mote(64, 10), mote(64, 9), mote(64, 8), mote(64, 7));

// Beat 6 — riftgate pair warping across the chasm.
entities.push(mote(67, 10));
entities.push(riftgate("rift-A", 68, "rift-B"), riftgate("rift-B", 75, "rift-A"));

// Beat 7 — second checkpoint + vertical lift to a high mote ledge.
entities.push(checkpoint(76));
entities.push(driftstone("driftstone-lift", [{ x: 79 * TS, y: 380 }, { x: 79 * TS, y: 200 }, { x: 79 * TS, y: 380 }], "$cfg.liftSpeed"));
entities.push(mote(82, 5), mote(84, 5));

// Beat 8 — emberstone guarded by a last wraith, then the Beacon (goal).
entities.push(wraith(88, 94));
entities.push(mote(88, 10), mote(95, 11));
entities.push({
  id: "emberstone",
  sprite: { kind: "image", src: "assets/lumen/emberstone.png" },
  size: { w: 16, h: 16 },
  position: center16(92, 10),
  tags: ["ember"],
  layer: 4,
  behaviors: [
    { type: "collect-on-touch", part: "collect-on-touch@1.0.0", params: { collectorTag: "player", value: "$cfg.emberValue", scoreKey: "motes", kind: "ember", sound: "collect" } },
    { type: "tween", part: "tween@1.0.0", params: { property: "scale", from: 1, to: 1.25, duration: "$cfg.emberPulseDuration", easing: "in-out-quad", loop: "pingpong" } },
  ],
});
entities.push({
  id: "beacon",
  sprite: { kind: "image", src: "assets/lumen/beacon.png" },
  size: { w: 32, h: 64 },
  position: { x: 97 * TS, y: FLOOR_TOP_Y - 64 },
  tags: ["beacon"],
  layer: 3,
  behaviors: [
    { type: "trigger-zone", part: "trigger-zone@1.0.0", params: { tag: "player", enterEvent: "level-clear", once: true, sound: "win" } },
    { type: "tween", part: "tween@1.0.0", params: { property: "scale", from: 1, to: 1.08, duration: "$cfg.beaconPulseDuration", easing: "in-out-quad", loop: "pingpong" } },
  ],
});

// Kill-plane (the void): a full-width strip below the lowest footing.
entities.push({
  id: "void",
  sprite: { kind: "none" },
  size: { w: COLS * TS, h: 60 },
  position: { x: 0, y: 450 },
  tags: ["void"],
  layer: 0,
  behaviors: [{ type: "trigger-zone", part: "trigger-zone@1.0.0", params: { tag: "player", kill: true, enterEvent: "void", sound: "hit" } }],
});

// --- scene ------------------------------------------------------------------
const scene = {
  id: "level-1",
  extends: "play-base",
  world: { width: COLS * TS, height: ROWS * TS },
  tilemap: { tileSize: TS, tileset: "assets/lumen/tiles.png", cols: COLS, rows: ROWS, tiles, properties },
  entities,
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, "..", "src", "scenes", "level-1.json");
writeFileSync(outPath, JSON.stringify(scene, null, 2) + "\n", "utf8");

// --- ASCII preview (stderr) for a quick layout sanity-check -----------------
const GLYPH = { "-1": "·", 0: "█", 1: "▔", 2: "◣", 3: "◢", 4: "Ⅱ", 5: "░" };
let preview = "";
for (let r = 0; r < ROWS; r++) {
  let line = "";
  for (let c = 0; c < COLS; c++) line += GLYPH[tiles[idx(c, r)]] ?? "?";
  preview += line + "\n";
}
process.stderr.write(preview);
console.log(`Wrote level-1.json — ${COLS}×${ROWS} tilemap, ${entities.length} entities (world ${COLS * TS}×${ROWS * TS}).`);
