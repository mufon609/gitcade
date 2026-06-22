import { defineChannel, type Channel } from "@gitcade/sdk";

/**
 * @gitcade/library channels — typed declarations for the well-known signals the library's own
 * parts emit, layered over the SDK's {@link defineChannel} facade (same open string-keyed
 * {@link EventBus} underneath; a game with its own one-off signal still emits a raw string). This is
 * the single source of truth for a library channel's NAME + PAYLOAD, so an emitter and a listener
 * stop re-typing a magic string and hand-casting `unknown`. Several previously shipped with
 * divergent payloads from multiple emitters — `upgrade-denied` (four shapes across one system),
 * `shoot` (two emitters) — which one declaration each now reconciles.
 *
 * The cross-cutting ENGINE channels (`gameover`, `pause-changed`, …) live in `@gitcade/sdk`'s
 * `channels` module because the SDK runtime emits them too; {@link GAME_OVER} is re-exported here so
 * a library part can import every channel it needs from one place.
 */

// Re-exported so library parts import the canonical `gameover` from the same place as library
// channels. `gameover` is emitted by the SDK `win-condition` AND three library systems, so its
// canonical payload is owned by the SDK (where both packages can reach it).
export { GAME_OVER, type GameOverPayload } from "@gitcade/sdk";

/** A watched entity respawned after a death (the `lives-respawn` system). */
export type RespawnPayload = { livesLeft: number };
export const RESPAWN: Channel<RespawnPayload> = defineChannel<RespawnPayload>("respawn");

/** A `follow-path` entity reached the end of its waypoint path. */
export type PathCompletePayload = { id: string };
export const PATH_COMPLETE: Channel<PathCompletePayload> = defineChannel<PathCompletePayload>("path-complete");

/** An inventory count rose (`item-gained`) or fell (`item-lost`) — the `simple-inventory` system. */
export type ItemChangePayload = { item: string; count: number; delta: number };
export const ITEM_GAINED: Channel<ItemChangePayload> = defineChannel<ItemChangePayload>("item-gained");
export const ITEM_LOST: Channel<ItemChangePayload> = defineChannel<ItemChangePayload>("item-lost");

/** A grid mover advanced one cell (the `move-grid-step` behavior — snake's step tick). */
export type GridStepPayload = { id: string; x: number; y: number };
export const GRID_STEP: Channel<GridStepPayload> = defineChannel<GridStepPayload>("grid-step");

/**
 * An upgrade purchase was rejected (the `upgrade-tree` system). The ONE payload for what previously
 * shipped as four divergent literals; `requires`/`cost` are filled only for the matching reason.
 */
export type UpgradeDeniedPayload = {
  id: string;
  reason: "unknown" | "max-level" | "requires" | "insufficient-funds";
  /** The prerequisite upgrade id (reason `"requires"`). */
  requires?: string;
  /** The price the player could not afford (reason `"insufficient-funds"`). */
  cost?: number;
};
export const UPGRADE_DENIED: Channel<UpgradeDeniedPayload> = defineChannel<UpgradeDeniedPayload>("upgrade-denied");

/** An upgrade was purchased (the `upgrade-tree` system). */
export type UpgradePurchasedPayload = { id: string; level: number; cost: number; effectKey?: string };
export const UPGRADE_PURCHASED: Channel<UpgradePurchasedPayload> =
  defineChannel<UpgradePurchasedPayload>("upgrade-purchased");

/** Contact damage was dealt (the `contact-damage` behavior). */
export type DamagePayload = { source: string; target: string; amount: number };
export const DAMAGE: Channel<DamagePayload> = defineChannel<DamagePayload>("damage");

/** A melee swing connected (the `melee-swing` behavior). */
export type MeleePayload = { source: string; hitbox: string };
export const MELEE: Channel<MeleePayload> = defineChannel<MeleePayload>("melee");

/** The last wave of a `wave-spawner` was cleared. */
export type WavesCompletePayload = { waves: number };
export const WAVES_COMPLETE: Channel<WavesCompletePayload> = defineChannel<WavesCompletePayload>("waves-complete");

/** A new wave began (the `wave-spawner` system). */
export type WaveStartPayload = { wave: number; size: number };
export const WAVE_START: Channel<WaveStartPayload> = defineChannel<WaveStartPayload>("wave-start");

/** An entity was spawned by a wave (the `wave-spawner` system). */
export type SpawnPayload = { wave: number; id: string };
export const SPAWN: Channel<SpawnPayload> = defineChannel<SpawnPayload>("spawn");

/** A projectile was fired (the `shoot` behavior AND `ai-aim-and-fire` — one shape, two emitters). */
export type ShootPayload = { source: string; projectile: string };
export const SHOOT: Channel<ShootPayload> = defineChannel<ShootPayload>("shoot");

/** An entity passed through a portal (the `portal` behavior). */
export type PortalPayload = { from: string; id: string };
export const PORTAL: Channel<PortalPayload> = defineChannel<PortalPayload>("portal");

/** A pickup was collected (the `collect-on-touch` behavior). */
export type CollectPayload = { id: string; kind: string; value: number; by: string };
export const COLLECT: Channel<CollectPayload> = defineChannel<CollectPayload>("collect");
