import { describe, it, expect } from "vitest";
import { applyRemix, buildRemixModel, flattenConfigLeaves, type CatalogIndex } from "@/lib/remix";
import { validateRemix } from "@/lib/remix-validate";
import type { CatalogPart } from "@/lib/catalog";

// A minimal catalog index for the pure apply/model functions.
type MovementEntry = CatalogIndex["movement"][number];
function catalog(): CatalogIndex {
  const moveGrid: MovementEntry = {
    id: "move-grid-step",
    kind: "behavior",
    version: "1.0.0",
    category: "movement",
    tags: ["movement", "grid"],
    description: "",
    license: "MIT",
    definition: { type: "move-grid-step", params: { tileSize: 20, stepInterval: "$cfg.stepInterval", continuous: true } },
    source: "catalog",
  };
  const move360: MovementEntry = {
    id: "move-topdown-360",
    kind: "behavior",
    version: "1.0.0",
    category: "movement",
    tags: ["movement", "topdown"],
    description: "",
    license: "MIT",
    definition: { type: "move-topdown-360", params: { speed: "$cfg.playerSpeed", pointerFollow: true } },
    source: "catalog",
  };
  return {
    sprites: [
      { partId: "enemy-shooter", version: "1.0.0", license: "CC-BY-4.0", source: "catalog" as const, sprite: { kind: "image", src: "assets/sprites/enemy-shooter.png" } },
    ],
    movement: [moveGrid, move360],
    behaviorById: new Map([
      ["move-grid-step", moveGrid],
      ["move-topdown-360", move360],
    ]),
  };
}

const snakeScene = () => ({
  id: "main",
  entities: [
    {
      id: "head",
      sprite: { kind: "sheet", src: "assets/sprites/player-blob.png", frameWidth: 32, frameHeight: 32, frameCount: 2 },
      size: { w: 20, h: 20 },
      position: { x: 400, y: 300 },
      tags: ["head"],
      layer: 4,
      behaviors: [
        { type: "sprite-animate", params: { play: "idle" } },
        { type: "move-grid-step", part: "move-grid-step@1.0.0", params: { tileSize: 20, stepInterval: "$cfg.stepInterval", continuous: true } },
      ],
    },
  ],
  systems: [],
});
const snakeConfig = () => ({ stepInterval: 0.11, startLength: 3 });

describe("remix — config flattening + slider ranges", () => {
  it("flattens numeric leaves with sane slider bounds", () => {
    const leaves = flattenConfigLeaves({ stepInterval: 0.11, startLength: 3 });
    const step = leaves.find((l) => l.path === "stepInterval")!;
    expect(step.kind).toBe("number");
    expect(step.min).toBe(0);
    expect(step.max).toBeGreaterThan(0.11);
  });
});

describe("remix — build model", () => {
  it("surfaces the sprite-bearing entity, the movement slot, and config leaves", () => {
    const model = buildRemixModel(snakeScene(), snakeConfig(), "src/scenes/main.json", "config.json", catalog());
    expect(model.entities.map((e) => e.id)).toContain("head");
    expect(model.movementSlots).toHaveLength(1);
    expect(model.movementSlots[0].currentType).toBe("move-grid-step");
    expect(model.movementSlots[0].options.map((o) => o.partId)).toContain("move-topdown-360");
    expect(model.configLeaves.map((l) => l.path)).toEqual(["stepInterval", "startLength"]);
  });
});

describe("remix — apply edits (the dragon-on-snake transform)", () => {
  it("swaps sprite + movement + a config tunable, backfilling the new $cfg key, and stays valid", () => {
    const result = applyRemix(
      snakeScene(),
      snakeConfig(),
      {
        spriteSwaps: { head: "enemy-shooter" },
        movementSwaps: { "head#1": "move-topdown-360" },
        configEdits: { startLength: 6 },
      },
      catalog(),
    );

    const head = (result.scene.entities as Array<Record<string, unknown>>)[0];
    // sprite swapped
    expect((head.sprite as { src: string }).src).toBe("assets/sprites/enemy-shooter.png");
    // movement swapped, with catalog provenance preserved
    const move = (head.behaviors as Array<Record<string, unknown>>)[1];
    expect(move.type).toBe("move-topdown-360");
    expect(move.part).toBe("move-topdown-360@1.0.0");
    // the new behavior's $cfg key was backfilled into config
    expect(result.addedConfigKeys).toContain("playerSpeed");
    expect((result.config as Record<string, number>).playerSpeed).toBeGreaterThan(0);
    // config tunable edited
    expect((result.config as Record<string, number>).startLength).toBe(6);
    // summary describes each change
    expect(result.summary.length).toBe(3);

    // THE GATE: the remixed output passes the no-magic-numbers + $cfg-resolution check.
    expect(validateRemix(result.scene, result.config)).toEqual([]);
  });

  it("vendors a user part instead of a catalog provenance ref", () => {
    const cat = catalog();
    const userBeh: CatalogPart & { source: "user"; version: string; sourceCode: string } = {
      id: "wobble-move",
      kind: "behavior",
      version: "1.0.0",
      category: "movement",
      tags: ["movement", "custom"],
      description: "",
      license: "MIT",
      definition: { type: "wobble-move", params: { amt: "$cfg.wobbleAmt" } },
      source: "user",
      sourceCode: "export const wobble = () => {};",
    };
    cat.movement.push(userBeh);
    cat.behaviorById.set("wobble-move", userBeh);

    const result = applyRemix(snakeScene(), snakeConfig(), { movementSwaps: { "head#1": "wobble-move" } }, cat);
    const move = (result.scene.entities as Array<Record<string, unknown>>)[0].behaviors as Array<Record<string, unknown>>;
    expect(move[1].type).toBe("wobble-move");
    expect(move[1].part).toBeUndefined(); // no catalog provenance for a vendored part
    expect(result.vendored).toEqual([{ path: "src/vendored-parts/wobble-move.ts", content: "export const wobble = () => {};" }]);
    expect(result.addedConfigKeys).toContain("wobbleAmt");
  });

  it("skips a user-part swap with no stored source (never references an unregistered type)", () => {
    const cat = catalog();
    const userBeh: CatalogPart & { source: "user"; version: string; sourceCode: null } = {
      id: "ghost-move",
      kind: "behavior",
      version: "1.0.0",
      category: "movement",
      tags: ["movement", "custom"],
      description: "",
      license: "MIT",
      definition: { type: "ghost-move", params: {} },
      source: "user",
      sourceCode: null,
    };
    cat.movement.push(userBeh);
    cat.behaviorById.set("ghost-move", userBeh);

    const result = applyRemix(snakeScene(), snakeConfig(), { movementSwaps: { "head#1": "ghost-move" } }, cat);
    const move = (result.scene.entities as Array<Record<string, unknown>>)[0].behaviors as Array<Record<string, unknown>>;
    expect(move[1].type).not.toBe("ghost-move"); // swap skipped — type unchanged
    expect(result.vendored).toEqual([]);
    expect(result.summary).toEqual([]);
  });
});

describe("remix-validate — the UI gate mirrors the worker", () => {
  it("flags an unresolved $cfg ref", () => {
    const scene = {
      id: "m",
      entities: [{ id: "e", sprite: { kind: "shape", shape: "circle", color: "#fff" }, size: { w: 1, h: 1 }, position: { x: 0, y: 0 }, tags: [], layer: 0, behaviors: [{ type: "x", params: { speed: "$cfg.missing" } }] }],
      systems: [],
    };
    const issues = validateRemix(scene, {});
    expect(issues.some((i) => i.code === "unresolved-cfg")).toBe(true);
  });

  it("flags a magic number under a non-structural key", () => {
    const scene = {
      id: "m",
      entities: [{ id: "e", sprite: { kind: "shape", shape: "circle", color: "#fff" }, size: { w: 1, h: 1 }, position: { x: 0, y: 0 }, tags: [], layer: 0, behaviors: [{ type: "x", params: { speed: 99 } }] }],
      systems: [],
    };
    const issues = validateRemix(scene, {});
    expect(issues.some((i) => i.code === "magic-number")).toBe(true);
  });
});
