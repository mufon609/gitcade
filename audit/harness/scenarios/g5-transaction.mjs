/**
 * ACCEPTANCE PROBE — G5 (economy transaction primitive).  [SDK-0.2.0-DESIGN.md §G5]
 *
 * STATUS: FAILS on 0.1.x. Flips to PASS once library@0.2.0 adds the generic
 *   `transaction` system (afford → deduct → emit), optionally backed by
 *   world.canAfford/world.spend (OQ-2).
 *
 * Baseline (0.1.x, out-06-economy.json): currency is a passive accumulator;
 *   world.spend:false, world.canAfford:false.
 *
 * Asserts (after 0.2.0):
 *  (a) an AFFORDABLE request (cost 30 against gold 50) deducts to 20 and emits
 *      "purchased";
 *  (b) an UNAFFORDABLE request (cost 999) leaves the balance unchanged and emits
 *      "purchase-denied" (reason insufficient-funds).
 */
const manifest = {
  name: "TxnG5", slug: "txng5", version: "1.0.0",
  engine: "gitcade-sdk", sdkVersion: "0.2.0", libraryVersion: "0.2.0",
  entryPoint: "main.json", tier: "ecosystem",
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
    { type: "currency", params: { currencyKey: "gold", startAmount: 50, passiveIncome: 0 } },
    // 0.2.0 additive: generic transaction consuming world.state.purchaseRequest.
    {
      type: "transaction",
      params: { currencyKey: "gold", requestKey: "purchaseRequest", onOk: "purchased", onDenied: "purchase-denied" },
    },
  ],
};

export default {
  sources: { manifest, config, scenes: [scene] },
  actions: [
    { eval: "() => window.__GC.apiSurface()", label: "api-surface (spend/canAfford or transaction present?)" },
    { step: 2, label: "t0 (gold == 50)" },
    // Affordable buy: set request, step once to let the system consume it.
    { eval: "() => window.__GC.setState && window.__GC.setState('purchaseRequest', { id: 'thing', cost: 30 })", label: "request affordable (cost 30)" },
    { step: 1, label: "after affordable (expect gold 20, 'purchased')" },
    // Unaffordable buy.
    { eval: "() => window.__GC.setState && window.__GC.setState('purchaseRequest', { id: 'big', cost: 999 })", label: "request unaffordable (cost 999)" },
    { step: 1, label: "after unaffordable (expect gold 20, 'purchase-denied')" },
  ],
};
