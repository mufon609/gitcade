import { describe, it, expect } from "vitest";
import { createGame, createReplay, snapshotWorld, type Game } from "@gitcade/sdk";
import { createLibraryRegistry } from "@gitcade/library";
import { registerCustomBehaviors } from "../src/custom-behaviors/index.js";
import manifest from "../game.json";
import config from "../config.json";
import playBase from "../src/scenes/play-base.json";
import level1 from "../src/scenes/level-1.json";

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
    { manifest, config, scenes: [playBase, level1] },
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

  it("C2: the ramp tops one row ABOVE the ledge — no solid wall at the climb's arrival row", () => {
    // The highest slopeR (idx 3) ramp cell.
    let apexCol = -1;
    let apexRow = TM.rows;
    for (let c = 0; c < TM.cols; c++) {
      for (let r = 0; r < TM.rows; r++) {
        if (tileAt(c, r) === 3 && r < apexRow) { apexRow = r; apexCol = c; }
      }
    }
    expect(apexCol).toBeGreaterThan(0);
    // The ledge's solid surface is one row BELOW the apex; the cell at the apex row, over the
    // ledge's leading column, is EMPTY — so the climber arrives above the ledge and lands on it,
    // never ramming a same-row solid face (the old jam) or sinking through a same-row one-way.
    const ledgeLeadCol = apexCol + 1;
    expect(isSolid(ledgeLeadCol, apexRow + 1)).toBe(true); // ledge surface, one row down
    expect(tileAt(ledgeLeadCol, apexRow)).toBe(-1); // nothing to ram at the arrival row
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
});
