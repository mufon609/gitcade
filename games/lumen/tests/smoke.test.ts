import { describe, it, expect } from "vitest";
import { createGame, createReplay, snapshotWorld, MemoryStorage, type Game, type RunRecording } from "@gitcade/sdk";
import { createLibraryRegistry, restoreRecordingEntry, createRunStore, createCampaign } from "@gitcade/library";
import { registerCustomBehaviors } from "../src/custom-behaviors/index.js";
import manifest from "../game.json";
import config from "../config.json";
import playBase from "../src/scenes/play-base.json";
import level1 from "../src/scenes/level-1.json";
import level2 from "../src/scenes/level-2.json";
import menu from "../src/scenes/menu.json";

/**
 * The headless smoke boot `gitcade validate` defers to (Lumen uses @gitcade/library parts
 * the default SDK registry can't supply). Boots `level-1` (which `extends` the `play-base`
 * shell) on the library registry and exercises the data-driven platformer + the headline
 * Echo. It also GATES the mechanical-tightness fixes two ways: STRUCTURAL assertions encode
 * the regenerated geometry (so a generator regression fails loudly), and a TRAVERSAL autopilot
 * drives the player from spawn to the Beacon (so "is it actually beatable?" is a test, not a hope).
 *
 * Lumen ships no custom behaviors, so registerCustomBehaviors is a no-op — but calling it
 * (like the other games) means a remix that vendors a community part into a Lumen fork
 * installs the managed registry, and THIS smoke test then registers the vendored behavior
 * instead of throwing "unknown behavior type" during ecosystem validation.
 */
const SEED = 0x10de;
const TS = 32;
const FLOOR_TOP_Y = 12 * TS; // 384 — the floor walk-surface

function boot(opts: { seed?: number; record?: boolean } = {}): Game {
  const registry = createLibraryRegistry();
  registerCustomBehaviors(registry);
  return createGame(
    { manifest, config, scenes: [playBase, level1, level2] },
    { canvas: null, registry, entrySceneId: "level-1", seed: opts.seed ?? SEED, record: opts.record },
  );
}

const player = (g: Game) => g.world.query("player")[0];
const hold = (g: Game, code: string, down = true) => g.world.input.setKey(code, down);
const stepUntil = (g: Game, done: () => boolean, maxFrames: number): number => {
  for (let f = 0; f < maxFrames; f++) {
    if (done()) return f;
    g.stepFrames(1);
  }
  return maxFrames;
};

// Boot into level-2 for the level-2 tests via the REAL campaign path: boot level-1 and advance one
// level. createGame now HONORS `entrySceneId`, so level-2 IS directly bootable (the SDK's
// faithful-level-replay test boots a recorded level-2 in ISOLATION, restoring the recording's
// entryState) — but these tests want level-2 entered exactly as a playthrough reaches it: the carried
// world.state AND the seeded-rng phase, not a from-scratch boot. The two settle ticks + the drain tick
// run with NO input and seed nothing random, so two `bootL2` games on the same seed reach level-2 in
// byte-identical state — which is what lets the level-2 Echo replay below compare equal.
function bootL2(opts: { seed?: number; record?: boolean } = {}): Game {
  const g = boot(opts);
  g.stepFrames(2);
  g.requestNextLevel();
  g.stepFrames(1); // drain the queued transition → level-2 is now the active scene
  return g;
}

// Boot DIRECTLY at any scene in ISOLATION (createGame's entrySceneId) — the per-level Echo / live-retry
// boot path main.ts uses (the Phase-2 attract loop and a mid-campaign retry both enter a level this way,
// then restore the recording's entry-state). Unlike bootL2, NO level before it is played.
function isoBoot(sceneId: string, opts: { seed?: number; record?: boolean } = {}): Game {
  const registry = createLibraryRegistry();
  registerCustomBehaviors(registry);
  return createGame(
    { manifest, config, scenes: [playBase, level1, level2] },
    { canvas: null, registry, entrySceneId: sceneId, seed: opts.seed ?? SEED, record: opts.record },
  );
}

// --- tilemap helpers for the structural assertions (read straight off the generated scene) ---
// The JSON imports infer very precise (per-element union) types; loosen them for structural reads.
type TileProp = { solid?: boolean; oneWay?: boolean; slopeL?: number; slopeR?: number; ladder?: boolean };
type LevelEntity = { id: string; tags?: string[]; size?: { w: number; h: number }; position?: { x: number; y: number }; behaviors?: Array<{ params?: Record<string, unknown> }> };
const TM = level1.tilemap as unknown as { tileSize: number; cols: number; rows: number; tiles: number[]; properties: Record<string, TileProp> };
const ENTITIES = level1.entities as unknown as LevelEntity[];
const tileAt = (c: number, r: number): number => TM.tiles[r * TM.cols + c] ?? -1;
const isSolid = (c: number, r: number): boolean => tileAt(c, r) === 0;
const isSlope = (c: number, r: number): boolean => tileAt(c, r) === 2 || tileAt(c, r) === 3;
const ent = (id: string): LevelEntity => ENTITIES.find((e) => e.id === id)!;
const spikes = (): LevelEntity[] => ENTITIES.filter((e) => e.tags?.includes("spike"));

// --- a scene-AGNOSTIC coarse autopilot (shared by the campaign / full-run Echo / clouds drives below) ---
// The level-1 / level-2 beatability autopilots read the active scene's footing inline; the whole-campaign
// drives cross a transition, so they read it off the ACTIVE scene each tick (level-1 and level-2 have
// different tilemaps). Same policy as the per-level autopilots, factored into one place: walk right, hop
// hazards, wait at a pit lip for the carrying driftstone then ride it, nudge off a wedge — with the
// anti-stuck counter + the held-to-apex jump latch carried in `ctx` so a single run threads both levels.
const footingActive = (g: Game, x: number, yTop: number, yBot: number): boolean => {
  const props = (g.scene as unknown as { tilemap?: { properties?: Record<string, TileProp> } }).tilemap?.properties ?? {};
  for (let y = yTop; y <= yBot; y += TS) {
    const idx = g.world.tileAt(x, y);
    const p = idx >= 0 ? props[String(idx)] : undefined;
    if (p && (p.solid === true || p.oneWay === true || typeof p.slopeL === "number" || typeof p.slopeR === "number")) return true;
  }
  return false;
};
type PilotCtx = { lastX: number; stuck: number; jumpHeld: boolean };
const newPilot = (): PilotCtx => ({ lastX: 0, stuck: 0, jumpHeld: false });
// Decide the ground autopilot's move-right for this tick + update the held-jump latch in ctx (no stepping).
const groundControls = (g: Game, p: NonNullable<ReturnType<typeof player>>, ctx: PilotCtx): boolean => {
  const px = p.x, foot = p.y + p.h, leadX = p.x + p.w, onGround = p.body.contacts.onGround;
  const pitAhead = onGround && !footingActive(g, leadX + 6, foot - 6, foot + 2 * TS) && !footingActive(g, leadX + TS, foot - 6, foot + 2 * TS);
  const stepOff = footingActive(g, leadX + 8, foot + 2, foot + 2) || footingActive(g, leadX + 20, foot + 2, foot + 2);
  const hazardAhead = [...g.world.query("spike"), ...g.world.query("wraith")].some((h) => h.x > p.cx - 10 && h.x < p.cx + 58 && Math.abs(h.cy - p.cy) < 64);
  const onDrift = g.world.query("driftstone").some((d) => Math.abs(foot - d.y) < 10 && leadX > d.x + 2 && px < d.x + d.w - 2);
  let goRight = true, wantJump = false;
  const waiting = pitAhead && !onDrift;
  if (onDrift) goRight = stepOff; else if (waiting) goRight = false;
  if (hazardAhead && onGround && !waiting) wantJump = true;
  if (onGround && goRight && !onDrift && Math.abs(px - ctx.lastX) < 0.3) ctx.stuck++; else ctx.stuck = 0;
  if (ctx.stuck > 30) wantJump = true;
  ctx.lastX = px;
  if (wantJump && onGround) ctx.jumpHeld = true;
  if (ctx.jumpHeld && !onGround && p.vy >= 0) ctx.jumpHeld = false; // release at apex → full jump, no jumpCut
  return goRight;
};
// One full ground-autopilot tick: decide, apply input, advance one fixed frame.
const groundTick = (g: Game, ctx: PilotCtx): void => {
  const p = player(g);
  if (!p) { hold(g, "ArrowRight", false); hold(g, "Space", false); g.stepFrames(1); return; }
  const goRight = groundControls(g, p, ctx);
  hold(g, "ArrowRight", goRight); hold(g, "ArrowLeft", false); hold(g, "Space", ctx.jumpHeld);
  g.stepFrames(1);
};

describe("lumen smoke (level-1 boots from the play-base shell)", () => {
  it("boots level-1 with the player, HUD-fed state, and the obstacle roster", () => {
    const g = boot();
    expect(g.scene.id).toBe("level-1");
    expect(g.world.query("player").length).toBe(1);
    expect(g.world.state.level).toBe(1); // manifest.levels → 1-based stage index (set in loadScene)
    g.stepFrames(1); // score + lives-respawn + health-and-death seed their state on the first tick
    expect(g.world.state.lives).toBe(config.startLives);
    expect(player(g).state.hp).toBe(config.playerHp);
    // The full obstacle roster is present (composed onto our own art).
    expect(g.world.query("mote").length).toBeGreaterThan(10);
    expect(g.world.query("wraith").length).toBe(2);
    expect(g.world.query("spike").length).toBe(4); // two 2-spike clusters
    expect(g.world.query("rift").length).toBe(2);
    expect(g.world.query("driftstone").length).toBe(2);
    expect(g.world.query("checkpoint").length).toBe(2);
    expect(g.world.query("beacon").length).toBe(1);
    // Screen-space HUD entities ride the shell (data HUD, fixed under the follow-camera).
    expect(g.world.query("hud").length).toBeGreaterThanOrEqual(4);
    expect(() => g.stepFrames(120)).not.toThrow();
  });

  it("the player rests on the floor and runs on input", () => {
    const g = boot();
    g.stepFrames(10);
    expect(player(g).body.contacts.onGround).toBe(true);
    const x0 = player(g).x;
    hold(g, "ArrowRight");
    g.stepFrames(30);
    expect(player(g).vx).toBeGreaterThan(0);
    expect(player(g).x).toBeGreaterThan(x0);
  });

  it("a mote is collected on touch — motes counter up, mote consumed, no throw", () => {
    const g = boot();
    g.stepFrames(5);
    const mote = g.world.query("mote")[0]!;
    const before = g.world.query("mote").length;
    const motesBefore = (g.world.state.motes as number) ?? 0;
    // Drop the player onto the mote (collection is aabb overlap + collect-on-touch).
    player(g).x = mote.x;
    player(g).y = mote.y;
    g.stepFrames(2);
    expect(g.world.query("mote").length).toBe(before - 1);
    expect(g.world.state.motes as number).toBe(motesBefore + config.moteValue);
  });

  it("the void costs a life via the canonical death and respawns the player at the start", () => {
    const g = boot();
    g.stepFrames(5);
    expect(g.world.state.lives).toBe(config.startLives);
    // The void is lethal CONTACT-DAMAGE now (not a raw kill): the player's health-and-death
    // drives the death, so it fires the canonical "died" the FX bind to. That routing costs a
    // tick or two, so step until the player is actually destroyed rather than asserting on frame 2.
    let died = false;
    g.world.events.on("died", () => (died = true));
    player(g).y = 460; // into the void band (full-width kill-plane at the world bottom)
    stepUntil(g, () => g.world.query("player").length === 0, 8);
    expect(g.world.query("player").length).toBe(0); // destroyed
    expect(died).toBe(true); // via the canonical death signal, not a silent kill
    g.stepFrames(1); // lives-respawn (a system) spends the life the tick AFTER it sees the player gone
    expect(g.world.state.lives).toBeLessThan(config.startLives); // a life spent
    // Respawn after the delay, back near the spawn point (no checkpoint touched).
    g.stepFrames(Math.ceil(config.respawnDelay * 60) + 5);
    expect(g.world.query("player").length).toBe(1);
    expect(player(g).x).toBeLessThan(200);
  });

  it("a checkpoint MOVES the respawn point (mid-level death returns there, not the start)", () => {
    const g = boot();
    g.stepFrames(2);
    const cp = g.world.query("checkpoint")[0]!; // checkpoint-0, well past the spawn
    expect(cp.x).toBeGreaterThan(200);
    // Touch it: trigger-zone.setRespawnKey writes the zone's {x,y} to world.state.respawnPoint.
    player(g).x = cp.x;
    player(g).y = cp.y;
    g.stepFrames(2);
    expect(g.world.state.respawnPoint).toEqual({ x: cp.x, y: cp.y });
    // Now die in the void → lives-respawn.respawnStateKey respawns at the checkpoint, not x=64.
    player(g).y = 460;
    stepUntil(g, () => g.world.query("player").length === 0, 8);
    g.stepFrames(Math.ceil(config.respawnDelay * 60) + 5);
    expect(g.world.query("player").length).toBe(1);
    expect(player(g).x).toBeGreaterThan(cp.x - 40); // respawned AT the checkpoint, far from the start
  });

  it("reaching the Beacon emits level-clear (the win edge the host listens for)", () => {
    const g = boot();
    let cleared = false;
    g.world.events.on("level-clear", () => (cleared = true));
    g.stepFrames(5);
    const beacon = g.world.query("beacon")[0]!;
    player(g).x = beacon.x;
    player(g).y = beacon.y + 16;
    g.stepFrames(3);
    expect(cleared).toBe(true);
  });

  it("draining the last life emits gameover (the lose edge the host listens for)", () => {
    const g = boot();
    let over = false;
    g.world.events.on("gameover", () => (over = true));
    g.stepFrames(5);
    g.world.state.lives = 1; // on the brink
    player(g).y = 460; // into the void → last life spent → gameover
    stepUntil(g, () => over, 10);
    expect(over).toBe(true);
    expect(g.world.state.outcome).toBe("lose");
  });
});

describe("lumen level geometry — the mechanical-tightness fixes are ENCODED (can't silently regress)", () => {
  it("C1: the pit driftstone's far reach overlaps the landing floor by ≥16px", () => {
    const drift = ent("driftstone-h");
    const halfW = drift.size!.w / 2;
    const points = (drift.behaviors![0].params!.points as Array<{ x: number }>);
    const farCenterX = Math.max(...points.map((p) => p.x));
    const platformRightEdge = farCenterX + halfW; // follow-path steers by CENTER, so right edge = center + halfW
    // Far landing floor = the first solid floor column after the pit the platform bridges.
    const r = 12;
    let farFloorLeftCol = -1;
    let inGap = false;
    for (let c = Math.floor(points[0].x / TS); c < TM.cols; c++) {
      if (!isSolid(c, r)) inGap = true;
      else if (inGap) { farFloorLeftCol = c; break; }
    }
    expect(farFloorLeftCol).toBeGreaterThan(0);
    const overlap = platformRightEdge - farFloorLeftCol * TS;
    expect(overlap).toBeGreaterThanOrEqual(16);
  });

  it("C2: the ramp tops out FLUSH with the ledge — a flat-top hill (apex row == ledge surface row)", () => {
    // The highest slopeR (idx 3) ramp cell — the apex.
    let apexCol = -1;
    let apexRow = TM.rows;
    for (let c = 0; c < TM.cols; c++) {
      for (let r = 0; r < TM.rows; r++) {
        if (tileAt(c, r) === 3 && r < apexRow) { apexRow = r; apexCol = c; }
      }
    }
    expect(apexCol).toBeGreaterThan(0);
    // The solid ledge begins at the apex's NEXT column, at the SAME row: the ramp tops out flush with
    // the ledge (no 32px notch). The climber walks off the ramp onto the ledge — the engine collider
    // `stepHeight` (10) clears the ~half-collider-width (≈8px) slope-exit lip there — and walking back simply
    // descends the ramp with no upward lurch. (Both directions are gated by the traversal test below.)
    const ledgeLeadCol = apexCol + 1;
    expect(isSolid(ledgeLeadCol, apexRow)).toBe(true); // solid ledge flush at the apex row
    expect(tileAt(apexCol, apexRow - 1)).toBe(-1); // nothing protrudes a row above the apex (no notch)
    expect(tileAt(ledgeLeadCol, apexRow - 1)).toBe(-1); // nor above the ledge's leading cell
  });

  it("C3: the high ledge connects FORWARD via a down-ramp that rejoins the floor past the climb", () => {
    // A solid high ledge (row 9) exists...
    const hasLedge = Array.from({ length: TM.cols }, (_, c) => isSolid(c, 9)).some(Boolean);
    expect(hasLedge).toBe(true);
    // ...followed by a slopeL (idx 2) descent that lands back on the floor FORWARD of the ramp base.
    let rampBaseCol = TM.cols;
    let dropBottomCol = -1;
    for (let c = 0; c < TM.cols; c++) {
      if (tileAt(c, 11) === 3 && c < rampBaseCol) rampBaseCol = c; // slopeR ramp base (row 11)
      if (tileAt(c, 11) === 2) dropBottomCol = Math.max(dropBottomCol, c); // slopeL descent bottom (row 11)
    }
    expect(rampBaseCol).toBeLessThan(TM.cols);
    expect(dropBottomCol).toBeGreaterThan(rampBaseCol); // descent rejoins forward, not back at the start
    expect(isSolid(dropBottomCol + 1, 12)).toBe(true); // the rejoin column is solid floor
  });

  it("M1: flat safe footing sits between the last spike and the ramp base", () => {
    const lastSpikeCol = Math.max(...spikes().map((s) => Math.round(s.position!.x / TS)));
    let rampBaseCol = TM.cols;
    for (let c = 0; c < TM.cols; c++) if (tileAt(c, 11) === 3 && c < rampBaseCol) { rampBaseCol = c; break; }
    expect(rampBaseCol).toBeGreaterThan(lastSpikeCol + 1); // a gap exists
    // every column strictly between is flat floor: solid below, and no slope/spike at the walk row.
    for (let c = lastSpikeCol + 1; c < rampBaseCol; c++) {
      expect(isSolid(c, 12)).toBe(true);
      expect(isSlope(c, 11)).toBe(false);
    }
    expect(spikes().every((s) => Math.round(s.position!.x / TS) < rampBaseCol)).toBe(true);
  });

  it("M2: spike hitboxes are an inset 16×12 box sitting low in the 32px cell", () => {
    expect(spikes().length).toBeGreaterThan(0);
    for (const s of spikes()) {
      expect(s.size!.w).toBe(16); // shrunk from the full 32px tile
      expect(s.size!.h).toBe(12);
      expect(s.position!.x % TS).toBe((TS - 16) / 2); // centered horizontally in the cell
      expect(s.position!.y + s.size!.h).toBe(FLOOR_TOP_Y); // base flush on the floor (sits LOW)
    }
  });
});

describe("lumen hill traversal — the flat-top hill is smooth BOTH directions (slope-exit jam fixed)", () => {
  const LEDGE_TOP_Y = 9 * TS; // 288 — the hilltop solid surface

  // Place the player so its (inset) collider foot settles on `footSurfaceY` at world-x `cx`, then hold
  // `key` for `frames`, recording center-x each frame and the worst grounded horizontal stall — a JAM
  // wedges the body for dozens of frames with no x progress; a smooth climb/descent keeps it ≈0.
  function driveHeld(cx: number, footSurfaceY: number, key: "ArrowLeft" | "ArrowRight", frames: number) {
    const g = boot();
    const p0 = player(g);
    p0.x = cx - p0.w / 2;
    p0.y = footSurfaceY - p0.h - 4; // a few px above the surface; the settle drops it on cleanly
    p0.vx = 0;
    p0.vy = 0;
    g.stepFrames(14); // settle onto the surface
    hold(g, key);
    const dir = key === "ArrowRight" ? 1 : -1;
    let prevX = player(g).x;
    let maxStall = 0;
    let stall = 0;
    const cxs: number[] = [];
    for (let f = 0; f < frames; f++) {
      g.stepFrames(1);
      const q = player(g);
      if (!q) break; // walked off into a hazard past the hill — irrelevant to the hill itself
      const dx = q.x - prevX;
      if (q.body.contacts.onGround && Math.sign(dx) !== dir && Math.abs(dx) < 0.5) stall++;
      else { maxStall = Math.max(maxStall, stall); stall = 0; }
      cxs.push(q.cx);
      prevX = q.x;
    }
    return { maxStall: Math.max(maxStall, stall), cxs };
  }

  it("the player collider opts into stepHeight (the engine seam-clearing knob)", () => {
    const p = player(boot());
    expect(p.body.collider?.stepHeight).toBeGreaterThan(0); // both the live + respawn-prototype copies set it
  });

  it("holding ArrowRight climbs floor → ramp → ledge with no horizontal stall (the seam step-up)", () => {
    // start on the flat safe footing left of the ramp base (col 54), foot on the floor
    const { cxs, maxStall } = driveHeld(54 * TS + TS / 2, FLOOR_TOP_Y, "ArrowRight", 100);
    // climbed ONTO the hilltop ledge (cols 59–63): a frame with the player's center over it proves the
    // slope→ledge seam was cleared, not jammed — the reported bug, in reverse.
    expect(cxs.some((cx) => cx >= 59 * TS && cx <= 63 * TS)).toBe(true);
    expect(maxStall).toBeLessThan(8); // no multi-frame wedge at the seam (a jam is dozens of frames)
  });

  it("holding ArrowLeft descends hilltop → ramp → floor with no upward lurch or stall (the reported bug)", () => {
    // start standing on the hilltop ledge (col 61), foot on the ledge surface
    const { cxs, maxStall } = driveHeld(61 * TS + TS / 2, LEDGE_TOP_Y, "ArrowLeft", 80);
    // center-x strictly decreases across the descent: no jam, and (crucially) no upward lurch flinging
    // it back — the flush apex means walking off the ledge simply descends the ramp.
    let monotonic = true;
    for (let i = 1; i < cxs.length; i++) if (cxs[i] > cxs[i - 1] + 0.5) { monotonic = false; break; }
    expect(monotonic).toBe(true);
    expect(maxStall).toBeLessThan(8);
    expect(Math.min(...cxs)).toBeLessThan(56 * TS); // descended past the ramp base (col 56) onto the floor
  });
});

describe("lumen lives-respawn prototype — the player is authored TWICE; guard the copy from drifting", () => {
  // `lives-respawn` clones a `prototype` entity-def on each respawn. The part takes a full prototype
  // OBJECT — there is no data path to point it at the live `player` entity by id — so play-base authors
  // the player TWICE: the live entity AND the respawn prototype. With two levels now sharing this one
  // shell, that duplicate spans a bigger surface, so a drifted copy (a changed collider / stepHeight /
  // inset / layer, or a behavior added to one copy but not the other) is a real bug. These lock the two
  // together, allowing ONLY the two deliberate differences:
  //   (a) the prototype carries NO `position` — lives-respawn supplies the respawn point; and
  //   (b) the prototype's health-and-death omits `hpStateKey:"carriedHp"` — a fresh LIFE respawns at the
  //       static $cfg.playerHp, NOT the (possibly-low) hp a level transition carries into the live player.
  type EntityDef = Record<string, unknown> & { behaviors?: Array<{ type: string; params: Record<string, unknown> }> };
  const livePlayer = (playBase.entities as unknown as EntityDef[]).find((e) => e.id === "player")!;
  const respawnSys = (playBase.systems as unknown as Array<{ type: string; params: { prototype: EntityDef } }>).find((s) => s.type === "lives-respawn")!;
  const proto = respawnSys.params.prototype;

  it("the prototype omits position (lives-respawn supplies the respawn point) and h&d's hpStateKey", () => {
    expect(livePlayer.position).toBeDefined();
    expect(proto.position).toBeUndefined();
    const liveHd = livePlayer.behaviors!.find((b) => b.type === "health-and-death")!;
    const protoHd = proto.behaviors!.find((b) => b.type === "health-and-death")!;
    expect(liveHd.params.hpStateKey).toBe("carriedHp"); // the live player re-seeds from the carried hp
    expect(protoHd.params.hpStateKey).toBeUndefined(); // a fresh life does NOT — it's full $cfg.playerHp
  });

  it("EVERY other field — sprite, size, tags, collider, layer, and all OTHER behaviors — byte-matches", () => {
    // Normalize the two sanctioned diffs, then assert full structural equality: anything else that drifts
    // (a collider inset, the stepHeight, the layer, a behavior added to one copy only) fails LOUDLY here.
    const norm = (def: EntityDef): EntityDef => {
      const c = JSON.parse(JSON.stringify(def)) as EntityDef;
      delete c.position;
      const hd = c.behaviors!.find((b) => b.type === "health-and-death")!;
      delete hd.params.hpStateKey;
      return c;
    };
    expect(norm(proto)).toEqual(norm(livePlayer));
  });

  it("IN-ENGINE: a respawned player (cloned from the prototype) has the SAME collider as the live player", () => {
    // The data guard above proves the AUTHORED copies match; this proves the engine instantiates the
    // prototype into a body whose collider (role + inset + stepHeight) is byte-identical to the live one.
    const g = boot();
    g.stepFrames(5);
    const liveCollider = JSON.parse(JSON.stringify(player(g).body.collider)); // snapshot the original, pre-death
    expect((liveCollider as { stepHeight?: number }).stepHeight).toBe(10); // the seam-clearing knob is live
    player(g).y = 460; // into the void → lives-respawn clones the prototype after respawnDelay
    stepUntil(g, () => g.world.query("player").length === 0, 8);
    g.stepFrames(Math.ceil(config.respawnDelay * 60) + 5);
    const respawned = player(g);
    expect(respawned).toBeTruthy();
    expect(respawned.body.collider).toEqual(liveCollider); // role + inset + stepHeight all identical
  });
});

describe("lumen beatability — a coarse autopilot completes start → Beacon", () => {
  it("drives the player from spawn to the Beacon (level-clear, no gameover, within budget)", () => {
    const g = boot();
    let cleared = false;
    let over = false;
    g.world.events.on("level-clear", () => (cleared = true));
    g.world.events.on("gameover", () => (over = true));

    // Is there a footing TILE (solid/oneway/slope) at world x within [yTop, yBot]?
    const footingAt = (x: number, yTop: number, yBot: number): boolean => {
      for (let y = yTop; y <= yBot; y += TS) {
        const idx = g.world.tileAt(x, y);
        const p = idx >= 0 ? TM.properties?.[String(idx)] : undefined;
        if (p && (p.solid === true || p.oneWay === true || typeof p.slopeL === "number" || typeof p.slopeR === "number")) return true;
      }
      return false;
    };

    let stuckTicks = 0;
    let lastX = 0;
    let jumpHeld = false; // hold a jump to APEX (full height) — a 1-tick tap halves it (jumpCut)
    const BUDGET = 2500; // the run clears well inside this (≈1100 ticks); the slack absorbs platform-cycle waits
    for (let f = 0; f < BUDGET && !cleared && !over; f++) {
      const p = player(g);
      if (!p) { hold(g, "ArrowRight", false); hold(g, "Space", false); g.stepFrames(1); continue; }
      const px = p.x, pcx = p.cx, pcy = p.cy, foot = p.y + p.h, leadX = p.x + p.w;
      const onGround = p.body.contacts.onGround;

      // A genuine gap ahead (no footing in the next tile) vs solid ground to step onto at foot level.
      const pitAhead = onGround && !footingAt(leadX + 6, foot - 6, foot + 2 * TS) && !footingAt(leadX + TS, foot - 6, foot + 2 * TS);
      const stepOff = footingAt(leadX + 8, foot + 2, foot + 2) || footingAt(leadX + 20, foot + 2, foot + 2);
      const hazardAhead = [...g.world.query("spike"), ...g.world.query("wraith")].some((h) => h.x > pcx - 10 && h.x < pcx + 58 && Math.abs(h.cy - pcy) < 64);
      const riftAhead = g.world.query("rift").some((r) => r.x + r.w > pcx && r.x < pcx + 60 && Math.abs(r.cy - pcy) < 80);
      const onDrift = g.world.query("driftstone").some((d) => Math.abs(foot - d.y) < 10 && leadX > d.x + 2 && px < d.x + d.w - 2);

      let goRight = true;
      let wantJump = false;
      const waiting = pitAhead && !onDrift && !riftAhead; // hold at a lip for the carrying platform
      if (onDrift) goRight = stepOff; // ride; walk forward only to step onto solid ground
      else if (waiting) goRight = false;
      if (hazardAhead && onGround && !waiting) wantJump = true;

      // anti-stuck ONLY while actively trying to move (never while waiting/riding — that can last ~90 ticks)
      if (onGround && goRight && !onDrift && Math.abs(px - lastX) < 0.3) stuckTicks++;
      else stuckTicks = 0;
      if (stuckTicks > 30) wantJump = true;
      lastX = px;

      if (wantJump && onGround) jumpHeld = true;
      if (jumpHeld && !onGround && p.vy >= 0) jumpHeld = false; // release at apex (full jump, no jumpCut)

      hold(g, "ArrowRight", goRight);
      hold(g, "ArrowLeft", false);
      hold(g, "Space", jumpHeld);
      g.stepFrames(1);
    }

    expect(over).toBe(false); // never bottomed out
    expect(cleared).toBe(true); // reached the Beacon
  });
});

describe("lumen Echo — a recorded run replays byte-for-byte", () => {
  it("a seeded recorded run re-simulates to identical per-tick snapshots (what lines the Echo up)", () => {
    // Record a real run: hold right, tap jump partway, for 90 ticks.
    const rec = boot({ seed: SEED, record: true });
    const origSnaps: string[] = [];
    rec.world.input.setKey("ArrowRight", true);
    for (let f = 0; f < 90; f++) {
      if (f === 20) rec.world.input.setKey("Space", true);
      if (f === 24) rec.world.input.setKey("Space", false);
      rec.stepFrames(1);
      origSnaps.push(snapshotWorld(rec.world));
    }
    const recording = rec.getRecording();
    expect(recording.seed).toBe(SEED);
    expect(recording.sceneId).toBe("level-1");
    expect(recording.frameCount).toBe(90);

    // Replay it through a FRESH seeded game (exactly as the Echo does) and compare each tick.
    const replayGame = boot({ seed: recording.seed });
    const replay = createReplay(replayGame, recording);
    const seen: string[] = [];
    while (!replay.done) {
      replay.step();
      seen.push(snapshotWorld(replay.game.world));
    }
    expect(seen.length).toBe(90);
    expect(seen).toEqual(origSnaps); // byte-identical at every tick — the Echo re-runs the run
  });

  it("a recorded LEVEL-2 run replays byte-for-byte (per-level recording: no cross-scene transition)", () => {
    // The Phase-1 desync was a SINGLE recording spanning level-1 → level-2: an input-only replay can't
    // reproduce the host-driven `requestNextLevel()` transition, so it desynced at the boundary. The fix
    // is PER-LEVEL recordings — each starts fresh on its level's entry and contains NO transition. Here we
    // prove a level-2 recording re-simulates byte-identically: record on a game advanced into level-2 and
    // RE-ARMED there (`resetRecording`), then replay through a fresh game advanced the same way.
    const rec = bootL2({ seed: SEED, record: true });
    rec.resetRecording(); // drop the level-1 + drain ticks → frame 0 is now level-2's first tick
    const origSnaps: string[] = [];
    rec.world.input.setKey("ArrowRight", true);
    for (let f = 0; f < 90; f++) {
      if (f === 20) rec.world.input.setKey("Space", true);
      if (f === 24) rec.world.input.setKey("Space", false);
      rec.stepFrames(1);
      origSnaps.push(snapshotWorld(rec.world));
    }
    const recording = rec.getRecording();
    expect(recording.seed).toBe(SEED);
    expect(recording.sceneId).toBe("level-2"); // the re-armed recording is rooted at level-2 — NOT level-1
    expect(recording.frameCount).toBe(90);
    // No frame's input references a scene change (recordings carry only input); the single recording is
    // wholly within level-2 — the cross-scene transition that desynced the spanning Phase-1 recording is gone.

    const replayGame = bootL2({ seed: recording.seed }); // same path into level-2 → identical entry state
    const replay = createReplay(replayGame, recording);
    const seen: string[] = [];
    while (!replay.done) {
      replay.step();
      seen.push(snapshotWorld(replay.game.world));
    }
    expect(seen.length).toBe(90);
    expect(seen).toEqual(origSnaps); // byte-identical — a level-2 Echo lines up exactly
  });
});

describe("lumen level sequencing — two levels, stats carry across the transition", () => {
  // Loosen the JSON import's precise inferred type for structural reads.
  const LEVEL2 = level2 as unknown as {
    id: string;
    extends?: string;
    world?: { width: number; height: number };
    overrides?: Array<{ id: string; position?: { x: number; y: number } }>;
    entities: Array<{ id: string; tags?: string[] }>;
    tilemap: { tileSize: number; cols: number; rows: number; tiles: number[]; properties: Record<string, TileProp> };
  };

  it("STRUCTURAL: level-2 is the real two-path world that extends play-base (≈3× level-1, taller)", () => {
    expect(LEVEL2.id).toBe("level-2");
    expect(LEVEL2.extends).toBe("play-base"); // shares the shell — player, HUD, camera, FX, systems, flow
    // ≈3× level-1's length, and TALLER (a real high route): 300×24 = 9600×768 vs level-1's 100×15.
    expect(LEVEL2.world).toEqual({ width: 9600, height: 768 });
    expect(LEVEL2.tilemap.cols).toBe(level1.tilemap.cols * 3);
    expect(LEVEL2.world!.height).toBeGreaterThan(level1.world!.height);
    // The one field-level patch a taller level needs: the player spawn dropped onto level-2's floor.
    expect(LEVEL2.overrides?.some((o) => o.id === "player" && typeof o.position?.y === "number")).toBe(true);
    // The full obstacle roster + the lone emberstone (the clouds bonus) are present.
    expect(LEVEL2.entities.filter((e) => e.tags?.includes("mote")).length).toBeGreaterThan(20);
    expect(LEVEL2.entities.filter((e) => e.tags?.includes("rift")).length).toBe(2); // the riftgate pair
    expect(LEVEL2.entities.filter((e) => e.tags?.includes("ember")).length).toBe(1); // the lone emberstone (clouds)
    expect(LEVEL2.entities.some((e) => e.tags?.includes("beacon"))).toBe(true);
    expect(LEVEL2.entities.some((e) => e.tags?.includes("void"))).toBe(true);
    expect(manifest.levels).toEqual(["level-1", "level-2"]); // the ordered campaign sequence
  });

  it("requestNextLevel advances level-1 → level-2 and the HUD level index becomes 2", () => {
    const g = boot();
    g.stepFrames(2);
    expect(g.scene.id).toBe("level-1");
    expect(g.world.state.level).toBe(1);
    g.world.state.carriedHp = config.playerHp; // host carries hp on the boundary
    g.requestNextLevel();
    g.stepFrames(1); // drain the queued transition
    expect(g.scene.id).toBe("level-2");
    expect(g.world.state.level).toBe(2); // format-binding renders this as HUD "LEVEL 2"
    g.stepFrames(5);
    expect(g.world.query("player").length).toBe(1);
    expect(g.world.query("beacon").length).toBe(1);
    expect(player(g).body.contacts.onGround).toBe(true); // the spawn-position override drops it onto level-2's row-21 floor
  });

  it("clearing level-1 at PARTIAL hp boots level-2 with that SAME hp + carried motes & lives", () => {
    const g = boot();
    g.stepFrames(2);
    const p = player(g);
    // Mid-level progress: a partial-hp player who has banked motes; lives untouched.
    p.state.hp = 2; // took two hits (full is config.playerHp = 3)
    g.world.state.motes = 7;
    const livesBefore = g.world.state.lives as number;
    expect(p.state.hp).toBeLessThan(config.playerHp);

    // Reach level-1's Beacon → "level-clear"; the host carries the LIVE player's remaining hp.
    let cleared = false;
    g.world.events.on("level-clear", () => {
      cleared = true;
      g.world.state.carriedHp = player(g).state.hp; // exactly what main.ts's handler does
    });
    const beacon = g.world.query("beacon")[0]!;
    p.x = beacon.x;
    p.y = beacon.y + 16;
    g.stepFrames(3);
    expect(cleared).toBe(true);

    // The host advances on the continue press.
    g.requestNextLevel();
    g.stepFrames(1); // drain → level-2 built (the player is rebuilt, hp unset)
    expect(g.scene.id).toBe("level-2");
    expect(g.world.state.level).toBe(2);
    g.stepFrames(1); // level-2 player's health-and-death seeds hp from carriedHp via hpStateKey

    expect(player(g).state.hp).toBe(2); // the PARTIAL hp carried over — NOT reset to full playerHp
    expect(g.world.state.motes).toBe(7); // motes carried (scene flow.persist)
    expect(g.world.state.lives).toBe(livesBefore); // lives carried (scene flow.persist)
  });

  it("a fresh LIFE in level-2 respawns at FULL hp (the prototype is static, not the carried value)", () => {
    const g = boot();
    g.stepFrames(2);
    g.world.state.carriedHp = 1; // arrive in level-2 on a sliver of hp
    g.requestNextLevel();
    g.stepFrames(2);
    expect(g.scene.id).toBe("level-2");
    expect(player(g).state.hp).toBe(1); // the carried sliver seeds the live player

    // Die in the void → lives-respawn clones the PROTOTYPE (static $cfg.playerHp, no hpStateKey). level-2's
    // floor is row 21, so its kill-plane sits far lower than level-1's — read it off the live void entity.
    player(g).y = g.world.query("void")[0]!.y + 12;
    stepUntil(g, () => g.world.query("player").length === 0, 8);
    g.stepFrames(Math.ceil(config.respawnDelay * 60) + 5);
    expect(g.world.query("player").length).toBe(1);
    expect(player(g).state.hp).toBe(config.playerHp); // a fresh life is FULL hp, not the carried 1
  });

  it("the final win fires only AFTER level-2's Beacon (its clear → levels-complete, no further level)", () => {
    const g = boot();
    g.stepFrames(2);
    g.world.state.carriedHp = config.playerHp;
    g.requestNextLevel(); // level-1 → level-2
    g.stepFrames(2);
    expect(g.scene.id).toBe("level-2");

    let cleared = false;
    let complete = false;
    g.world.events.on("level-clear", () => (cleared = true));
    g.world.events.on("levels-complete", () => (complete = true));

    // Touch level-2's Beacon → "level-clear"…
    const beacon = g.world.query("beacon")[0]!;
    const p = player(g);
    p.x = beacon.x;
    p.y = beacon.y + 16;
    g.stepFrames(3);
    expect(cleared).toBe(true);

    // …and advancing the LAST level emits "levels-complete" (the final-win edge), staying put.
    g.requestNextLevel();
    expect(complete).toBe(true);
    expect(g.scene.id).toBe("level-2"); // there is no level past the last
  });
});

describe("lumen level-2 — the two-path world (structure ENCODED + both paths reachable)", () => {
  // level-2 structural reads (the generated geometry — a regression fails loudly), mirroring the level-1
  // helpers above against level-2's own tilemap.
  const TM2 = level2.tilemap as unknown as { tileSize: number; cols: number; rows: number; tiles: number[]; properties: Record<string, TileProp> };
  const tile2 = (c: number, r: number): number => TM2.tiles[r * TM2.cols + c] ?? -1;
  const isSolid2 = (c: number, r: number): boolean => tile2(c, r) === 0;
  const FLOOR2_ROW = 21; // level-2's ground walk-surface row
  const firstSlopeCol = (tm: typeof TM2): number => {
    for (let c = 0; c < tm.cols; c++) for (let r = 0; r < tm.rows; r++) { const t = tm.tiles[r * tm.cols + c]; if (t === 2 || t === 3) return c; }
    return tm.cols;
  };
  const firstPitCol = (tm: typeof TM2, floorRow: number): number => {
    for (let c = 0; c < tm.cols; c++) if (tm.tiles[floorRow * tm.cols + c] !== 0) return c; // first gap in the solid floor
    return tm.cols;
  };
  const L2ENT = level2.entities as unknown as LevelEntity[];
  const l2ent = (id: string): LevelEntity => L2ENT.find((e) => e.id === id)!;
  const rift = (id: string) => l2ent(id);

  it("P1: the GROUND path is a continuous solid floor — one void gap (the pit), bridged by a driftstone", () => {
    // Almost every column has solid floor at the walk row; exactly one contiguous gap (the pit) breaks it.
    let solidCols = 0, gaps = 0, inGap = false;
    for (let c = 0; c < TM2.cols; c++) {
      if (isSolid2(c, FLOOR2_ROW)) { solidCols++; inGap = false; }
      else if (!inGap) { gaps++; inGap = true; }
    }
    expect(solidCols).toBeGreaterThan(TM2.cols - 12); // the floor is solid nearly everywhere
    expect(gaps).toBe(1); // the single pit — so a cloud-faller lands safe everywhere except over it
    // The pit is bridged by the carrying driftstone (the level-1 carry mechanic, re-used near the END).
    const drift = l2ent("driftstone-h");
    expect(drift.behaviors?.[0].params?.points).toBeDefined();
  });

  it("P2: the CLOUDS path is high footing, PORTAL-GATED on a perch, and rejoins via a descent", () => {
    // rift-A (entry) sits on a perch WELL above the floor (a floor-walker passes under it); rift-B is high
    // in the clouds; the two target each other (the bidirectional pair).
    const a = rift("rift-A"), b = rift("rift-B");
    const floorY = FLOOR2_ROW * TM2.tileSize; // 672
    expect(a.position!.y + a.size!.h).toBeLessThan(floorY - 32); // rift-A's base is a jump above the floor (the perch)
    expect(b.position!.y).toBeLessThan(floorY - 256); // rift-B is far up in the clouds
    expect(a.behaviors?.some((x) => x.params?.targetId === "rift-B")).toBe(true);
    expect(b.behaviors?.some((x) => x.params?.targetId === "rift-A")).toBe(true);
    // High footing exists in the clouds band (rows ≤ 9) across the divergence, AND a one-way descent
    // staircase steps back down toward the floor (rows 9 < 13 < 17) — the reconvergence.
    let cloudFooting = 0;
    for (let c = 53; c < 130; c++) for (let r = 4; r <= 9; r++) { const t = tile2(c, r); if (t === 0 || t === 1) cloudFooting++; }
    expect(cloudFooting).toBeGreaterThan(20);
    const oneWayInRow = (r: number) => Array.from({ length: TM2.cols }, (_, c) => tile2(c, r) === 1).some(Boolean);
    expect(oneWayInRow(13) && oneWayInRow(17)).toBe(true); // the descent cascade rungs toward the ground
  });

  it("P3: the beat ORDER differs from level-1 — pit-before-hill in L1 is reversed to hill-before-pit in L2", () => {
    const L1TM = level1.tilemap as unknown as typeof TM2;
    expect(firstPitCol(L1TM, 12)).toBeLessThan(firstSlopeCol(L1TM)); // level-1: the pit comes before the hill
    expect(firstSlopeCol(TM2)).toBeLessThan(firstPitCol(TM2, FLOOR2_ROW)); // level-2: the hill comes before the pit
  });

  it("P4: the first GROUND checkpoint precedes the first hazard (no sky-fall respawn)", () => {
    // level-2's floor sits lower than level-1's, so the inherited `lives-respawn` fallback (64,360) is
    // ABOVE level-2's floor. A pre-checkpoint death would respawn from the sky — so a checkpoint must be
    // claimed before anything can kill you. The spawn→hill stretch is hazard-free and a checkpoint sits
    // just past it, before the first spike/wraith.
    const col = (e: LevelEntity) => Math.round((e.position?.x ?? 0) / TS);
    const groundCps = L2ENT.filter((e) => e.tags?.includes("checkpoint") && (e.position?.y ?? 0) > FLOOR2_ROW * TS - 60).map(col);
    const hazards = L2ENT.filter((e) => e.tags?.includes("spike") || e.tags?.includes("wraith")).map(col);
    expect(Math.min(...groundCps)).toBeLessThan(Math.min(...hazards));
  });

  it("a coarse autopilot beats level-2 via the GROUND path (level-clear, no gameover, within budget)", () => {
    const g = bootL2();
    let cleared = false, over = false;
    g.world.events.on("level-clear", () => (cleared = true));
    g.world.events.on("gameover", () => (over = true));
    const footingAt = (x: number, yTop: number, yBot: number): boolean => {
      for (let y = yTop; y <= yBot; y += TS) {
        const i = g.world.tileAt(x, y);
        const pr = i >= 0 ? TM2.properties?.[String(i)] : undefined;
        if (pr && (pr.solid === true || pr.oneWay === true || typeof pr.slopeL === "number" || typeof pr.slopeR === "number")) return true;
      }
      return false;
    };
    let stuckTicks = 0, lastX = 0, jumpHeld = false;
    const BUDGET = 6000; // clears in ≈3300; the slack absorbs platform-cycle waits
    for (let f = 0; f < BUDGET && !cleared && !over; f++) {
      const p = player(g);
      if (!p) { hold(g, "ArrowRight", false); hold(g, "Space", false); g.stepFrames(1); continue; }
      const px = p.x, pcx = p.cx, pcy = p.cy, foot = p.y + p.h, leadX = p.x + p.w;
      const onGround = p.body.contacts.onGround;
      const pitAhead = onGround && !footingAt(leadX + 6, foot - 6, foot + 2 * TS) && !footingAt(leadX + TS, foot - 6, foot + 2 * TS);
      const stepOff = footingAt(leadX + 8, foot + 2, foot + 2) || footingAt(leadX + 20, foot + 2, foot + 2);
      const hazardAhead = [...g.world.query("spike"), ...g.world.query("wraith")].some((h) => h.x > pcx - 10 && h.x < pcx + 58 && Math.abs(h.cy - pcy) < 64);
      const onDrift = g.world.query("driftstone").some((d) => Math.abs(foot - d.y) < 10 && leadX > d.x + 2 && px < d.x + d.w - 2);
      let goRight = true, wantJump = false;
      const waiting = pitAhead && !onDrift; // hold at the lip for the carrying platform
      if (onDrift) goRight = stepOff; else if (waiting) goRight = false;
      if (hazardAhead && onGround && !waiting) wantJump = true;
      if (onGround && goRight && !onDrift && Math.abs(px - lastX) < 0.3) stuckTicks++; else stuckTicks = 0;
      if (stuckTicks > 30) wantJump = true;
      lastX = px;
      if (wantJump && onGround) jumpHeld = true;
      if (jumpHeld && !onGround && p.vy >= 0) jumpHeld = false; // release at apex (full jump, no jumpCut)
      hold(g, "ArrowRight", goRight);
      hold(g, "ArrowLeft", false);
      hold(g, "Space", jumpHeld);
      g.stepFrames(1);
    }
    const finalHp = (player(g)?.state.hp as number) ?? 0; // the player persists at the Beacon (clear ≠ death)
    expect(over).toBe(false); // never bottomed out in the void
    expect(cleared).toBe(true); // reached the Beacon along the ground
    // EASY-MARGIN GUARD: the no-dodge ground run eats at most the hunter's brush + one sentry bolt
    // (0.5 hp each on level-2's eased Phase-3 damage), so it clears with ≥ 2 of 3 hp — comfortably above
    // the brink. Encoded so a future rebalance that quietly hardens those hits can't erode the margin.
    expect(finalHp).toBeGreaterThanOrEqual(2);
  });

  it("the CLOUDS entry works: stepping into the fork riftgate warps the player up onto cloud footing", () => {
    const g = bootL2();
    g.stepFrames(4);
    const a = g.world.query("rift").find((r) => r.id === "rift-A")!;
    const floorCy = player(g).cy;
    // Stand the player on rift-A (as a jump-up onto the perch would), step, and confirm it warps up to the
    // cloud platform (row 9, cy ≈ 288) and SETTLES grounded there — the high route is genuinely entered.
    const p = player(g);
    p.x = a.cx - p.w / 2; p.y = a.cy - p.h / 2; p.vx = 0; p.vy = 0;
    g.stepFrames(12);
    const q = player(g);
    expect(q.cy).toBeLessThan(floorCy - 256); // warped far UP into the clouds (not still on the floor)
    expect(q.body.contacts.onGround).toBe(true); // landed on cloud footing, not the void
  });

  it("the clouds LIFT bridges the walkway up to the ember perch, and the emberstone is collectible", () => {
    const g = bootL2();
    g.stepFrames(4);
    // The vertical lift's center sweeps from the walkway (row 9, cy ≈ 296) up to the ember perch (row 5, cy ≈ 168).
    let minCy = Infinity, maxCy = -Infinity;
    for (let i = 0; i < 360; i++) { g.stepFrames(1); const lift = g.world.query("driftstone").find((d) => d.id === "driftstone-lift")!; minCy = Math.min(minCy, lift.cy); maxCy = Math.max(maxCy, lift.cy); }
    expect(minCy).toBeLessThan(5 * TS + 24); // reaches the perch tier (row 5)
    expect(maxCy).toBeGreaterThan(9 * TS - 8); // returns to the walkway tier (row 9)
    // The emberstone (worth emberValue, the high-route payoff) collects on touch.
    const before = (g.world.state.motes as number) ?? 0;
    const ember = g.world.query("ember")[0]!;
    player(g).x = ember.x; player(g).y = ember.y;
    g.stepFrames(3);
    expect(g.world.query("ember").length).toBe(0);
    expect(g.world.state.motes as number).toBe(before + config.emberValue);
  });
});

describe("lumen level-2 Phase-3 — the void HUNTER (chaser) + the RIFT-SENTRY (turret)", () => {
  it("both new mechanics are present in level-2: a HUNTER (chaser) and a RIFT-SENTRY (turret)", () => {
    const g = bootL2();
    expect(g.world.query("hunter").length).toBe(1); // the void hunter (ai-chase)
    expect(g.world.query("rift-sentry").length).toBe(1); // the arcane turret (ai-aim-and-fire)
    // Composed from the EXISTING catalog at the confirmed versions (no engine work).
    const hunter = g.world.query("hunter")[0]!;
    const hb = (level2.entities as unknown as LevelEntity[]).find((e) => e.id === hunter.id)!.behaviors!;
    expect(hb.some((b) => (b as { part?: string }).part === "ai-chase@1.0.0")).toBe(true);
    expect(hb.some((b) => (b as { part?: string }).part === "health-and-death@1.1.0")).toBe(true);
    expect(hb.some((b) => (b as { part?: string }).part === "face-velocity@1.0.0")).toBe(true);
    const sentry = (level2.entities as unknown as LevelEntity[]).find((e) => e.tags?.includes("rift-sentry"))!;
    expect(sentry.behaviors!.some((b) => (b as { part?: string }).part === "ai-aim-and-fire@1.1.0")).toBe(true);
  });

  it("the SHELL pairs the new tags so contact-damage fires (player×hunter, player×bolt)", () => {
    // The one integration seam in the shared play-base shell: the new tags joined aabb-collision.pairs.
    const sys = (playBase.systems as Array<{ type: string; params?: { pairs?: string[][] } }>).find((s) => s.type === "aabb-collision")!;
    const pairs = (sys.params!.pairs ?? []).map((p) => p.join("×"));
    expect(pairs).toContain("player×hunter"); // the chaser can damage the player
    expect(pairs).toContain("player×bolt"); // the sentry's bolt can damage the player
  });

  it("the void HUNTER pursues — it closes distance toward a standing player (ai-chase, full 2D)", () => {
    const g = bootL2();
    const dist = (a: { cx: number; cy: number }, b: { cx: number; cy: number }) => Math.hypot(a.cx - b.cx, a.cy - b.cy);
    const d0 = dist(g.world.query("hunter")[0]!, player(g));
    g.stepFrames(180); // hold no input — the player stands; the hunter homes in
    const h = g.world.query("hunter")[0]!;
    expect(d0 - dist(h, player(g))).toBeGreaterThan(100); // measurably closed the gap
    expect(h.vx).toBeLessThan(0); // moving LEFT toward the player (who spawns far to its left)
  });

  it("the void HUNTER's touch drains player hp (contact-damage through the shell pair)", () => {
    const g = bootL2();
    g.stepFrames(4); // settle + seed hp
    const p = player(g);
    const hp0 = p.state.hp as number;
    const hunter = g.world.query("hunter")[0]!;
    hunter.x = p.cx - hunter.w / 2; // drop it onto the player, as the cross-paths brush does
    hunter.y = p.cy - hunter.h / 2;
    g.stepFrames(2);
    expect(player(g).state.hp as number).toBe(hp0 - config.hunterDamage); // exactly one hit landed
  });

  it("a RIFT-SENTRY bolt damages the player, and a lethal one fires the canonical 'died'", () => {
    const g = bootL2();
    g.stepFrames(4); // settle the player on the floor + seed its hp
    const sentry = g.world.query("rift-sentry")[0]!;
    const p = player(g);
    p.x = sentry.cx - 140 - p.w / 2; // park within range (320px), to the sentry's left, on the floor
    p.vx = 0;
    p.state.hp = config.sentryBulletDamage; // a sliver = exactly one bolt's damage — the next bolt that connects is lethal
    let died = false;
    g.world.events.on("died", () => (died = true));
    let sawBolt = false;
    for (let f = 0; f < 240 && !died; f++) {
      if (g.world.query("bolt").length > 0) sawBolt = true; // the turret actually launched a projectile
      g.stepFrames(1);
    }
    expect(sawBolt).toBe(true); // ai-aim-and-fire spawned a bolt
    expect(died).toBe(true); // its damage drove the PLAYER's health-and-death → the one canonical death
    expect(g.world.query("player").length).toBe(0); // destroyed via the standard death flow (FX bind here)
  });
});

describe("lumen campaign — ONE continuous autopilot beats BOTH levels and wins; stats carry EXACTLY across the boundary", () => {
  // The headline end-to-end: a single coarse autopilot drives spawn → level-1 Beacon → the host's
  // between-levels carry → level-2 → the final win, with NO teleporting — every transition is the real
  // one. It wires the EXACT host boundary from main.ts (stash the live player's hp on world.state.carriedHp,
  // then requestNextLevel), so the carry-over it asserts is the shipping path, not a contrivance.
  it("spawn → L1 Beacon → carry → L2 → levels-complete: motes+lives+hp are byte-exact across the boundary, gameover never fires", () => {
    const g = boot();
    const total = manifest.levels!.length;
    let won = false, over = false;
    // The leaving (level-1) values captured AT the clear, and the same keys read back once level-2 has seeded.
    let bMotes = -1, bLives = -1, bHp = -1, aMotes = -1, aLives = -1, aHp = -1;
    let boundaryFrame = -1, inL2 = false;
    g.world.events.on("level-clear", () => {
      const p = player(g);
      if (p) g.world.state.carriedHp = p.state.hp as number; // exactly what main.ts stashes on a clear
      if (((g.world.state.level as number) ?? 1) < total) {
        bMotes = g.world.state.motes as number; bLives = g.world.state.lives as number; bHp = g.world.state.carriedHp as number;
      }
      g.requestNextLevel(); // last level → emits levels-complete (no scene change)
    });
    g.world.events.on("levels-complete", () => (won = true));
    g.world.events.on("gameover", () => (over = true));

    const ctx = newPilot();
    const BUDGET = 9000; // L1 (~1100) + L2 (~3300) clears well inside this
    for (let f = 0; f < BUDGET && !won && !over; f++) {
      groundTick(g, ctx);
      if (!inL2 && g.scene.id === "level-2") { inL2 = true; boundaryFrame = f; } // the tick the transition drained
      // +2 ticks in: level-2's player has run a tick, so its health-and-death has re-seeded hp from carriedHp.
      if (inL2 && f === boundaryFrame + 2) { aMotes = g.world.state.motes as number; aLives = g.world.state.lives as number; aHp = player(g)!.state.hp as number; }
    }

    expect(won).toBe(true);   // the FINAL Beacon's levels-complete fired — the whole two-level campaign cleared
    expect(over).toBe(false); // never bottomed out across either level
    expect(g.scene.id).toBe("level-2");
    // EXACT carry-over across the REAL boundary: motes + lives ride scene flow.persist, hp rides carriedHp.
    expect(boundaryFrame).toBeGreaterThan(0);
    expect(aMotes).toBe(bMotes);
    expect(aLives).toBe(bLives);
    expect(aHp).toBe(bHp);
    // EASY margin: it reaches the final Beacon with hp to spare (it eats at most the hunter brush + a sentry
    // bolt on level-2's eased damage) — encoded so a rebalance that quietly hardens the run can't slip past.
    expect(player(g)!.state.hp as number).toBeGreaterThanOrEqual(2);
  });
});

describe("lumen full-run Echo — a recording that SPANS the level-1 → level-2 boundary replays byte-for-byte", () => {
  // The two per-level Echoes above prove a single level re-simulates; THIS proves determinism holds straight
  // THROUGH a scene transition. The run recorder's tick index is continuous across loadScene (it is NOT
  // world.frame, which resets), so one recording spans both levels. An input-only replay cannot reproduce
  // the HOST's requestNextLevel() — which is precisely why the SHIPPING Echo records PER-LEVEL and only ever
  // replays the entry level — so the harness here reproduces that ONE host action (the same level-clear →
  // carriedHp + requestNextLevel main.ts runs). With it, the spanning recording re-simulates byte-identically
  // at EVERY tick, the boundary tick included — the determinism guarantee the per-level split is built on.
  const wireHostBoundary = (g: Game): void => {
    g.world.events.on("level-clear", () => {
      const p = player(g);
      if (p) g.world.state.carriedHp = p.state.hp as number;
      g.requestNextLevel();
    });
  };
  it("record a continuous run crossing into level-2, then replay it through a fresh seeded game — identical per-tick snapshots", () => {
    // Record: the shared ground autopilot (pure input — nothing teleported, so the recording captures it all),
    // crossing the boundary and continuing a stretch into level-2.
    const rec = boot({ seed: SEED, record: true });
    wireHostBoundary(rec);
    const origSnaps: string[] = [];
    const ctx = newPilot();
    let l2Frame = -1;
    for (let f = 0; f < 4000; f++) {
      groundTick(rec, ctx);
      origSnaps.push(snapshotWorld(rec.world));
      if (l2Frame < 0 && rec.scene.id === "level-2") l2Frame = f;
      if (l2Frame >= 0 && f >= l2Frame + 400) break; // a full level-1 + the transition + a level-2 stretch
    }
    const recording = rec.getRecording();
    expect(recording.sceneId).toBe("level-1"); // rooted where frame 0 was captured — the run STARTED in level-1
    expect(l2Frame).toBeGreaterThan(0);         // and genuinely crossed INTO level-2 mid-recording
    expect(recording.frameCount).toBe(origSnaps.length);

    // Replay through a FRESH seeded game with the SAME host boundary wiring → it transitions on the same tick
    // the recording did, so every per-tick snapshot matches (the boundary tick and all of level-2 included).
    const rg = boot({ seed: recording.seed });
    wireHostBoundary(rg);
    const replay = createReplay(rg, recording);
    const seen: string[] = [];
    while (!replay.done) { replay.step(); seen.push(snapshotWorld(replay.game.world)); }

    expect(seen.length).toBe(origSnaps.length);
    expect(seen).toEqual(origSnaps); // byte-identical across BOTH levels AND the transition between them
  });
});

describe("lumen clouds path — the optional HIGH route is a real alternate that rejoins the ground and reaches the Beacon", () => {
  const FLOOR2_Y = 21 * TS; // level-2 ground walk-surface (672)

  it("a clouds autopilot beats level-2 via the HIGH route — jumps the fork into the clouds, walks the walkway, rejoins the ground, lights the Beacon", () => {
    const g = bootL2();
    let cleared = false, over = false, minCy = Infinity;
    g.world.events.on("level-clear", () => (cleared = true));
    g.world.events.on("gameover", () => (over = true));
    const ctx = newPilot();
    // Modes (every transition PHYSICAL — no teleport): walk to the fork (approach) → hop up into rift-A until
    // it warps us to the clouds (fork) → walk the high walkway, leaping only SAME-TIER gaps so an end-of-tier
    // edge drops us back to the always-solid ground (cloud) → finish along the ground (ground).
    let mode: "approach" | "fork" | "cloud" | "ground" = "approach";
    const BUDGET = 8000;
    for (let f = 0; f < BUDGET && !cleared && !over; f++) {
      const p = player(g);
      if (!p) { hold(g, "ArrowRight", false); hold(g, "Space", false); g.stepFrames(1); continue; }
      minCy = Math.min(minCy, p.cy);
      const foot = p.y + p.h, leadX = p.x + p.w, onGround = p.body.contacts.onGround;
      if (mode === "approach" && p.cx / TS >= 46 && onGround) mode = "fork";
      if (mode === "fork" && p.cy < 420) mode = "cloud";                         // warped up onto the cloud
      if (mode === "cloud" && onGround && foot > FLOOR2_Y - 16) mode = "ground"; // fell back onto the floor
      let goRight = true;
      if (mode === "approach" || mode === "ground") {
        goRight = groundControls(g, p, ctx);
      } else if (mode === "fork") {
        if (onGround) ctx.jumpHeld = true;                                       // hop toward rift-A until it warps us
        if (ctx.jumpHeld && !onGround && p.vy >= 0) ctx.jumpHeld = false;
      } else { // cloud: leap a small same-tier gap, otherwise let a real drop carry us back down to the ground
        const gapNow = onGround && !footingActive(g, leadX + 6, foot - 6, foot + 10);
        const sameTier = footingActive(g, leadX + TS, foot - 6, foot + 6) || footingActive(g, leadX + 2 * TS, foot - 6, foot + 6) || footingActive(g, leadX + 3 * TS, foot - 6, foot + 6);
        if (gapNow && sameTier && onGround) ctx.jumpHeld = true;
        if (ctx.jumpHeld && !onGround && p.vy >= 0) ctx.jumpHeld = false;
      }
      hold(g, "ArrowRight", goRight); hold(g, "ArrowLeft", false); hold(g, "Space", ctx.jumpHeld);
      g.stepFrames(1);
    }
    expect(cleared).toBe(true);      // reached the Beacon via the high route + the ground finish
    expect(over).toBe(false);        // never fell into the void
    // Went genuinely INTO the clouds: a ground/hill jump tops out near cy≈456; only the rift warp (cloud
    // surface cy≈276, a cloud-jump apex lower still) reaches below 360 — so this can't be a mere ground hop.
    expect(minCy).toBeLessThan(360);
    expect(player(g)!.state.hp as number).toBeGreaterThanOrEqual(2); // EASY: clears the high route with margin too
  });

  it("the designed descent cascade rejoins the ground FORWARD of the fork (ember perch → one-way cascade → floor at the reconverge)", () => {
    const g = bootL2();
    g.stepFrames(4);
    // Arrange the player atop the ember perch (row 5) — the high-route apex the lift delivers you onto (the
    // lift sweep + the ember collect are covered above); from there the authored reconvergence is "hold right".
    const ember = g.world.query("ember")[0]!;
    const p = player(g);
    p.x = ember.x - 24; p.y = 5 * TS - p.h; p.vx = 0; p.vy = 0;
    g.stepFrames(6);
    expect(p.body.contacts.onGround).toBe(true); // standing on the perch
    let died = false; g.world.events.on("died", () => (died = true));
    let landedCol = -1;
    for (let f = 0; f < 420 && landedCol < 0; f++) {
      hold(g, "ArrowRight"); g.stepFrames(1);
      const q = player(g);
      if (!q) break;
      if (f > 4 && q.body.contacts.onGround && q.y + q.h > FLOOR2_Y - 16) landedCol = Math.round(q.cx / TS);
    }
    expect(died).toBe(false);                       // a safe STEPPED descent, never a fall into a hazard
    expect(landedCol).toBeGreaterThanOrEqual(120);  // rejoined the GROUND well forward — at the reconverge (~col 128)…
    expect(landedCol).toBeLessThanOrEqual(150);     // …not straight back down at the perch
  });
});

describe("lumen EASY difficulty — generous checkpoints + no blind jumps onto hazards (ENCODED so a rebalance can't silently harden it)", () => {
  const L2E = level2.entities as unknown as LevelEntity[];
  const FLOOR2_ROW = 21;
  const colOf = (e: LevelEntity) => Math.round((e.position?.x ?? 0) / TS);
  const TM2 = level2.tilemap as unknown as { cols: number; tiles: number[] };
  const tile2 = (c: number, r: number) => TM2.tiles[r * TM2.cols + c] ?? -1;

  it("level-2 GROUND checkpoints are plentiful and close — a death never costs much progress", () => {
    const groundCps = L2E.filter((e) => e.tags?.includes("checkpoint") && (e.position?.y ?? 0) > FLOOR2_ROW * TS - 60).map(colOf).sort((a, b) => a - b);
    expect(groundCps.length).toBeGreaterThanOrEqual(6); // a generous count strung along the ground line
    const spawnCol = 2; // the level-2 spawn (x=64)
    const beaconCol = colOf(L2E.find((e) => e.tags?.includes("beacon"))!);
    const marks = [spawnCol, ...groundCps, beaconCol];
    let maxGap = 0;
    for (let i = 1; i < marks.length; i++) maxGap = Math.max(maxGap, marks[i] - marks[i - 1]);
    expect(maxGap).toBeLessThanOrEqual(60); // no stretch between safe points (spawn / checkpoint / Beacon) is punishingly long
  });

  it("no blind hazard jumps — every level-2 spike CLUSTER has flat solid floor to walk up to before the hop", () => {
    const spikeCols = L2E.filter((e) => e.tags?.includes("spike")).map(colOf).sort((a, b) => a - b);
    expect(spikeCols.length).toBeGreaterThan(0);
    const clusterStarts = spikeCols.filter((c) => !spikeCols.includes(c - 1)); // the leftmost spike of each contiguous run
    for (const c of clusterStarts) {
      for (let k = 1; k <= 3; k++) {
        expect(tile2(c - k, FLOOR2_ROW)).toBe(0);          // solid floor for several cols before the cluster
        expect(tile2(c - k, FLOOR2_ROW - 1)).not.toBe(2);  // …and no slope in the approach (you walk up flat, then hop)
        expect(tile2(c - k, FLOOR2_ROW - 1)).not.toBe(3);
        expect(spikeCols.includes(c - k)).toBe(false);     // …and the approach itself is spike-free
      }
    }
  });
});

describe("lumen Phase-2 — the Echo shows the level you're ON + the end-of-level CHOICE", () => {
  // The PURE campaign-nav policy main.ts reads off manifest.levels (the choice's advance-vs-re-enter
  // targets + the per-level Echo key) — the library's `createCampaign`, tested here without the DOM glue.
  const campaign = createCampaign(manifest.levels as string[]);

  it("(b) choice nav: Continue advances to the next level, Replay re-enters the cleared one, the final level wins", () => {
    expect(campaign.first).toBe("level-1"); // the campaign start, and where a win restarts
    // Clearing a NON-final level offers the choice: Continue → the NEXT level; Replay → the SAME level.
    expect(campaign.isFinal("level-1")).toBe(false);
    expect(campaign.next("level-1")).toBe("level-2"); // Continue target
    // (Replay's target is the just-cleared level itself — identity, exercised by the live re-entry test below.)
    // The FINAL level has no `next` → no choice card; clearing it wins.
    expect(campaign.isFinal("level-2")).toBe(true);
    expect(campaign.next("level-2")).toBeNull();
  });

  it("(a) the Echo surfaced for a level-2 player is THIS level's run, and it replays byte-for-byte booted IN ISOLATION", () => {
    // Record a real level-2 run the campaign way (enter level-2, re-arm) — the recording the host persists
    // under run:level-2 and surfaces when the player is ON level-2.
    const rec0 = bootL2({ seed: SEED, record: true });
    rec0.resetRecording();
    const origSnaps: string[] = [];
    rec0.world.input.setKey("ArrowRight", true);
    for (let f = 0; f < 90; f++) {
      if (f === 20) rec0.world.input.setKey("Space", true);
      if (f === 24) rec0.world.input.setKey("Space", false);
      rec0.stepFrames(1);
      origSnaps.push(snapshotWorld(rec0.world));
    }
    const recording = rec0.getRecording();
    // The surfaced recording is rooted at the level the player is on — level-2, NOT level-1 (the old bug).
    // (The run-store keys its LAST recording per level; the round-trip is tested in the run-store describe below.)
    expect(recording.sceneId).toBe("level-2");
    expect(recording.entryState?.level).toBe(2); // the carried slice the level was entered with

    // THE ECHO PATH (what main.ts's attachReplayLoop now does): boot the replay game DIRECTLY at the
    // recorded level via entrySceneId — NOT by re-playing level-1 — and let createReplay restore the
    // recording's entry-state + RNG phase before tick 0. The level-2 Echo, booted in isolation.
    const echoGame = isoBoot("level-2", { seed: recording.seed });
    expect(echoGame.scene.id).toBe("level-2");
    expect(echoGame.world.state.level).toBe(2);
    const replay = createReplay(echoGame, recording);
    const seen: string[] = [];
    while (!replay.done) {
      replay.step();
      seen.push(snapshotWorld(replay.game.world));
    }
    expect(seen.length).toBe(90);
    expect(seen).toEqual(origSnaps); // the level-2 Echo lines up byte-for-byte, booted in isolation
  });

  it("(a) the level-1 Echo (fresh start / post-win) replays in isolation too — its entry is a no-op { level: 1 }", () => {
    // After a win the loop restarts at level-1; its Echo boots level-1 fresh. Its entryState is just
    // { level: 1 }, so the isolation boot + restore replays it exactly like the boot path — no desync.
    const rec = boot({ seed: SEED, record: true });
    const origSnaps: string[] = [];
    rec.world.input.setKey("ArrowRight", true);
    for (let f = 0; f < 60; f++) {
      rec.stepFrames(1);
      origSnaps.push(snapshotWorld(rec.world));
    }
    const recording = rec.getRecording();
    expect(recording.sceneId).toBe("level-1");
    expect(recording.entryState).toEqual({ level: 1 }); // nothing is carried into the first level
    const echoGame = isoBoot("level-1", { seed: recording.seed });
    const replay = createReplay(echoGame, recording);
    const seen: string[] = [];
    while (!replay.done) {
      replay.step();
      seen.push(snapshotWorld(replay.game.world));
    }
    expect(seen).toEqual(origSnaps);
  });

  it("(b) a LIVE retry of level-2 resumes from the recorded entry (restoreRecordingEntry) — the carry the Echo replays from", () => {
    // The retry-into-level-2 path: after dying in level-2, the host boots level-2 LIVE and restores the
    // recording's entry-state, so the live run starts from the carried hp/motes the Echo replays from —
    // NOT a from-scratch full-hp boot. Record a partial-hp level-2 entry, then restore it onto a fresh boot.
    const rec0 = boot({ seed: SEED, record: true });
    rec0.stepFrames(2);
    rec0.world.state.carriedHp = 1; // arrive in level-2 on a sliver (the host stashes hp on the clear)
    rec0.world.state.motes = 9; // …with some banked motes
    rec0.requestNextLevel();
    rec0.stepFrames(1); // drain → level-2 active, carry persisted via flow.persist
    rec0.resetRecording();
    rec0.stepFrames(20);
    const recording = rec0.getRecording();
    expect(recording.entryState?.carriedHp).toBe(1);
    expect(recording.entryState?.motes).toBe(9);

    // The LIVE retry: a fresh isolation boot at level-2 starts from DEFAULTS until the entry is restored.
    const live = isoBoot("level-2", { seed: recording.seed });
    expect(live.world.state.carriedHp).toBeUndefined();
    restoreRecordingEntry(live, recording);
    expect(live.world.state.carriedHp).toBe(1); // resumes the carried sliver…
    expect(live.world.state.motes).toBe(9); // …and the banked motes
    live.stepFrames(1); // the level-2 player re-seeds hp from the carried 1 (NOT full playerHp)
    expect(player(live)!.state.hp).toBe(1);
  });
});

describe("lumen Phase-5 — the run-store + the DATA level-select menu", () => {
  // Boot the menu scene as the host's openMenu does: the `persistence` system LOADS the run-store's progress
  // index from the SAME storage; `level-select` PROJECTS it; the gated `tap-emit` cards READ the won-set.
  function bootMenu(storage: MemoryStorage, opts: Record<string, unknown> = {}): Game {
    const registry = createLibraryRegistry();
    registerCustomBehaviors(registry);
    return createGame({ manifest, config, scenes: [playBase, level1, level2, menu] }, { canvas: null, registry, storage, entrySceneId: "menu", ...opts });
  }
  // Record a real run of `sceneId` for `ticks` frames — the recording the run-store keeps (Echo source) and
  // whose deterministic tick count IS the best time. (Input-free here; the run's content is irrelevant to the store.)
  function recordReal(sceneId: string, ticks: number): RunRecording {
    const g = isoBoot(sceneId, { seed: SEED, record: true });
    g.stepFrames(ticks);
    return g.getRecording();
  }
  // Let the menu's async `persistence` load (storage.get → world.state) resolve between sim steps.
  const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

  it("the run-store round-trips runWon/runBest through manifest.persist, and the menu surfaces them", async () => {
    const storage = new MemoryStorage();
    const store = createRunStore({ storage }); // lumen's defaults: slot "progress", keys runWon/runBest

    // Clear level-1 (a real recording → best time is its tick count); level-2 stays unplayed.
    const rec1 = recordReal("level-1", 40);
    const out = await store.recordRun({ recording: rec1, score: 128, won: true });
    expect(out.newlyWon).toBe(true);
    expect(out.best).toEqual({ score: 128, ticks: 40, seconds: 40 * rec1.fixedDt });

    // The progress slot is EXACTLY the shape lumen's manifest.persist declares — the binding bridge.
    expect(manifest.persist).toEqual({ slot: "progress", keys: ["runWon", "runBest"] });
    expect(await storage.get("progress")).toEqual({
      runWon: { "level-1": true },
      runBest: { "level-1": { score: 128, ticks: 40, seconds: 40 * rec1.fixedDt } },
    });
    expect((await store.lastRecording("level-1"))!.frameCount).toBe(40); // the level's Echo source round-trips

    // Boot the menu over the SAME storage: persistence LOADS the index, level-select PROJECTS it.
    const g = bootMenu(storage);
    g.stepFrames(1); // persistence issues the async load
    await flush(); // …it resolves → world.state.runWon / runBest are set (the in-game READ of the index)
    g.stepFrames(1); // level-select projects the per-level flat keys
    expect(g.world.state.runWon).toEqual({ "level-1": true }); // the round-trip reached world.state
    expect(g.world.state["level-1:sel"]).toBe(true); // cleared ⇒ selectable
    expect(g.world.state["level-1:status"]).toBe("✓ CLEARED");
    expect(g.world.state["level-1:score"]).toBe("◆ 128");
    expect(g.world.state["level-1:time"]).toBe(`⧗ ${(40 * rec1.fixedDt).toFixed(1)}s`);
    // level-2 — never cleared ⇒ locked + blank stats.
    expect(g.world.state["level-2:sel"]).toBe(false);
    expect(g.world.state["level-2:status"]).toBe("🔒 LOCKED");
    expect(g.world.state["level-2:score"]).toBe("");
    expect(g.world.state["level-2:time"]).toBe("");
  });

  it("the menu GATES mode buttons by the won-set and ROUTES a won pick via @level:<id>", async () => {
    const storage = new MemoryStorage();
    const store = createRunStore({ storage });
    await store.recordRun({ recording: recordReal("level-1", 30), score: 7, won: true }); // level-1 cleared, level-2 NOT

    // Boot the menu WITH the level sequence (the portable-host path) so the menu's @level edges resolve
    // IN-ENGINE — proving the routing end-to-end. (lumen's own host boots it with levels:[] and intercepts
    // the per-mode event to launch a practice mode; the menu's DATA contract is identical either way.)
    const g = bootMenu(storage);
    g.stepFrames(1);
    await flush();
    g.stepFrames(1);
    expect(g.world.state["level-1:sel"]).toBe(true);
    expect(g.world.state["level-2:sel"]).toBe(false);

    // Tap a LOCKED level-2 mode button → the gated tap-emit must NOT emit ⇒ no transition (won-gating, as DATA).
    g.world.input.tap(400, 374); // center of card-2-race-tap (300..500 × 352..396)
    g.stepFrames(1);
    expect(g.scene.id).toBe("menu");

    // Tap a CLEARED level-1 mode button → it emits race-level-1 → flow @level:level-1 → the menu jumps to
    // level-1 and world.state.level becomes its 1-based stage index. The pick routed by id, mode-agnostic.
    g.world.input.tap(400, 208); // center of card-1-race-tap (300..500 × 186..230)
    g.stepFrames(1);
    expect(g.scene.id).toBe("level-1");
    expect(g.world.state.level).toBe(1);
  });

  it("the BACK card emits menu-back (ungated) — the host's return-to-where-you-were affordance", () => {
    const g = bootMenu(new MemoryStorage());
    let back = 0;
    g.world.events.on("menu-back", () => (back += 1));
    g.stepFrames(1);
    g.world.input.tap(400, 446); // center of back-tap (300..500 × 424..468)
    g.stepFrames(1);
    expect(back).toBe(1);
  });
});

describe("lumen Phase-6 — level-select MODES (the data contract + the modes' entry-state semantics)", () => {
  // Boot the menu exactly as the host's openMenu does (persistence loads the run-store index; level-select
  // projects it; the gated mode `tap-emit`s read the per-level `:sel` flag).
  function bootMenu(storage: MemoryStorage, opts: Record<string, unknown> = {}): Game {
    const registry = createLibraryRegistry();
    registerCustomBehaviors(registry);
    return createGame({ manifest, config, scenes: [playBase, level1, level2, menu] }, { canvas: null, registry, storage, entrySceneId: "menu", ...opts });
  }
  function recordReal(sceneId: string, ticks: number): RunRecording {
    const g = isoBoot(sceneId, { seed: SEED, record: true });
    g.stepFrames(ticks);
    return g.getRecording();
  }
  const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

  it("each CLEARED card offers THREE gated mode events (echo/race/trial); a LOCKED card emits NONE", async () => {
    const storage = new MemoryStorage();
    const store = createRunStore({ storage, metric: "fastest" }); // lumen's own metric
    await store.recordRun({ recording: recordReal("level-1", 30), score: 7, won: true }); // level-1 CLEARED; level-2 LOCKED

    // Boot with levels:[] (lumen's own host path) so @level no-ops and we observe the RAW mode events the
    // host would intercept — proving the menu DATA emits a per-(level, mode) event, gated by the won-set.
    const g = bootMenu(storage, { levels: [] });
    g.stepFrames(1);
    await flush();
    g.stepFrames(1);
    const fired: string[] = [];
    for (const ev of ["echo-level-1", "race-level-1", "trial-level-1", "echo-level-2", "race-level-2", "trial-level-2"]) {
      g.world.events.on(ev, () => fired.push(ev));
    }
    // level-1 (CLEARED): echo x84..284, race x300..500, trial x516..716 — all at the mode row y186..230.
    g.world.input.tap(184, 208);
    g.stepFrames(1);
    g.world.input.tap(400, 208);
    g.stepFrames(1);
    g.world.input.tap(616, 208);
    g.stepFrames(1);
    // level-2 (LOCKED): the same three buttons (mode row y352..396) are gated → none emit.
    g.world.input.tap(184, 374);
    g.stepFrames(1);
    g.world.input.tap(400, 374);
    g.stepFrames(1);
    g.world.input.tap(616, 374);
    g.stepFrames(1);

    expect(fired).toEqual(["echo-level-1", "race-level-1", "trial-level-1"]); // only the cleared level's three, in tap order
    expect(g.scene.id).toBe("menu"); // levels:[] ⇒ the @level edges no-op; lumen's host does the real launching
  });

  it("a mode launch boots the level CANONICAL (full hp, nothing carried) — distinct from the campaign carry", () => {
    // launchReplay/launchMode boot the chosen level via createGame `entrySceneId` with NO
    // restoreRecordingEntry — a fresh ISOLATION boot. So level-2 starts at FULL hp with no carriedHp, even
    // though the CAMPAIGN enters it from a (possibly low-hp) carry. This is the mode launch's boot path.
    const g = isoBoot("level-2", { seed: SEED });
    expect(g.world.state.carriedHp).toBeUndefined(); // nothing carried — no restoreRecordingEntry on a mode launch
    g.stepFrames(1); // the player's health-and-death seeds hp
    expect(player(g)!.state.hp).toBe(config.playerHp); // FULL hp — the canonical start ALL three modes use
    // (The campaign retry path restoreRecordingEntry()s a recorded entry instead — covered by the
    // restore-entry suite + Phase-2's live-retry test; a mode launch deliberately skips it.)
  });

  it("the ghost / showcase source is the FASTEST clear (run-store metric 'fastest' — a speedrun ghost)", async () => {
    // lumen builds its run-store with metric:"fastest", so bestRecording is the fewest-TICK clear — what
    // RACE replays as the ghost and REPLAY (Echo) showcases. Record a SLOW clear, then a FAST clear.
    const storage = new MemoryStorage();
    const store = createRunStore({ storage, metric: "fastest" }); // exactly lumen's main.ts config
    await store.recordRun({ recording: recordReal("level-1", 80), score: 5, won: true });
    await store.recordRun({ recording: recordReal("level-1", 40), score: 5, won: true });
    const best = await store.bestRecording("level-1");
    expect(best!.frameCount).toBe(40); // the FASTEST clear is kept as the ghost source (not the slow 80-tick one)
    expect((await store.bestFor("level-1"))!.ticks).toBe(40); // best TIME tracks it (deterministic ticks, never wall-clock)
  });
});
