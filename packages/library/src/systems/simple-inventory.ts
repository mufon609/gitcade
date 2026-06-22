import type { SystemFn } from "@gitcade/sdk";
import { num, str } from "@gitcade/sdk";
import { ITEM_GAINED, ITEM_LOST } from "../channels.js";
import { systemState } from "../util.js";

/**
 * Maintain a keyed item inventory on `world.state[inventoryKey]` (a record of
 * `itemName → count`). Other parts add items by incrementing those counts (e.g.
 * `collect-on-touch` with `grantKey: "inventory.key"`-style flows, or game code);
 * this system normalizes the bag each tick — ensures it exists, clamps every
 * count to `capacity`, and emits `"item-gained"` / `"item-lost"` events when a
 * count changes so HUDs and doors can react. Keys, ammo, fragments, crafting
 * resources.
 *
 * Params:
 *  - `inventoryKey`: `world.state` key holding the inventory record (default `"inventory"`)
 *  - `capacity`: max count per item, 0 = unlimited (balance → `$cfg`; default 0)
 *  - `stateKey`: `world.state` scratch key for change detection (default `"__inventory"`)
 */
export const simpleInventory: SystemFn = (world, params) => {
  const inventoryKey = str(params, "inventoryKey", "inventory");
  const capacity = num(params, "capacity", 0);
  const stateKey = str(params, "stateKey", "__inventory");

  const bag = (world.state[inventoryKey] ??= {}) as Record<string, number>;
  const prev = systemState<Record<string, unknown>>(world, stateKey, {}) as Record<string, number>;

  for (const [item, rawCount] of Object.entries(bag)) {
    let count = typeof rawCount === "number" ? rawCount : 0;
    if (capacity > 0 && count > capacity) count = capacity;
    if (count < 0) count = 0;
    bag[item] = count;

    const before = prev[item] ?? 0;
    if (count > before) ITEM_GAINED.emit(world, { item, count, delta: count - before });
    else if (count < before) ITEM_LOST.emit(world, { item, count, delta: count - before });
    prev[item] = count;
  }
};
