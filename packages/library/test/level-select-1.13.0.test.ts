import { describe, it, expect } from "vitest";
import { createGame, type Game } from "@gitcade/sdk";
import { createLibraryRegistry } from "../src/index.js";

/**
 * 1.13.0 — the DATA layer of a level-select menu: the new `level-select` SYSTEM (projects the run-store
 * progress index into flat per-level keys) + `tap-emit@1.1.0`'s new `requireKey` GATE (a button emits only
 * when a world.state flag is truthy). Together with the SDK `@level:<id>` token and `createRunStore`, they
 * make a won-gated, best-displaying level-select pure DATA — no custom behavior, no host mirror. These tests
 * boot a REAL menu Game (so the system runs in tick order and the tap drives a real click edge):
 *  - `level-select` fans `runWon`/`runBest` out to `<id>:sel` / `:status` / `:score` / `:time`;
 *  - a `tap-emit` with `requireKey` is LOCKED (no emit) until its flag is truthy, and unGATED tap-emit is
 *    unchanged (back-compat);
 *  - the two compose: tapping a CLEARED card emits its pick event; tapping a LOCKED card does nothing.
 */

const manifest = {
  name: "Level Select Fixture",
  slug: "level-select",
  description: "Menu fixture for the level-select projection + gated tap-emit.",
  version: "1.0.0",
  engine: "gitcade-sdk",
  sdkVersion: "1.13.0",
  entryPoint: "src/scenes/menu.json",
  tier: "open",
  levels: ["level-1", "level-2"],
};

/** A menu scene: two full-width level cards (gated tap-emit) + the level-select projection system. */
function menuScene(): unknown {
  const card = (id: string, y: number, level: string): unknown => ({
    id,
    sprite: { kind: "none" },
    size: { w: 200, h: 80 },
    position: { x: 0, y },
    tags: ["card"],
    behaviors: [{ type: "tap-emit", params: { emitOnTap: `pick-${level}`, requireKey: `${level}:sel` } }],
  });
  return {
    id: "menu",
    size: { width: 200, height: 200 },
    entities: [card("card-1", 0, "level-1"), card("card-2", 100, "level-2")],
    systems: [
      {
        type: "level-select",
        params: {
          levels: ["level-1", "level-2"],
          clearedText: "✓ CLEARED",
          lockedText: "🔒 LOCKED",
          scoreTemplate: "◆ {v}",
          timeTemplate: "⧗ {v}s",
        },
      },
    ],
  };
}

function bootMenu(): Game {
  return createGame({ manifest, config: {}, scenes: [menuScene()] }, { canvas: null, registry: createLibraryRegistry(), entrySceneId: "menu" });
}

describe("level-select — projects the run-store index into flat per-level keys", () => {
  it("a CLEARED level: sel=true, cleared label, best score + time; a LOCKED level: sel=false, locked label, blank stats", () => {
    const g = bootMenu();
    // Simulate the progress index the `persistence` system loads from the run-store slot.
    g.world.state.runWon = { "level-1": true };
    g.world.state.runBest = { "level-1": { score: 128, ticks: 252, seconds: 4.2 } };
    g.stepFrames(1);

    expect(g.world.state["level-1:sel"]).toBe(true);
    expect(g.world.state["level-1:status"]).toBe("✓ CLEARED");
    expect(g.world.state["level-1:score"]).toBe("◆ 128");
    expect(g.world.state["level-1:time"]).toBe("⧗ 4.2s");

    expect(g.world.state["level-2:sel"]).toBe(false);
    expect(g.world.state["level-2:status"]).toBe("🔒 LOCKED");
    expect(g.world.state["level-2:score"]).toBe("");
    expect(g.world.state["level-2:time"]).toBe("");
  });

  it("an empty index ⇒ every level locked and blank (safe before any clear / before the load resolves)", () => {
    const g = bootMenu();
    g.stepFrames(1); // no runWon/runBest set
    for (const id of ["level-1", "level-2"]) {
      expect(g.world.state[`${id}:sel`]).toBe(false);
      expect(g.world.state[`${id}:status`]).toBe("🔒 LOCKED");
      expect(g.world.state[`${id}:score`]).toBe("");
      expect(g.world.state[`${id}:time`]).toBe("");
    }
  });

  it("re-projects each tick, so a level that becomes won flips to selectable", () => {
    const g = bootMenu();
    g.stepFrames(1);
    expect(g.world.state["level-2:sel"]).toBe(false);
    g.world.state.runWon = { "level-2": true };
    g.world.state.runBest = { "level-2": { score: 5, ticks: 600, seconds: 10 } };
    g.stepFrames(1);
    expect(g.world.state["level-2:sel"]).toBe(true);
    expect(g.world.state["level-2:time"]).toBe("⧗ 10.0s");
  });
});

describe("tap-emit requireKey gate", () => {
  it("a tap on a LOCKED card never emits; a tap on a CLEARED card emits its pick event", () => {
    const g = bootMenu();
    let picked1 = 0;
    let picked2 = 0;
    g.world.events.on("pick-level-1", () => (picked1 += 1));
    g.world.events.on("pick-level-2", () => (picked2 += 1));

    // Nothing cleared yet — both cards locked. A tap on card-1 must NOT emit.
    g.world.input.tap(100, 40);
    g.stepFrames(1);
    expect(picked1).toBe(0);

    // Clear level-1 (the run-store would have written this). Now card-1 is selectable; card-2 still locked.
    g.world.state.runWon = { "level-1": true };
    g.world.state.runBest = { "level-1": { score: 1, ticks: 60, seconds: 1 } };

    // Tap the LOCKED card-2 → still nothing (gated by level-2:sel === false).
    g.world.input.tap(100, 140);
    g.stepFrames(1);
    expect(picked2).toBe(0);

    // Tap the CLEARED card-1 → it emits its pick event (the host routes it; the @level edge is the data contract).
    g.world.input.tap(100, 40);
    g.stepFrames(1);
    expect(picked1).toBe(1);
  });

  it("an UNGATED tap-emit (no requireKey) still emits unconditionally — additive back-compat", () => {
    const g = createGame(
      {
        manifest,
        config: {},
        scenes: [
          {
            id: "menu",
            size: { width: 100, height: 100 },
            entities: [
              {
                id: "btn",
                sprite: { kind: "none" },
                size: { w: 100, h: 100 },
                position: { x: 0, y: 0 },
                tags: ["ui"],
                behaviors: [{ type: "tap-emit", params: { emitOnTap: "go" } }],
              },
            ],
            systems: [],
          },
        ],
      },
      { canvas: null, registry: createLibraryRegistry(), entrySceneId: "menu" },
    );
    let go = 0;
    g.world.events.on("go", () => (go += 1));
    g.world.input.tap(50, 50);
    g.stepFrames(1);
    expect(go).toBe(1);
  });
});
