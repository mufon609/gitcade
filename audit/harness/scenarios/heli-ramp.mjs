/**
 * Helicopter regression: (1) obstacles spawn across multiple heights (the headline
 * "only at the top" complaint), and (2) the difficulty ramp climbs the obstacle
 * scroll speed with the live `level` counter (the scroll-ramp → scale-by-state swap).
 * Uses the closed-loop fly() autopilot to keep the chopper alive while sampling.
 */
export default {
  slug: "helicopter",
  actions: [
    { emit: "start-pressed", label: "to-play" },
    // Fly ~5s, polling obstacle heights each short hop so we accumulate the set.
    { eval: "() => { const seen = new Set(); for (let i=0;i<30;i++){ window.__GC.fly(10, 300); window.__GC.entities().filter(e=>e.tags.includes('obstacle')).forEach(o=>seen.add(Math.round(o.y))); if (window.__GC.scene()!=='play') break; } return { scene: window.__GC.scene(), distinctYs: [...seen].sort((a,b)=>a-b) }; }", label: "obstacle-heights" },
    // Read the level-1 obstacle scroll speed.
    { eval: "() => { const ob = window.__GC.entities().filter(e=>e.tags.includes('obstacle')); return { level: window.__GC.state().level, vxs: [...new Set(ob.map(o=>Math.round(o.vx)))] }; }", label: "lvl1-speed" },
    // Force level high; one tick lets scale-by-state re-force vx; read ramped speed.
    { eval: "() => { window.__GC.setState('level', 8); window.__GC.fly(2, 300); const ob = window.__GC.entities().filter(e=>e.tags.includes('obstacle')); return { scene: window.__GC.scene(), level: window.__GC.state().level, vxs: [...new Set(ob.map(o=>Math.round(o.vx)))] }; }", label: "lvl8-speed" },
  ],
};
