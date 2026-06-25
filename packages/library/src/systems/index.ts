import type { Registry } from "@gitcade/sdk";

import { score } from "./score.js";
import { livesRespawn } from "./lives-respawn.js";
import { timerCountdown } from "./timer-countdown.js";
import { waveSpawner } from "./wave-spawner.js";
import { levelProgression } from "./level-progression.js";
import { winLoseConditions } from "./win-lose-conditions.js";
import { simpleInventory } from "./simple-inventory.js";
import { currency } from "./currency.js";
import { upgradeTree } from "./upgrade-tree.js";
import { transaction } from "./transaction.js";
import { persistence } from "./persistence.js";
import { placeOnFreeCell } from "./place-on-free-cell.js";
import { inputActions } from "./input-actions.js";
import { formatBinding } from "./format-binding.js";
import { levelSelect } from "./level-select.js";
import { statModifier } from "./stat-modifier.js";
import { cameraFollow } from "./camera-follow.js";
import { cameraShake } from "./camera-shake.js";

/**
 * Every library system, keyed by the exact `type` string a scene uses. As with
 * behaviors, this single map is the source of truth shared by the catalog, the
 * registration call, and the runtime.
 */
export const LIBRARY_SYSTEMS = {
  score: score,
  "lives-respawn": livesRespawn,
  "timer-countdown": timerCountdown,
  "wave-spawner": waveSpawner,
  "level-progression": levelProgression,
  "win-lose-conditions": winLoseConditions,
  "simple-inventory": simpleInventory,
  currency: currency,
  "upgrade-tree": upgradeTree,
  transaction: transaction,
  persistence: persistence,
  "place-on-free-cell": placeOnFreeCell,
  "input-actions": inputActions,
  "format-binding": formatBinding,
  "level-select": levelSelect,
  "stat-modifier": statModifier,
  "camera-follow": cameraFollow,
  "camera-shake": cameraShake,
} as const;

/** The library system type ids (for tests / introspection). */
export const LIBRARY_SYSTEM_TYPES = Object.keys(LIBRARY_SYSTEMS);

/** Register every library system TYPE onto a registry (never mutates the schema). */
export function registerLibrarySystems(registry: Registry): void {
  for (const [type, fn] of Object.entries(LIBRARY_SYSTEMS)) {
    registry.registerSystem(type, fn);
  }
}

export {
  score,
  livesRespawn,
  timerCountdown,
  waveSpawner,
  levelProgression,
  winLoseConditions,
  simpleInventory,
  currency,
  upgradeTree,
  transaction,
  persistence,
  placeOnFreeCell,
  inputActions,
  formatBinding,
  levelSelect,
  statModifier,
  cameraFollow,
  cameraShake,
};
