import type { SystemFn } from "@gitcade/sdk";
import { num, str, bool } from "@gitcade/sdk";
import { points, spawnFrom, systemState } from "../util.js";

interface SpawnerState extends Record<string, unknown> {
  wave: number;
  spawnTimer: number;
  waveTimer: number;
  spawnedThisWave: number;
  // Cumulative spawn index across the WHOLE run (never reset per wave). The
  // round-robin over `spawnPoints` keys on this, not on `spawnedThisWave`, so
  // small per-wave counts (e.g. waveSize:1) still cycle through every spawn
  // point over successive waves instead of pinning to spawnPoints[0]. (B-1)
  spawnCursor: number;
  started: boolean;
  done: boolean;
  betweenWaves: boolean;
}

/**
 * Spawn entities in escalating waves over time — the engine behind every "more
 * keep coming" genre. Clones the `prototype` entity-definition (its `$cfg` refs
 * already resolved at scene load), assigns a unique id, and places it at a chosen
 * `spawnPoints` entry. A wave is `waveSize` (+ `waveSizeGrowth` per wave) spawns
 * dripped out every `interval`; the next wave begins after `waveDelay` (or once
 * `countTag` entities are all cleared). `maxAlive` caps concurrent spawns.
 *
 * One of the four REUSE-PROOF parts: it produces the snake-tail threat, the
 * tower-defense creep waves, the survival-arena scaling swarm, and the
 * space-invaders formation — same system, four genres, balance entirely in
 * `$cfg`. Per-instance scratch lives under `stateKey` on `world.state`, so several
 * spawners can run at once.
 *
 * Params:
 *  - `prototype`: entity-definition to spawn (required)
 *  - `interval`: seconds between individual spawns within a wave (balance → `$cfg`)
 *  - `waveSize`: spawns in the first wave (balance → `$cfg`)
 *  - `waveSizeGrowth`: added to `waveSize` each subsequent wave (balance → `$cfg`; default 0)
 *  - `waveDelay`: seconds between waves (balance → `$cfg`; default 0)
 *  - `maxWaves`: total waves, 0 = endless (balance → `$cfg`; default 0)
 *  - `maxAlive`: cap on concurrent `countTag` entities, 0 = uncapped (balance → `$cfg`; default 0)
 *  - `startDelay`: seconds before the first spawn (balance → `$cfg`; default 0)
 *  - `countTag`: tag counted for `maxAlive` and wave-clear detection (default = prototype's first tag)
 *  - `spawnPoints`: array of `{ x, y }` spawn positions, used round-robin (structural; default prototype position)
 *  - `advanceOnClear`: start the next wave as soon as all `countTag` are gone (default true)
 *  - `stateKey`: `world.state` scratch key for this spawner (default `"__waveSpawner"`)
 *  - `waveKey`: `world.state` key exposing the current wave number for a HUD (default `"wave"`)
 */
export const waveSpawner: SystemFn = (world, params, dt) => {
  const interval = num(params, "interval", 1);
  const baseWaveSize = num(params, "waveSize", 1);
  const growth = num(params, "waveSizeGrowth", 0);
  const waveDelay = num(params, "waveDelay", 0);
  const maxWaves = num(params, "maxWaves", 0);
  const maxAlive = num(params, "maxAlive", 0);
  const startDelay = num(params, "startDelay", 0);
  const advanceOnClear = bool(params, "advanceOnClear", true);
  const stateKey = str(params, "stateKey", "__waveSpawner");
  const waveKey = str(params, "waveKey", "wave");

  const proto = params.prototype as { tags?: string[] } | undefined;
  const countTag = str(params, "countTag", "") || proto?.tags?.[0] || "";
  const spawnPts = points(params, "spawnPoints");

  const s = systemState<SpawnerState>(world, stateKey, {
    wave: 0,
    spawnTimer: 0,
    waveTimer: startDelay,
    spawnedThisWave: 0,
    spawnCursor: 0,
    started: false,
    done: false,
    betweenWaves: true,
  });
  if (s.done) return;

  const aliveOfTag = countTag ? world.query(countTag).length : 0;
  const waveSizeFor = (wave: number): number => Math.max(0, Math.round(baseWaveSize + growth * (wave - 1)));

  // Between waves: wait out the delay (or the clear) before opening the next wave.
  if (s.betweenWaves) {
    s.waveTimer -= dt;
    const ready = s.waveTimer <= 0 || (advanceOnClear && s.wave > 0 && aliveOfTag === 0);
    if (!ready) return;
    if (maxWaves > 0 && s.wave >= maxWaves) {
      s.done = true;
      world.events.emit("waves-complete", { waves: s.wave });
      return;
    }
    s.wave += 1;
    s.spawnedThisWave = 0;
    s.spawnTimer = 0;
    s.betweenWaves = false;
    world.state[waveKey] = s.wave;
    world.events.emit("wave-start", { wave: s.wave, size: waveSizeFor(s.wave) });
  }

  // Drip spawns out across the wave.
  const target = waveSizeFor(s.wave);
  s.spawnTimer -= dt;
  if (s.spawnedThisWave < target && s.spawnTimer <= 0) {
    if (maxAlive === 0 || aliveOfTag < maxAlive) {
      // Persistent cumulative cursor → spawn points cycle over the whole run. (B-1)
      const pt = spawnPts.length ? spawnPts[s.spawnCursor % spawnPts.length] : undefined;
      const spawned = spawnFrom(world, params.prototype, {
        idPrefix: `${stateKey}.w${s.wave}`,
        position: pt,
      });
      if (spawned) {
        s.spawnedThisWave += 1;
        s.spawnCursor += 1;
        s.spawnTimer = interval;
        world.events.emit("spawn", { wave: s.wave, id: spawned.id });
      }
    }
  }

  // Wave complete → enter the inter-wave gap.
  if (s.spawnedThisWave >= target) {
    s.betweenWaves = true;
    s.waveTimer = waveDelay;
  }
};
