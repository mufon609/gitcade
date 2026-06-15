/**
 * Idle Clicker persistence + core-loop regression. With persistentStorage the boot
 * storage survives a reboot() (same as a real reload in the same slot).
 *
 * Flow: start → play → tap the coin to earn → buy a click upgrade → let auto-income
 * tick → record coins/clickPower/autoRate/upgrades/prestigeMult, force a save, then
 * REBOOT and walk title → play again and confirm the economy restored (NOT reset to
 * the seed). This is the 0.2.1 collapse acceptance: persistence on the play scene
 * (claim-before-seed) must restore a system-seeded key across a reload.
 */
const tapCoin = (n) => {
  const a = [];
  for (let i = 0; i < n; i++) a.push({ click: { x: 400, y: 300 }, holdFrames: 1, sample: false }, { step: 1, sample: false });
  return a;
};

export default {
  slug: "idle-clicker",
  persistentStorage: true,
  actions: [
    { emit: "start-pressed", label: "to-play" },
    { step: 2, label: "play-seeded" },
    ...tapCoin(40),
    // Buy the click-power upgrade (request flag the shop button would set).
    { eval: "() => window.__GC.setState('upgradeRequest', 'click')", label: "buy-click-upg" },
    { step: 2, label: "after-upg" },
    ...tapCoin(40),
    { eval: "() => window.__GC.setState('upgradeRequest', 'cursor')", label: "buy-cursor-upg" },
    { step: 2, label: "after-cursor" },
    ...tapCoin(20),
    { step: 120, label: "let-auto-tick" },
    {
      eval:
        "() => { const s = window.__GC.state(); return { coins: Math.round(s.coins), clickPower: s.clickPower, autoRate: s.autoRate, upgrades: s.upgrades, prestigeMult: s.prestigeMult }; }",
      label: "before-reload",
    },
    // Let the everySeconds:5 autosave fire (or change-based save already did).
    { step: 320, label: "settle-save" },
    {
      eval: "() => { const s = window.__GC.state(); return { coins: Math.round(s.coins), clickPower: s.clickPower, autoRate: s.autoRate, upgrades: s.upgrades }; }",
      label: "pre-reboot-snapshot",
    },
    // RELOAD: reboot keeps the shared storage adapter.
    { reboot: true, label: "reboot" },
    { step: 2, label: "post-reboot-title" },
    { emit: "start-pressed", label: "reboot-to-play" },
    { step: 6, label: "post-reboot-play" },
    {
      eval:
        "() => { const s = window.__GC.state(); return { scene: window.__GC.scene(), coins: Math.round(s.coins||0), clickPower: s.clickPower, autoRate: s.autoRate, upgrades: s.upgrades, prestigeMult: s.prestigeMult }; }",
      label: "restored",
    },
  ],
};
