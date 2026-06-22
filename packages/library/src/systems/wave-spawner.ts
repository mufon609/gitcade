import type { SystemFn } from "@gitcade/sdk";
import { num, str, bool } from "@gitcade/sdk";
import { WAVES_COMPLETE, WAVE_START, SPAWN } from "../channels.js";
import { points, spawnFrom, systemState, randomFreeCell, type Vec2 } from "../util.js";

interface SpawnerState extends Record<string, unknown> {
  wave: number;
  spawnTimer: number;
  waveTimer: number;
  spawnedThisWave: number;
  // Cumulative spawn index across the WHOLE run (never reset per wave). The
  // round-robin over `spawnPoints` keys on this, not on `spawnedThisWave`, so
  // small per-wave counts (e.g. waveSize:1) still cycle through every spawn
  // point over successive waves instead of pinning to spawnPoints[0].
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
 *
 * Level-aware DENSITY ramp — the spawn-pressure half of difficulty, the
 * companion to per-entity `scale-by-state` which ramps the SPEED half. Reads the
 * same 1-based difficulty counter `scale-by-state`/`level-progression` use (and that
 * the runtime sets per stage when a game declares `manifest.levels`), so a wave's
 * size and cadence tighten as the level climbs — with the factor
 * `1 + perLevel * max(0, level - 1)`. Both default to 0 ⇒ no ramp:
 *  - `levelKey`: `world.state` key holding the 1-based level (default `"level"`)
 *  - `densityPerLevel`: fractional add to `waveSize` per level above 1 (balance → `$cfg`; default 0)
 *  - `intervalPerLevel`: fractional SHORTENING of the inter-spawn `interval` per level (balance → `$cfg`; default 0)
 */
export const waveSpawner: SystemFn = (world, params, dt) => {
  const baseInterval = num(params, "interval", 1);
  const baseWaveSize = num(params, "waveSize", 1);
  const growth = num(params, "waveSizeGrowth", 0);
  const baseWaveDelay = num(params, "waveDelay", 0);
  const maxWaves = num(params, "maxWaves", 0);
  const maxAlive = num(params, "maxAlive", 0);
  const startDelay = num(params, "startDelay", 0);
  const advanceOnClear = bool(params, "advanceOnClear", true);
  const stateKey = str(params, "stateKey", "__waveSpawner");
  const waveKey = str(params, "waveKey", "wave");

  // Level-aware density ramp. `factor(per)` = 1 + per·(level-1), level≥1, so
  // it is ≥1 (a denominator-safe shortener for the timers). Read live each tick, so
  // a mid-run level-up tightens the very next spawn. `intervalPerLevel` shortens the
  // WHOLE spawn cadence — both the intra-wave `interval` and the inter-wave
  // `waveDelay` — so it works for dense waves (tower-defense) and the one-per-wave
  // pillar stream (helicopter, where `waveDelay` is the only live spacing knob) alike.
  const level = (world.state[str(params, "levelKey", "level")] as number) ?? 1;
  const factor = (per: number): number => 1 + per * Math.max(0, level - 1);
  const densityFactor = factor(num(params, "densityPerLevel", 0));
  const cadenceFactor = factor(num(params, "intervalPerLevel", 0));
  const interval = baseInterval / cadenceFactor;
  const waveDelay = baseWaveDelay / cadenceFactor;

  const proto = params.prototype as { tags?: string[]; size?: { w?: number; h?: number } } | undefined;
  const countTag = str(params, "countTag", "") || proto?.tags?.[0] || "";
  const spawnPts = points(params, "spawnPoints");

  // Scatter spawns across free grid cells instead of the literal prototype
  // position. `placement` defaults to "literal" (round-robin spawnPoints or the
  // prototype's own position).
  const placement = str(params, "placement", "literal");
  const tileSize = num(params, "tileSize", 0);
  const occupiedTag = str(params, "occupiedTag", "") || countTag;

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
  const waveSizeFor = (wave: number): number =>
    Math.max(0, Math.round((baseWaveSize + growth * (wave - 1)) * densityFactor));

  // Between waves: wait out the delay (or the clear) before opening the next wave.
  if (s.betweenWaves) {
    s.waveTimer -= dt;
    const ready = s.waveTimer <= 0 || (advanceOnClear && s.wave > 0 && aliveOfTag === 0);
    if (!ready) return;
    if (maxWaves > 0 && s.wave >= maxWaves) {
      s.done = true;
      WAVES_COMPLETE.emit(world, { waves: s.wave });
      return;
    }
    s.wave += 1;
    s.spawnedThisWave = 0;
    s.spawnTimer = 0;
    s.betweenWaves = false;
    world.state[waveKey] = s.wave;
    WAVE_START.emit(world, { wave: s.wave, size: waveSizeFor(s.wave) });
  }

  // Drip spawns out across the wave.
  const target = waveSizeFor(s.wave);
  s.spawnTimer -= dt;
  if (s.spawnedThisWave < target && s.spawnTimer <= 0) {
    if (maxAlive === 0 || aliveOfTag < maxAlive) {
      // Resolve the spawn position. "free-cell" picks a verified-free grid cell
      // (deterministic via world.rng) and centers the prototype on it; "literal"
      // uses the round-robin spawnPoints cursor or the prototype's position.
      let pt: Vec2 | undefined;
      if (placement === "free-cell" && tileSize > 0) {
        const cell = randomFreeCell(world, { tileSize, occupiedTag });
        if (!cell) return; // grid full this tick — try again next interval
        const w = proto?.size?.w ?? 16;
        const h = proto?.size?.h ?? 16;
        pt = { x: cell.x - w / 2, y: cell.y - h / 2 }; // top-left so center sits on the cell
      } else {
        // Persistent cumulative cursor → spawn points cycle over the whole run.
        pt = spawnPts.length ? spawnPts[s.spawnCursor % spawnPts.length] : undefined;
      }
      const spawned = spawnFrom(world, params.prototype, {
        idPrefix: `${stateKey}.w${s.wave}`,
        position: pt,
      });
      if (spawned) {
        s.spawnedThisWave += 1;
        s.spawnCursor += 1;
        s.spawnTimer = interval;
        SPAWN.emit(world, { wave: s.wave, id: spawned.id });
      }
    }
  }

  // Wave complete → enter the inter-wave gap.
  if (s.spawnedThisWave >= target) {
    s.betweenWaves = true;
    s.waveTimer = waveDelay;
  }
};
