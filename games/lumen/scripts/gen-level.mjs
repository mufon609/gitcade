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
 * Two engine facts the geometry is authored AGAINST (both verified against the SDK runtime):
 *   1. `follow-path`/`ai-patrol` steer by the entity's CENTER (`cx`/`cy`), not its top-left —
 *      so a mover's waypoints are CENTER coordinates. A landing platform's far waypoint is
 *      `targetEdge − halfWidth` to put its CENTER there, which lands its RIGHT EDGE on the floor.
 *   2. A walkable slope tile (2/3) SNAPS a body's feet to its surface, even from below — so a
 *      slope at floor level is a one-way funnel UP (you can't pass under it). The high route is
 *      therefore a HILL: walk up the ramp, across the ledge, down the far slope, rejoining the
 *      floor further along — a real forward traversal, not a dead-end you fall back from.
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
const PIT_L = 31; // first empty floor column
const PIT_R = 38; // first solid floor column AFTER the pit (far ledge left edge = 38*32 = 1216)
fill(PIT_L, 12, PIT_R - 1, 13, -1);
// Beat 6 — chasm under the riftgate pair.
fill(70, 12, 73, 13, -1);

// Beat 2 — one-way ledges to jump up through / drop through.
fill(16, 10, 19, 10, 1); // ledge A
fill(21, 8, 24, 8, 1); // ledge B

// Beat 5 — the HILL: a slopeR ramp up, a solid high ledge, a slopeL ramp down — FLAT-TOPPED. The
// ramp tops out FLUSH with the ledge: its apex cell (col 58) reaches row 9's surface (y=288) at its
// right edge, exactly where the solid ledge begins. A 45° slope snaps the foot to its surface under
// the entity CENTER, so a climber arrives at the seam with its foot ~half a collider-width below the
// ledge top — a small lip. The player collider's `stepHeight` (set in play-base) lets the engine STEP
// the body UP onto that lip instead of ramming the ledge's vertical face, so the slope→ledge seam is
// smooth walking RIGHT, and the flush apex means walking LEFT off the ledge simply descends the ramp
// (no upward lurch). The down-ramp lands the player back on the floor at col 67 — forward of the
// col-56 base — so the high route is a genuine way THROUGH the segment, not a dead-end.
const RAMP = [
  [56, 11], // 384 → 352
  [57, 10], // 352 → 320
  [58, 9], //  320 → 288  (apex tops FLUSH with the ledge surface at row 9)
];
for (const [c, r] of RAMP) set(c, r, 3); // slopeR — ascends to the right
const LEDGE_ROW = 9; // solid high ledge surface = top of row 9 (y=288), flush with the ramp apex
const LEDGE_L = 59; // first solid ledge col — the ramp apex (col 58) tops out at its left edge
const LEDGE_R = 63;
fill(LEDGE_L, LEDGE_ROW, LEDGE_R, LEDGE_ROW, 0);
const DROP = [
  [64, 9], //  288 → 320
  [65, 10], // 320 → 352
  [66, 11], // 352 → 384  (rejoins the floor at col 67)
];
for (const [c, r] of DROP) set(c, r, 2); // slopeL — descends to the right
const REJOIN_COL = 67; // floor column the down-ramp lands on
// Optional bonus: a ladder rising OFF the ledge to a one-way perch + mote cache. The ladder
// tops out one row ABOVE the perch (rows 6–8 vs the perch at row 7), so a climber steps off
// the side onto it cleanly — it exits onto footing, never open air.
const LADDER_COL = 61;
fill(LADDER_COL, 6, LADDER_COL, 8, 4);
const PERCH_COL = 62;
set(PERCH_COL, 7, 1); // one-way perch beside the ladder top

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

// gloomspike — the kill hitbox is the entity AABB (`aabb-collision` keys on the sprite box),
// so it is a CENTERED 16×12 inner box sitting LOW in the 32-px cell: grazing the triangle's
// empty upper corners now survives (Mario-tight, shrunk in the player's favor). Lethal via
// `contact-damage` (not a raw `kill` trigger) so the player's `health-and-death` fires the
// canonical `died` event — the single "player died" signal the host binds all FX to.
const SPIKE_W = 16;
const SPIKE_H = 12;
let spikeN = 0;
const spike = (c) => ({
  id: `spike-${spikeN++}`,
  sprite: { kind: "shape", shape: "triangle", color: "#ff4fb0", stroke: "#070512", strokeWidth: 1 },
  size: { w: SPIKE_W, h: SPIKE_H },
  position: { x: c * TS + (TS - SPIKE_W) / 2, y: FLOOR_TOP_Y - SPIKE_H }, // centered, base flush on the floor
  tags: ["spike"],
  layer: 2,
  behaviors: [{ type: "contact-damage", part: "contact-damage@1.0.0", params: { targetTag: "player", damage: "$cfg.spikeDamage", cooldown: "$cfg.damageCooldown", sound: "hit" } }],
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

const DRIFT_W = 64;
const DRIFT_H = 16;
const driftstone = (id, points, speedCfg) => ({
  id,
  sprite: { kind: "shape", shape: "rect", color: "#3a2f6b", stroke: "#4fe0cf", strokeWidth: 2 },
  size: { w: DRIFT_W, h: DRIFT_H },
  // top-left so its CENTER starts at the first waypoint (follow-path steers by center — header note 1)
  position: { x: points[0].x - DRIFT_W / 2, y: points[0].y - DRIFT_H / 2 },
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

// A checkpoint MOVES the live respawn point: `setRespawnKey` writes its own {x,y} to
// world.state.respawnPoint, which `lives-respawn` (respawnStateKey) respawns at — so a
// mid-level death returns you to the last checkpoint, not the level start. Its y is the
// player's standing y, so the respawn lands cleanly on the floor. A gentle scale pulse (the
// `checkpointPulseDuration` balance value) draws the eye to it.
const RESPAWN_KEY = "respawnPoint";
const CHECKPOINT_H = 24; // 12×24 marker standing on the floor; y is the player spawn-y
let cpN = 0;
const checkpoint = (c) => ({
  id: `checkpoint-${cpN++}`,
  sprite: { kind: "shape", shape: "rect", color: "#9a5cff" },
  size: { w: 12, h: CHECKPOINT_H },
  position: { x: c * TS + 10, y: FLOOR_TOP_Y - CHECKPOINT_H },
  tags: ["checkpoint"],
  layer: 2,
  behaviors: [
    { type: "trigger-zone", part: "trigger-zone@1.1.0", params: { tag: "player", enterEvent: "checkpoint", once: true, setRespawnKey: RESPAWN_KEY, sound: "collect" } },
    { type: "tween", part: "tween@1.0.0", params: { property: "scale", from: 1, to: 1.12, duration: "$cfg.checkpointPulseDuration", easing: "in-out-quad", loop: "pingpong" } },
  ],
});

// --- entities ---------------------------------------------------------------
const entities = [];

// Beat 1 — spawn plaza: an arc of motes teaching the jump.
entities.push(mote(4, 10), mote(6, 9), mote(8, 8), mote(10, 9), mote(12, 10));

// Beat 2 — one-way ledges + a patrolling driftwraith.
entities.push(mote(17, 9), mote(18, 9), mote(22, 7), mote(23, 7));
entities.push(wraith(15, 20));

// Beat 3 — checkpoint, pit, horizontal carrying driftstone, motes over the gap.
// The driftstone bridges the pit: near waypoint centers it on the pit's left lip (boardable
// from the near floor); the far waypoint puts its CENTER on the far ledge's left edge, so its
// right half (32px) overlaps the landing floor — a comfortable, reliably-crossable step-off.
entities.push(checkpoint(28));
const driftNearX = PIT_L * TS; // 992 — pit left lip (platform center here = left half on floor, right half over the gap)
const driftFarX = PIT_R * TS; //  1216 — far ledge left edge (center here ⇒ right edge 32px onto the floor)
// Center y so the platform's TOP rides flush with the floor walk-surface — a player waiting at
// the lip is simply CARRIED across (a 12px-proud platform presents a left-face wall you can't board).
const driftY = FLOOR_TOP_Y + DRIFT_H / 2; // 392 → top-left 384 → top surface = 384
entities.push(driftstone("driftstone-h", [{ x: driftNearX, y: driftY }, { x: driftFarX, y: driftY }, { x: driftNearX, y: driftY }], "$cfg.driftstoneSpeed"));
entities.push(mote(33, 11), mote(35, 11));

// Beat 4 — spike corridor: TWO tight 2-spike clusters with a wide safe gap between them. The gap
// is sized for the apex-hang jump arc (a full jump clears a cluster and lands in the next gap),
// then FLAT safe footing (cols 53–55) before the ramp base so there is no blind jump off spikes
// into the climb. Motes ride the jump arcs over the gap as rewards.
entities.push(spike(44), spike(45), spike(51), spike(52));
entities.push(mote(47, 9), mote(48, 8), mote(49, 9));

// Beat 5 — the hill (ramp → ledge → ramp down) with a bonus ladder cache.
entities.push(mote(60, 8), mote(63, 8)); // ledge-top motes (reward the high traversal)
entities.push(mote(LADDER_COL, 7), mote(LADDER_COL, 6), mote(PERCH_COL, 6)); // ladder/perch cache

// Beat 6 — riftgate pair warping across the chasm; a mote where the down-ramp rejoins the floor.
entities.push(mote(REJOIN_COL, 11));
entities.push(riftgate("rift-A", 68, "rift-B"), riftgate("rift-B", 75, "rift-A"));

// Beat 7 — second checkpoint + vertical lift to a high mote ledge. The lift's CENTER rides the
// waypoints (header note 1): its top-left starts at points[0].x−32, so it rises flush to the
// row-6 ledge (y=192) with its right edge meeting the ledge's left edge — a clean step-off.
entities.push(checkpoint(76));
// Lift center x=2560 ⇒ right edge 2592 = the row-6 ledge's left edge (cols 81–85) — flush at the top;
// bottom center y=driftY so its top is flush with the floor (boardable by simply standing on it).
entities.push(driftstone("driftstone-lift", [{ x: 2560, y: driftY }, { x: 2560, y: 200 }, { x: 2560, y: driftY }], "$cfg.liftSpeed"));
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
    { type: "trigger-zone", part: "trigger-zone@1.1.0", params: { tag: "player", enterEvent: "level-clear", once: true, sound: "win" } },
    { type: "tween", part: "tween@1.0.0", params: { property: "scale", from: 1, to: 1.08, duration: "$cfg.beaconPulseDuration", easing: "in-out-quad", loop: "pingpong" } },
  ],
});

// Kill-plane (the void): a full-width strip below the lowest footing. Lethal via
// `contact-damage` (not a raw `kill`) so falling in fires the same canonical `died` event as a
// spike or a drained wraith hit — one "player died" signal, one set of FX.
entities.push({
  id: "void",
  sprite: { kind: "none" },
  size: { w: COLS * TS, h: 60 },
  position: { x: 0, y: 450 },
  tags: ["void"],
  layer: 0,
  behaviors: [{ type: "contact-damage", part: "contact-damage@1.0.0", params: { targetTag: "player", damage: "$cfg.voidDamage", cooldown: "$cfg.damageCooldown", sound: "hit" } }],
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
