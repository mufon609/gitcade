import type { SystemFn, World } from "@gitcade/sdk";
import { num, str, strArray } from "@gitcade/sdk";
import { systemState } from "../util.js";

interface PersistScratch extends Record<string, unknown> {
  loadStarted: boolean;
  /** JSON of the last snapshot written to storage, so we only write on change. */
  lastSaved: string | null;
  /** Seconds accumulated toward the next autosave (only used when everySeconds > 0). */
  sinceSave: number;
}

/**
 * Declarative cross-RUN persistence (G6). Round-trips named `world.state` keys
 * through the EXISTING `world.storage` bridge — no host JS, and NO change to the
 * frozen storage wire protocol (this only *consumes* the sanctioned `world.storage`
 * adapter, the same escape hatch behaviors already use for side effects).
 *
 * Config comes from `manifest.persist` (surfaced on `world.persist`); individual
 * fields may be overridden per-instance via params. Behavior:
 *  - **Load on boot:** kicks off `world.storage.get(slot)` once; when it resolves,
 *    restores each declared key that is ABSENT from `world.state` ("live value
 *    wins", so a value already set this run is never clobbered by an old save).
 *  - **Save on change / interval:** each tick snapshots the declared keys that are
 *    present; writes when the snapshot CHANGED, and additionally every
 *    `everySeconds` when that is > 0. An empty snapshot (no declared key present
 *    yet — e.g. the first ticks after a reboot, before the async load resolves) is
 *    never written, so a pending restore is never overwritten with nothing.
 *
 * Params (default to `world.persist`): `keys`, `slot`, `everySeconds`.
 */
export const persistence: SystemFn = (world, params, dt) => {
  const cfg = world.persist;
  const keys = params.keys !== undefined ? strArray(params, "keys") : cfg?.keys ?? [];
  const slot = str(params, "slot", cfg?.slot ?? "save");
  const everySeconds = params.everySeconds !== undefined ? num(params, "everySeconds", 0) : cfg?.everySeconds ?? 0;
  if (keys.length === 0) return;

  const s = systemState<PersistScratch>(world, `__persist:${slot}`, {
    loadStarted: false,
    lastSaved: null,
    sinceSave: 0,
  });

  // Load-on-boot: issue the async read exactly once; restore absent keys when it lands.
  if (!s.loadStarted) {
    s.loadStarted = true;
    void world.storage
      .get<Record<string, unknown>>(slot)
      .then((saved) => {
        if (!saved || typeof saved !== "object") return;
        for (const k of keys) {
          if (!(k in world.state) && k in saved) world.state[k] = (saved as Record<string, unknown>)[k];
        }
        s.lastSaved = JSON.stringify(snapshot(world, keys));
      })
      .catch(() => {
        /* storage unavailable — persistence degrades to in-memory, like the dev shim */
      });
  }

  // Save-on-change / interval. Skip an empty snapshot so a pending restore (the
  // ticks between reboot and the async load resolving) is never clobbered.
  const snap = snapshot(world, keys);
  if (Object.keys(snap).length === 0) return;

  s.sinceSave += dt;
  const json = JSON.stringify(snap);
  const changed = json !== s.lastSaved;
  const intervalDue = everySeconds > 0 && s.sinceSave >= everySeconds;
  if (changed || intervalDue) {
    s.lastSaved = json;
    s.sinceSave = 0;
    void world.storage.set(slot, snap).catch(() => {
      /* best-effort persist */
    });
  }
};

/** The declared keys that are currently present in `world.state`, in declared order. */
function snapshot(world: World, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (k in world.state) out[k] = world.state[k];
  return out;
}
