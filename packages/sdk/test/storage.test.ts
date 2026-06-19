import { describe, it, expect } from "vitest";
import {
  MemoryStorage,
  BridgeStorage,
  STORAGE_PROTOCOL_VERSION,
  BRIDGE_TAG,
} from "../src/index.js";

describe("MemoryStorage adapter", () => {
  it("round-trips values and lists/clears keys", async () => {
    const s = new MemoryStorage();
    expect(await s.get("hi")).toBeNull();
    await s.set("hi", { n: 1 });
    expect(await s.get("hi")).toEqual({ n: 1 });
    await s.set("two", 2);
    expect((await s.keys()).sort()).toEqual(["hi", "two"]);
    await s.remove("hi");
    expect(await s.get("hi")).toBeNull();
    await s.clear();
    expect(await s.keys()).toEqual([]);
  });
});

/**
 * A fake parent page that implements the protocol: validates source identity via
 * the handshake nonce, namespaces by gameSlug+branch, and replies with
 * targetOrigin "*". Mirrors what the platform's game page does.
 */
function makeFakeBridgePair(gameSlug: string, branch: string) {
  const listeners = new Set<(ev: MessageEvent) => void>();
  const host = {
    addEventListener: (_t: "message", l: (ev: MessageEvent) => void) => listeners.add(l),
    removeEventListener: (_t: "message", l: (ev: MessageEvent) => void) => listeners.delete(l),
  };
  const store = new Map<string, string>();
  let parentNonce = "parent-nonce";
  let sessionId = "session-1";
  let gameNonce: string | null = null;

  // The "parent" receives game→parent messages here and replies into the host.
  const parent = {
    postMessage: (msg: any) => {
      if (msg.type === "handshake-init") {
        gameNonce = msg.nonce;
        deliver({
          __gitcade: BRIDGE_TAG,
          v: STORAGE_PROTOCOL_VERSION,
          type: "handshake-ack",
          nonce: gameNonce,
          sessionId,
          parentNonce,
        });
        return;
      }
      if (msg.sessionId !== sessionId || msg.parentNonce !== parentNonce) return;
      const ns = `${gameSlug}:${branch}:`;
      const reply: any = {
        __gitcade: BRIDGE_TAG,
        v: STORAGE_PROTOCOL_VERSION,
        type: "result",
        requestId: msg.requestId,
        sessionId,
        nonce: parentNonce,
        ok: true,
      };
      switch (msg.type) {
        case "get":
          reply.value = store.has(ns + msg.key) ? store.get(ns + msg.key) : null;
          break;
        case "set":
          store.set(ns + msg.key, msg.value);
          break;
        case "remove":
          store.delete(ns + msg.key);
          break;
        case "keys":
          reply.keys = [...store.keys()].filter((k) => k.startsWith(ns)).map((k) => k.slice(ns.length));
          break;
        case "clear":
          for (const k of [...store.keys()]) if (k.startsWith(ns)) store.delete(k);
          break;
      }
      deliver(reply);
    },
  };

  function deliver(data: unknown): void {
    const ev = { data } as MessageEvent;
    for (const l of [...listeners]) l(ev);
  }

  return { host, parent };
}

describe("BridgeStorage (game side) + fake parent", () => {
  it("handshakes and round-trips values through postMessage", async () => {
    const { host, parent } = makeFakeBridgePair("pong", "main");
    const storage = new BridgeStorage({ host, parent, gameSlug: "pong", branch: "main", timeoutMs: 500 });

    expect(await storage.get("hi")).toBeNull();
    await storage.set("hi", { score: 9 });
    expect(await storage.get("hi")).toEqual({ score: 9 });
    await storage.set("two", 2);
    expect((await storage.keys()).sort()).toEqual(["hi", "two"]);
    await storage.remove("hi");
    expect(await storage.get("hi")).toBeNull();
    await storage.clear();
    expect(await storage.keys()).toEqual([]);
    storage.dispose();
  });

  it("namespaces saves by gameSlug + branch (different branches don't collide)", async () => {
    const main = makeFakeBridgePair("pong", "main");
    const fork = makeFakeBridgePair("pong", "feature");
    const sMain = new BridgeStorage({ host: main.host, parent: main.parent, gameSlug: "pong", branch: "main", timeoutMs: 500 });
    const sFork = new BridgeStorage({ host: fork.host, parent: fork.parent, gameSlug: "pong", branch: "feature", timeoutMs: 500 });

    await sMain.set("highscore", 10);
    await sFork.set("highscore", 99);
    // Each parent store is isolated; the namespacing prevents cross-branch reads.
    expect(await sMain.get("highscore")).toBe(10);
    expect(await sFork.get("highscore")).toBe(99);
    sMain.dispose();
    sFork.dispose();
  });
});
