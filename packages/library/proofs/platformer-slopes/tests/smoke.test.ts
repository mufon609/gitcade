import { describe, it, expect } from "vitest";
import { createGame, type Game } from "@gitcade/sdk";
import { createLibraryRegistry } from "@gitcade/library";
import manifest from "../game.json";
import config from "../config.json";
import main from "../src/scenes/main.json";

/**
 * Reuse proof — the 0.11.0 platformer terrain (INDIE-ROADMAP slopes + ladders):
 *  - the player walks UP a 45° ramp to a plateau and DOWN the far side (floor slopes resolved by
 *    `resolveSlopes` inside `tilemap-collide`), staying grounded with no launch at the crest;
 *  - the player CLIMBS a ladder (`move-platformer` climb mode: gravity off, vy from up/down).
 *
 * Scene facts (32px tiles): floor top y=416 (player h=28 → rests at y=388). Ascending ramp cols
 * 8–10 (slope tiles) rises to a plateau (cols 11–14, top y=320 → rest y=292); descending ramp cols
 * 15–17 returns to the floor. A ladder column at col 4 (x 128–160) rises from the floor.
 */
function boot(): Game {
  return createGame({ manifest, config, scenes: [main] }, { canvas: null, registry: createLibraryRegistry() });
}

function drive(game: Game, opts: { axis?: number; held?: string[] }): void {
  const set = new Set(opts.held ?? []);
  const input = game.world.input as unknown as { axis: () => number; anyDown: (keys: string[]) => boolean };
  input.axis = () => opts.axis ?? 0;
  input.anyDown = (keys: string[]) => keys.some((k) => set.has(k));
}

describe("platformer-slopes reuse proof", () => {
  it("boots and runs 120 frames headless without throwing", () => {
    const game = boot();
    expect(() => game.stepFrames(120)).not.toThrow();
    expect(game.world.frame).toBe(120);
  });

  it("settles on the flat floor at the start (slope pass no-ops off the ramps)", () => {
    const game = boot();
    game.stepFrames(30); // no input → fall/settle on the floor
    const player = game.world.byId("player")!;
    expect(player.y).toBe(388); // floor top 416 − h 28
    expect(player.contacts.onGround).toBe(true);
  });

  it("walks UP the ascending ramp to the peak, then DOWN the far side back to the floor", () => {
    const game = boot();
    game.stepFrames(20); // settle on the floor
    const player = game.world.byId("player")!;
    let minY = player.y; // highest point reached (smallest y)
    let airTicks = 0;
    let maxStepUp = 0;
    let prevY = player.y;
    drive(game, { axis: 1 }); // hold right up the chevron and back down to the floor
    for (let i = 0; i < 230; i++) {
      game.stepFrames(1);
      minY = Math.min(minY, player.y);
      if (!player.contacts.onGround) airTicks++;
      maxStepUp = Math.max(maxStepUp, prevY - player.y); // upward jump this tick
      prevY = player.y;
    }
    expect(minY).toBeLessThanOrEqual(300); // climbed up to the peak (~292)
    expect(player.y).toBe(388); // descended the far ramp back to the floor (top 416 − h 28)
    expect(player.contacts.onGround).toBe(true);
    expect(airTicks).toBeLessThan(15); // stayed grounded across the slopes (no fall-offs)
    expect(maxStepUp).toBeLessThan(12); // no LAUNCH over the peak (smooth, ~vx*dt per tick)
  });

  it("climbs the LADDER when up is held (gravity suspended)", () => {
    const game = boot();
    game.stepFrames(20); // settle on the floor
    const player = game.world.byId("player")!;
    player.x = 138; // center 148 → over the ladder column (col 4, x 128–160)
    player.vx = 0;
    const y0 = player.y;
    drive(game, { axis: 0, held: ["ArrowUp"] }); // climb up
    game.stepFrames(30);
    expect(player.y).toBeLessThan(y0 - 40); // climbed up the ladder (climbSpeed 120 → ~60px/30f)
    expect(player.state.__climbing).toBe(true);
  });
});
