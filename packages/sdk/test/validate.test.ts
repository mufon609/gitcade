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
});
