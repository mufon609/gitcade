import { describe, it, expect } from "vitest";
import {
  World,
  Game,
  createDefaultRegistry,
  cooldown,
  seededRng,
  assertDeterministic,
} from "../src/index.js";
import { SceneSchema } from "../src/schema/index.js";

/**
 * 1.11.0 — the deterministic one-shot scheduler (`world.after` / `World.runScheduled`) and the
 * per-instance `cooldown` helper. Pins: due-time + (time, schedule-order) firing, one-shot, the
 * no-op fast path, scene-scoped clearing, the cooldown gate, the in-tick drain (before prune), and
 * that a scheduler-using game stays replay-deterministic.
 */

const makeWorld = (): World =>
  new World({ bounds: { width: 100, height: 100 }, config: {}, registry: createDefaultRegistry() });

describe("World.after / runScheduled", () => {
  it("fires only once the due simulated time is reached, then never again (one-shot)", () => {
    const w = makeWorld();
    let n = 0;
    w.time = 0;
    w.after(0.05, () => n++);

    w.time = 0.04;
    w.runScheduled();
    expect(n).toBe(0); // not yet due

    w.time = 0.05;
    w.runScheduled();
    expect(n).toBe(1); // due

    w.time = 0.2;
    w.runScheduled();
    expect(n).toBe(1); // one-shot — does not re-fire
  });

  it("fires same-tick due timers in (due-time, schedule-order) order", () => {
    const w = makeWorld();
    const order: string[] = [];
    w.time = 0;
    w.after(0.02, () => order.push("b")); // due later
    w.after(0.01, () => order.push("a")); // due earlier
    w.after(0.01, () => order.push("a2")); // same due as a, scheduled after it
    w.time = 1;
    w.runScheduled();
    expect(order).toEqual(["a", "a2", "b"]);
  });

  it("a timer re-scheduled from inside its callback defers to a later drain (no same-tick loop)", () => {
    const w = makeWorld();
    let fires = 0;
    w.time = 0;
    const arm = (): void => {
      fires++;
      if (fires < 3) w.after(0.01, arm);
    };
    w.after(0.01, arm);
    w.time = 1;
    w.runScheduled();
    expect(fires).toBe(1); // the re-armed timer is due AFTER this drain's `now`, so it waits
    w.time = 2;
    w.runScheduled();
    expect(fires).toBe(2);
  });

  it("clearScheduled drops pending timers (the scene-scoped reset)", () => {
    const w = makeWorld();
    let n = 0;
    w.after(0.01, () => n++);
    w.clearScheduled();
    w.time = 100;
    w.runScheduled();
    expect(n).toBe(0);
  });

  it("runScheduled is a no-op fast path when nothing is scheduled", () => {
    const w = makeWorld();
    expect(() => w.runScheduled()).not.toThrow();
  });
});

describe("cooldown helper", () => {
  it("is ready on first call, then blocks until the interval elapses, then re-arms", () => {
    const scratch: Record<string, unknown> = {};
    expect(cooldown(scratch, "fire", 0, 1)).toBe(true); // first ⇒ ready
    expect(cooldown(scratch, "fire", 0.5, 1)).toBe(false); // cooling
    expect(cooldown(scratch, "fire", 0.999, 1)).toBe(false);
    expect(cooldown(scratch, "fire", 1.0, 1)).toBe(true); // re-armed
    expect(cooldown(scratch, "fire", 1.2, 1)).toBe(false);
  });

  it("namespaces independent cooldowns by key within one scratch", () => {
    const scratch: Record<string, unknown> = {};
    expect(cooldown(scratch, "fire", 0, 1)).toBe(true);
    expect(cooldown(scratch, "dash", 0, 1)).toBe(true); // different key, independent
    expect(cooldown(scratch, "fire", 0, 1)).toBe(false);
  });
});

describe("scheduler in the Game loop", () => {
  const sceneWith = (systems: unknown[]) => SceneSchema.parse({ id: "main", entities: [], systems });

  it("drains due timers inside the fixed-update tick", () => {
    const registry = createDefaultRegistry();
    // A system that, on tick 1, schedules a state bump ~3 frames out.
    registry.registerSystem("sched-test", (world) => {
      if (world.frame === 1) world.after(3 / 60, () => (world.state.fired = ((world.state.fired as number) ?? 0) + 1));
    });
    const game = new Game({
      scenes: [sceneWith([{ type: "sched-test", params: {} }])],
      config: {},
      registry,
      canvas: null,
    });
    game.stepFrames(3); // frames 1,2,3 — at frame 1 time=1/60, due=4/60 → frame 4
    expect(game.world.state.fired).toBeUndefined();
    game.stepFrames(1); // frame 4: time=4/60 ≥ due
    expect(game.world.state.fired).toBe(1);
    game.stepFrames(10); // one-shot — stays at 1
    expect(game.world.state.fired).toBe(1);
  });

  it("clears pending timers on a scene change (no fire into the next scene)", () => {
    const registry = createDefaultRegistry();
    registry.registerSystem("arm-then-leave", (world) => {
      if (world.frame !== 1) return;
      world.after(0.02, () => (world.state.fired = true)); // due ~frame 2
      world.requestScene("after"); // ...but leave first, draining between ticks
    });
    registry.registerSystem("noop", () => {});
    const game = new Game({
      scenes: [
        sceneWith([{ type: "arm-then-leave", params: {} }]),
        SceneSchema.parse({ id: "after", entities: [], systems: [{ type: "noop", params: {} }] }),
      ],
      config: {},
      registry,
      canvas: null,
    });
    game.stepFrames(10);
    expect(game.scene.id).toBe("after");
    expect(game.world.state.fired).toBeUndefined(); // timer cleared by the transition
  });
});

describe("scheduler stays replay-deterministic", () => {
  it("two runs of a world.after-using game produce byte-identical state", () => {
    const makeGame = (rng: () => number): Game => {
      const registry = createDefaultRegistry();
      registry.registerSystem("rng-sched", (world) => {
        // schedule a randomized-but-rng-routed bump every tick; effects must reproduce
        world.after(world.rng() * 0.1, () => (world.state.n = ((world.state.n as number) ?? 0) + 1));
      });
      return new Game({
        scenes: [SceneSchema.parse({ id: "main", entities: [], systems: [{ type: "rng-sched", params: {} }] })],
        config: {},
        registry,
        rng,
        canvas: null,
      });
    };
    expect(() => assertDeterministic((rng) => makeGame(rng), { seed: 0x5eed, frames: 60 })).not.toThrow();
    // sanity: seededRng is what assertDeterministic threads in (documents the seam)
    expect(typeof seededRng(1)()).toBe("number");
  });
});
