/**
 * PROBE 1 — Scenes / levels / progression.
 *
 * Questions:
 *  (a) Can a data-driven part (behavior/system) reach a scene switch at runtime?
 *      → check the API surface a part actually sees (`world`), and whether
 *        `loadScene` is reachable from there.
 *  (b) Does switching scenes preserve or wipe `world.state`?
 *      → seed state via the `currency` system, then call `game.loadScene("two")`
 *        (the host-only path) and compare state before/after.
 *
 * Two scenes; scene "one" runs `currency` (startAmount 100) so world.state.gold
 * becomes a non-zero number we can watch survive (or not) a transition.
 */
const manifest = {
  name: "SceneXfer", slug: "scenexfer", version: "1.0.0",
  engine: "gitcade-sdk", sdkVersion: "0.1.1", entryPoint: "one.json", tier: "open",
};
const config = {};

const sceneOne = {
  id: "one",
  size: { width: 300, height: 200 },
  background: "#102010",
  entities: [
    { id: "label", sprite: { kind: "text", text: "SCENE ONE", color: "#fff" }, position: { x: 20, y: 20 } },
  ],
  systems: [
    { type: "currency", params: { currencyKey: "gold", startAmount: 100 } },
  ],
};
const sceneTwo = {
  id: "two",
  size: { width: 300, height: 200 },
  background: "#201010",
  entities: [
    { id: "label2", sprite: { kind: "text", text: "SCENE TWO", color: "#fff" }, position: { x: 20, y: 20 } },
  ],
  systems: [],
};

export default {
  sources: { manifest, config, scenes: [sceneOne, sceneTwo] },
  actions: [
    { step: 10, label: "after-10-frames (gold seeded)" },
    // Probe the API surface a part can reach (is scene-switch data-driven?).
    { eval: "() => window.__GC.apiSurface()", label: "api-surface" },
    // Attempt the transition via the host-only Game.loadScene and capture state delta.
    { eval: "() => window.__GC.tryLoadScene('two')", label: "tryLoadScene-two" },
    { step: 5, label: "after-transition" },
  ],
};
