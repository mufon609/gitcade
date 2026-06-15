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
 * `clicksKey` on every tap; this polls the delta and pays `clickPower` per click,
 * scaled by the prestige multiplier (`multKey`, default 1) so prestige raises ALL
 * income — not just the base click value (IC-1).
 * Params: `coinsKey`, `clicksKey`, `powerKey`, `basePower` ($cfg), `multKey`, `stateKey`.
 */
export const clickToEarn: SystemFn = (world, params) => {
  const coinsKey = str(params, "coinsKey", "coins");
  const clicksKey = str(params, "clicksKey", "clicks");
  const powerKey = str(params, "powerKey", "clickPower");
  const multKey = str(params, "multKey", "prestigeMult");
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
    const mult = (world.state[multKey] as number) ?? 1;
    world.state[coinsKey] = ((world.state[coinsKey] as number) ?? 0) + (clicks - s.last) * per * mult;
    s.last = clicks;
  }
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
  if (typeof world.state[rateKey] !== "number") world.state[rateKey] = num(params, "baseRate", 0);
  const rate = world.state[rateKey] as number;
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

export function registerCustomBehaviors(registry: Registry): void {
  registry.registerSystem("click-to-earn", clickToEarn);
  registry.registerSystem("auto-income", autoIncome);
  registry.registerSystem("interval-bonus", intervalBonus);
}
