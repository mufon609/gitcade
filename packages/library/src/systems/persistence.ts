import type { SystemFn, World } from "@gitcade/sdk";
import { num, str, strArray } from "@gitcade/sdk";
import { systemState } from "../util.js";

interface PersistScratch extends Record<string, unknown> {
  /** The async load has been ISSUED (claim placed, storage.get fired) once. */
  loadStarted: boolean;
  /** The async load has RESOLVED (restore written, claim released) — gates saving. */
  loadResolved: boolean;
  /** JSON of the last snapshot written to storage, so we only write on change. */
  lastSaved: string | null;
  /** Seconds accumulated toward the next autosave (only used when everySeconds > 0). */
  sinceSave: number;
}

/**
 * Declarative cross-RUN persistence. Round-trips named `world.state` keys
 * through the EXISTING `world.storage` bridge — no host JS, and NO change to the
 * frozen storage wire protocol (this only *consumes* the sanctioned `world.storage`
 * adapter, the same escape hatch behaviors already use for side effects).
 *
 * Config comes from `manifest.persist` (surfaced on `world.persist`); individual
 * fields may be overridden per-instance via params. Behavior:
 *  - **Claim on boot:** on its first tick the system calls
 *    `world.claimPersistKeys(keys)` SYNCHRONOUSLY — before any seed-once system
 *    later in the same scene's system order runs — so a seed system (e.g.
 *    `currency`) that consults `world.isPersistPending(key)` DEFERS seeding while
 *    the load is in flight. This is the robust fix for the persistence-vs-seeding
 *    race: a persisted value is authoritative on boot with no per-game workaround.
 *  - **Load on boot:** kicks off `world.storage.get(slot)` once; when it resolves,
 *    it WRITES each declared key the save holds (the restore is authoritative for
 *    its claimed keys — it no longer skips a key the seed already set, because the
 *    claim made the seed defer), then releases the claim via
 *    `world.resolvePersistKeys(keys)`. A key with no saved value is simply
 *    released, so its seed system seeds it on the next tick.
 *  - **Save on change / interval:** each tick snapshots the declared keys that are
 *    present; writes when the snapshot CHANGED, and additionally every
 *    `everySeconds` when that is > 0. Saving is suppressed until the load resolves
 *    (and an empty snapshot is never written), so a pending restore is never
 *    overwritten before it lands.
 *
 * The SDK claim methods are no-ops for any seed system that does not consult them
 * (those keep their "live value wins" behavior), and a game that runs persistence
 * on a non-seeding scene (Idle
 * Clicker's title-scene workaround) is unaffected — no key it carries is seeded
 * there, so claim/defer never fires.
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
    loadResolved: false,
    sinceSave: 0,
    lastSaved: null,
  });

  // Load-on-boot: claim the declared keys synchronously (so seed-once systems
  // defer), then issue the async read exactly once. When it lands, the restore is
  // authoritative for its keys — it WRITES every saved key — then releases the
  // claim so any unsaved key is free to seed normally.
  if (!s.loadStarted) {
    s.loadStarted = true;
    world.claimPersistKeys(keys);
    void world.storage
      .get<Record<string, unknown>>(slot)
      .then((saved) => {
        if (saved && typeof saved === "object") {
          for (const k of keys) {
            if (k in saved) world.state[k] = (saved as Record<string, unknown>)[k];
          }
        }
      })
      .catch(() => {
        /* storage unavailable — persistence degrades to in-memory, like the dev shim */
      })
      .finally(() => {
        s.loadResolved = true;
        world.resolvePersistKeys(keys);
        // Re-baseline the change detector to the post-restore snapshot, so the
        // restored value is not redundantly re-written on the next tick.
        s.lastSaved = JSON.stringify(snapshot(world, keys));
      });
  }

  // Save-on-change / interval. The empty-snapshot skip below is what keeps a
  // pending restore safe: while the load is in flight the seed-once systems have
  // DEFERRED (they consult `world.isPersistPending`), so on a reboot the declared
  // keys are absent ⇒ the snapshot is empty ⇒ nothing is written over the unread
  // save. Once the load resolves it WRITES the saved values (authoritative), the
  // change detector is re-baselined in `.finally`, and normal save-on-change
  // resumes. (The claim/defer on the seed side is the real race fix; this skip is
  // the matching save-side safety.)
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
