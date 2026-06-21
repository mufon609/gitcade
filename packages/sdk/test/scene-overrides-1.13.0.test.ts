import { describe, it, expect } from "vitest";
import { SceneSchema, resolveSceneInheritance, Game, type Scene } from "../src/index.js";
import { checkParams, collectPartRefs, checkSceneRefs } from "../src/validate/rules.js";

/**
 * 1.13.0 — scene `extends` GRANULARITY. The plain `entities` id-merge replaces an inherited entity
 * WHOLESALE; `overrides` add the missing granularity — a `{ id, …partial }` patch that deep-merges
 * onto the resolved entity of that id (nested objects recurse per-leaf; arrays/primitives replace;
 * absent keys inherit), re-parsed through the strict EntityDefSchema. Additive: a scene with no
 * `overrides` resolves byte-identically.
 */

/** Parse a raw scene object the way the loader does (defaults applied, `overrides` passed through). */
function scene(raw: unknown): Scene {
  return SceneSchema.parse(raw);
}

const BASE = {
  id: "play-base",
  size: { width: 640, height: 480 },
  background: "#111",
  entities: [
    {
      id: "paddle",
      sprite: { kind: "shape", shape: "rect", color: "#ffffff" },
      size: { w: 80, h: 10 },
      position: { x: 100, y: 400 },
      tags: ["paddle"],
      layer: 1,
      state: { hp: 3 },
      behaviors: [{ type: "velocity", params: { vx: "$cfg.paddleVx" } }],
    },
    {
      id: "ball",
      sprite: { kind: "shape", shape: "circle", color: "#ffcc00" },
      size: { w: 10, h: 10 },
      position: { x: 50, y: 50 },
      tags: ["ball"],
      behaviors: [{ type: "velocity", params: { vx: "$cfg.ballVx", vy: "$cfg.ballVy" } }],
    },
  ],
  systems: [],
};

describe("scene overrides — resolver", () => {
  it("deep-merges a single nested field, inheriting every other field of the entity", () => {
    const base = scene(BASE);
    const level = scene({
      id: "level-1",
      extends: "play-base",
      overrides: [{ id: "paddle", position: { x: 200 } }],
    });
    const [, resolved] = resolveSceneInheritance([base, level]);

    const paddle = resolved.entities.find((e) => e.id === "paddle")!;
    // The patched leaf changed; its sibling leaf (`y`) and every other field inherit unchanged.
    expect(paddle.position).toEqual({ x: 200, y: 400 });
    expect(paddle.size).toEqual({ w: 80, h: 10 });
    expect(paddle.sprite).toEqual({ kind: "shape", shape: "rect", color: "#ffffff" });
    expect(paddle.tags).toEqual(["paddle"]);
    expect(paddle.layer).toBe(1);
    expect(paddle.behaviors).toHaveLength(1);
    // The un-patched sibling entity (`ball`) is untouched, and order is preserved.
    expect(resolved.entities.map((e) => e.id)).toEqual(["paddle", "ball"]);
    expect(resolved.entities.find((e) => e.id === "ball")!.size).toEqual({ w: 10, h: 10 });
    // `overrides` is resolved away, like `extends`.
    expect(resolved.overrides).toBeUndefined();
    expect(resolved.extends).toBeUndefined();
  });

  it("merges nested object shapes per-leaf (size, sprite within a kind, state)", () => {
    const base = scene(BASE);
    const level = scene({
      id: "level-1",
      extends: "play-base",
      overrides: [
        { id: "ball", size: { w: 14 } }, // keeps h
        { id: "paddle", sprite: { color: "#00ff00" } }, // keeps kind+shape
        { id: "paddle", state: { armor: 1 } }, // merges onto {hp:3}
      ],
    });
    const [, resolved] = resolveSceneInheritance([base, level]);

    expect(resolved.entities.find((e) => e.id === "ball")!.size).toEqual({ w: 14, h: 10 });
    const paddle = resolved.entities.find((e) => e.id === "paddle")!;
    expect(paddle.sprite).toEqual({ kind: "shape", shape: "rect", color: "#00ff00" });
    // Two patches to the same id accumulate; state deep-merges rather than replacing.
    expect(paddle.state).toEqual({ hp: 3, armor: 1 });
  });

  it("replaces arrays (behaviors, tags) wholesale when the patch provides them", () => {
    const base = scene(BASE);
    const level = scene({
      id: "level-1",
      extends: "play-base",
      overrides: [
        { id: "ball", behaviors: [{ type: "velocity", params: { vx: "$cfg.fastVx" } }] },
        { id: "paddle", tags: ["paddle", "boosted"] },
      ],
    });
    const [, resolved] = resolveSceneInheritance([base, level]);

    const ball = resolved.entities.find((e) => e.id === "ball")!;
    expect(ball.behaviors).toHaveLength(1); // replaced, not appended to the base's
    expect(ball.behaviors[0].params).toEqual({ vx: "$cfg.fastVx" });
    expect(resolved.entities.find((e) => e.id === "paddle")!.tags).toEqual(["paddle", "boosted"]);
  });

  it("can ADD an additive field the base entity lacks (e.g. a collider)", () => {
    const base = scene(BASE);
    const level = scene({
      id: "level-1",
      extends: "play-base",
      overrides: [{ id: "ball", collider: { role: "dynamic" } }],
    });
    const [, resolved] = resolveSceneInheritance([base, level]);

    const ball = resolved.entities.find((e) => e.id === "ball")!;
    // Re-parse through EntityDefSchema fills the collider's own defaults.
    expect(ball.collider).toMatchObject({ role: "dynamic", oneWay: false, pushable: false, mass: 1 });
  });

  it("applies overrides across an extends chain (and bakes a base's overrides before a child extends)", () => {
    const root = scene(BASE);
    const mid = scene({
      id: "mid",
      extends: "play-base",
      overrides: [{ id: "paddle", layer: 5 }],
    });
    const leaf = scene({
      id: "leaf",
      extends: "mid",
      overrides: [{ id: "paddle", position: { x: 300 } }],
    });
    const [, , resolvedLeaf] = resolveSceneInheritance([root, mid, leaf]);

    const paddle = resolvedLeaf.entities.find((e) => e.id === "paddle")!;
    expect(paddle.layer).toBe(5); // mid's override, inherited by leaf
    expect(paddle.position).toEqual({ x: 300, y: 400 }); // leaf's override over the inherited y
  });

  it("ignores a patch whose id matches no entity — a runtime-robust no-op, no throw", () => {
    const base = scene(BASE);
    const level = scene({
      id: "level-1",
      extends: "play-base",
      overrides: [{ id: "ghost", position: { x: 1, y: 1 } }],
    });
    expect(() => resolveSceneInheritance([base, level])).not.toThrow();
    const [, resolved] = resolveSceneInheritance([base, level]);
    expect(resolved.entities.map((e) => e.id)).toEqual(["paddle", "ball"]); // no ghost entity created
  });

  it("throws a clear, located error when a patch yields a structurally-invalid entity", () => {
    const base = scene(BASE);
    const level = scene({
      id: "level-1",
      extends: "play-base",
      overrides: [{ id: "paddle", opacity: 5 }], // opacity is bounded 0..1
    });
    expect(() => resolveSceneInheritance([base, level])).toThrow(
      /scene "level-1": override for entity "paddle" produced an invalid entity/,
    );
  });

  it("leaves a scene with no overrides byte-identical (same object reference)", () => {
    const base = scene(BASE);
    const [resolved] = resolveSceneInheritance([base]);
    // A root scene that declares no overrides is returned untouched — the additive guarantee.
    expect(resolved).toBe(base);
  });
});

describe("scene overrides — runtime boot", () => {
  const config = { paddleVx: 0, ballVx: 60, ballVy: 90, fastVx: 240 };

  it("boots a scene whose inherited entity is patched, reflecting the patched fields", () => {
    const base = scene(BASE);
    const level = scene({
      id: "level-1",
      extends: "play-base",
      overrides: [
        { id: "paddle", position: { x: 200 }, state: { armor: 1 } },
        { id: "ball", size: { w: 14 } },
      ],
    });
    const game = new Game({ scenes: [base, level], config, entrySceneId: "level-1", canvas: null });

    const paddle = game.world.byId("paddle")!;
    expect(paddle.x).toBe(200); // patched leaf
    expect(paddle.y).toBe(400); // inherited leaf
    expect(paddle.state).toMatchObject({ hp: 3, armor: 1 });
    expect(game.world.byId("ball")!.w).toBe(14);
  });

  it("resolves a $cfg-slice override against config at boot", () => {
    const base = scene(BASE);
    const level = scene({
      id: "level-1",
      extends: "play-base",
      // Point the inherited ball's mover at a different config slice (a $cfg-slice override).
      overrides: [{ id: "ball", behaviors: [{ type: "velocity", params: { vx: "$cfg.fastVx" } }] }],
    });
    const game = new Game({ scenes: [base, level], config, entrySceneId: "level-1", canvas: null });

    const ball = game.world.byId("ball")!;
    game.update(1 / 60); // one fixed step integrates velocity → vx = fastVx (240) px/s
    expect(ball.x).toBeCloseTo(50 + 240 / 60, 5);
  });
});

describe("scene overrides — validator", () => {
  const config = { paddleVx: 1, ballVx: 1, ballVy: 1, goodSpeed: 7 };

  it("checkParams scans override behavior params (magic number + unresolved $cfg)", () => {
    const scenes = [
      scene(BASE),
      scene({
        id: "level-1",
        extends: "play-base",
        overrides: [
          { id: "paddle", behaviors: [{ type: "velocity", params: { vx: 999 } }] }, // magic number
          { id: "ball", behaviors: [{ type: "velocity", params: { vx: "$cfg.missing" } }] }, // dangling $cfg
        ],
      }),
    ];
    const issues = checkParams(scenes, config);

    const magic = issues.find((i) => i.code === "magic-number");
    expect(magic?.where).toContain("level-1.overrides[0:paddle].behaviors");
    const dangling = issues.find((i) => i.code === "unresolved-cfg");
    expect(dangling?.where).toContain("level-1.overrides[1:ball].behaviors");
  });

  it("checkParams passes an override that uses a resolvable $cfg slice", () => {
    const scenes = [
      scene(BASE),
      scene({
        id: "level-1",
        extends: "play-base",
        overrides: [{ id: "paddle", behaviors: [{ type: "velocity", params: { vx: "$cfg.goodSpeed" } }] }],
      }),
    ];
    expect(checkParams(scenes, config)).toEqual([]);
  });

  it("collectPartRefs pins a part introduced through an override", () => {
    const scenes = [
      scene(BASE),
      scene({
        id: "level-1",
        extends: "play-base",
        overrides: [
          {
            id: "ball",
            behaviors: [{ type: "contact-damage", part: "contact-damage@1.0.0", params: {} }],
          },
        ],
      }),
    ];
    const refs = collectPartRefs(scenes);
    const ref = refs.find((r) => r.ref === "contact-damage@1.0.0");
    expect(ref).toBeDefined();
    expect(ref?.where).toContain("level-1.overrides[0:ball].behaviors[0].part");
  });

  it("checkSceneRefs reports an override that targets a missing entity", () => {
    const scenes = [
      scene(BASE),
      scene({ id: "level-1", extends: "play-base", overrides: [{ id: "ghost", position: { x: 1, y: 1 } }] }),
    ];
    const issues = checkSceneRefs(scenes, null);
    const missing = issues.find((i) => i.code === "override-target-missing");
    expect(missing).toBeDefined();
    expect(missing?.where).toContain("level-1.overrides[0:ghost]");
  });

  it("checkSceneRefs surfaces a structurally-invalid override merge as a clean issue", () => {
    const scenes = [
      scene(BASE),
      // A typo'd key survives the passthrough patch and is rejected by the strict re-parse.
      scene({ id: "level-1", extends: "play-base", overrides: [{ id: "paddle", postion: { x: 1 } }] }),
    ];
    const issues = checkSceneRefs(scenes, null);
    const invalid = issues.find((i) => i.code === "scene-override-invalid");
    expect(invalid).toBeDefined();
    expect(invalid?.message).toMatch(/override for entity "paddle"/);
  });

  it("checkSceneRefs accepts valid overrides against a real target", () => {
    const scenes = [
      scene(BASE),
      scene({ id: "level-1", extends: "play-base", overrides: [{ id: "paddle", position: { x: 200 } }] }),
    ];
    const issues = checkSceneRefs(scenes, null);
    expect(issues.filter((i) => i.code.startsWith("override") || i.code === "scene-override-invalid")).toEqual([]);
  });
});
