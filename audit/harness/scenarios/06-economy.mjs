/**
 * PROBE 7 — economy / transactions.
 *
 * Question: is there a "can I afford → deduct → do" primitive beyond
 * `upgrade-tree`'s request flag? Is `currency` purely passive?
 *
 * Method: run the `currency` system with startAmount 50 and passiveIncome 10/s.
 * Observe that the balance simply accrues over time (passive accumulator) and that
 * the API surface exposes no `world.spend` / `world.canAfford`. To "buy" something
 * a game must read+compare+write `world.state[key]` itself (or route through
 * upgrade-tree's single request flag).
 *
 * Expected: gold rises by ~10/s; no spend/canAfford primitive on world.
 */
const manifest = {
  name: "Economy", slug: "economy", version: "1.0.0",
  engine: "gitcade-sdk", sdkVersion: "0.1.1", entryPoint: "main.json", tier: "open",
};
const config = {};

const scene = {
  id: "main",
  size: { width: 200, height: 120 },
  background: "#0b0b12",
  entities: [
    { id: "hud", sprite: { kind: "text", bind: "gold", color: "#fff" }, position: { x: 10, y: 10 } },
  ],
  systems: [
    { type: "currency", params: { currencyKey: "gold", startAmount: 50, passiveIncome: 10 } },
  ],
};

export default {
  sources: { manifest, config, scenes: [scene] },
  actions: [
    { eval: "() => window.__GC.apiSurface()", label: "api-surface (spend? canAfford?)" },
    { step: 60, label: "t+1s (gold ~60?)" },
    { step: 120, label: "t+3s (gold ~80?)" },
  ],
};
