import type { Registry, SystemFn } from "@gitcade/sdk";
import { num, str } from "@gitcade/sdk";

/**
 * Idle Clicker's custom economy. The action-game library doesn't cover the idle
 * loop, so these small systems do — each fully param-driven (every balance value a
 * `$cfg` from config.json, so the game keeps 100% of its balance in config.json)
 * and each poll/tick-based with NO event listeners, so a restart (which clears
 * `world.state` but not the event bus) can never double-count.
 * Logged in games/LIBRARY-GAPS.md as generalization candidates.
 *
 * 0.2.0 ADOPTION: `click-to-earn` now reads the SDK's G2 pointer-click EDGE
 * (`world.input.justReleased()` + `world.entityAt`) directly, so the host
 * `pointerdown` listener that used to increment `world.state.clicks` is GONE — the
 * click is data. Purchases route through the library `upgrade-tree` (the G5 fixed-
 * catalog economy primitive: afford → deduct → effect). Value persistence is
 * declarative (`manifest.persist` + the library `persistence` system). The only
 * thing still custom is this idle-economy trio + a tiny `prestige` reset system.
 */

/**
 * `click-to-earn` — award coins for each tap on the coin button. Polls the SDK's
 * one-frame click EDGE (`world.input.justReleased()`, G2) and pays `clickPower`
 * per tap that lands on an entity tagged `targetTag` (`world.entityAt`, G2), scaled
 * by the prestige multiplier (`multKey`, default 1) so prestige raises ALL income
 * (IC-1). No host listener, no `clicks` counter — the click is pure data now.
 * Params: `coinsKey`, `targetTag`, `powerKey`, `basePower` ($cfg), `multKey`, `tapEvent`.
 */
export const clickToEarn: SystemFn = (world, params) => {
  const coinsKey = str(params, "coinsKey", "coins");
  const targetTag = str(params, "targetTag", "coin-button");
  const powerKey = str(params, "powerKey", "clickPower");
  const multKey = str(params, "multKey", "prestigeMult");
  const tapEvent = str(params, "tapEvent", "click");

  // Seed the per-click power once (so prestige/reset restores a clean base).
  // 0.2.1 (G6 race fix): DEFER the seed while a persistence load owns this key
  // (`world.isPersistPending`), so collapsing persistence onto the play scene
  // restores a saved clickPower instead of the tick-1 seed clobbering it — the
  // same deferral the library `currency` system uses. No claim ⇒ a no-op (0.2.0
  // behavior, additive).
  if (!world.isPersistPending(powerKey) && typeof world.state[powerKey] !== "number") {
    world.state[powerKey] = num(params, "basePower", 1);
  }

  // Count taps this frame that landed on the coin (topmost pick), remembering the
  // last hit point so feedback can be LOCAL — a particle burst at the cursor instead
  // of a full-screen flash (IC-FX; clicking is the highest-frequency action in the game).
  let taps = 0;
  let lastX = 0;
  let lastY = 0;
  for (const t of world.input.justReleased()) {
    const hit = world.entityAt(t.x, t.y);
    if (hit && hit.hasTag(targetTag)) {
      taps++;
      lastX = t.x;
      lastY = t.y;
    }
  }
  if (taps === 0) return;

  const per = (world.state[powerKey] as number) ?? 1;
  const mult = (world.state[multKey] as number) ?? 1;
  world.state[coinsKey] = ((world.state[coinsKey] as number) ?? 0) + taps * per * mult;
  // Feedback (sound + a juice event carrying the tap point so a `sparkle` FX system
  // can burst particles right where the player tapped — `eventPos` reads {x,y}).
  world.audio.play("collect");
  if (tapEvent) world.events.emit(tapEvent, { taps, x: lastX, y: lastY });
};

/**
 * `auto-income` — passive coins per second from `rateKey` (raised by the
 * upgrade-tree's generator upgrades), scaled by the prestige multiplier
 * (`multKey`, default 1) so prestige boosts the dominant late-game income (IC-1).
 * Params: `coinsKey`, `rateKey`, `baseRate` ($cfg), `multKey`.
 */
export const autoIncome: SystemFn = (world, params, dt) => {
  const coinsKey = str(params, "coinsKey", "coins");
  const rateKey = str(params, "rateKey", "autoRate");
  const multKey = str(params, "multKey", "prestigeMult");
  // 0.2.1 (G6 race fix): defer the autoRate seed while a persistence load claims it
  // (see click-to-earn above) so a saved rate survives the play-scene collapse.
  if (!world.isPersistPending(rateKey) && typeof world.state[rateKey] !== "number") {
    world.state[rateKey] = num(params, "baseRate", 0);
  }
  const rate = (world.state[rateKey] as number) ?? 0;
  const mult = (world.state[multKey] as number) ?? 1;
  if (rate > 0) world.state[coinsKey] = ((world.state[coinsKey] as number) ?? 0) + rate * mult * dt;
};

/**
 * `interval-bonus` — every `period` seconds grant a lump `amount` (scaled by the
 * prestige multiplier `multKey`, default 1, so prestige boosts it too — IC-1) and
 * expose the remaining time for a HUD countdown (the game's "timer"). Self-resetting.
 * Params: `coinsKey`, `period` ($cfg), `amount` ($cfg), `multKey`, `leftKey`, `stateKey`.
 */
export const intervalBonus: SystemFn = (world, params, dt) => {
  const coinsKey = str(params, "coinsKey", "coins");
  const leftKey = str(params, "leftKey", "bonusLeft");
  const multKey = str(params, "multKey", "prestigeMult");
  const stateKey = str(params, "stateKey", "__bonus");
  const period = num(params, "period", 30);
  const amount = num(params, "amount", 0);

  const s = (world.state[stateKey] ??= { left: period }) as { left: number };
  s.left -= dt;
  if (s.left <= 0) {
    s.left += period;
    const mult = (world.state[multKey] as number) ?? 1;
    const paid = amount * mult;
    world.state[coinsKey] = ((world.state[coinsKey] as number) ?? 0) + paid;
    // IC-4: a routine periodic trickle should not play the game's "win" cue.
    world.audio.play("collect");
    world.events.emit("bonus", { amount: paid });
  }
  world.state[leftKey] = s.left;
};

/**
 * `prestige` — data-driven reset-for-a-permanent-multiplier. Polls `requestKey`
 * (set true by the shop's Prestige button, like upgrade-tree's request flag); on a
 * request it banks the current coins (`bankKey`, for the "Banked N" readout), bumps
 * the permanent multiplier (`multKey`) by `bonus` ($cfg), and RESETS the run's
 * progress (coins→0, clickPower→base, autoRate→base, upgrades→{}) so prestige is a
 * fresh, faster run. Emits `prestige`. This replaces the host prestige-button
 * economics (the multiplier + reset used to live in main.ts) — only the button
 * wiring (set the flag) stays host UI. Balance ($cfg): `bonus`, `baseClickPower`,
 * `baseAutoRate`.
 * Params: `requestKey`, `coinsKey`, `multKey`, `bonus` ($cfg), `powerKey`,
 *         `basePower` ($cfg), `rateKey`, `baseRate` ($cfg), `levelsKey`, `bankKey`.
 */
export const prestige: SystemFn = (world, params) => {
  const requestKey = str(params, "requestKey", "prestigeRequest");
  if (world.state[requestKey] !== true) return;
  world.state[requestKey] = false; // consume once per click

  const coinsKey = str(params, "coinsKey", "coins");
  const multKey = str(params, "multKey", "prestigeMult");
  const powerKey = str(params, "powerKey", "clickPower");
  const rateKey = str(params, "rateKey", "autoRate");
  const levelsKey = str(params, "levelsKey", "upgrades");
  const bankKey = str(params, "bankKey", "lastBank");
  const bonus = num(params, "bonus", 0);
  const basePower = num(params, "basePower", 1);
  const baseRate = num(params, "baseRate", 0);

  world.state[bankKey] = Math.floor((world.state[coinsKey] as number) ?? 0);
  const mult = (world.state[multKey] as number) ?? 1;
  // Round to 2dp so the multiplier reads cleanly (x1.25, x1.5, …).
  world.state[multKey] = Math.round((mult + bonus) * 100) / 100;
  world.state[coinsKey] = 0;
  world.state[powerKey] = basePower;
  world.state[rateKey] = baseRate;
  world.state[levelsKey] = {};
  world.audio.play("collect");
  world.events.emit("prestige", { mult: world.state[multKey] });
};

export function registerCustomBehaviors(registry: Registry): void {
  registry.registerSystem("click-to-earn", clickToEarn);
  registry.registerSystem("auto-income", autoIncome);
  registry.registerSystem("interval-bonus", intervalBonus);
  registry.registerSystem("prestige", prestige);
}
