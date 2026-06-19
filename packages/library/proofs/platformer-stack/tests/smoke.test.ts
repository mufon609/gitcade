import { describe, it, expect } from "vitest";
import { createGame, type Game } from "@gitcade/sdk";
import { createLibraryRegistry } from "@gitcade/library";
import manifest from "../game.json";
import config from "../config.json";
import main from "../src/scenes/main.json";

/**
 * Reuse proof — 1.9.0 DYNAMIC-ON-DYNAMIC stacking (the resolveBodies stacking step): a `pushable`
 * crate is solid-to-dynamics, so
 *  - a player STANDS ON a crate (lands on its top, grounded above the floor);
 *  - crates STACK (a crate dropped on another rests on its top);
 *  - PUSHING still works (the stand-on solidity is top-only, so a walker shoves a crate's side).
 * The ride-a-pushed-crate and transitive-carry cases are pinned in the SDK suite
 * (resolve-bodies-stacking-1.9.0); here we prove the mechanic authors + boots in a real game.
 *
 * Scene facts (32px tiles): floor top y=448. Player h=24 → rests at y=424 on the floor, 392 on a crate
 * (416−24). Crates 32×32 → rest y=416 on the floor, 384 stacked on another crate (416−32).
 */
function boot(): Game {
  return createGame({ manifest, config, scenes: [main] }, { canvas: null, registry: createLibraryRegistry() });
}
function drive(game: Game, axis: number): void {
  const input = game.world.input as unknown as { axis: () => number; anyDown: () => boolean };
  input.axis = () => axis;
  input.anyDown = () => false;
}
function place(game: Game, id: string, x: number, y: number): void {
  const e = game.world.byId(id)!;
  e.x = x; e.y = y; e.vx = 0; e.vy = 0;
}

describe("platformer-stack reuse proof", () => {
  it("boots and runs 120 frames headless without throwing", () => {
    const game = boot();
    expect(() => game.stepFrames(120)).not.toThrow();
    expect(game.world.frame).toBe(120);
  });

  it("a crate rests on the solid floor under its own gravity (collider grounded)", () => {
    const game = boot();
    game.stepFrames(60);
    const crateA = game.world.byId("crateA")!;
    expect(crateA.y).toBe(416); // floor top 448 − h 32
    expect(crateA.body.contacts.onGround).toBe(true);
  });

  it("the player STANDS ON a crate — lands on its top, not the floor below it", () => {
    const game = boot();
    place(game, "crateB", 700, 416); // out of the way
    place(game, "crateA", 288, 416); // on the floor
    place(game, "player", 288, 260); // drop straight onto the crate
    drive(game, 0);
    game.stepFrames(90);
    const player = game.world.byId("player")!;
    expect(player.y).toBeCloseTo(392, 1); // crate top 416 − player h 24 — NOT the floor (424)
    expect(player.body.contacts.onGround).toBe(true);
  });

  it("crates STACK — a crate dropped onto another rests on its top", () => {
    const game = boot();
    place(game, "crateA", 288, 416); // on the floor
    place(game, "crateB", 288, 180); // drop straight onto crateA
    game.stepFrames(120);
    const crateA = game.world.byId("crateA")!;
    const crateB = game.world.byId("crateB")!;
    expect(crateA.y).toBe(416);
    expect(crateB.y).toBeCloseTo(384, 1); // crateA top 416 − h 32
  });

  it("PUSHING still works — a walker shoves a crate's SIDE (the stand-on solidity is top-only)", () => {
    const game = boot();
    place(game, "crateB", 700, 416); // out of the way
    place(game, "crateA", 288, 416);
    place(game, "player", 230, 424); // on the floor, left of crateA
    drive(game, 1); // walk right into the crate
    game.stepFrames(120);
    const crateA = game.world.byId("crateA")!;
    const player = game.world.byId("player")!;
    expect(crateA.x).toBeGreaterThan(300); // crate was shoved right (push works through the oneWay stand-on)
    expect(player.x + player.w).toBeLessThanOrEqual(crateA.x + 0.5); // player flush behind it
  });
});
