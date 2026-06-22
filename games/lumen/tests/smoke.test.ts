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
 * Echo: movement, mote collection, the void kill-plane → respawn, the Beacon win edge, the
 * lives-drain lose edge, and — the load-bearing one — that a recorded run REPLAYS
 * byte-for-byte (what makes the Echo line up with live play).
 *
 * Lumen ships no custom behaviors, so registerCustomBehaviors is a no-op — but calling it
 * (like the other games) means a remix that vendors a community part into a Lumen fork
 * installs the managed registry, and THIS smoke test then registers the vendored behavior
 * instead of throwing "unknown behavior type" during ecosystem validation.
 */
const SEED = 0x10de;

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
    expect(g.world.query("spike").length).toBe(6);
    expect(g.world.query("rift").length).toBe(2);
    expect(g.world.query("driftstone").length).toBe(2);
    expect(g.world.query("beacon").length).toBe(1);
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

  it("the void kill-plane costs a life and respawns the player at the start", () => {
    const g = boot();
    g.stepFrames(5);
    expect(g.world.state.lives).toBe(config.startLives);
    // Drop the player into the void band (full-width kill-plane at the world bottom).
    player(g).y = 460;
    g.stepFrames(2);
    expect(g.world.query("player").length).toBe(0); // destroyed by the trigger
    expect(g.world.state.lives).toBe(config.startLives - 1); // a life spent
    // Respawn after the delay, back near the spawn point.
    g.stepFrames(Math.ceil(config.respawnDelay * 60) + 5);
    expect(g.world.query("player").length).toBe(1);
    expect(player(g).x).toBeLessThan(200);
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
    g.stepFrames(3);
    expect(over).toBe(true);
    expect(g.world.state.outcome).toBe("lose");
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
