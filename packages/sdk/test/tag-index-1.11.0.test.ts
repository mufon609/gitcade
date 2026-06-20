import { describe, it, expect } from "vitest";
import { World, Entity, createDefaultRegistry, type Sprite } from "../src/index.js";

/**
 * 1.11.0 — the tag index behind `query`/`nearest`/`entityAt`. The primitives now read a
 * `Map<tag, Entity[]>` bucket (O(matches)) instead of scanning every entity, but must stay
 * BYTE-IDENTICAL to the old full scan — same set, same ORDER, same distance/topmost tie-breaks —
 * or replays/ghosts/determinism break. These tests pin that against an independent reimplementation
 * of the pre-index logic, across spawn/mid-tick-destroy/prune churn and a scene reset.
 */
const NONE: Sprite = { kind: "none" };

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeWorld(): World {
  return new World({ bounds: { width: 800, height: 600 }, config: {}, registry: createDefaultRegistry() });
}

// ---- Independent reimplementations of the PRE-INDEX logic (the byte-identical reference) ----
function naiveQuery(w: World, tag: string): Entity[] {
  return w.entities.filter((e) => e.alive && e.hasTag(tag));
}
function naiveNearest(w: World, from: Entity, tag: string): Entity | undefined {
  let best: Entity | undefined;
  let bestD = Infinity;
  for (const e of w.entities) {
    if (!e.alive || e === from || !e.hasTag(tag)) continue;
    const dx = e.cx - from.cx;
    const dy = e.cy - from.cy;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}
function naiveEntityAt(w: World, x: number, y: number, tag?: string): Entity | undefined {
  let best: Entity | undefined;
  for (const e of w.entities) {
    if (!e.alive) continue;
    if (tag !== undefined && !e.hasTag(tag)) continue;
    if (x >= e.x && x <= e.x + e.w && y >= e.y && y <= e.y + e.h) {
      if (!best || e.layer > best.layer || (e.layer === best.layer && e.zIndex >= best.zIndex)) best = e;
    }
  }
  return best;
}

const TAGS = ["a", "b", "c"];
function assertMatchesNaive(w: World): void {
  for (const tag of [...TAGS, "absent"]) {
    expect(w.query(tag).map((e) => e.id)).toEqual(naiveQuery(w, tag).map((e) => e.id));
  }
  // nearest: from a few probe points, against each tag
  for (const from of w.entities.slice(0, 5)) {
    for (const tag of [...TAGS, "absent"]) {
      expect(w.nearest(from, tag)?.id).toBe(naiveNearest(w, from, tag)?.id);
    }
  }
  // entityAt: a grid of probe points, tagged + untagged
  for (let px = 0; px <= 800; px += 53) {
    for (let py = 0; py <= 600; py += 61) {
      expect(w.entityAt(px, py)?.id).toBe(naiveEntityAt(w, px, py)?.id);
      for (const tag of TAGS) expect(w.entityAt(px, py, tag)?.id).toBe(naiveEntityAt(w, px, py, tag)?.id);
    }
  }
}

let uid = 0;
function spawn(w: World, r: () => number): Entity {
  // overlapping boxes + repeated layer/zIndex so entityAt's topmost tie-break is actually exercised
  const e = new Entity({
    id: `e${uid++}`,
    x: Math.floor(r() * 760),
    y: Math.floor(r() * 560),
    w: 40 + Math.floor(r() * 60),
    h: 40 + Math.floor(r() * 60),
    layer: Math.floor(r() * 3),
    zIndex: Math.floor(r() * 3),
    sprite: NONE,
    tags: r() < 0.85 ? [TAGS[Math.floor(r() * TAGS.length)]!] : [],
  });
  return w.add(e);
}

describe("World tag index — query/nearest/entityAt", () => {
  it("matches the naive scan across spawn / mid-tick destroy / prune churn", () => {
    const w = makeWorld();
    const r = mulberry32(0xa11ce);
    for (let i = 0; i < 120; i++) spawn(w, r);
    assertMatchesNaive(w);

    // Destroy a scattered third WITHOUT pruning — buckets still hold them; readers must filter `alive`.
    w.entities.forEach((e, i) => {
      if (i % 3 === 0) w.destroy(e);
    });
    assertMatchesNaive(w);

    // Spawn more while dead-but-unpruned entities still sit in the buckets (mid-tick churn).
    for (let i = 0; i < 40; i++) spawn(w, r);
    assertMatchesNaive(w);

    // Prune rebuilds both indexes from survivors in array order; order must stay identical.
    w.prune();
    assertMatchesNaive(w);
    expect(w.entities.every((e) => e.alive)).toBe(true);

    // Another churn round after the rebuild.
    for (let i = 0; i < 30; i++) spawn(w, r);
    w.entities.forEach((e, i) => {
      if (i % 5 === 0) w.destroy(e);
    });
    w.prune();
    assertMatchesNaive(w);
  });

  it("buckets stay a same-order subsequence of entities (query order == entities order)", () => {
    const w = makeWorld();
    const r = mulberry32(7);
    for (let i = 0; i < 60; i++) spawn(w, r);
    w.entities.filter((_, i) => i % 4 === 0).forEach((e) => w.destroy(e));
    w.prune();
    for (let i = 0; i < 25; i++) spawn(w, r);
    for (const tag of TAGS) {
      const fromIndex = w.entities.filter((e) => e.alive && e.hasTag(tag)).map((e) => e.id);
      expect(w.query(tag).map((e) => e.id)).toEqual(fromIndex);
    }
  });

  it("resetEntities clears entities + both indexes (no cross-scene tag leak)", () => {
    const w = makeWorld();
    const a = w.add(new Entity({ id: "old", x: 0, y: 0, w: 10, h: 10, layer: 0, sprite: NONE, tags: ["a"] }));
    expect(w.query("a").map((e) => e.id)).toEqual(["old"]);
    expect(w.byId("old")).toBe(a);

    w.resetEntities();
    expect(w.entities).toEqual([]);
    expect(w.query("a")).toEqual([]);
    expect(w.nearest(a, "a")).toBeUndefined();
    expect(w.entityAt(5, 5, "a")).toBeUndefined();
    expect(w.byId("old")).toBeUndefined();

    // The new scene's entities are the only ones visible.
    w.add(new Entity({ id: "new", x: 0, y: 0, w: 10, h: 10, layer: 0, sprite: NONE, tags: ["a"] }));
    expect(w.query("a").map((e) => e.id)).toEqual(["new"]);
  });

  it("nearest is O(target-tag) — a 1-member target is unaffected by scene population", () => {
    // Pure behavior pin (not a timing test): the bucket-scan returns exactly the lone target
    // regardless of how many untagged-by-it entities exist.
    const w = makeWorld();
    const r = mulberry32(123);
    const chaser = w.add(new Entity({ id: "chaser", x: 400, y: 300, w: 20, h: 20, layer: 0, sprite: NONE, tags: ["hunter"] }));
    const target = w.add(new Entity({ id: "target", x: 100, y: 100, w: 20, h: 20, layer: 0, sprite: NONE, tags: ["player"] }));
    for (let i = 0; i < 500; i++) spawn(w, r); // 500 irrelevant entities
    expect(w.nearest(chaser, "player")).toBe(target);
    expect(w.nearest(chaser, "player")?.id).toBe(naiveNearest(w, chaser, "player")?.id);
  });

  it("twice-run determinism: spawn/destroy churn is byte-identical run-to-run", () => {
    // Snapshot the index-visible state (query order per tag) after a scripted churn; two runs of the
    // SAME script must produce identical sequences — the index introduces no ordering entropy.
    const run = (): string => {
      uid = 0; // identical ids across runs
      const w = makeWorld();
      const r = mulberry32(0xbead);
      const log: string[] = [];
      for (let step = 0; step < 30; step++) {
        if (r() < 0.6) spawn(w, r);
        if (r() < 0.3 && w.entities.length) w.destroy(w.entities[Math.floor(r() * w.entities.length)]!);
        if (step % 4 === 3) w.prune();
        log.push(TAGS.map((t) => w.query(t).map((e) => e.id).join(",")).join("|"));
      }
      return log.join("\n");
    };
    expect(run()).toBe(run());
  });
});
