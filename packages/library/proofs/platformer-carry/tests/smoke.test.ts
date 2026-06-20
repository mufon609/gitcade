import { describe, it, expect } from "vitest";
import { createGame, type Game } from "@gitcade/sdk";
import { createLibraryRegistry } from "@gitcade/library";
import manifest from "../game.json";
import config from "../config.json";
import main from "../src/scenes/main.json";

/**
 * Reuse proof — the resolver CARRY mode (`ride-platform`, two-body carry):
 *  - a `player` rides a horizontally-tweened solid `carrier` platform (x tracks it rigidly) and
 *    can WALK while carried (moves relative to the platform), staying grounded;
 *  - a `passenger` follows a vertically-descending `descender` platform DOWN (and is pushed back
 *    up on its rise) — staying glued to its top throughout.
 *
 * Scene facts: viewport 800x480. `carrier` 120x16 at y=360 tweens x 100↔480 (pingpong); `player`
 * 20x28 rests on it (bottom 360 → y=332). `descender` 80x16 at x=650 tweens y 160↔340; `passenger`
 * 16x16 rests on it (bottom = descender top).
 *
 * 1.10.0 SOLID-AWARE CARRY (the shared-root fix): `wallCarrier` 120x16 at y=430 tweens x 60↔160 with a
 * passive `wallRider` 16x16 on its top, sliding it into `cornerWall` (left face x=170, in the rider's band
 * only). A passive (vx=0) rider was carried straight THROUGH a wall — `resolveSolids` is motion-derived,
 * so it never ejected a zero-velocity body. Carry now clamps to solids, so the rider stops flush.
 */
function boot(): Game {
  return createGame({ manifest, config, scenes: [main] }, { canvas: null, registry: createLibraryRegistry() });
}

function drive(game: Game, opts: { axis?: number; jump?: boolean }): void {
  const input = game.world.input as unknown as { axis: () => number; anyDown: () => boolean };
  input.axis = () => opts.axis ?? 0;
  input.anyDown = () => opts.jump ?? false;
}

describe("platformer-carry reuse proof", () => {
  it("boots and runs 120 frames headless without throwing", () => {
    const game = boot();
    expect(() => game.stepFrames(120)).not.toThrow();
    expect(game.world.frame).toBe(120);
  });

  it("the player rides the horizontal carrier — x tracks it rigidly, resting on its top", () => {
    const game = boot();
    game.stepFrames(40);
    const carrier = game.world.byId("carrier")!;
    const player = game.world.byId("player")!;
    expect(player.y).toBe(carrier.y - player.h); // 332 — resting on the carrier top
    expect(player.body.contacts.onGround).toBe(true);
    const offset = player.x - carrier.x;
    const cx1 = carrier.x;
    game.stepFrames(40);
    expect(Math.abs(carrier.x - cx1)).toBeGreaterThan(1); // the carrier actually tweened
    expect(player.x - carrier.x).toBeCloseTo(offset, 2); // carried with no drift (rigid x)
    expect(player.body.contacts.onGround).toBe(true);
  });

  it("the player can WALK while being carried (moves right relative to the platform)", () => {
    const game = boot();
    game.stepFrames(40);
    const carrier = game.world.byId("carrier")!;
    const player = game.world.byId("player")!;
    const rel0 = player.x - carrier.x;
    drive(game, { axis: 1 }); // walk right
    game.stepFrames(10);
    expect(player.x - carrier.x).toBeGreaterThan(rel0 + 10); // walked right ON the moving platform
    expect(player.body.contacts.onGround).toBe(true); // never fell off
  });

  it("the passenger stays glued to the descending platform's top through descent and rise", () => {
    const game = boot();
    const descender = game.world.byId("descender")!;
    const passenger = game.world.byId("passenger")!;
    let sawDescent = false;
    let glued = true;
    for (let i = 0; i < 90; i++) {
      const prevY = descender.y;
      game.stepFrames(1);
      if (descender.y > prevY + 0.5) sawDescent = true; // moved down this tick
      if (Math.abs(passenger.y - (descender.y - passenger.h)) > 2) glued = false;
    }
    expect(sawDescent).toBe(true); // the platform did descend
    expect(glued).toBe(true); // passenger tracked its top every tick (carry down + push-out up)
  });

  it("a passive rider carried into a wall stops FLUSH — never penetrates (solid-aware carry)", () => {
    const game = boot();
    drive(game, { axis: 0 }); // no input ⇒ the rider's own vx stays 0 — the passive case the motion-derived push-out can't eject
    const wall = game.world.byId("cornerWall")!;
    const rider = game.world.byId("wallRider")!;
    let maxRight = -Infinity;
    for (let i = 0; i < 150; i++) {
      game.stepFrames(1);
      maxRight = Math.max(maxRight, rider.x + rider.w);
    }
    expect(maxRight).toBeLessThanOrEqual(wall.x + 0.01); // never crossed the wall's left face (no penetration)
    expect(maxRight).toBeGreaterThan(wall.x - 4); // but DID ride up to it — the clamp engaged, not a no-op
    expect(rider.body.contacts.onGround).toBe(true); // still riding the carrier (didn't fall off)
  });

  it("is NOT carried while jumping (the rider leaves the platform on a jump)", () => {
    const game = boot();
    game.stepFrames(40);
    const carrier = game.world.byId("carrier")!;
    const player = game.world.byId("player")!;
    drive(game, { axis: 0, jump: true }); // jump
    game.stepFrames(1);
    expect(player.vy).toBeLessThan(0); // launched upward off the platform
    const rel = player.x - carrier.x;
    game.stepFrames(5); // rising — ride-platform is gated off (vy<0)
    // While rising, the player does not inherit the carrier's horizontal delta, so its offset
    // from the (still-moving) carrier changes instead of staying locked.
    expect(player.x - carrier.x).not.toBeCloseTo(rel, 1);
  });
});
