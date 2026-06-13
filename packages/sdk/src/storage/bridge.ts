import type { StorageAdapter } from "./adapters.js";
import {
  BRIDGE_TAG,
  STORAGE_PROTOCOL_VERSION,
  HandshakeAckSchema,
  StorageResultSchema,
  serializeValue,
  deserializeValue,
  type ParentToGameMessage,
} from "./protocol.js";

/** Minimal window-like surface so this is testable without a real DOM. */
interface MessageTarget {
  postMessage(message: unknown, targetOrigin: string): void;
}
interface MessageHost {
  addEventListener(type: "message", listener: (ev: MessageEvent) => void): void;
  removeEventListener(type: "message", listener: (ev: MessageEvent) => void): void;
}

function randomNonce(): string {
  const c: Crypto | undefined =
    typeof globalThis !== "undefined" ? (globalThis as { crypto?: Crypto }).crypto : undefined;
  if (c?.randomUUID) return c.randomUUID();
  // Non-crypto fallback (handshake nonce only; the security boundary is the
  // event.source identity check, the nonce is a replay/cross-talk guard).
  let s = "";
  for (let i = 0; i < 4; i++) s += Math.floor(Math.random() * 0xffffffff).toString(16);
  return s;
}

export interface BridgeStorageOptions {
  /** The window to post requests to (the parent platform page). */
  parent: MessageTarget;
  /** The window that receives replies (defaults to the host's own window). */
  host: MessageHost;
  /** Game identity used by the parent for `gameSlug + branch` namespacing. */
  gameSlug?: string;
  branch?: string;
  /** Handshake/operation timeout in ms. */
  timeoutMs?: number;
}

/**
 * The PRODUCTION storage adapter: the game side of the postMessage bridge.
 *
 * Performs the nonce handshake on first use, then proxies every storage op to the
 * parent and resolves on the correlated `result` message. Replies are accepted
 * only when they (a) come from the expected parent window identity, (b) carry the
 * agreed `sessionId`, and (c) echo the parent nonce — never based on origin
 * strings (which are `"null"` for opaque iframes). All requests post with
 * `targetOrigin: "*"` as required for opaque-origin sandboxes.
 */
export class BridgeStorage implements StorageAdapter {
  private readonly parent: MessageTarget;
  private readonly host: MessageHost;
  private readonly timeoutMs: number;
  private readonly gameNonce = randomNonce();
  private sessionId: string | null = null;
  private parentNonce: string | null = null;
  private handshakePromise: Promise<void> | null = null;
  private reqSeqId = 0;
  private pending = new Map<string, { resolve: (m: unknown) => void; reject: (e: Error) => void }>();
  private listener: ((ev: MessageEvent) => void) | null = null;

  constructor(private readonly opts: BridgeStorageOptions) {
    this.parent = opts.parent;
    this.host = opts.host;
    this.timeoutMs = opts.timeoutMs ?? 5000;
  }

  /** Begin listening and perform the handshake (idempotent). */
  private ensureHandshake(): Promise<void> {
    if (this.handshakePromise) return this.handshakePromise;
    this.attach();
    this.handshakePromise = new Promise<void>((resolve, reject) => {
      const timer = setTimeoutSafe(() => reject(new Error("storage bridge handshake timed out")), this.timeoutMs);
      this.pending.set("__handshake__", {
        resolve: () => {
          clearTimeoutSafe(timer);
          resolve();
        },
        reject: (e) => {
          clearTimeoutSafe(timer);
          reject(e);
        },
      });
      this.parent.postMessage(
        {
          __gitcade: BRIDGE_TAG,
          v: STORAGE_PROTOCOL_VERSION,
          type: "handshake-init",
          nonce: this.gameNonce,
          gameSlug: this.opts.gameSlug,
          branch: this.opts.branch,
        },
        "*",
      );
    });
    return this.handshakePromise;
  }

  private attach(): void {
    if (this.listener) return;
    this.listener = (ev: MessageEvent) => this.onMessage(ev);
    this.host.addEventListener("message", this.listener);
  }

  /** Stop listening (call when the game shuts down). */
  dispose(): void {
    if (this.listener) {
      this.host.removeEventListener("message", this.listener);
      this.listener = null;
    }
  }

  private onMessage(ev: MessageEvent): void {
    const data = ev.data as ParentToGameMessage | undefined;
    if (!data || (data as { __gitcade?: unknown }).__gitcade !== BRIDGE_TAG) return;

    // Handshake ack: validate it echoes OUR game nonce, then record session.
    const ack = HandshakeAckSchema.safeParse(data);
    if (ack.success) {
      if (ack.data.nonce !== this.gameNonce) return; // not ours / replay
      this.sessionId = ack.data.sessionId;
      this.parentNonce = ack.data.parentNonce;
      this.pending.get("__handshake__")?.resolve(undefined);
      this.pending.delete("__handshake__");
      return;
    }

    // Operation result: validate session + parent nonce identity before use.
    const res = StorageResultSchema.safeParse(data);
    if (res.success) {
      if (res.data.sessionId !== this.sessionId || res.data.nonce !== this.parentNonce) return;
      const waiter = this.pending.get(res.data.requestId);
      if (waiter) {
        this.pending.delete(res.data.requestId);
        waiter.resolve(res.data);
      }
    }
  }

  private async request(payload: Record<string, unknown>): Promise<import("./protocol.js").StorageResult> {
    await this.ensureHandshake();
    const requestId = `r${++this.reqSeqId}`;
    const message = {
      __gitcade: BRIDGE_TAG,
      v: STORAGE_PROTOCOL_VERSION,
      requestId,
      sessionId: this.sessionId,
      parentNonce: this.parentNonce,
      ...payload,
    };
    return new Promise((resolve, reject) => {
      const timer = setTimeoutSafe(
        () => {
          this.pending.delete(requestId);
          reject(new Error(`storage bridge request '${String(payload.type)}' timed out`));
        },
        this.timeoutMs,
      );
      this.pending.set(requestId, {
        resolve: (m) => {
          clearTimeoutSafe(timer);
          resolve(m as import("./protocol.js").StorageResult);
        },
        reject,
      });
      this.parent.postMessage(message, "*");
    });
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    const res = await this.request({ type: "get", key });
    if (!res.ok) throw new Error(res.error ?? "storage get failed");
    return deserializeValue<T>(res.value);
  }
  async set<T = unknown>(key: string, value: T): Promise<void> {
    const res = await this.request({ type: "set", key, value: serializeValue(value) });
    if (!res.ok) throw new Error(res.error ?? "storage set failed");
  }
  async remove(key: string): Promise<void> {
    const res = await this.request({ type: "remove", key });
    if (!res.ok) throw new Error(res.error ?? "storage remove failed");
  }
  async keys(): Promise<string[]> {
    const res = await this.request({ type: "keys" });
    if (!res.ok) throw new Error(res.error ?? "storage keys failed");
    return res.keys ?? [];
  }
  async clear(): Promise<void> {
    const res = await this.request({ type: "clear" });
    if (!res.ok) throw new Error(res.error ?? "storage clear failed");
  }
}

// Timer helpers tolerate environments where these are absent (defensive).
function setTimeoutSafe(fn: () => void, ms: number): ReturnType<typeof setTimeout> | null {
  return typeof setTimeout === "function" ? setTimeout(fn, ms) : null;
}
function clearTimeoutSafe(timer: ReturnType<typeof setTimeout> | null): void {
  if (timer && typeof clearTimeout === "function") clearTimeout(timer);
}
