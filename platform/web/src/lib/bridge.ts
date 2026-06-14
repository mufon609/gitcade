// PARENT SIDE of the GitCade storage bridge (Phase 1 protocol, FROZEN in
// packages/sdk/src/storage/protocol.ts). This is the FIRST time the parent half
// runs end-to-end. It is written framework-agnostic and DOM-free so it is unit
// testable; the React <GameFrame> wires it to a real iframe + window.
//
// SECURITY MODEL — IDENTITY, NOT ORIGIN. An opaque-origin iframe
// (sandbox="allow-scripts") reports `event.origin === "null"`, so origin strings
// are useless. We authenticate every inbound message by:
//   1. event.source === the iframe's contentWindow (the only trustworthy signal);
//   2. a per-session nonce handshake (we mint sessionId + parentNonce);
//   3. matching sessionId + parentNonce on every subsequent request.
// Replies always post with targetOrigin "*" (required for opaque iframes).
// Mismatches are dropped silently. Saves are namespaced by gameSlug + branch.
import {
  BRIDGE_TAG,
  STORAGE_PROTOCOL_VERSION,
  GameToParentSchema,
  type ParentToGameMessage,
} from "@gitcade/sdk";

/** A flat string KV the bridge persists into. Keys arrive already namespaced by
 *  the bridge; the store is "dumb" (Locked Decision). May be sync or async. */
export interface BridgeStore {
  get(key: string): string | null | Promise<string | null>;
  set(key: string, value: string): void | Promise<void>;
  remove(key: string): void | Promise<void>;
  /** All keys currently stored (across all games); the bridge filters by prefix. */
  keys(): string[] | Promise<string[]>;
}

export interface ParentBridgeOptions {
  gameSlug: string;
  branch: string;
  /** The trusted iframe window. `event.source` must be referentially equal. */
  expectedSource: unknown;
  store: BridgeStore;
  /** Post a reply to the game. The React layer uses iframe.contentWindow.postMessage(msg, "*"). */
  reply: (message: ParentToGameMessage) => void;
  /** Injectable for deterministic tests; defaults to crypto.randomUUID. */
  randomId?: () => string;
  /** Optional hook for observability/tests (e.g. mark "a save round-tripped"). */
  onEvent?: (ev: { type: string; key?: string }) => void;
}

function defaultRandomId(): string {
  const c =
    typeof globalThis !== "undefined" ? (globalThis as { crypto?: Crypto }).crypto : undefined;
  if (c?.randomUUID) return c.randomUUID();
  let s = "";
  for (let i = 0; i < 4; i++) s += Math.floor(Math.random() * 0xffffffff).toString(16);
  return s;
}

// Namespace separator: a NUL byte — it cannot appear in a game slug, a git
// branch ref, or a sane storage key, so it can never let one game's saves
// leak into another's namespace. Exported via bridgeKeyPrefix so the parent
// bridge AND the GameFrame "saved keys" inspector share ONE definition.
const SEP = "\u0000";

/** The parent-store key prefix for a game's saves on a branch. Every save is
 *  stored under `${bridgeKeyPrefix(slug, branch)}${userKey}`. */
export function bridgeKeyPrefix(gameSlug: string, branch: string): string {
  return `gc${SEP}${gameSlug}${SEP}${branch}${SEP}`;
}

export class ParentBridge {
  private sessionId: string | null = null;
  private parentNonce: string | null = null;
  private readonly prefix: string;
  private readonly randomId: () => string;

  constructor(private readonly opts: ParentBridgeOptions) {
    this.prefix = bridgeKeyPrefix(opts.gameSlug, opts.branch);
    this.randomId = opts.randomId ?? defaultRandomId;
  }

  private ns(key: string): string {
    return this.prefix + key;
  }
  private stripNs(full: string): string {
    return full.slice(this.prefix.length);
  }

  /** Handle one inbound message. `source` is `event.source`. Async because the
   *  store may be async. Unrecognized / unauthenticated messages are ignored. */
  async handle(rawData: unknown, source: unknown): Promise<void> {
    const data = rawData as { __gitcade?: unknown } | undefined;
    if (!data || data.__gitcade !== BRIDGE_TAG) return;

    const parsed = GameToParentSchema.safeParse(data);
    if (!parsed.success) return;
    const msg = parsed.data;

    // IDENTITY CHECK — the security boundary. Never trust origin.
    if (source !== this.opts.expectedSource) return;

    if (msg.type === "handshake-init") {
      // (Re)establish the session for this iframe. The game minted `nonce`; we
      // echo it and mint our own sessionId + parentNonce.
      this.sessionId = this.randomId();
      this.parentNonce = this.randomId();
      this.opts.onEvent?.({ type: "handshake" });
      this.opts.reply({
        __gitcade: BRIDGE_TAG,
        v: STORAGE_PROTOCOL_VERSION,
        type: "handshake-ack",
        nonce: msg.nonce,
        sessionId: this.sessionId,
        parentNonce: this.parentNonce,
      });
      return;
    }

    // From here on it is a storage request — require a completed handshake AND a
    // matching session + parent nonce.
    if (!this.sessionId || !this.parentNonce) return;
    if (msg.sessionId !== this.sessionId || msg.parentNonce !== this.parentNonce) return;

    const ok = (extra: { value?: string | null; keys?: string[] }) =>
      this.opts.reply({
        __gitcade: BRIDGE_TAG,
        v: STORAGE_PROTOCOL_VERSION,
        type: "result",
        requestId: msg.requestId,
        sessionId: this.sessionId!,
        nonce: this.parentNonce!, // game verifies result.nonce === parentNonce
        ok: true,
        ...extra,
      });
    const fail = (error: string) =>
      this.opts.reply({
        __gitcade: BRIDGE_TAG,
        v: STORAGE_PROTOCOL_VERSION,
        type: "result",
        requestId: msg.requestId,
        sessionId: this.sessionId!,
        nonce: this.parentNonce!,
        ok: false,
        error,
      });

    try {
      switch (msg.type) {
        case "get": {
          const value = await this.opts.store.get(this.ns(msg.key));
          this.opts.onEvent?.({ type: "get", key: msg.key });
          ok({ value: value ?? null });
          break;
        }
        case "set": {
          await this.opts.store.set(this.ns(msg.key), msg.value);
          this.opts.onEvent?.({ type: "set", key: msg.key });
          ok({});
          break;
        }
        case "remove": {
          await this.opts.store.remove(this.ns(msg.key));
          this.opts.onEvent?.({ type: "remove", key: msg.key });
          ok({});
          break;
        }
        case "keys": {
          const all = await this.opts.store.keys();
          const mine = all.filter((k) => k.startsWith(this.prefix)).map((k) => this.stripNs(k));
          ok({ keys: mine });
          break;
        }
        case "clear": {
          const all = await this.opts.store.keys();
          for (const k of all) if (k.startsWith(this.prefix)) await this.opts.store.remove(k);
          this.opts.onEvent?.({ type: "clear" });
          ok({});
          break;
        }
      }
    } catch (e) {
      fail((e as Error).message ?? "storage error");
    }
  }
}

/** A localStorage-backed BridgeStore for the platform page (same-origin, so
 *  localStorage works). Saves persist on the parent namespaced by gameSlug+branch.
 *  EXTENSION POINT: swap this for a server-backed (per-user cloud save) store
 *  without touching the protocol — the bridge only needs a flat string KV. */
export function localStorageBridgeStore(ls: Storage): BridgeStore {
  return {
    get: (k) => ls.getItem(k),
    set: (k, v) => ls.setItem(k, v),
    remove: (k) => ls.removeItem(k),
    keys: () => {
      const out: string[] = [];
      for (let i = 0; i < ls.length; i++) {
        const k = ls.key(i);
        if (k) out.push(k);
      }
      return out;
    },
  };
}

/** An in-memory BridgeStore (tests, SSR fallback). */
export function memoryBridgeStore(initial?: Map<string, string>): BridgeStore {
  const m = initial ?? new Map<string, string>();
  return {
    get: (k) => m.get(k) ?? null,
    set: (k, v) => {
      m.set(k, v);
    },
    remove: (k) => {
      m.delete(k);
    },
    keys: () => [...m.keys()],
  };
}
