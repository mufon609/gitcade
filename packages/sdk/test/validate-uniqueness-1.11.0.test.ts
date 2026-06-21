import { describe, it, expect, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { SceneSchema } from "../src/schema/index.js";
import { checkUniqueIds, checkParams } from "../src/validate/rules.js";
import { validateGame } from "../src/validate/index.js";

/**
 * 1.11.0 — validator hardening. Three holes the per-file schema structurally cannot see:
 *  - duplicate SCENE ids (a whole scene silently dropped at runtime),
 *  - duplicate ENTITY ids within a scene (byId/parent/tag resolution collapses),
 *  - bare numeric ARRAYS smuggling balance past the structural-key whitelist,
 * plus two warning-only determinism source scans: wall-clock / Math.random, and (1.12.0) raw
 * cross-engine transcendentals (`Math.sin`/`pow`/`hypot`/… and the `**` operator) in sim source.
 */

const SHAPE = { kind: "shape", shape: "rect", color: "#fff" } as const;
const ent = (id: string, behaviors: unknown[] = []) => ({
  id,
  sprite: SHAPE,
  size: { w: 10, h: 10 },
  position: { x: 0, y: 0 },
  behaviors,
});
const scene = (id: string, entities: unknown[] = [], systems: unknown[] = []) =>
  SceneSchema.parse({ id, entities, systems });

describe("checkUniqueIds — duplicate scene ids", () => {
  it("flags two scenes sharing an id", () => {
    const issues = checkUniqueIds([scene("title", [ent("a")]), scene("title", [ent("b")])]);
    const dup = issues.filter((i) => i.code === "duplicate-scene-id");
    expect(dup).toHaveLength(1);
    expect(dup[0].level).toBe("error");
  });

  it("passes distinct scene ids", () => {
    expect(checkUniqueIds([scene("title"), scene("play")])).toHaveLength(0);
  });
});

describe("checkUniqueIds — duplicate entity ids within a scene", () => {
  it("flags two entities sharing an id in one scene", () => {
    const issues = checkUniqueIds([scene("main", [ent("ball"), ent("ball")])]);
    const dup = issues.filter((i) => i.code === "duplicate-entity-id");
    expect(dup).toHaveLength(1);
    expect(dup[0].level).toBe("error");
    expect(dup[0].message).toContain("ball");
  });

  it("allows the SAME entity id across DIFFERENT scenes (legitimate re-use / extends override)", () => {
    const issues = checkUniqueIds([scene("l1", [ent("player")]), scene("l2", [ent("player")])]);
    expect(issues).toHaveLength(0);
  });
});

describe("checkParams — array-aware no-magic-numbers", () => {
  const cfg = { speed: 100 };

  it("flags a bare numeric array under a whitelisted key (the smuggling vector)", () => {
    const s = scene("main", [ent("e", [{ type: "velocity", params: { offset: [50, 120, 9999] } }])]);
    const arr = checkParams([s], cfg).filter((i) => i.code === "magic-number-array");
    expect(arr.length).toBe(3); // every element flagged
    expect(arr[0].level).toBe("error");
  });

  it("does NOT flag numbers nested in an OBJECT array (waypoints) under whitelisted x/y", () => {
    const s = scene("main", [
      ent("e", [{ type: "follow-path", params: { path: [{ x: 1, y: 2 }, { x: 3, y: 4 }] } }]),
    ]);
    expect(checkParams([s], cfg)).toHaveLength(0);
  });

  it("still passes a $cfg reference and a scalar under a whitelisted key", () => {
    const s = scene("main", [ent("e", [{ type: "velocity", params: { vx: "$cfg.speed", offset: 4 } }])]);
    expect(checkParams([s], cfg)).toHaveLength(0);
  });
});

describe("determinism source scan (validateGame, warning-only)", () => {
  const MANIFEST = {
    name: "Mini",
    slug: "mini",
    version: "0.1.0",
    engine: "gitcade-sdk",
    sdkVersion: "0.1.0",
    entryPoint: "src/scenes/main.json",
    tier: "open",
  };
  const SCENE = { id: "main", entities: [], systems: [] };

  const dirs: string[] = [];
  const writeGame = (files: Record<string, unknown | string>): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gitcade-scan-"));
    dirs.push(dir);
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(dir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, typeof content === "string" ? content : JSON.stringify(content, null, 2));
    }
    return dir;
  };
  afterAll(() => {
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  });

  it("warns (does not fail publishability) on Math.random in a non-main sim source file", async () => {
    const dir = writeGame({
      "game.json": MANIFEST,
      "config.json": {},
      "src/scenes/main.json": SCENE,
      "src/custom-behaviors/index.ts": "export const r = () => Math.random();\n",
    });
    const res = await validateGame(dir);
    const scan = res.issues.filter((i) => i.code === "nondeterministic-source");
    expect(scan).toHaveLength(1);
    expect(scan[0].level).toBe("warning");
    expect(scan[0].where).toContain("custom-behaviors");
  });

  it("exempts main.ts host glue (Date.now is allowed there)", async () => {
    const dir = writeGame({
      "game.json": MANIFEST,
      "config.json": {},
      "src/scenes/main.json": SCENE,
      "src/main.ts": "export const t = Date.now();\n",
    });
    const res = await validateGame(dir);
    expect(res.issues.filter((i) => i.code === "nondeterministic-source")).toHaveLength(0);
  });

  it("warns (does not fail) on a raw transcendental Math.* in a non-main sim source file", async () => {
    const dir = writeGame({
      "game.json": MANIFEST,
      "config.json": {},
      "src/scenes/main.json": SCENE,
      "src/custom-behaviors/spin.ts":
        "export const spin = (e: any, _w: any, _p: any, dt: number) => { e.rotation = Math.sin(dt) + Math.atan2(e.vy, e.vx); };\n",
    });
    const res = await validateGame(dir);
    const scan = res.issues.filter((i) => i.code === "raw-transcendental");
    expect(scan).toHaveLength(1);
    expect(scan[0].level).toBe("warning");
    expect(scan[0].where).toContain("custom-behaviors");
    expect(res.ok).toBe(true); // advisory only — never blocks publish
  });

  it("flags the ** exponentiation operator (also implementation-approximated)", async () => {
    const dir = writeGame({
      "game.json": MANIFEST,
      "config.json": {},
      "src/scenes/main.json": SCENE,
      "src/custom-behaviors/curve.ts": "export const f = (x: number, k: number) => x ** k;\n",
    });
    const res = await validateGame(dir);
    expect(res.issues.filter((i) => i.code === "raw-transcendental")).toHaveLength(1);
  });

  it("does NOT flag correctly-rounded Math.sqrt or the spec-fixed Math.PI constant", async () => {
    const dir = writeGame({
      "game.json": MANIFEST,
      "config.json": {},
      "src/scenes/main.json": SCENE,
      "src/custom-behaviors/ok.ts":
        "export const d = (x: number, y: number) => Math.sqrt(x * x + y * y) * Math.PI * Math.abs(x);\n",
    });
    const res = await validateGame(dir);
    expect(res.issues.filter((i) => i.code === "raw-transcendental")).toHaveLength(0);
  });

  it("exempts main.ts host glue (a raw transcendental is allowed there)", async () => {
    const dir = writeGame({
      "game.json": MANIFEST,
      "config.json": {},
      "src/scenes/main.json": SCENE,
      "src/main.ts": "export const f = Math.cos(1.23);\n",
    });
    const res = await validateGame(dir);
    expect(res.issues.filter((i) => i.code === "raw-transcendental")).toHaveLength(0);
  });
});
