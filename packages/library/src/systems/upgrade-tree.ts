import type { SystemFn, World } from "@gitcade/sdk";
import { str } from "@gitcade/sdk";

interface Upgrade {
  /** Stable id used in the purchase request and the levels record. */
  id: string;
  /** Cost of the NEXT level (balance → `$cfg`). */
  cost: number;
  /** `world.state` key the upgrade modifies (e.g. `"towerDamage"`). */
  effectKey?: string;
  /** Amount added to `effectKey` per level (balance → `$cfg`). */
  effectAmount?: number;
  /** Max purchasable levels, 0 = unlimited (balance → `$cfg`). */
  maxLevel?: number;
  /** Cost multiplier applied per already-owned level (balance → `$cfg`; default 1). */
  costGrowth?: number;
  /** Optional prerequisite upgrade id that must have ≥1 level. */
  requires?: string;
}

/**
 * A purchasable upgrade tree driven by a request flag. UI/game code requests a
 * buy by setting `world.state[requestKey]` to an upgrade id; each tick this
 * system fulfils a pending request if the player can afford it
 * (`world.state[currencyKey]`), is below the upgrade's `maxLevel`, and meets its
 * prerequisite — deducting the (growth-scaled) cost, bumping the level in
 * `world.state[levelsKey]`, applying the effect to `effectKey`, emitting
 * `"upgrade-purchased"`, and clearing the request. Rejected requests emit
 * `"upgrade-denied"`. Idle multipliers, tower upgrades, skill trees.
 *
 * Costs and effects are all `$cfg`-driven, so an upgrade tree is a pure data
 * description — exactly the shape a governance proposal rebalances.
 *
 * Params:
 *  - `upgrades`: array of upgrade descriptors (see {@link Upgrade})
 *  - `currencyKey`: balance key to spend from (default `"currency"`)
 *  - `levelsKey`: `world.state` record of `upgradeId → owned levels` (default `"upgrades"`)
 *  - `requestKey`: `world.state` key holding a pending buy request (default `"upgradeRequest"`)
 */
export const upgradeTree: SystemFn = (world, params) => {
  const upgrades = (Array.isArray(params.upgrades) ? params.upgrades : []) as Upgrade[];
  const currencyKey = str(params, "currencyKey", "currency");
  const levelsKey = str(params, "levelsKey", "upgrades");
  const requestKey = str(params, "requestKey", "upgradeRequest");

  const levels = (world.state[levelsKey] ??= {}) as Record<string, number>;
  const requested = world.state[requestKey];
  if (typeof requested !== "string" || requested === "") return;

  // Consume the request regardless of outcome (UI sets it once per click).
  world.state[requestKey] = "";

  const up = upgrades.find((u) => u && u.id === requested);
  if (!up) {
    world.events.emit("upgrade-denied", { id: requested, reason: "unknown" });
    return;
  }

  const owned = levels[up.id] ?? 0;
  if (up.maxLevel && up.maxLevel > 0 && owned >= up.maxLevel) {
    world.events.emit("upgrade-denied", { id: up.id, reason: "max-level" });
    return;
  }
  if (up.requires && (levels[up.requires] ?? 0) < 1) {
    world.events.emit("upgrade-denied", { id: up.id, reason: "requires", requires: up.requires });
    return;
  }

  const cost = costFor(up, owned);
  const balance = (world.state[currencyKey] as number) ?? 0;
  if (balance < cost) {
    world.events.emit("upgrade-denied", { id: up.id, reason: "insufficient-funds", cost });
    return;
  }

  // Apply.
  world.state[currencyKey] = balance - cost;
  levels[up.id] = owned + 1;
  if (up.effectKey && typeof up.effectAmount === "number") {
    world.state[up.effectKey] = ((world.state[up.effectKey] as number) ?? 0) + up.effectAmount;
  }
  world.audio.play("collect");
  emitPurchase(world, up, levels[up.id], cost);
};

function costFor(up: Upgrade, owned: number): number {
  const growth = typeof up.costGrowth === "number" && up.costGrowth > 0 ? up.costGrowth : 1;
  return Math.round((up.cost ?? 0) * Math.pow(growth, owned));
}

function emitPurchase(world: World, up: Upgrade, level: number, cost: number): void {
  world.events.emit("upgrade-purchased", { id: up.id, level, cost, effectKey: up.effectKey });
}
