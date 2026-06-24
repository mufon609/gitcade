#!/usr/bin/env node
/**
 * Author games/lumen/src/scenes/level-2.json — "The Sundering Reach" — from a readable grid spec.
 *
 * Level-2 is the TWO-PATH world. Exactly as gen-level.mjs is the deterministic source for level-1's
 * committed JSON, THIS is the deterministic source for level-2's: re-run `npm run gen:level-2` and the
 * output is byte-identical. Edit the BEATS here, never the generated JSON.
 *
 * ── The shape of it ────────────────────────────────────────────────────────────────────────────────
 * A ~3× longer, TALLER world than level-1 (300×24 = 9600×768 vs level-1's 100×15 = 3200×480). The
 * extra height buys a real HIGH route. From a fork early on, two paths run in parallel and reconverge
 * before the Beacon:
 *   • the GROUND path — a continuous, safe floor the whole way (rows 21–22 solid); the default route,
 *     and the one the headless traversal autopilot beats. Every level-1 mechanic appears on or beside
 *     it, but in a DIFFERENT ORDER than level-1.
 *   • the CLOUDS path — high up (rows ~5–9), ENTERED through a riftgate portal on a perch above the
 *     floor (so a floor-walker never trips it), holding the bonus (extra motes + the lone emberstone),
 *     rejoining the ground path further along via a one-way-ledge descent. Optional, and as forgiving
 *     as level-1: the floor stays solid UNDER the whole clouds stretch, so falling off a cloud lands you
 *     safely back on the ground path (the only void gap, the pit, sits in the shared post-reconverge
 *     stretch, never under a cloud).
 *
 * Beat order (ground): spawn arc → HILL → spikes → FORK(riftgate up) → wraith → spikes → reconverge →
 * wraith → PIT+driftstone → wraith → Beacon.  vs level-1: spawn → ledges+wraith → pit → spikes → hill →
 * riftgate(chasm) → lift → ember+wraith+Beacon. The HILL is beat 2 not 5; the PIT is near the END not
 * beat 3; the riftgate is an OPTIONAL fork not a forced chasm crossing; the emberstone + the vertical
 * lift + the ladder cache all live on the bonus CLOUDS path, not the main line.
 *
 * ── Engine facts the geometry is authored AGAINST (re-verified for this build) ───────────────────────
 *  1. A scene whose `world` is TALLER than `size` (the 800×480 viewport) scrolls VERTICALLY under
 *     camera-follow and CLAMPS to `world.bounds` — the viewport never shows past the world top/bottom
 *     (so the high route reads as sky, not void). Verified headless against the SDK runtime.
 *  2. `play-base` fixes the player spawn at (64,360) — tuned to level-1's row-12 floor. Level-2's floor
 *     is row 21, so the scene `overrides` the player `position` to sit on it (the one field-level patch
 *     a taller level needs; the level-1-tuned `lives-respawn` fallback never fires because the spawn
 *     checkpoint claims `respawnPoint` before any hazard).
 *  3. `portal@2.0.0` places the entrant's CENTER at the destination portal's CENTER, edge-triggered
 *     and bounce-free. So the clouds-side exit portal sits above its cloud platform EXACTLY as level-1's
 *     ground riftgates sit above the floor (`y = surface − 48`): the arrival settles onto footing.
 *  4. `follow-path`/`ai-patrol` steer by the entity CENTER — a mover's waypoints are CENTER coords, and
 *     a vertical lift's top rides flush with a surface when its center y = surface + halfHeight.
 *  5. A walkable slope (tile 2/3) SNAPS feet to its ramp surface; the player collider `stepHeight`
 *     (set in play-base) clears the sub-pixel slope→ledge seam, so the flat-topped HILL walks smoothly
 *     both directions (the exact level-1 construction, re-used here).
 *  6. A ladder (tile 4) is climbable while the player's CENTER is over a ladder cell — so a climb-UP
 *     cache rises from a ledge with its bottom cell at the stander's center row (the level-1 pattern).
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const TS = 32;
const COLS = 300;
const ROWS = 24;
const FLOOR_TOP_ROW = 21; // ground walk-surface = y = 21*32 = 672; solid floor rows 21–22; row 23 = void band
const FLOOR_TOP_Y = FLOOR_TOP_ROW * TS; // 672

// --- tilemap grid -----------------------------------------------------------
const tiles = new Array(COLS * ROWS).fill(-1);
const idx = (c, r) => r * COLS + c;
const set = (c, r, v) => {
  if (c >= 0 && c < COLS && r >= 0 && r < ROWS) tiles[idx(c, r)] = v;
};
const fill = (c0, r0, c1, r1, v) => {
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) set(c, r, v);
};

// Base ground: solid (0) at rows 21–22 across the WHOLE level — a continuous safe floor. The only break
// is the pit carved below, so falling off a cloud always lands on solid ground (the void is reachable
// only at the pit, in the shared stretch).
fill(0, FLOOR_TOP_ROW, COLS - 1, FLOOR_TOP_ROW + 1, 0);

// === GROUND PATH geometry ===================================================
// Beat 2 — the HILL (slopeR ramp → flat solid ledge → slopeL ramp), flat-topped so `stepHeight` clears
// the seam (the level-1 construction, re-used at floor row 21 → ledge row 18). A genuine forward
// traversal: up the near ramp, across the ledge, down the far ramp back onto the floor.
const HILL_LEDGE_ROW = 18; // 3 rows / 96px above the floor
for (const [c, r] of [[24, 20], [25, 19], [26, 18]]) set(c, r, 3); // slopeR ramp; apex (26,18) tops FLUSH with the ledge
fill(27, HILL_LEDGE_ROW, 31, HILL_LEDGE_ROW, 0); // solid hill ledge (row 18)
for (const [c, r] of [[32, 18], [33, 19], [34, 20]]) set(c, r, 2); // slopeL ramp; rejoins the floor at col 35

// FORK — the clouds entry. A one-way ledge PERCH one jump (96px) above the floor holds riftgate rift-A.
// A floor-walker passes harmlessly UNDERNEATH it (the perch is top-face-only and the riftgate AABB sits
// well above the floor), so the high route is strictly OPT-IN: jump up, step into rift-A, warp to the
// clouds. A mote trail climbs the perch to advertise it.
const FORK_PERCH_ROW = 18; // 96px above the floor — a single forgiving jump onto a one-way ledge
fill(51, FORK_PERCH_ROW, 54, FORK_PERCH_ROW, 1); // one-way perch (drop back down through it any time)

// === CLOUDS PATH geometry (high route, rows ~5–9) ===========================
const CLOUD_ROW = 9; // the main cloud walkway surface (y = 288)
const CLOUD_Y = CLOUD_ROW * TS; // 288
// rift-B ARRIVAL — a solid landing platform; the warp settles the player onto its row-9 surface.
fill(53, CLOUD_ROW, 62, CLOUD_ROW, 0);
// WALKWAY — one-way ledges (5-wide) with small 2-col / 64px jumpable gaps.
for (const c0 of [65, 72, 79, 86, 93]) fill(c0, CLOUD_ROW, c0 + 4, CLOUD_ROW, 1);
// LADDER CACHE — a ladder rising off the 2nd walkway ledge to a one-way mote perch (the level-1 cache
// pattern). Its bottom cell sits at the stander's center row (8) so a walker on the ledge grabs it.
const CACHE_LADDER_COL = 74;
fill(CACHE_LADDER_COL, CLOUD_ROW - 3, CACHE_LADDER_COL, CLOUD_ROW - 1, 4); // ladder rows 6–8
const CACHE_PERCH_ROW = 6;
set(75, CACHE_PERCH_ROW, 1); // one-way mote perch beside the ladder top

// EMBER PERCH — high (row 5), reached only by the vertical LIFT (authored as an entity below); it rises
// from the walkway (row 9) to the perch (row 5). The walkway ends at col 97; the lift bridges up to col 100.
const PERCH_ROW = 5; // 128px above the walkway
const PERCH_Y = PERCH_ROW * TS; // 160
fill(100, PERCH_ROW, 108, PERCH_ROW, 0); // solid ember perch

// DESCENT — a one-way-ledge cascade stepping down from the perch back to the ground (the reconvergence).
// Each step is 4 rows / 128px; walk right off each ledge onto the next, or hold down to drop through.
for (const [c0, r] of [[110, 9], [116, 13], [122, 17]]) fill(c0, r, c0 + 3, r, 1);
const RECONVERGE_COL = 128; // the cascade lands back on the ground floor about here

// === SHARED post-reconverge geometry ========================================
// Beat — the PIT: a void gap bridged by a horizontal carrying driftstone (level-1's signature carry,
// here near the END). Carve the floor; the kill-plane shows through.
const PIT_L = 168; // first empty floor column
const PIT_R = 174; // first solid floor column AFTER the pit (far ledge left edge = 174*32)
fill(PIT_L, FLOOR_TOP_ROW, PIT_R - 1, FLOOR_TOP_ROW + 1, -1);

// Decorative background stone (5) — dim, non-solid ruins for depth (ART.md idx 5), scattered high & low.
for (const [c, r] of [
  [14, 13], [15, 13], [15, 14], [44, 7], [45, 7], [120, 11], [121, 11],
  [160, 8], [161, 8], [200, 14], [201, 14], [201, 15], [250, 7], [251, 7], [278, 12], [279, 12],
]) set(c, r, 5);

const properties = {
  "0": { solid: true },
  "1": { oneWay: true },
  "2": { slopeL: TS, slopeR: 0 }, // high on the LEFT (descends right)
  "3": { slopeL: 0, slopeR: TS }, // high on the RIGHT (ascends right)
  "4": { ladder: true },
  "5": {},
};

// --- entity helpers (grid → pixels) -----------------------------------------
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

// gloomspike — a CENTERED 16×12 inner box sitting LOW in the 32-px cell (Mario-tight, shrunk in the
// player's favor); lethal via `contact-damage` so death routes through the player's health-and-death.
const SPIKE_W = 16;
const SPIKE_H = 12;
let spikeN = 0;
const spike = (c) => ({
  id: `spike-${spikeN++}`,
  sprite: { kind: "shape", shape: "triangle", color: "#ff4fb0", stroke: "#070512", strokeWidth: 1 },
  size: { w: SPIKE_W, h: SPIKE_H },
  position: { x: c * TS + (TS - SPIKE_W) / 2, y: FLOOR_TOP_Y - SPIKE_H }, // base flush on the floor
  tags: ["spike"],
  layer: 2,
  behaviors: [{ type: "contact-damage", part: "contact-damage@1.0.0", params: { targetTag: "player", damage: "$cfg.spikeDamage", cooldown: "$cfg.damageCooldown", sound: "hit" } }],
});

let wraithN = 0;
const wraith = (cLeft, cRight, surfaceY = FLOOR_TOP_Y) => {
  const y = surfaceY - 24; // stands on the given surface (floor by default; a cloud platform if passed)
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
  // top-left so its CENTER starts at the first waypoint (follow-path steers by center — engine fact 4)
  position: { x: points[0].x - DRIFT_W / 2, y: points[0].y - DRIFT_H / 2 },
  tags: ["driftstone"],
  collider: { role: "solid", carriable: true },
  layer: 3,
  behaviors: [
    { type: "follow-path", part: "follow-path@1.1.0", params: { points, speed: speedCfg, loop: true } },
    { type: "velocity", params: {} },
  ],
});

const riftgate = (id, c, surfaceY, targetId) => ({
  id,
  sprite: { kind: "image", src: "assets/lumen/riftgate.png" },
  size: { w: 32, h: 48 },
  position: { x: c * TS, y: surfaceY - 48 }, // sits on the given surface (floor perch, or a cloud platform)
  tags: ["rift"],
  layer: 3,
  behaviors: [
    { type: "portal", part: "portal@2.0.0", params: { tag: "player", targetId, sound: "collect" } },
    { type: "tween", part: "tween@1.0.0", params: { property: "scale", from: 1, to: 1.12, duration: "$cfg.riftPulseDuration", easing: "in-out-quad", loop: "pingpong" } },
  ],
});

// A checkpoint MOVES the live respawn point (`setRespawnKey` → `lives-respawn.respawnStateKey`). Its y is
// the standing-surface y so the respawn lands cleanly on footing (floor, or a cloud platform if passed).
const RESPAWN_KEY = "respawnPoint";
const CHECKPOINT_H = 24;
let cpN = 0;
const checkpoint = (c, surfaceY = FLOOR_TOP_Y) => ({
  id: `checkpoint-${cpN++}`,
  sprite: { kind: "shape", shape: "rect", color: "#9a5cff" },
  size: { w: 12, h: CHECKPOINT_H },
  position: { x: c * TS + 10, y: surfaceY - CHECKPOINT_H },
  tags: ["checkpoint"],
  layer: 2,
  behaviors: [
    { type: "trigger-zone", part: "trigger-zone@1.1.0", params: { tag: "player", enterEvent: "checkpoint", once: true, setRespawnKey: RESPAWN_KEY, sound: "collect" } },
    { type: "tween", part: "tween@1.0.0", params: { property: "scale", from: 1, to: 1.12, duration: "$cfg.checkpointPulseDuration", easing: "in-out-quad", loop: "pingpong" } },
  ],
});

// === PHASE-3 MECHANIC · the void HUNTER (chaser) ============================
// A voidhound: `ai-chase` pursues "player" in full 2D (lockAxis "none") at a SLOW speed, so the faster
// player out-runs it — it swoops across you ONCE in the open, then trails behind for good. It is ghostly
// like the wraith (NO collider → flies straight at the player through terrain). `health-and-death` gives
// it hp purely for completeness (nothing in Lumen damages it, and its `deathEvent` is deliberately NOT
// "died", so it can never drive the player's death FX); `contact-damage` routes a touch through the
// PLAYER's hp, so a lethal one fires the single canonical "died" the shell already binds flash/shake/
// explosion to. `face-velocity` turns it to face its travel. Order: chase SETS velocity → `velocity`
// integrates → contact → health → face (reads vx) → animate (the wraith's behavior order).
let hunterN = 0;
const hunter = (c, r) => ({
  id: `hunter-${hunterN++}`,
  sprite: { kind: "sheet", src: "assets/lumen/voidhound.png", frameWidth: 24, frameHeight: 24, frameCount: 2, fps: 4, animations: { hover: { from: 0, to: 1, fps: 4 } } },
  size: { w: 24, h: 24 },
  position: { x: c * TS, y: r * TS },
  tags: ["hunter"],
  layer: 4,
  behaviors: [
    { type: "ai-chase", part: "ai-chase@1.0.0", params: { targetTag: "player", speed: "$cfg.hunterSpeed", stopDistance: "$cfg.hunterStopDistance", lockAxis: "none" } },
    { type: "velocity", params: {} },
    { type: "contact-damage", part: "contact-damage@1.0.0", params: { targetTag: "player", damage: "$cfg.hunterDamage", cooldown: "$cfg.damageCooldown" } },
    { type: "health-and-death", part: "health-and-death@1.1.0", params: { hp: "$cfg.hunterHp", deathEvent: "hunter-spent", deathSound: "" } },
    { type: "face-velocity", part: "face-velocity@1.0.0", params: {} },
    { type: "sprite-animate", params: { play: "hover" } },
  ],
});

// === PHASE-3 MECHANIC · the RIFT-SENTRY (shooting obstacle) =================
// An arcane turret: `ai-aim-and-fire` fires a SLOW bolt at the player on a cooldown while the player is
// within range. The bolt is an entity-def — `velocity` + `contact-damage{selfDestruct}` (one-shot, dies
// on the hit) + `health-and-death{lifespan}` (a MISS expires of old age, so bolts never accumulate) —
// and routes its damage through the player's hp → the same canonical "died". Slow bolts + a moving
// player = easy to jump/dodge (a walker eats one on the approach; once past, the bolts chase and miss).
// Stationary, NO collider (an emplacement floating in the ruins); a `tween` pulses it visibly "alive".
let sentryN = 0;
const BOLT_WH = 10;
const riftSentry = (c, y) => ({
  id: `rift-sentry-${sentryN++}`,
  sprite: { kind: "image", src: "assets/lumen/riftsentry.png" },
  size: { w: 24, h: 24 },
  position: { x: c * TS + (TS - 24) / 2, y },
  tags: ["rift-sentry"],
  layer: 3,
  behaviors: [
    {
      type: "ai-aim-and-fire",
      part: "ai-aim-and-fire@1.1.0",
      params: {
        targetTag: "player",
        range: "$cfg.sentryRange",
        cooldown: "$cfg.sentryCooldown",
        projectileSpeed: "$cfg.sentryBulletSpeed",
        // The bolt — danger-fuchsia (the universal hazard tell), a small shape primitive (ART.md sanctions
        // shapes for projectiles, as the gloomspikes/driftstones are). $cfg-balanced damage + lifespan.
        projectile: {
          id: "bolt",
          sprite: { kind: "shape", shape: "circle", color: "#ff4fb0", stroke: "#070512", strokeWidth: 1 },
          size: { w: BOLT_WH, h: BOLT_WH },
          tags: ["bolt"],
          layer: 3,
          behaviors: [
            { type: "velocity", params: {} },
            { type: "contact-damage", part: "contact-damage@1.0.0", params: { targetTag: "player", damage: "$cfg.sentryBulletDamage", selfDestruct: true, sound: "hit" } },
            { type: "health-and-death", part: "health-and-death@1.1.0", params: { hp: "$cfg.sentryBulletHp", lifespan: "$cfg.sentryBulletLifespan", deathSound: "" } },
          ],
        },
      },
    },
    { type: "tween", part: "tween@1.0.0", params: { property: "scale", from: 1, to: 1.15, duration: "$cfg.sentryPulseDuration", easing: "in-out-quad", loop: "pingpong" } },
  ],
});

// --- entities ---------------------------------------------------------------
const entities = [];

// Beat G1 — spawn plaza: an arc of motes teaching the run + jump.
entities.push(mote(5, 20), mote(7, 19), mote(9, 18), mote(11, 19), mote(13, 20));

// Beat G2 — the hill: motes crown the ledge (reward the climb-over).
entities.push(mote(28, 17), mote(30, 17));

// Beat G3 — a checkpoint on the flat ground past the hill, THEN gloomspikes cluster 1 + a mote arc to
// clear it. The checkpoint sits BEFORE the level's first hazard (the spawn→hill stretch is death-free), so
// `respawnPoint` is always claimed before anything can kill you — a pre-checkpoint death would otherwise
// fall back to the inherited level-1 spawn (high above level-2's lower floor) and respawn from the sky.
entities.push(checkpoint(37));
entities.push(spike(40), spike(41));
entities.push(mote(42, 19), mote(43, 18), mote(44, 19));

// FORK — the clouds entry. rift-A on the perch (warps to rift-B in the clouds); a mote trail climbs to it.
entities.push(mote(51, 20), mote(52, 19), mote(53, 18));
entities.push(riftgate("rift-A", 52, FORK_PERCH_ROW * TS, "rift-B"));

// Beat G5 — parallel GROUND section: wraith, checkpoint, spikes. The floor stays solid the whole way (no
// pit), so a cloud-faller lands here safely.
entities.push(wraith(68, 78));
entities.push(mote(84, 20), mote(88, 20));
entities.push(checkpoint(92));
entities.push(spike(110), spike(111));
entities.push(mote(112, 19), mote(113, 18));
entities.push(mote(120, 20), mote(124, 20));

// Reconvergence — a mote where the clouds descent rejoins the floor, then a checkpoint just past it.
entities.push(mote(RECONVERGE_COL, 20));
entities.push(checkpoint(130));

// Beat G6 — shared post-reconverge run: wraith, the PIT + carrying driftstone, a last wraith, motes.
entities.push(wraith(142, 152));
entities.push(checkpoint(160));
// The driftstone bridges the pit: near waypoint centers it on the pit's left lip; the far waypoint puts
// its CENTER on the far ledge's left edge (right half onto the floor) — a comfortable carried crossing.
const driftNearX = PIT_L * TS;
const driftFarX = PIT_R * TS;
const driftY = FLOOR_TOP_Y + DRIFT_H / 2; // top rides flush with the floor walk-surface — a waiting player is simply CARRIED
entities.push(driftstone("driftstone-h", [{ x: driftNearX, y: driftY }, { x: driftFarX, y: driftY }, { x: driftNearX, y: driftY }], "$cfg.driftstoneSpeed"));
entities.push(mote(PIT_L + 1, 20), mote(PIT_R - 1, 20));
entities.push(checkpoint(186));
entities.push(wraith(214, 226));
// This open post-pit flat (checkpoint 186 behind, wraith 214 ahead) is where the void HUNTER (spawned far
// right, Beat G8) swoops in to cross the player ≈col 200 — these motes pull the eye forward into the
// incoming-hunter sightline, the safe arena where you first read its slow approach before it brushes past.
entities.push(mote(196, 20), mote(204, 20), mote(220, 19), mote(236, 20));
entities.push(checkpoint(244));

// Beat G7 — the RIFT-SENTRY (Phase-3 shooting obstacle). The long, open Beacon run-up past checkpoint
// 244 IS the SAFE-INTRO: the floating, pulsing sentry is visible from far off and the player watches its
// first slow bolt cross the open before it can connect. It fires while the player APPROACHES (a walker
// eats about one), then the player passes and the bolts trail and miss. Motes lure the weave through its
// fire line. Floats a little above head height so a jump clears the bolt — easy to dodge.
entities.push(riftSentry(262, FLOOR_TOP_Y - 56));
entities.push(mote(258, 20), mote(268, 19), mote(278, 20), mote(286, 20));

// Beat G8 — the void HUNTER (Phase-3 chaser). It SPAWNS high near the Beacon and immediately homes left
// in full 2D toward the player; being slow, it meets the player back in the open post-pit flat (≈col 200,
// see the wraith/mote beat above), brushes ONCE, then trails the rest of the run — always out-run. Spawned
// high so it reads as descending out of the dusk as it closes; its damage routes the canonical "died".
entities.push(hunter(286, 14));

// === CLOUDS PATH entities ===================================================
// rift-B arrival (paired with rift-A), then walkway motes + a cloud checkpoint + the ladder cache.
entities.push(riftgate("rift-B", 55, CLOUD_Y, "rift-A"));
entities.push(mote(67, 8), mote(74, 7), mote(75, 5), mote(88, 8), mote(95, 8)); // walkway + cache motes
entities.push(checkpoint(81, CLOUD_Y)); // on the 3rd walkway ledge (row 9)

// The vertical LIFT: rises from the walkway (row 9) to the ember perch (row 5). Center x over the gap
// between the walkway (…col 97) and the perch (col 100…); its top rides flush with each surface.
const LIFT_X = 99 * TS + TS / 2; // 3184 — centered just left of the perch's left edge (col 100)
entities.push(driftstone("driftstone-lift", [
  { x: LIFT_X, y: CLOUD_Y + DRIFT_H / 2 },  // bottom: top flush with the walkway (row 9)
  { x: LIFT_X, y: PERCH_Y + DRIFT_H / 2 },  // top: flush with the perch (row 5)
  { x: LIFT_X, y: CLOUD_Y + DRIFT_H / 2 },
], "$cfg.liftSpeed"));

// The EMBERSTONE + a mote cache on the perch (the bonus payoff for taking the high route), then motes
// down the descent cascade (reward the route back to the ground).
entities.push(mote(102, 4), mote(106, 4));
entities.push(mote(112, 8), mote(118, 12), mote(124, 16));
entities.push({
  id: "emberstone",
  sprite: { kind: "image", src: "assets/lumen/emberstone.png" },
  size: { w: 16, h: 16 },
  position: center16(104, 4),
  tags: ["ember"],
  layer: 4,
  behaviors: [
    { type: "collect-on-touch", part: "collect-on-touch@1.0.0", params: { collectorTag: "player", value: "$cfg.emberValue", scoreKey: "motes", kind: "ember", sound: "collect" } },
    { type: "tween", part: "tween@1.0.0", params: { property: "scale", from: 1, to: 1.25, duration: "$cfg.emberPulseDuration", easing: "in-out-quad", loop: "pingpong" } },
  ],
});

// Beacon (goal) — at the far right, on the floor. Being the FINAL level, clearing it routes past the
// last Beacon into the `levels-complete` win edge (host-driven).
const BEACON_COL = 292;
entities.push({
  id: "beacon",
  sprite: { kind: "image", src: "assets/lumen/beacon.png" },
  size: { w: 32, h: 64 },
  position: { x: BEACON_COL * TS, y: FLOOR_TOP_Y - 64 },
  tags: ["beacon"],
  layer: 3,
  behaviors: [
    { type: "trigger-zone", part: "trigger-zone@1.1.0", params: { tag: "player", enterEvent: "level-clear", once: true, sound: "win" } },
    { type: "tween", part: "tween@1.0.0", params: { property: "scale", from: 1, to: 1.08, duration: "$cfg.beaconPulseDuration", easing: "in-out-quad", loop: "pingpong" } },
  ],
});

// Kill-plane (the void): a full-width strip below the lowest footing — reachable only through the pit.
// Lethal via `contact-damage` so falling in fires the same canonical `died` as a spike or a drained wraith.
entities.push({
  id: "void",
  sprite: { kind: "none" },
  size: { w: COLS * TS, h: 60 },
  position: { x: 0, y: FLOOR_TOP_Y + 66 }, // ~66px below the floor surface (mirrors level-1's drop to the void)
  tags: ["void"],
  layer: 0,
  behaviors: [{ type: "contact-damage", part: "contact-damage@1.0.0", params: { targetTag: "player", damage: "$cfg.voidDamage", cooldown: "$cfg.damageCooldown", sound: "hit" } }],
});

// --- scene ------------------------------------------------------------------
const scene = {
  id: "level-2",
  extends: "play-base",
  world: { width: COLS * TS, height: ROWS * TS },
  // The one field-level patch a taller level needs: drop the inherited (level-1-tuned) player spawn onto
  // level-2's row-21 floor. Everything else — sprite, collider, behaviors, the whole shell — is inherited.
  overrides: [{ id: "player", position: { x: 64, y: FLOOR_TOP_Y - 24 } }],
  tilemap: { tileSize: TS, tileset: "assets/lumen/tiles.png", cols: COLS, rows: ROWS, tiles, properties },
  entities,
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, "..", "src", "scenes", "level-2.json");
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
console.log(`Wrote level-2.json — ${COLS}×${ROWS} tilemap, ${entities.length} entities (world ${COLS * TS}×${ROWS * TS}).`);
