import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { validateGame } from "../src/validate/index.js";

/**
 * Build a throwaway game directory on disk for the validator to inspect. Returns
 * the dir; caller cleans up.
 */
function writeGame(files: Record<string, unknown | string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gitcade-validate-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, typeof content === "string" ? content : JSON.stringify(content, null, 2));
  }
  return dir;
}

const GOOD_MANIFEST = {
  name: "Mini",
  slug: "mini",
  version: "0.1.0",
  engine: "gitcade-sdk",
  sdkVersion: "0.1.0",
  libraryVersion: "0.1.0",
  entryPoint: "src/scenes/main.json",
  tier: "ecosystem",
};

describe("validateGame", () => {
  const dirs: string[] = [];
  const track = (d: string) => {
    dirs.push(d);
    return d;
  };
  afterAll(() => {
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  });

  it("passes a minimal valid ecosystem game", async () => {
    const dir = track(
      writeGame({
        "game.json": GOOD_MANIFEST,
        "config.json": { speed: 100 },
        "src/scenes/main.json": {
          id: "main",
          entities: [
            {
              id: "ball",
              sprite: { kind: "shape", shape: "circle", color: "#fff" },
              size: { w: 10, h: 10 },
              position: { x: 10, y: 10 },
              behaviors: [{ type: "velocity", params: { vx: "$cfg.speed" } }],
            },
          ],
          systems: [],
        },
      }),
    );
    const r = await validateGame(dir);
    expect(r.ok).toBe(true);
    expect(r.framesRun).toBe(60);
  });

  it("fails a magic number in behavior params", async () => {
    const dir = track(
      writeGame({
        "game.json": GOOD_MANIFEST,
        "config.json": {},
        "src/scenes/main.json": {
          id: "main",
          entities: [
            {
              id: "ball",
              sprite: { kind: "none" },
              size: { w: 10, h: 10 },
              position: { x: 0, y: 0 },
              behaviors: [{ type: "velocity", params: { vx: 250 } }],
            },
          ],
          systems: [],
        },
      }),
    );
    const r = await validateGame(dir);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "magic-number")).toBe(true);
  });

  it("fails an unresolved $cfg reference", async () => {
    const dir = track(
      writeGame({
        "game.json": GOOD_MANIFEST,
        "config.json": {},
        "src/scenes/main.json": {
          id: "main",
          entities: [
            {
              id: "ball",
              sprite: { kind: "none" },
              size: { w: 10, h: 10 },
              position: { x: 0, y: 0 },
              behaviors: [{ type: "velocity", params: { vx: "$cfg.missing" } }],
            },
          ],
          systems: [],
        },
      }),
    );
    const r = await validateGame(dir);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "unresolved-cfg")).toBe(true);
  });

  it("fails an ecosystem game touching raw localStorage", async () => {
    const dir = track(
      writeGame({
        "game.json": GOOD_MANIFEST,
        "config.json": { speed: 1 },
        "src/scenes/main.json": {
          id: "main",
          entities: [],
          systems: [],
        },
        "src/custom-behaviors/index.ts": "export const x = () => { localStorage.setItem('a','b'); };",
      }),
    );
    const r = await validateGame(dir);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "raw-storage")).toBe(true);
  });

  it("fails an invalid manifest (range sdkVersion)", async () => {
    const dir = track(
      writeGame({
        "game.json": { ...GOOD_MANIFEST, sdkVersion: "^0.1.0" },
        "config.json": {},
        "src/scenes/main.json": { id: "main", entities: [], systems: [] },
      }),
    );
    const r = await validateGame(dir);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "schema")).toBe(true);
  });

  it("fails a part reference with no installed catalog", async () => {
    const dir = track(
      writeGame({
        "game.json": GOOD_MANIFEST,
        "config.json": {},
        "src/scenes/main.json": {
          id: "main",
          entities: [
            {
              id: "e",
              sprite: { kind: "none" },
              size: { w: 1, h: 1 },
              position: { x: 0, y: 0 },
              part: "enemy-chaser@1.0.0",
              behaviors: [],
            },
          ],
          systems: [],
        },
      }),
    );
    const r = await validateGame(dir);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "catalog-unavailable")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // cross-scene reference integrity
  // -------------------------------------------------------------------------
  it("fails a flow.on target that names a missing scene", async () => {
    const dir = track(
      writeGame({
        "game.json": GOOD_MANIFEST,
        "config.json": {},
        "src/scenes/main.json": {
          id: "main",
          entities: [],
          systems: [],
          flow: { on: { go: "nowhere" } },
        },
      }),
    );
    const r = await validateGame(dir);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "flow-target-missing")).toBe(true);
  });

  it("fails an extends target that names a missing scene", async () => {
    const dir = track(
      writeGame({
        "game.json": GOOD_MANIFEST,
        "config.json": {},
        "src/scenes/main.json": { id: "main", entities: [], systems: [], extends: "ghost" },
      }),
    );
    const r = await validateGame(dir);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "extends-target-missing")).toBe(true);
  });

  it("fails a manifest levels entry that names a missing scene", async () => {
    const dir = track(
      writeGame({
        "game.json": { ...GOOD_MANIFEST, levels: ["main", "level-9"] },
        "config.json": {},
        "src/scenes/main.json": { id: "main", entities: [], systems: [] },
      }),
    );
    const r = await validateGame(dir);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "level-scene-missing")).toBe(true);
  });

  it("fails an entryPoint that does not resolve to a scene id", async () => {
    const dir = track(
      writeGame({
        "game.json": { ...GOOD_MANIFEST, entryPoint: "src/scenes/typo.json" },
        "config.json": {},
        "src/scenes/main.json": { id: "main", entities: [], systems: [] },
      }),
    );
    const r = await validateGame(dir);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "entry-scene-missing")).toBe(true);
  });

  it("fails a reserved flow token when no levels sequence is declared", async () => {
    const dir = track(
      writeGame({
        "game.json": GOOD_MANIFEST,
        "config.json": {},
        "src/scenes/main.json": { id: "main", entities: [], systems: [], flow: { on: { go: "@next" } } },
      }),
    );
    const r = await validateGame(dir);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "flow-token-without-levels")).toBe(true);
  });

  it("passes a valid extends + levels + @next campaign", async () => {
    const dir = track(
      writeGame({
        "game.json": {
          ...GOOD_MANIFEST,
          entryPoint: "src/scenes/title.json",
          levels: ["level-1", "level-2"],
          levelsComplete: "win",
        },
        "config.json": { speed: 100 },
        "src/scenes/title.json": { id: "title", entities: [], systems: [], flow: { on: { start: "@next" } } },
        "src/scenes/base.json": {
          id: "base",
          entities: [
            {
              id: "ball",
              sprite: { kind: "none" },
              size: { w: 10, h: 10 },
              position: { x: 10, y: 10 },
              behaviors: [{ type: "velocity", params: { vx: "$cfg.speed" } }],
            },
          ],
          systems: [],
          flow: { on: { cleared: "@next" } },
        },
        "src/scenes/level-1.json": { id: "level-1", extends: "base", entities: [] },
        "src/scenes/level-2.json": { id: "level-2", extends: "base", entities: [] },
        "src/scenes/win.json": { id: "win", entities: [], systems: [] },
      }),
    );
    const r = await validateGame(dir);
    expect(r.ok).toBe(true);
    expect(r.framesRun).toBe(60);
  });
});
