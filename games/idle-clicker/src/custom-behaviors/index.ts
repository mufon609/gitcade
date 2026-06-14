import type { Registry, SystemFn } from "@gitcade/sdk";
import { num, str } from "@gitcade/sdk";

/**
 * Idle Clicker's custom economy. The action-game library doesn't cover the idle
 * loop, so these three small systems do — each fully param-driven (every balance
 * value a `$cfg` from config.json, so the game keeps 100% of its balance in
 * config.json) and each poll/tick-based with NO event listeners, so a restart
 * (which clears `world.state` but not the event bus) can never double-count.
 * Logged in games/LIBRARY-GAPS.md as generalization candidates.
 */

/**
 * `click-to-earn` — award coins for each registered click. The host increments
 * `clicksKey` on every tap; this polls the delta and pays `clickPower` per click.
 * Params: `coinsKey`, `clicksKey`, `powerKey`, `basePower` ($cfg), `stateKey`.
 */
export const clickToEarn: SystemFn = (world, params) => {
  const coinsKey = str(params, "coinsKey", "coins");
  const clicksKey = str(params, "clicksKey", "clicks");
  const powerKey = str(params, "powerKey", "clickPower");
  const stateKey = str(params, "stateKey", "__clicker");

  const s = (world.state[stateKey] ??= { last: 0, seeded: false }) as { last: number; seeded: boolean };
  if (!s.seeded) {
    s.seeded = true;
    if (typeof world.state[powerKey] !== "number") world.state[powerKey] = num(params, "basePower", 1);
    s.last = (world.state[clicksKey] as number) ?? 0;
  }
  const clicks = (world.state[clicksKey] as number) ?? 0;
  if (clicks > s.last) {
    const per = (world.state[powerKey] as number) ?? 1;
    world.state[coinsKey] = ((world.state[coinsKey] as number) ?? 0) + (clicks - s.last) * per;
    s.last = clicks;
  }
};

/**
 * `auto-income` — passive coins per second from `rateKey` (raised by the
 * upgrade-tree's generator upgrades). Params: `coinsKey`, `rateKey`,
 * `baseRate` ($cfg).
 */
export const autoIncome: SystemFn = (world, params, dt) => {
  const coinsKey = str(params, "coinsKey", "coins");
  const rateKey = str(params, "rateKey", "autoRate");
  if (typeof world.state[rateKey] !== "number") world.state[rateKey] = num(params, "baseRate", 0);
  const rate = world.state[rateKey] as number;
  if (rate > 0) world.state[coinsKey] = ((world.state[coinsKey] as number) ?? 0) + rate * dt;
};

/**
 * `interval-bonus` — every `period` seconds grant a lump `amount` and expose the
 * remaining time for a HUD countdown (the game's "timer"). Self-resetting.
 * Params: `coinsKey`, `period` ($cfg), `amount` ($cfg), `leftKey`, `stateKey`.
 */
export const intervalBonus: SystemFn = (world, params, dt) => {
  const coinsKey = str(params, "coinsKey", "coins");
  const leftKey = str(params, "leftKey", "bonusLeft");
  const stateKey = str(params, "stateKey", "__bonus");
  const period = num(params, "period", 30);
  const amount = num(params, "amount", 0);

  const s = (world.state[stateKey] ??= { left: period }) as { left: number };
  s.left -= dt;
  if (s.left <= 0) {
    s.left += period;
    world.state[coinsKey] = ((world.state[coinsKey] as number) ?? 0) + amount;
    world.audio.play("win");
    world.events.emit("bonus", { amount });
  }
  world.state[leftKey] = s.left;
};

export function registerCustomBehaviors(registry: Registry): void {
  registry.registerSystem("click-to-earn", clickToEarn);
  registry.registerSystem("auto-income", autoIncome);
  registry.registerSystem("interval-bonus", intervalBonus);
}
