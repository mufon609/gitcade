/**
 * Survival Arena difficulty-scaling regression (swarm-scale → two scale-by-state
 * instances). Boots title → play, reads enemy speed magnitude + spawn hp at level 1,
 * then forces level 8 and reads the ramped speed (multiply, every tick) and a freshly
 * spawned enemy's hp (once, at spawn).
 */
export default {
  slug: "survival-arena",
  actions: [
    { emit: "start-pressed", label: "to-play" },
    { step: 90, label: "spawned-lvl1" },
    {
      eval:
        "() => { const en = window.__GC.entityStates('enemy'); const sp = en.map(e=>e.speed).filter(v=>v>0); const hps = en.map(e=>e.state.hp); return { scene: window.__GC.scene(), level: window.__GC.state().level, count: en.length, speedMax: sp.length?Math.max(...sp):0, hps }; }",
      label: "lvl1",
    },
    { eval: "() => window.__GC.setState('level', 8)", label: "force-8" },
    { step: 40, label: "after-force" },
    {
      eval:
        "() => { const en = window.__GC.entityStates('enemy'); const sp = en.map(e=>e.speed).filter(v=>v>0); const hps = en.map(e=>e.state.hp); return { scene: window.__GC.scene(), level: window.__GC.state().level, count: en.length, speedMax: sp.length?Math.max(...sp):0, hpsMax: hps.length?Math.max(...hps):0, hps }; }",
      label: "lvl8",
    },
  ],
};
