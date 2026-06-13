import { z } from "zod";

/**
 * The GitCade storage bridge wire protocol (FROZEN at the end of Phase 1).
 *
 * WHY A BRIDGE (Locked Decision: game storage isolation): production game iframes
 * use `sandbox="allow-scripts"` ONLY, giving them an opaque origin. In that
 * sandbox `localStorage`/`indexedDB` THROW `SecurityError`. Adding
 * `allow-same-origin` would instead let every untrusted game on the shared
 * artifact origin read every other game's saves. So the game never touches
 * browser storage directly: it posts save/load messages to the parent platform
 * page, which persists them namespaced by `gameSlug + branch`.
 *
 * SECURITY MODEL — identity, not origin. An opaque-origin iframe reports
 * `event.origin === "null"`, and replies to it must use `targetOrigin: "*"`.
 * Origin strings are therefore useless for authentication. Instead:
 *   1. The game posts a `handshake` carrying a freshly generated `nonce`.
 *   2. The parent matches `event.source === iframe.contentWindow` (the only
 *      trustworthy identity signal), assigns a `sessionId`, and replies with the
 *      same `nonce` plus its own `parentNonce`.
 *   3. Every subsequent message from BOTH sides carries `sessionId` + the peer's
 *      nonce; each side checks `event.source` identity AND the nonce before
 *      acting. Mismatches are dropped silently.
 *
 * The parent side of this protocol is implemented in Phase 4B against THIS
 * module's exported schemas, so the two halves can never drift.
 */

/** Protocol version. Bump only for breaking wire changes; both sides assert it. */
export const STORAGE_PROTOCOL_VERSION = 1 as const;

/** Tag present on every GitCade bridge message, to ignore unrelated postMessages. */
export const BRIDGE_TAG = "gitcade.storage" as const;

const Base = z.object({
  __gitcade: z.literal(BRIDGE_TAG),
  v: z.literal(STORAGE_PROTOCOL_VERSION),
});

// ---- Handshake (game → parent, then parent → game) ----

/** Game opens the channel, presenting its session nonce. */
export const HandshakeInitSchema = Base.extend({
  type: z.literal("handshake-init"),
  /** Random nonce minted by the game for this session. */
  nonce: z.string().min(1),
  /** The game's slug + branch, so the parent can namespace persistence. */
  gameSlug: z.string().optional(),
  branch: z.string().optional(),
});

/** Parent accepts, echoing the game nonce and minting a sessionId + parentNonce. */
export const HandshakeAckSchema = Base.extend({
  type: z.literal("handshake-ack"),
  nonce: z.string().min(1),
  sessionId: z.string().min(1),
  parentNonce: z.string().min(1),
});

// ---- Requests (game → parent) ----

const RequestBase = Base.extend({
  /** Correlates a request with its result. */
  requestId: z.string().min(1),
  /** Session assigned during the handshake. */
  sessionId: z.string().min(1),
  /** The parent's nonce, proving this game completed the handshake. */
  parentNonce: z.string().min(1),
});

export const StorageGetSchema = RequestBase.extend({ type: z.literal("get"), key: z.string() });
export const StorageSetSchema = RequestBase.extend({
  type: z.literal("set"),
  key: z.string(),
  value: z.string(),
});
export const StorageRemoveSchema = RequestBase.extend({ type: z.literal("remove"), key: z.string() });
export const StorageKeysSchema = RequestBase.extend({ type: z.literal("keys") });
export const StorageClearSchema = RequestBase.extend({ type: z.literal("clear") });

// ---- Result (parent → game) ----

export const StorageResultSchema = Base.extend({
  type: z.literal("result"),
  requestId: z.string().min(1),
  sessionId: z.string().min(1),
  nonce: z.string().min(1),
  ok: z.boolean(),
  /** Present on a successful `get`; `null` when the key is absent. */
  value: z.string().nullable().optional(),
  /** Present on a successful `keys`. */
  keys: z.array(z.string()).optional(),
  /** Present when `ok === false`. */
  error: z.string().optional(),
});

export const GameToParentSchema = z.discriminatedUnion("type", [
  HandshakeInitSchema,
  StorageGetSchema,
  StorageSetSchema,
  StorageRemoveSchema,
  StorageKeysSchema,
  StorageClearSchema,
]);

export const ParentToGameSchema = z.discriminatedUnion("type", [
  HandshakeAckSchema,
  StorageResultSchema,
]);

export type HandshakeInit = z.infer<typeof HandshakeInitSchema>;
export type HandshakeAck = z.infer<typeof HandshakeAckSchema>;
export type StorageResult = z.infer<typeof StorageResultSchema>;
export type GameToParentMessage = z.infer<typeof GameToParentSchema>;
export type ParentToGameMessage = z.infer<typeof ParentToGameSchema>;

/**
 * The values persisted by the bridge are always serialized to strings on the
 * game side (JSON) so the wire payload is a primitive `string`. This keeps the
 * parent persistence layer dumb (a string KV store) and the namespacing trivial.
 */
export function serializeValue(value: unknown): string {
  return JSON.stringify(value);
}

export function deserializeValue<T = unknown>(raw: string | null | undefined): T | null {
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
