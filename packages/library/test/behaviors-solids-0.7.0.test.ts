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
  it("lands on a solid entity and flags contacts.onGround", () => {
    const world = makeWorld();
    makeEntity(world, { id: "crate", x: 0, y: 200, w: 200, h: 40, tags: ["solid"] });
    const e = makeEntity(world, { id: "p", x: 50, y: 188, w: 16, h: 16 }); // bottom 204 sinks into crate top 200
    e.vy = 600;
    solidCollide(e, world, { solidTag: "solid" }, DT);
    expect(e.y).toBe(200 - 16); // 184 — rests on the crate top
    expect(e.vy).toBe(0);
    expect(e.body.contacts.onGround).toBe(true);
  });

  it("is blocked by a solid entity's side moving right (contacts.onWallR)", () => {
    const world = makeWorld();
    makeEntity(world, { id: "crate", x: 100, y: 0, w: 40, h: 200, tags: ["solid"] });
    const e = makeEntity(world, { id: "p", x: 88, y: 50, w: 16, h: 16 });
    e.vx = 600;
    solidCollide(e, world, { solidTag: "solid" }, DT);
    expect(e.x).toBe(100 - 16); // 84
    expect(e.vx).toBe(0);
    expect(e.body.contacts.onWallR).toBe(true);
  });

  it("bonks a solid entity's underside moving up (contacts.onCeiling)", () => {
    const world = makeWorld();
    makeEntity(world, { id: "ledge", x: 0, y: 0, w: 200, h: 40, tags: ["solid"] });
    const e = makeEntity(world, { id: "p", x: 50, y: 34, w: 16, h: 16 }); // top 34 sinks into ledge bottom 40
    e.vy = -600;
    solidCollide(e, world, { solidTag: "solid" }, DT);
    expect(e.y).toBe(40);
    expect(e.vy).toBe(0);
    expect(e.body.contacts.onCeiling).toBe(true);
  });

  it("no solid entities ⇒ flags false, body untouched, no throw", () => {
    const world = makeWorld();
    const e = makeEntity(world, { id: "p", x: 0, y: 0, w: 16, h: 16 });
    e.body.contacts.onGround = true; // pre-seed grounded; the resolver must reset it
    e.vy = 600;
    expect(() => solidCollide(e, world, { solidTag: "solid" }, DT)).not.toThrow();
    expect(e.body.contacts.onGround).toBe(false);
    expect(e.y).toBe(0); // solid-collide does not integrate; nothing to resolve against
  });

  it("skips itself when the carrier also carries the solid tag", () => {
    const world = makeWorld();
    const e = makeEntity(world, { id: "p", x: 0, y: 0, w: 16, h: 16, tags: ["solid"] });
    e.vy = 600;
    solidCollide(e, world, { solidTag: "solid" }, DT);
    expect(e.body.contacts.onGround).toBe(false); // did not resolve against itself
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
    solidCollide(e, world, { solidTag: "solid" }, DT); // no solids → must NOT clobber contacts.onGround
    expect(e.body.contacts.onGround).toBe(true);
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
    solidCollide(e, world, { solidTag: "solid" }, DT); // lands on the crate, OR's contacts.onGround back true
    expect(e.body.contacts.onGround).toBe(true);
    expect(e.y).toBe(200 - 16);
  });
});

/**
 * 0.7.0 — one-way (pass-through) platforms: solid on the TOP face only. A falling body
 * lands; a rising body and a sideways body pass; the mover's drop-through window suppresses
 * them. Tile flavour via `tilemap-collide` (a `oneWay` tile-prop), entity flavour via
 * `solid-collide` (an `oneWayTag`).
 */

/** A 10x10 grid of 32px tiles whose row 5 is a ONE-WAY platform (tile index 2). */
function oneWayTilemap(): Tilemap {
  const cols = 10;
  const rows = 10;
  const tiles: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) tiles.push(r === 5 ? 2 : -1);
  }
  return { tileSize: 32, cols, rows, tiles, properties: { "2": { oneWay: true } } };
}

describe("tilemap-collide — one-way tiles", () => {
  it("lands a falling body on a one-way tile from above (contacts.onGround + contacts.onOneWay)", () => {
    const world = makeWorld();
    world.tilemap = oneWayTilemap();
    world.frame = 3;
    const e = makeEntity(world, { id: "p", x: 100, y: 148, w: 16, h: 16 }); // pre-fall bottom 159 ≤ top 160
    e.vy = 300;
    tilemapCollide(e, world, {}, DT);
    expect(e.y).toBe(5 * 32 - 16); // 144 — rests on the platform top (160)
    expect(e.body.contacts.onGround).toBe(true);
    expect(e.body.contacts.onOneWay).toBe(true);
  });

  it("lets a rising body pass UP through a one-way tile (no ceiling bonk)", () => {
    const world = makeWorld();
    world.tilemap = oneWayTilemap();
    world.frame = 3;
    const e = makeEntity(world, { id: "p", x: 100, y: 180, w: 16, h: 16 }); // inside the band, rising
    e.vy = -300;
    tilemapCollide(e, world, {}, DT);
    expect(e.vy).toBe(-300); // not stopped
    expect(e.body.contacts.onCeiling).toBe(false);
  });

  it("ignores one-way tiles while a drop-through window is open (falls through)", () => {
    const world = makeWorld();
    world.tilemap = oneWayTilemap();
    world.frame = 3;
    const e = makeEntity(world, { id: "p", x: 100, y: 148, w: 16, h: 16 });
    e.body.dropThrough = 0.1;
    e.vy = 300;
    tilemapCollide(e, world, {}, DT);
    expect(e.body.contacts.onGround).toBe(false); // not caught — passes through
    expect(e.vy).toBe(300); // velocity untouched
  });
});

describe("solid-collide — one-way ledge entities (oneWayTag)", () => {
  it("lands on a one-way ledge entity from above", () => {
    const world = makeWorld();
    makeEntity(world, { id: "ledge", x: 0, y: 200, w: 200, h: 16, tags: ["ledge"] });
    const e = makeEntity(world, { id: "p", x: 50, y: 188, w: 16, h: 16 }); // pre-fall bottom 199 ≤ top 200
    e.vy = 300;
    solidCollide(e, world, { oneWayTag: "ledge" }, DT);
    expect(e.y).toBe(200 - 16); // 184 — rests on the ledge top
    expect(e.body.contacts.onGround).toBe(true);
    expect(e.body.contacts.onOneWay).toBe(true);
  });

  it("passes UP through a one-way ledge entity", () => {
    const world = makeWorld();
    makeEntity(world, { id: "ledge", x: 0, y: 200, w: 200, h: 16, tags: ["ledge"] });
    const e = makeEntity(world, { id: "p", x: 50, y: 195, w: 16, h: 16 }); // overlapping, rising
    e.vy = -300;
    solidCollide(e, world, { oneWayTag: "ledge" }, DT);
    expect(e.vy).toBe(-300);
    expect(e.body.contacts.onCeiling).toBe(false);
  });

  it("default mover off: no oneWayTag means the ledge query is skipped (no contact)", () => {
    const world = makeWorld();
    makeEntity(world, { id: "ledge", x: 0, y: 200, w: 200, h: 16, tags: ["ledge"] });
    const e = makeEntity(world, { id: "p", x: 50, y: 188, w: 16, h: 16 });
    e.vy = 300;
    solidCollide(e, world, {}, DT); // default solidTag "solid", no oneWayTag
    expect(e.body.contacts.onGround).toBe(false);
  });
});
