import { describe, it, expect } from "vitest";
import { createGame, Input } from "@gitcade/sdk";
import { createLibraryRegistry } from "@gitcade/library";
import manifest from "../game.json";
import config from "../config.json";
import title from "../src/scenes/title.json";
import play from "../src/scenes/play.json";
import over from "../src/scenes/over.json";
import { registerCustomBehaviors } from "../src/custom-behaviors/index.js";

/**
 * The headless smoke boot `gitcade validate` defers to (Helicopter uses the custom
 * `thrust-lift` behavior and library parts the default registry can't supply).
 * Boots the three-scene flow on the full library + custom registry and exercises
 * the data-driven transitions with no canvas — title → play → over → play —
 * asserting the scroller spawns pillars, the survival score accrues, the difficulty
 * ramps, a crash routes to game-over, and a retry returns to play (resetting the
 * run) — all without throwing.
 */
function boot() {
  const registry = createLibraryRegistry();
  registerCustomBehaviors(registry);
  return createGame({ manifest, config, scenes: [title, play, over] }, { canvas: null, registry });
}

describe("helicopter smoke (data flow)", () => {
  it("boots the entry (title) scene and runs frames without throwing", () => {
    const game = boot();
    expect(game.scene.id).toBe("title");
    expect(() => game.stepFrames(30)).not.toThrow();
  });

  it("title → play on the start-pressed edge; pillars scroll in and score accrues", () => {
    const game = boot();
    game.world.events.emit("start-pressed"); // what the title's tap-emit button emits
    game.stepFrames(2); // queued scene change drains after the tick, then play inits
    expect(game.scene.id).toBe("play");
    // Keep the craft parked mid-field so gravity doesn't crash it before we observe.
    for (let i = 0; i < 180; i++) {
      const p = game.world.query("player")[0];
      if (p) {
        p.y = 290;
        p.vy = 0;
      }
      game.stepFrames(1);
    }
    expect(game.scene.id).toBe("play");
    expect(game.world.query("player").length).toBe(1);
    expect(game.world.query("obstacle").length).toBeGreaterThan(0);
    expect(typeof game.world.state.score).toBe("number");
    expect((game.world.state.score as number) > 0).toBe(true);
  });

  it("the difficulty ramps: a high score advances the level and speeds the scroll", () => {
    const game = boot();
    game.world.events.emit("start-pressed");
    game.stepFrames(2);
    // Park the player safely so it does not crash and end the run.
    const park = () => {
      const p = game.world.query("player")[0];
      if (p) {
        p.y = 290;
        p.vy = 0;
      }
    };
    // Step until at least one obstacle is moving, so we can read its level-1 speed.
    let o1;
    for (let i = 0; i < 200 && !o1; i++) {
      park();
      game.stepFrames(1);
      o1 = game.world.query("obstacle").find((o) => Math.abs(o.vx) > 0);
    }
    const speedL1 = Math.abs(o1!.vx);
    const lvl1 = game.world.state.level as number;
    game.world.state.score = 100000; // force level-progression scoreGte to ramp
    // Sample as soon as the level ramps: scale-by-state(set) re-applies the new
    // speed to LIVE obstacles each tick, so a moving obstacle reflects the higher
    // speed within a frame or two — well before the now-faster, denser pillars
    // (the E11 density ramp) can reach and crash the parked player. (Surviving a
    // long window here is the wrong strategy — the difficulty is supposed to bite.)
    let o2;
    for (let i = 0; i < 90 && !o2 && game.scene.id === "play"; i++) {
      park();
      game.stepFrames(1);
      if ((game.world.state.level as number) > lvl1) {
        o2 = game.world.query("obstacle").find((o) => Math.abs(o.vx) > 0);
      }
    }
    expect((game.world.state.level as number) > lvl1).toBe(true);
    expect(o2).toBeDefined();
    expect(Math.abs(o2!.vx) > speedL1).toBe(true);
  });

  it("a crash routes play → over and hands off the score", () => {
    const game = boot();
    game.world.events.emit("start-pressed");
    game.stepFrames(2);
    expect(game.scene.id).toBe("play");
    game.world.state.score = 42; // a run's worth of survival
    // Drive the craft into the bottom wall until the crash flow edge routes over.
    for (let i = 0; i < 200 && game.scene.id === "play"; i++) {
      const p = game.world.query("player")[0];
      if (p) {
        p.y = 595;
        p.vy = 300;
      }
      game.stepFrames(1);
    }
    expect(game.scene.id).toBe("over");
    // Carried by play.flow.persist (≥ 42: passive income may tick it a hair higher
    // before the crash routes the scene).
    expect((game.world.state.score as number) >= 42).toBe(true);
  });

  it("retry routes over → play and resets the run", () => {
    const game = boot();
    game.world.events.emit("start-pressed");
    game.stepFrames(2);
    for (let i = 0; i < 200 && game.scene.id === "play"; i++) {
      const p = game.world.query("player")[0];
      if (p) {
        p.y = 595;
        p.vy = 300;
      }
      game.stepFrames(1);
    }
    expect(game.scene.id).toBe("over");
    game.world.events.emit("retry");
    game.stepFrames(2);
    expect(game.scene.id).toBe("play");
    expect(game.world.query("player").length).toBe(1);
  });
});

/**
 * The real play.json input wiring: the `input-actions` system binds `thrust` to the
 * Space key AND a full-canvas `rect`, and `thrust-lift{thrustAction:"thrust"}` reads
 * it. So BOTH a real Space keydown AND a bare touch anywhere on the canvas lift the
 * craft through the same logical action, with no host glue.
 */
describe("helicopter input action layer", () => {
  function bootPlay() {
    const registry = createLibraryRegistry();
    registerCustomBehaviors(registry);
    const input = new Input();
    input.setWorldSize(800, 600);
    const keyL: Record<string, (e: any) => void> = {};
    const ptrL: Record<string, (e: any) => void> = {};
    input.attach({
      keyTarget: { addEventListener: (t: string, f: any) => (keyL[t] = f), removeEventListener: () => {} } as never,
      pointerTarget: { addEventListener: (t: string, f: any) => (ptrL[t] = f), removeEventListener: () => {} } as never,
    });
    const game = createGame({ manifest, config, scenes: [title, play, over] }, { canvas: null, registry, input });
    game.world.events.emit("start-pressed");
    game.stepFrames(2);
    expect(game.scene.id).toBe("play");
    return { game, keyL, ptrL };
  }

  it("a real Space keydown lifts the craft via the thrust action (no synth key)", () => {
    const { game, keyL } = bootPlay();
    const p = game.world.query("player")[0]!;
    p.vy = 0;
    keyL.keydown({ code: "Space", cancelable: true, preventDefault() {} });
    game.stepFrames(5);
    expect(p.vy).toBeLessThan(0); // accelerating UP — thrust reached the mover
  });

  it("a bare touch anywhere on the canvas lifts too (declarative full-canvas rect)", () => {
    const { game, ptrL } = bootPlay();
    const p = game.world.query("player")[0]!;
    p.vy = 0;
    ptrL.pointerdown({ pointerId: 1, clientX: 400, clientY: 300 }); // hold-anywhere to fly
    game.stepFrames(5);
    expect(p.vy).toBeLessThan(0);
  });
});

/**
 * The `format-binding` system in play.json derives the integer display keys from the
 * float score/best as DATA.
 */
describe("helicopter HUD (format-binding)", () => {
  it("floors the float score/best into scoreDisplay/bestDisplay as data", () => {
    const game = boot();
    game.world.events.emit("start-pressed");
    game.stepFrames(2);
    game.world.state.score = 142;
    game.world.state.best = 999.7;
    game.stepFrames(1);
    expect(game.world.state.scoreDisplay).toBe("142"); // floor(142 + a hair of passive income)
    expect(game.world.state.bestDisplay).toBe("999"); // floor(999.7)
  });
});
