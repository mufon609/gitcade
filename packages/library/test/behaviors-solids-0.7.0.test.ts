import { describe, it, expect } from "vitest";
import type { Tilemap } from "@gitcade/sdk";
import { makeWorld, makeEntity } from "./helpers.js";
import { solidCollide } from "../src/behaviors/solid-collide.js";
import { tilemapCollide } from "../src/behaviors/tilemap-collide.js";

const DT = 1 / 60;

/**
 * 0.7.0 — solid-collide (INDIE-ROADMAP Tier-0 0.3): resolve an entity against OTHER
 * entities tagged solid, with the SAME contact flags as tilemap-collide, and the two
 * combine per tick. A crate/ledge/lift becomes as solid as a tile.
 */

/** A 10x10 grid of 32px tiles whose last row (9) is a solid floor; interior is empty. */
function floorTilemap(): Tilemap {
  const cols = 10;
  const rows = 10;
  const tiles: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) tiles.push(r === rows - 1 ? 1 : -1);
  }
  return { tileSize: 32, cols, rows, tiles, properties: { "1": { solid: true } } };
}

describe("solid-collide — entity-vs-entity solids", () => {
  it("lands on a solid entity and flags __onGround", () => {
    const world = makeWorld();
    makeEntity(world, { id: "crate", x: 0, y: 200, w: 200, h: 40, tags: ["solid"] });
    const e = makeEntity(world, { id: "p", x: 50, y: 188, w: 16, h: 16 }); // bottom 204 sinks into crate top 200
    e.vy = 600;
    solidCollide(e, world, { solidTag: "solid" }, DT);
    expect(e.y).toBe(200 - 16); // 184 — rests on the crate top
    expect(e.vy).toBe(0);
    expect(e.state.__onGround).toBe(true);
  });

  it("is blocked by a solid entity's side moving right (__onWallR)", () => {
    const world = makeWorld();
    makeEntity(world, { id: "crate", x: 100, y: 0, w: 40, h: 200, tags: ["solid"] });
    const e = makeEntity(world, { id: "p", x: 88, y: 50, w: 16, h: 16 });
    e.vx = 600;
    solidCollide(e, world, { solidTag: "solid" }, DT);
    expect(e.x).toBe(100 - 16); // 84
    expect(e.vx).toBe(0);
    expect(e.state.__onWallR).toBe(true);
  });

  it("bonks a solid entity's underside moving up (__onCeiling)", () => {
    const world = makeWorld();
    makeEntity(world, { id: "ledge", x: 0, y: 0, w: 200, h: 40, tags: ["solid"] });
    const e = makeEntity(world, { id: "p", x: 50, y: 34, w: 16, h: 16 }); // top 34 sinks into ledge bottom 40
    e.vy = -600;
    solidCollide(e, world, { solidTag: "solid" }, DT);
    expect(e.y).toBe(40);
    expect(e.vy).toBe(0);
    expect(e.state.__onCeiling).toBe(true);
  });

  it("no solid entities ⇒ flags false, body untouched, no throw", () => {
    const world = makeWorld();
    const e = makeEntity(world, { id: "p", x: 0, y: 0, w: 16, h: 16, state: { __onGround: true } });
    e.vy = 600;
    expect(() => solidCollide(e, world, { solidTag: "solid" }, DT)).not.toThrow();
    expect(e.state.__onGround).toBe(false);
    expect(e.y).toBe(0); // solid-collide does not integrate; nothing to resolve against
  });

  it("skips itself when the carrier also carries the solid tag", () => {
    const world = makeWorld();
    const e = makeEntity(world, { id: "p", x: 0, y: 0, w: 16, h: 16, tags: ["solid"] });
    e.vy = 600;
    solidCollide(e, world, { solidTag: "solid" }, DT);
    expect(e.state.__onGround).toBe(false); // did not resolve against itself
  });
});

describe("tilemap-collide + solid-collide — contact flags merge per tick", () => {
  it("stays grounded on a TILE floor even though a later solid-collide finds no solid entity", () => {
    const world = makeWorld();
    world.tilemap = floorTilemap();
    world.frame = 7; // a real tick (constant within the tick)
    const e = makeEntity(world, { id: "p", x: 100, y: 290, w: 16, h: 16 }); // sinks into floor row 9 (288)
    e.vy = 100;
    tilemapCollide(e, world, { solidProp: "solid" }, DT); // grounds on the tile floor
    solidCollide(e, world, { solidTag: "solid" }, DT); // no solids → must NOT clobber __onGround
    expect(e.state.__onGround).toBe(true);
    expect(e.y).toBe(9 * 32 - 16);
  });

  it("grounds on a SOLID ENTITY with a tilemap present but no tile underfoot", () => {
    const world = makeWorld();
    world.tilemap = floorTilemap();
    world.frame = 7;
    makeEntity(world, { id: "crate", x: 96, y: 200, w: 64, h: 40, tags: ["solid"] });
    const e = makeEntity(world, { id: "p", x: 100, y: 188, w: 16, h: 16 }); // mid-air vs tiles, sinks into crate
    e.vy = 600;
    tilemapCollide(e, world, { solidProp: "solid" }, DT); // interior — no tile contact, resets flags
    solidCollide(e, world, { solidTag: "solid" }, DT); // lands on the crate, OR's __onGround back true
    expect(e.state.__onGround).toBe(true);
    expect(e.y).toBe(200 - 16);
  });
});
