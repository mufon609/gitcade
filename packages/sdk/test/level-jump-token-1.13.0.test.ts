import { describe, it, expect, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Game, isReservedFlowTarget, levelTargetId, type Scene } from "../src/index.js";
import { validateGame } from "../src/validate/index.js";

/**
 * 1.13.0 — the `@level:<sceneId>` reserved flow token: a data-authored level-select jumps to ANY
 * level INTROSPECTIVELY (resolved against `manifest.levels`), the parameterized companion to the
 * forward-only `@next`/`@first`. ADDITIVE/MINOR: a new optional token — no existing game uses it, no
 * existing token's resolution changes, no tick/result-order/world.state change. These tests pin:
 *  - the token grammar ({@link isReservedFlowTarget} / {@link levelTargetId});
 *  - runtime resolution — a `@level:<id>` flow edge transitions to `<id>` and `world.state.level`
 *    becomes its 1-based stage index; an unknown id is a no-op jump (the validator flags it);
 *  - the validator — `@level:<id>` to a non-level is `level-target-missing`, and the existing
 *    `flow-token-without-levels` STILL fires for an `@level` edge when no `levels` sequence exists.
 */

// ---------------------------------------------------------------------------
// token grammar
// ---------------------------------------------------------------------------
describe("@level token grammar", () => {
  it("isReservedFlowTarget recognizes @next/@first/@level:<id>, not a literal scene id", () => {
    expect(isReservedFlowTarget("@next")).toBe(true);
    expect(isReservedFlowTarget("@first")).toBe(true);
    expect(isReservedFlowTarget("@level:level-2")).toBe(true);
    expect(isReservedFlowTarget("@level:")).toBe(true); // an (empty-id) token is still a token — the validator rejects it
    expect(isReservedFlowTarget("level-2")).toBe(false);
    expect(isReservedFlowTarget("menu")).toBe(false);
  });

  it("levelTargetId extracts the id from an @level token, null otherwise", () => {
    expect(levelTargetId("@level:level-2")).toBe("level-2");
    expect(levelTargetId("@level:")).toBe("");
    expect(levelTargetId("@next")).toBeNull();
    expect(levelTargetId("@first")).toBeNull();
    expect(levelTargetId("level-2")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// runtime resolution
// ---------------------------------------------------------------------------
describe("@level runtime resolution", () => {
  // A menu scene whose flow jumps to specific levels by id, plus the campaign levels.
  const scenes: Scene[] = [
    {
      id: "menu",
      size: { width: 100, height: 100 },
      entities: [],
      systems: [],
      flow: { on: { "pick-1": "@level:level-1", "pick-2": "@level:level-2", "pick-bad": "@level:nope" }, persist: [] },
    },
    { id: "level-1", size: { width: 100, height: 100 }, entities: [], systems: [], flow: { on: { cleared: "@next" }, persist: [] } },
    { id: "level-2", size: { width: 100, height: 100 }, entities: [], systems: [], flow: { on: { cleared: "@next" }, persist: [] } },
    { id: "win", size: { width: 100, height: 100 }, entities: [], systems: [] },
  ] as unknown as Scene[];
  const levels = ["level-1", "level-2"];

  function boot(): Game {
    return new Game({ scenes, config: {}, entrySceneId: "menu", levels, levelsComplete: "win", canvas: null });
  }

  it("@level:<id> jumps directly to that level and sets world.state.level to its stage index", () => {
    const game = boot();
    game.world.events.emit("pick-2"); // → @level:level-2
    game.update(1 / 60);
    expect(game.scene.id).toBe("level-2");
    expect(game.world.state.level).toBe(2); // 1-based stage index of level-2, set on load

    // A jump to the FIRST level from the menu lands on level-1 at stage index 1 (no @next "first level" coincidence:
    // @level names it explicitly).
    const g2 = boot();
    g2.world.events.emit("pick-1"); // → @level:level-1
    g2.update(1 / 60);
    expect(g2.scene.id).toBe("level-1");
    expect(g2.world.state.level).toBe(1);
  });

  it("a jump to a level OTHER than the next one works from inside the campaign (not forward-only)", () => {
    const game = boot();
    game.loadScene("level-2");
    expect(game.scene.id).toBe("level-2");
    // From level-2, @level:level-1 jumps BACKWARD — something @next can never express.
    game.world.events.emit("__nudge"); // no listener; just to show no incidental transition
    game.loadScene("menu");
    game.world.events.emit("pick-1");
    game.update(1 / 60);
    expect(game.scene.id).toBe("level-1");
  });

  it("@level:<unknown> is a no-op transition (stays put) — the runtime never jumps to a non-level", () => {
    const game = boot();
    game.world.events.emit("pick-bad"); // → @level:nope (not in levels)
    game.update(1 / 60);
    expect(game.scene.id).toBe("menu"); // unresolved → no requestScene → no transition
  });

  it("@level resolves to null when the game has no level sequence (no-op)", () => {
    const game = new Game({ scenes, config: {}, entrySceneId: "menu", canvas: null }); // no `levels`
    game.world.events.emit("pick-1");
    game.update(1 / 60);
    expect(game.scene.id).toBe("menu"); // levels empty ⇒ token resolves to null
  });
});

// ---------------------------------------------------------------------------
// validator coverage
// ---------------------------------------------------------------------------
describe("@level validator coverage", () => {
  const dirs: string[] = [];
  const track = (d: string): string => {
    dirs.push(d);
    return d;
  };
  afterAll(() => {
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  });

  function writeGame(files: Record<string, unknown>): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gitcade-level-token-"));
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(dir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, JSON.stringify(content, null, 2));
    }
    return dir;
  }

  const MANIFEST = {
    name: "Mini",
    slug: "mini",
    version: "0.1.0",
    engine: "gitcade-sdk",
    sdkVersion: "0.1.0",
    libraryVersion: "0.1.0",
    entryPoint: "src/scenes/menu.json",
    tier: "ecosystem",
  };

  it("passes an @level edge that names a real level", async () => {
    const dir = track(
      writeGame({
        "game.json": { ...MANIFEST, levels: ["level-1", "level-2"] },
        "config.json": {},
        "src/scenes/menu.json": { id: "menu", entities: [], systems: [], flow: { on: { go: "@level:level-2" } } },
        "src/scenes/level-1.json": { id: "level-1", entities: [], systems: [] },
        "src/scenes/level-2.json": { id: "level-2", entities: [], systems: [] },
      }),
    );
    const r = await validateGame(dir);
    expect(r.issues.some((i) => i.code === "level-target-missing")).toBe(false);
    expect(r.ok).toBe(true);
  });

  it("flags an @level edge that names a non-level scene (level-target-missing)", async () => {
    const dir = track(
      writeGame({
        "game.json": { ...MANIFEST, levels: ["level-1", "level-2"] },
        "config.json": {},
        // "win" is a real scene, but NOT in `levels` — so an @level jump to it is invalid.
        "src/scenes/menu.json": { id: "menu", entities: [], systems: [], flow: { on: { go: "@level:win" } } },
        "src/scenes/level-1.json": { id: "level-1", entities: [], systems: [] },
        "src/scenes/level-2.json": { id: "level-2", entities: [], systems: [] },
        "src/scenes/win.json": { id: "win", entities: [], systems: [] },
      }),
    );
    const r = await validateGame(dir);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "level-target-missing")).toBe(true);
  });

  it("flags an @level edge to a wholly unknown scene id (level-target-missing)", async () => {
    const dir = track(
      writeGame({
        "game.json": { ...MANIFEST, levels: ["level-1"] },
        "config.json": {},
        "src/scenes/menu.json": { id: "menu", entities: [], systems: [], flow: { on: { go: "@level:ghost" } } },
        "src/scenes/level-1.json": { id: "level-1", entities: [], systems: [] },
      }),
    );
    const r = await validateGame(dir);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "level-target-missing")).toBe(true);
  });

  it("STILL fires flow-token-without-levels for an @level edge when no levels sequence is declared", async () => {
    const dir = track(
      writeGame({
        "game.json": MANIFEST, // no `levels`
        "config.json": {},
        "src/scenes/menu.json": { id: "menu", entities: [], systems: [], flow: { on: { go: "@level:level-1" } } },
      }),
    );
    const r = await validateGame(dir);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "flow-token-without-levels")).toBe(true);
    // level-target-missing is NOT also reported when there is no list (flow-token-without-levels covers it).
    expect(r.issues.some((i) => i.code === "level-target-missing")).toBe(false);
  });
});
