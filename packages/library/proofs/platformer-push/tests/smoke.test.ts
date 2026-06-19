import { describe, it, expect } from "vitest";
import { createGame, type Game } from "@gitcade/sdk";
import { createLibraryRegistry } from "@gitcade/library";
import manifest from "../game.json";
import config from "../config.json";
import main from "../src/scenes/main.json";

/**
 * Reuse proof — the 1.4.0 two-body PUSH (the `resolveBodies` push step, INDIE-ROADMAP Tier-1):
 *  - a `player` shoves a `pushable` crate sideways and the crate STOPS flush against a wall while
 *    the player stops behind it;
 *  - a crate PUSHED past a ledge FALLS into the pit (its own gravity, once unsupported);
 *  - a 2-crate CHAIN: the player pushes crate A into crate B, both move, and (wall-blocked) the
 *    chain compresses with the player flush behind it.
 *
 * Scene facts (32px tiles): floor top y=448 (player h=24 → rests y=424; crates 32×32 → rest y=416).
 * A wall column at col 9 (left face x=288). A pit at cols 17–19 (x 544–640). `crateB` is parked at
 * x=700 (on the right floor shelf) for the single-crate tests.
 */
function boot(): Game {
  return createGame({ manifest, config, scenes: [main] }, { canvas: null, registry: createLibraryRegistry() });
}

/** Stub headless input so the player walks; NEVER press jump (a shared jump would also lift crates). */
function drive(game: Game, axis: number): void {
  const input = game.world.input as unknown as { axis: () => number; anyDown: () => boolean };
  input.axis = () => axis;
  input.anyDown = () => false;
}

/** Move an entity to a fresh spot and clear its velocity (per-scenario setup). */
function place(game: Game, id: string, x: number, y: number): void {
  const e = game.world.byId(id)!;
  e.x = x;
  e.y = y;
  e.vx = 0;
  e.vy = 0;
}

const overlapX = (a: { x: number; w: number }, b: { x: number; w: number }): number =>
  Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);

describe("platformer-push reuse proof", () => {
  it("boots and runs 120 frames headless without throwing", () => {
    const game = boot();
    expect(() => game.stepFrames(120)).not.toThrow();
    expect(game.world.frame).toBe(120);
  });

  it("a crate rests on the solid floor under its own gravity (collider grounded)", () => {
    const game = boot();
    place(game, "crateB", 700, 300); // also prove the parked crate falls and settles on the right shelf
    game.stepFrames(60);
    const crateA = game.world.byId("crateA")!;
    expect(crateA.y).toBe(416); // floor top 448 − h 32
    expect(crateA.body.contacts.onGround).toBe(true);
    expect(game.world.byId("crateB")!.y).toBe(416);
  });

  it("the player shoves a crate INTO a wall — crate stops flush, player stops behind it", () => {
    const game = boot();
    place(game, "crateB", 700, 416); // out of the way
    place(game, "crateA", 200, 416);
    place(game, "player", 160, 424);
    drive(game, 1); // walk right into the crate, toward the wall (left face x=288)
    game.stepFrames(150);
    const crateA = game.world.byId("crateA")!;
    const player = game.world.byId("player")!;
    expect(crateA.x + crateA.w).toBeLessThanOrEqual(288.5); // crate flush against the wall, never through
    expect(crateA.x + crateA.w).toBeGreaterThan(287); // ...and actually reached it
    expect(overlapX(player, crateA)).toBeLessThan(0.5); // player stopped behind the crate (no deep overlap)
    expect(player.x).toBeLessThan(crateA.x);
  });

  it("a crate pushed off a LEDGE falls into the pit (gravity, once unsupported)", () => {
    const game = boot();
    place(game, "crateB", 700, 416); // out of the way
    place(game, "crateA", 470, 416); // on the floor, left of the pit (x 544–640)
    place(game, "player", 420, 424);
    const crateA = game.world.byId("crateA")!;
    const restY = crateA.y; // 416, resting on the platform floor
    drive(game, 1); // push the crate right, over the pit edge
    game.stepFrames(220);
    expect(crateA.x).toBeGreaterThan(544); // pushed past the ledge, out over the pit (cols 17–19)
    expect(crateA.y).toBeGreaterThan(restY + 16); // dropped off the platform — fell to the world floor (448) a tile below
  });

  it("pushes a 2-crate CHAIN into the wall — both move, compress flush, player behind", () => {
    const game = boot();
    place(game, "crateA", 160, 416);
    place(game, "crateB", 200, 416);
    place(game, "player", 120, 424);
    drive(game, 1);
    game.stepFrames(200);
    const crateA = game.world.byId("crateA")!;
    const crateB = game.world.byId("crateB")!;
    const player = game.world.byId("player")!;
    expect(crateB.x + crateB.w).toBeLessThanOrEqual(288.5); // B wedged flush at the wall
    expect(crateB.x + crateB.w).toBeGreaterThan(287);
    expect(player.x).toBeLessThan(crateA.x); // order preserved: player < A < B
    expect(crateA.x).toBeLessThan(crateB.x);
    expect(overlapX(crateA, crateB)).toBeLessThan(0.5); // A flush behind B (no deep overlap)
    expect(overlapX(player, crateA)).toBeLessThan(0.5); // player flush behind A
  });
});
