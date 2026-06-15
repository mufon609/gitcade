/**
 * ACCEPTANCE PROBE — G1 (data-driven scene flow + state hand-off).  [SDK-0.2.0-DESIGN.md §G1]
 *
 * STATUS: FAILS on 0.1.x (by design). Flips to PASS once sdk@0.2.0 lands
 *   `world.requestScene` + `flow` edges + persist-on-loadScene.
 *
 * Asserts (after 0.2.0):
 *  (a) a part can call `world.requestScene("two", { keep:["gold"] })` and, after
 *      the host loop drains the queue, the active scene is "two";
 *  (b) `world.state.gold` (seeded in scene "one" via `currency`) SURVIVES the
 *      transition because it was in the keep/persist set;
 *  (c) a `flow.on` event edge ("go-two" → "two") transitions without host JS.
 *
 * On 0.1.x: `world.requestScene` is absent and host `loadScene` WIPES state, so
 * this probe's apiSurface() shows `world.requestScene:false` and any forced
 * transition loses `gold` — the documented baseline (out-01-scene-transition.json).
 */
const manifest = {
  name: "FlowG1", slug: "flowg1", version: "1.0.0",
  engine: "gitcade-sdk", sdkVersion: "0.2.0", entryPoint: "one.json", tier: "open",
};
const config = {};

const sceneOne = {
  id: "one",
  size: { width: 300, height: 200 },
  background: "#102010",
  entities: [
    { id: "label", sprite: { kind: "text", text: "ONE", color: "#fff" }, position: { x: 20, y: 20 } },
  ],
  systems: [{ type: "currency", params: { currencyKey: "gold", startAmount: 100 } }],
  // 0.2.0 additive: leaving "one" on event "go-two" → "two", carrying gold.
  flow: { on: { "go-two": "two" }, persist: ["gold"] },
};
const sceneTwo = {
  id: "two",
  size: { width: 300, height: 200 },
  background: "#201010",
  entities: [
    { id: "label2", sprite: { kind: "text", text: "TWO", color: "#fff" }, position: { x: 20, y: 20 } },
  ],
  systems: [],
};

export default {
  sources: { manifest, config, scenes: [sceneOne, sceneTwo] },
  actions: [
    { step: 10, label: "after-10-frames (gold seeded ~100)" },
    // PASS target: requestScene present on the part-facing surface.
    { eval: "() => window.__GC.apiSurface()", label: "api-surface (world.requestScene present?)" },
    // PASS target: request from data, drain via host loop, gold preserved.
    { eval: "() => window.__GC.requestScene && window.__GC.requestScene('two', ['gold'])", label: "requestScene-two-keep-gold" },
    { step: 2, label: "after-drain (scene==two, gold preserved?)" },
    { eval: "() => window.__GC.info()", label: "scene-id-now (expect two)" },
  ],
};
