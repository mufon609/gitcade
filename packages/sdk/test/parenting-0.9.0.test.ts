import { describe, it, expect } from "vitest";
import {
  Game,
  World,
  Entity,
  createDefaultRegistry,
  EntityDefSchema,
  SceneSchema,
  type Sprite,
} from "../src/index.js";
import { checkSceneRefs } from "../src/validate/rules.js";

/**
 * Entity HIERARCHY / transform parenting. A parented
 * entity's WORLD transform is derived from its parent's world transform composed with a
 * parent-frame `local` offset, each tick, by `World.resolveHierarchy()`. `entity.x/y/rotation/
 * scale*` stay WORLD-space (renderer/collision unchanged); the offset lives in `entity.local`.
 */

const NONE: Sprite = { kind: "none" };

function world(): World {
  return new World({ bounds: { width: 800, height: 600 }, config: {}, registry: createDefaultRegistry() });
}

function ent(init: {
  id: string;
  x?: number;
  y?: number;
  parentId?: string;
  local?: { x?: number; y?: number; rotation?: number; scale?: number };
  rotation?: number;
  scale?: number;
}): Entity {
  const e = new Entity({
    id: init.id,
    x: init.x ?? 0,
    y: init.y ?? 0,
    w: 16,
    h: 16,
    layer: 0,
    sprite: NONE,
    parentId: init.parentId,
    local: init.local,
  });
  if (init.rotation !== undefined) e.rotation = init.rotation;
  if (init.scale !== undefined) {
    e.scaleX = init.scale;
    e.scaleY = init.scale;
  }
  return e;
}

const HALF_PI = Math.PI / 2;

describe("resolveHierarchy — world transform composition", () => {
  it("derives the child world position from parent position + local offset, tracking the parent", () => {
    const w = world();
    const parent = ent({ id: "p", x: 100, y: 50 });
    const child = ent({ id: "c", parentId: "p", local: { x: 20, y: -8 } });
    w.add(parent);
    w.add(child);

    w.resolveHierarchy();
    expect(child.x).toBe(120);
    expect(child.y).toBe(42);

    parent.x = 200; // the parent moved this tick (as its own behavior would)
    parent.y = 60;
    w.resolveHierarchy();
    expect(child.x).toBe(220);
    expect(child.y).toBe(52);
  });

  it("rotates the local offset about the parent and composes rotation", () => {
    const w = world();
    const parent = ent({ id: "p", x: 0, y: 0, rotation: HALF_PI }); // +90° (clockwise in screen space)
    const child = ent({ id: "c", parentId: "p", local: { x: 10, y: 0 } });
    w.add(parent);
    w.add(child);
    w.resolveHierarchy();
    // (10,0) rotated +90° → (0,10); rotation inherited.
    expect(child.x).toBeCloseTo(0, 6);
    expect(child.y).toBeCloseTo(10, 6);
    expect(child.rotation).toBeCloseTo(HALF_PI, 6);
  });

  it("composes scale (position scaled by parent, world scale multiplied)", () => {
    const w = world();
    const parent = ent({ id: "p", x: 0, y: 0, scale: 2 });
    const child = ent({ id: "c", parentId: "p", local: { x: 10, y: 5, scale: 3 } });
    w.add(parent);
    w.add(child);
    w.resolveHierarchy();
    expect(child.x).toBe(20); // 10 * parentScale 2
    expect(child.y).toBe(10); // 5 * 2
    expect(child.scaleX).toBe(6); // 2 * localScale 3
    expect(child.scaleY).toBe(6);
  });

  it("a flipped parent (scaleX = -1) mirrors the child offset and facing", () => {
    const w = world();
    const parent = ent({ id: "p", x: 100, y: 0 });
    parent.scaleX = -1; // facing left (the face-velocity flip convention)
    const child = ent({ id: "c", parentId: "p", local: { x: 10, y: 5 } });
    w.add(parent);
    w.add(child);
    w.resolveHierarchy();
    expect(child.x).toBe(90); // 100 + (10 * -1)
    expect(child.y).toBe(5);
    expect(child.scaleX).toBe(-1); // child mirrors too (a held item flips with the holder)
  });

  it("resolves a multi-level chain parent-first, even when added out of order", () => {
    const w = world();
    // Add child → parent → grandparent (reverse depth order) to prove on-demand parent resolution.
    const child = ent({ id: "c", parentId: "p", local: { x: 5, y: 0 } });
    const parent = ent({ id: "p", parentId: "g", local: { x: 10, y: 0 } });
    const grandparent = ent({ id: "g", x: 100, y: 0 });
    w.add(child);
    w.add(parent);
    w.add(grandparent);
    w.resolveHierarchy();
    expect(parent.x).toBe(110); // 100 + 10
    expect(child.x).toBe(115); // 110 + 5  (composed against the RESOLVED parent)
  });
});

describe("resolveHierarchy — edge cases", () => {
  it("leaves a child with a missing parent at its last world transform (orphan in place, no throw)", () => {
    const w = world();
    const child = ent({ id: "c", x: 42, y: 7, parentId: "ghost", local: { x: 5, y: 5 } });
    w.add(child);
    expect(() => w.resolveHierarchy()).not.toThrow();
    expect(child.x).toBe(42);
    expect(child.y).toBe(7);
  });

  it("breaks a parent cycle without hanging and keeps finite transforms", () => {
    const w = world();
    const a = ent({ id: "a", x: 1, y: 0, parentId: "b" });
    const b = ent({ id: "b", x: 2, y: 0, parentId: "a" });
    w.add(a);
    w.add(b);
    expect(() => w.resolveHierarchy()).not.toThrow();
    expect(Number.isFinite(a.x)).toBe(true);
    expect(Number.isFinite(b.x)).toBe(true);
  });

  it("is a no-op for a parentless world (byte-identical to a flat world)", () => {
    const w = world();
    const a = ent({ id: "a", x: 10, y: 20, rotation: 0.5 });
    const b = ent({ id: "b", x: 30, y: 40 });
    w.add(a);
    w.add(b);
    w.resolveHierarchy();
    expect([a.x, a.y, a.rotation]).toEqual([10, 20, 0.5]);
    expect([b.x, b.y]).toEqual([30, 40]);
  });
});

describe("attachTo / detach — runtime re-parenting", () => {
  it("attachTo with an explicit local sets the parent + offset", () => {
    const w = world();
    const parent = ent({ id: "p", x: 100, y: 0 });
    const child = ent({ id: "c", x: 0, y: 0 });
    w.add(parent);
    w.add(child);
    child.attachTo(parent, { x: 5, y: 5 });
    expect(child.parentId).toBe("p");
    w.resolveHierarchy();
    expect(child.x).toBe(105);
    expect(child.y).toBe(5);
  });

  it("attachTo without a local captures the current world gap so the child does NOT teleport", () => {
    const w = world();
    const parent = ent({ id: "p", x: 100, y: 50 });
    const child = ent({ id: "c", x: 130, y: 30 });
    w.add(parent);
    w.add(child);
    child.attachTo(parent); // pick up in place
    w.resolveHierarchy();
    expect(child.x).toBe(130); // held its on-screen position
    expect(child.y).toBe(30);
    // and now it rides the parent:
    parent.x = 200;
    w.resolveHierarchy();
    expect(child.x).toBe(200 + 30);
  });

  it("attachTo capture respects a rotated parent (no teleport)", () => {
    const w = world();
    const parent = ent({ id: "p", x: 0, y: 0, rotation: HALF_PI });
    const child = ent({ id: "c", x: 0, y: 10 });
    w.add(parent);
    w.add(child);
    child.attachTo(parent);
    w.resolveHierarchy();
    expect(child.x).toBeCloseTo(0, 6);
    expect(child.y).toBeCloseTo(10, 6);
  });

  it("detach makes the entity a root again, leaving its world transform put", () => {
    const w = world();
    const parent = ent({ id: "p", x: 100, y: 0 });
    const child = ent({ id: "c", parentId: "p", local: { x: 20, y: 0 } });
    w.add(parent);
    w.add(child);
    w.resolveHierarchy();
    expect(child.x).toBe(120);
    child.detach();
    expect(child.parentId).toBeUndefined();
    parent.x = 500; // parent moves away
    w.resolveHierarchy();
    expect(child.x).toBe(120); // child stayed where it was dropped
  });
});

describe("Game tick integration — the hierarchy phase runs after behaviors", () => {
  it("a child rides its parent through the full fixed-step loop", () => {
    const scene = SceneSchema.parse({
      id: "main",
      entities: [
        { id: "p", position: { x: 100, y: 100 }, size: { w: 16, h: 16 }, behaviors: [{ type: "velocity" }] },
        { id: "c", parent: "p", local: { x: 20, y: -4 }, size: { w: 8, h: 8 } },
      ],
    });
    const game = new Game({ scenes: [scene], config: {} });
    const p = game.world.byId("p")!;
    const c = game.world.byId("c")!;
    p.vx = 600; // 600 px/s → 10 px/tick at 60Hz
    game.stepFrames(10); // parent integrates to x=200
    expect(p.x).toBeCloseTo(200, 5);
    expect(c.x).toBeCloseTo(220, 5); // tracked parent + local.x (20)
    expect(c.y).toBe(96); // 100 + local.y (-4)
  });
});

describe("schema — parent/local are additive optional", () => {
  it("absent on a plain entity (no materialized keys → byte-identical default)", () => {
    const e = EntityDefSchema.parse({ id: "x" });
    expect(e.parent).toBeUndefined();
    expect(e.local).toBeUndefined();
  });

  it("local defaults x/y to 0 when partially specified", () => {
    const e = EntityDefSchema.parse({ id: "x", parent: "p", local: { rotation: 1 } });
    expect(e.parent).toBe("p");
    expect(e.local).toEqual({ x: 0, y: 0, rotation: 1 });
  });
});

describe("validator — parent reference integrity", () => {
  it("flags a parent that names no entity in the scene", () => {
    const scene = SceneSchema.parse({ id: "main", entities: [{ id: "c", parent: "ghost" }] });
    const issues = checkSceneRefs([scene], null);
    expect(issues.some((i) => i.code === "parent-entity-missing")).toBe(true);
  });

  it("flags a self-parent and a 2-cycle as a parent cycle", () => {
    const self = SceneSchema.parse({ id: "s", entities: [{ id: "a", parent: "a" }] });
    expect(checkSceneRefs([self], null).some((i) => i.code === "parent-cycle")).toBe(true);

    const cycle = SceneSchema.parse({
      id: "main",
      entities: [
        { id: "a", parent: "b" },
        { id: "b", parent: "a" },
      ],
    });
    expect(checkSceneRefs([cycle], null).some((i) => i.code === "parent-cycle")).toBe(true);
  });

  it("passes a valid parent reference (no parent-* issue)", () => {
    const scene = SceneSchema.parse({
      id: "main",
      entities: [{ id: "p" }, { id: "c", parent: "p", local: { x: 4, y: 4 } }],
    });
    const issues = checkSceneRefs([scene], null);
    expect(issues.some((i) => i.code.startsWith("parent-"))).toBe(false);
  });

  it("resolves a parent inherited from a base scene (extends) as valid", () => {
    const base = SceneSchema.parse({ id: "base", entities: [{ id: "p", position: { x: 0, y: 0 } }] });
    const level = SceneSchema.parse({ id: "level", extends: "base", entities: [{ id: "c", parent: "p" }] });
    const issues = checkSceneRefs([base, level], null);
    expect(issues.some((i) => i.code === "parent-entity-missing")).toBe(false);
  });
});
