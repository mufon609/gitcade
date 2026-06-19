import type { SystemFn } from "@gitcade/sdk";
import { num, str } from "@gitcade/sdk";

/**
 * A currency balance with optional passive income — gold, gems, mana, idle
 * "points-per-second". Seeds `world.state[currencyKey]` from `startAmount`,
 * accrues `passiveIncome` per second (the idle-game / tower-defense economy
 * trickle), and clamps to `maxAmount`. Other parts earn by adding to the key
 * (`collect-on-touch`, bounty on `health-and-death`) and spend by subtracting
 * (`upgrade-tree`), so the currency stays a single source of truth in `world.state`.
 *
 * Seeding `startAmount` is DEFERRED while the key is claimed by an in-flight
 * persistence load (`world.isPersistPending(currencyKey)`), so a saved balance
 * restores as the authoritative boot value instead of being clobbered by the
 * tick-1 seed. With no persistence system claiming the key the check is a no-op.
 *
 * Params:
 *  - `currencyKey`: `world.state` key holding the balance (default `"currency"`)
 *  - `startAmount`: opening balance (balance → `$cfg`; default 0)
 *  - `passiveIncome`: units earned per second (balance → `$cfg`; default 0)
 *  - `maxAmount`: balance cap, 0 = uncapped (balance → `$cfg`; default 0)
 */
export const currency: SystemFn = (world, params, dt) => {
  const currencyKey = str(params, "currencyKey", "currency");
  const maxAmount = num(params, "maxAmount", 0);

  // Defer the one-time seed while a persistence load owns this key, so the
  // restored save wins. Also skip the accrual this tick — there is no
  // balance to grow yet, and seeding zero would defeat the restore.
  if (world.isPersistPending(currencyKey)) return;

  if (typeof world.state[currencyKey] !== "number") {
    world.state[currencyKey] = num(params, "startAmount", 0);
  }

  const income = num(params, "passiveIncome", 0);
  let bal = world.state[currencyKey] as number;
  if (income !== 0) bal += income * dt;
  if (maxAmount > 0 && bal > maxAmount) bal = maxAmount;
  if (bal < 0) bal = 0;
  world.state[currencyKey] = bal;
};
