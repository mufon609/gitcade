/**
 * ACCEPTANCE PROBE — G6 (cross-scene / cross-run persistence).  [SDK-0.2.0-DESIGN.md §G6]
 *
 * STATUS: FAILS on 0.1.x. Flips to PASS once sdk@0.2.0 adds the declarative
 *   `persist` binding (manifest) + a `persistence` system that round-trips named
 *   world.state keys through the EXISTING storage bridge (no host JS, no protocol
 *   change).
 *
 * Asserts (after 0.2.0):
 *  (a) a declared persisted key ("best") set during a run is written via
 *      world.storage and RESTORED after a re-boot using the same storage adapter;
 *  (b) a non-declared key ("scratch") is NOT restored.
 *
 * NOTE for the harness implementer: this probe needs a storage adapter that
 * survives a re-boot (a shared in-memory KV passed to both boots). The current
 * entry.mjs boots a fresh MemoryStorage each time; Stage 3b should add a
 * `bootOpts.persistentStorage` hook so the adapter is shared across boots. Until
 * then this stays a documented FAIL/target.
 */
const manifest = {
  name: "PersistG6", slug: "persistg6", version: "1.0.0",
  engine: "gitcade-sdk", sdkVersion: "0.2.0", entryPoint: "main.json", tier: "open",
  // 0.2.0 additive (per OQ-6, cross-run save lives on the manifest):
  persist: { keys: ["best"], slot: "save", everySeconds: 0 },
};
const config = {};

const scene = {
  id: "main",
  size: { width: 200, height: 120 },
  background: "#0b0b12",
  entities: [
    { id: "hud", sprite: { kind: "text", bind: "best", color: "#fff" }, position: { x: 10, y: 10 } },
  ],
  // 0.2.0 additive: the persistence system reads manifest.persist and round-trips.
  systems: [{ type: "persistence" }],
};

export default {
  // bootOpts.persistentStorage: a Stage-3b harness hook to share the KV across boots.
  sources: { manifest, config, scenes: [scene] },
  bootOpts: { persistentStorage: true },
  actions: [
    { eval: "() => window.__GC.setState && window.__GC.setState('best', 4242)", label: "set persisted key best=4242" },
    { eval: "() => window.__GC.setState && window.__GC.setState('scratch', 7)", label: "set non-persisted key scratch=7" },
    { step: 5, label: "let persistence flush to storage" },
    // Re-boot the SAME sources with the SAME storage adapter (Stage-3b hook).
    { eval: "() => window.__GC.reboot && window.__GC.reboot()", label: "reboot (simulate reload)" },
    { step: 2, label: "after reboot — best restored (4242), scratch absent?" },
    { eval: "() => window.__GC.state()", label: "state after reboot (expect best=4242, no scratch)" },
  ],
};
