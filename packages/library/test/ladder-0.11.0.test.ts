import { describe, it, expect } from "vitest";
import type { Tilemap, World } from "@gitcade/sdk";
import { makeWorld, makeEntity } from "./helpers.js";
import { movePlatformer } from "../src/behaviors/move-platformer.js";

/**
 * 0.11.0 — move-platformer LADDER climb (INDIE-ROADMAP slopes+ladders): when the entity's center
 * is over a `ladder` tile and up/down is held, it climbs (gravity off, vy = ±climbSpeed) and can
 * step off the side. Default (`climbSpeed` 0) is byte-identical to the pre-ladder mover.
 *
 * The mover keeps its `climbing` flag in its INSTANCE scratch (the host's per-instance store),
 * so these direct-call tests pass an explicit `sc` object and assert on `sc.climbing`.
 */
const DT = 1 / 60;

/** A 10x10 grid of 32px tiles whose column 5 is a ladder (tile index 3, prop ladder:true). */
function ladderTilemap(): Tilemap {
  const cols = 10;
  const rows = 10;
  const tiles: number[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) tiles.push(c === 5 ? 3 : -1);
  return { tileSize: 32, cols, rows, tiles, properties: { "3": { ladder: true } } };
}

function setKeys(world: World, held: string[]): void {
  const set = new Set(held);
  const input = world.input as unknown as { axis: () => number; anyDown: (keys: string[]) => boolean };
  input.axis = () => 0;
  input.anyDown = (keys: string[]) => keys.some((k) => set.has(k));
}

const PARAMS = { gravity: 1000, jumpSpeed: 400, climbSpeed: 100, up: ["ArrowUp"], down: ["ArrowDown"], jump: ["Space", "ArrowUp"] };

describe("move-platformer — ladder climb", () => {
  it("climbs UP a ladder when up is held (gravity suspended)", () => {
    const world = makeWorld();
    world.tilemap = ladderTilemap();
    const e = makeEntity(world, { id: "p", x: 160, y: 160, w: 16, h: 16 }); // center (168,168) → col 5 ladder
    const sc: Record<string, unknown> = {};
    setKeys(world, ["ArrowUp"]);
    movePlatformer(e, world, PARAMS, DT, sc);
    expect(e.vy).toBe(-100); // climbing up at climbSpeed; NOT gravity (-100 exactly, no +g*dt)
    expect(sc.climbing).toBe(true);
  });

  it("climbs DOWN when down is held", () => {
    const world = makeWorld();
    world.tilemap = ladderTilemap();
    const e = makeEntity(world, { id: "p", x: 160, y: 160, w: 16, h: 16 });
    setKeys(world, ["ArrowDown"]);
    movePlatformer(e, world, PARAMS, DT, {});
    expect(e.vy).toBe(100);
  });

  it("hangs (vy 0) once grabbed when no climb key is held", () => {
    const world = makeWorld();
    world.tilemap = ladderTilemap();
    const e = makeEntity(world, { id: "p", x: 160, y: 160, w: 16, h: 16 });
    const sc: Record<string, unknown> = {};
    setKeys(world, ["ArrowUp"]);
    movePlatformer(e, world, PARAMS, DT, sc); // grab + climb
    setKeys(world, []); // release
    movePlatformer(e, world, PARAMS, DT, sc);
    expect(e.vy).toBe(0); // hangs on the ladder (still climbing, gravity off)
    expect(sc.climbing).toBe(true);
  });

  it("UP on a ladder CLIMBS, it does not jump (even though ArrowUp is a jump key)", () => {
    const world = makeWorld();
    world.tilemap = ladderTilemap();
    const e = makeEntity(world, { id: "p", x: 160, y: 160, w: 16, h: 16 });
    setKeys(world, ["ArrowUp"]);
    movePlatformer(e, world, PARAMS, DT, {});
    expect(e.vy).toBe(-100); // climb speed, NOT -jumpSpeed (-400)
  });

  it("leaves the ladder when its center moves off it — gravity resumes", () => {
    const world = makeWorld();
    world.tilemap = ladderTilemap();
    const e = makeEntity(world, { id: "p", x: 160, y: 160, w: 16, h: 16 });
    const sc: Record<string, unknown> = {};
    setKeys(world, ["ArrowUp"]);
    movePlatformer(e, world, PARAMS, DT, sc); // climbing
    expect(sc.climbing).toBe(true);
    e.x = 16; // step off to col 0 (not a ladder)
    e.vy = 0;
    setKeys(world, []);
    movePlatformer(e, world, PARAMS, DT, sc);
    expect(sc.climbing).toBe(false);
    expect(e.vy).toBeGreaterThan(0); // gravity applied again
  });

  it("with climbSpeed 0 (default) ladders are OFF — gravity applies, byte-identical mover", () => {
    const world = makeWorld();
    world.tilemap = ladderTilemap();
    const e = makeEntity(world, { id: "p", x: 160, y: 160, w: 16, h: 16 });
    const sc: Record<string, unknown> = {};
    setKeys(world, ["ArrowUp"]);
    movePlatformer(e, world, { gravity: 1000, jumpSpeed: 400 }, DT, sc); // no climbSpeed
    expect(e.vy).toBeGreaterThan(0); // gravity, not climbing
    expect(sc.climbing).toBeUndefined(); // ladder block never ran
  });
});
