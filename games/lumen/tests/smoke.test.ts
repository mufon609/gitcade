import { describe, it, expect } from "vitest";
import { createGame, createReplay, snapshotWorld, type Game } from "@gitcade/sdk";
import { createLibraryRegistry } from "@gitcade/library";
import { registerCustomBehaviors } from "../src/custom-behaviors/index.js";
import manifest from "../game.json";
import config from "../config.json";
import playBase from "../src/scenes/play-base.json";
import level1 from "../src/scenes/level-1.json";
import level2 from "../src/scenes/level-2.json";

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

// Boot straight into level-2 for the level-2 tests. createGame resolves the entry scene from
// `manifest.entryPoint` (level-1) and IGNORES any `entrySceneId`, so the only way into level-2 is the
// real path: boot level-1 and advance one level. The two settle ticks + the drain tick run with NO input
// and seed nothing random, so two `bootL2` games on the same seed reach level-2 in byte-identical state —
// which is what lets the level-2 Echo replay below compare equal.
function bootL2(opts: { seed?: number; record?: boolean } = {}): Game {
  const g = boot(opts);
  g.stepFrames(2);
  g.requestNextLevel();
  g.stepFrames(1); // drain the queued transition → level-2 is now the active scene
  return g;
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
    // `stepHeight` clears the sub-pixel slope-exit lip there — and walking back the other way simply
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
    expect(over).toBe(false); // never bottomed out in the void
    expect(cleared).toBe(true); // reached the Beacon along the ground
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
