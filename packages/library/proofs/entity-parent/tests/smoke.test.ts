import { describe, it, expect } from "vitest";
import { createGame, type Game } from "@gitcade/sdk";
import { createLibraryRegistry } from "@gitcade/library";
import manifest from "../game.json";
import config from "../config.json";
import main from "../src/scenes/main.json";

/**
 * Reuse proof — the 0.9.0 entity HIERARCHY / transform parenting (scene graph), end to end:
 *  - a tween-driven `platform` CARRIES a `crate` and a `turret` (translation parenting),
 *  - a `turret-tip` rides the turret rides the platform (multi-level chain),
 *  - a spinning `hub` carries an orbiting `satellite` (rotation composition preserves the radius),
 *  - a free `pickup` entity is attached onto the platform at runtime (`attachTo`) and dropped
 *    back to a root (`detach`) — all with no host code beyond the runtime re-parent calls.
 *
 * Scene facts: viewport 800x480. `platform` tweens x 200↔520 (pingpong); `crate` local (8,-24),
 * `turret` local (64,-16), `turret-tip` local (4,-10) on the turret. `hub` spins 0→2π (loop) at
 * (600,200); `satellite` local (40,0) → orbit radius 40. `pickup` authored at (100,100), unparented.
 */
function boot(): Game {
  return createGame({ manifest, config, scenes: [main] }, { canvas: null, registry: createLibraryRegistry() });
}

describe("entity-parent reuse proof", () => {
  it("boots and runs 120 frames headless without throwing", () => {
    const game = boot();
    expect(() => game.stepFrames(120)).not.toThrow();
    expect(game.world.frame).toBe(120);
  });

  it("the crate rides the platform (child world = parent ∘ local), tracking it as it tweens", () => {
    const game = boot();
    game.stepFrames(30);
    const platform = game.world.byId("platform")!;
    const crate = game.world.byId("crate")!;
    expect(crate.x).toBeCloseTo(platform.x + 8, 5); // local.x
    expect(crate.y).toBeCloseTo(platform.y - 24, 5); // local.y (platform.y is constant)

    const px1 = platform.x;
    game.stepFrames(30);
    expect(platform.x).not.toBeCloseTo(px1, 2); // the platform actually moved (tween live)
    expect(crate.x).toBeCloseTo(platform.x + 8, 5); // still rigidly carried
  });

  it("resolves a multi-level chain: the turret tip rides the turret rides the platform", () => {
    const game = boot();
    game.stepFrames(40);
    const platform = game.world.byId("platform")!;
    const turret = game.world.byId("turret")!;
    const tip = game.world.byId("turret-tip")!;
    expect(turret.x).toBeCloseTo(platform.x + 64, 5);
    expect(tip.x).toBeCloseTo(turret.x + 4, 5); // === platform.x + 68
    expect(tip.y).toBeCloseTo(turret.y - 10, 5);
  });

  it("the satellite orbits the spinning hub — rotation composition preserves the orbit radius", () => {
    const game = boot();
    const hub = game.world.byId("hub")!;
    const sat = game.world.byId("satellite")!;

    game.stepFrames(2); // just past start: still near the +x axis
    expect(Math.hypot(sat.x - hub.x, sat.y - hub.y)).toBeCloseTo(40, 3);

    game.stepFrames(60); // ~1s → ~120° of a 3s full turn → well off the axis
    expect(Math.hypot(sat.x - hub.x, sat.y - hub.y)).toBeCloseTo(40, 3); // radius held
    expect(Math.abs(sat.y - hub.y)).toBeGreaterThan(1); // actually orbited off the x-axis
    expect(sat.rotation).toBeCloseTo(hub.rotation, 6); // rotation inherited
  });

  it("picks a free entity up onto the platform at runtime (attachTo), then drops it (detach)", () => {
    const game = boot();
    game.stepFrames(10);
    const platform = game.world.byId("platform")!;
    const pickup = game.world.byId("pickup")!;
    expect(pickup.parentId).toBeUndefined(); // starts as a root
    const before = pickup.x;

    // Pick it up IN PLACE (no explicit local) — it must not teleport to the platform origin.
    pickup.attachTo(platform);
    expect(pickup.parentId).toBe("platform");
    game.stepFrames(1);
    expect(Math.abs(pickup.x - before)).toBeLessThan(20); // held its position (rode the 1-tick nudge)

    // Now it rides rigidly: the platform→pickup offset stays constant as the platform tweens.
    const offset = pickup.x - platform.x;
    game.stepFrames(25);
    expect(pickup.x - platform.x).toBeCloseTo(offset, 5);

    // Drop it: it becomes a root again and stays put while the platform moves on.
    pickup.detach();
    expect(pickup.parentId).toBeUndefined();
    const dropped = pickup.x;
    game.stepFrames(25);
    expect(pickup.x).toBe(dropped);
  });

  it("a parentless scene path is unaffected — the pickup never moves until attached", () => {
    const game = boot();
    const pickup = game.world.byId("pickup")!;
    const x0 = pickup.x;
    const y0 = pickup.y;
    game.stepFrames(90);
    expect(pickup.x).toBe(x0); // a root with no behavior is never touched by the hierarchy phase
    expect(pickup.y).toBe(y0);
  });
});
