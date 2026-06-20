// End-to-end protocol round-trip: the REAL SDK game-side BridgeStorage talking to
// our parent-side ParentBridge over a fake postMessage channel. This proves the
// two halves of the FROZEN bridge protocol interoperate — identity + nonce
// handshake, namespacing, and isolation — without a browser.
import { describe, it, expect } from "vitest";
import { BridgeStorage } from "@gitcade/sdk";
import { ParentBridge, memoryBridgeStore, bridgeKeyPrefix } from "@/lib/bridge";

interface Listener {
  (ev: { data: unknown; source: unknown }): void;
}

/** Wire one game BridgeStorage to one ParentBridge sharing a parent store. */
function wireGame(opts: {
  slug: string;
  branch: string;
  store: ReturnType<typeof memoryBridgeStore>;
  // Optional: a different identity object to simulate a spoofed source.
}) {
  const gameListeners = new Set<Listener>();
  const gameSource = { id: `game:${opts.slug}` }; // stands in for iframe.contentWindow
  const parentSource = { id: "parent" };

  let parent: ParentBridge;
  const gameHost = {
    addEventListener: (_t: "message", l: Listener) => gameListeners.add(l),
    removeEventListener: (_t: "message", l: Listener) => gameListeners.delete(l),
  };
  const parentTarget = {
    // game → parent
    postMessage: (msg: unknown, _origin: string) => {
      void parent.handle(msg, gameSource);
    },
  };
  parent = new ParentBridge({
    gameSlug: opts.slug,
    branch: opts.branch,
    expectedSource: gameSource,
    store: opts.store,
    // parent → game
    reply: (msg) => {
      for (const l of gameListeners) l({ data: msg, source: parentSource });
    },
    randomId: (() => {
      let n = 0;
      return () => `${opts.slug}-id-${++n}`;
    })(),
  });

  const storage = new BridgeStorage({
    parent: parentTarget,
    host: gameHost as unknown as {
      addEventListener: (t: "message", l: (ev: MessageEvent) => void) => void;
      removeEventListener: (t: "message", l: (ev: MessageEvent) => void) => void;
    },
    gameSlug: opts.slug,
    branch: opts.branch,
    timeoutMs: 2000,
  });

  return { storage, parent, gameSource };
}

describe("storage bridge round-trip (game ↔ parent)", () => {
  it("performs the handshake and round-trips set/get with JSON values", async () => {
    const store = memoryBridgeStore();
    const { storage } = wireGame({ slug: "snake", branch: "main", store });

    await storage.set("highscore", { score: 4096, level: 7 });
    const got = await storage.get<{ score: number; level: number }>("highscore");
    expect(got).toEqual({ score: 4096, level: 7 });
  });

  it("persists under a gameSlug+branch namespace in the parent store", async () => {
    const store = memoryBridgeStore();
    const { storage } = wireGame({ slug: "snake", branch: "main", store });
    await storage.set("k", "v");
    const keys = await storage.keys();
    expect(keys).toContain("k");
    // The parent stored it namespaced, not as the bare key.
    const raw = await store.get(bridgeKeyPrefix("snake", "main") + "k");
    expect(raw).toBe(JSON.stringify("v"));
    expect(await store.get("k")).toBeNull();
  });

  it("isolates saves across branches and games (no cross-talk)", async () => {
    const store = memoryBridgeStore();
    const a = wireGame({ slug: "snake", branch: "main", store });
    const b = wireGame({ slug: "snake", branch: "feature", store });
    const c = wireGame({ slug: "breakout", branch: "main", store });

    await a.storage.set("save", "A");
    await b.storage.set("save", "B");
    await c.storage.set("save", "C");

    expect(await a.storage.get("save")).toBe("A");
    expect(await b.storage.get("save")).toBe("B");
    expect(await c.storage.get("save")).toBe("C");
    expect(await a.storage.keys()).toEqual(["save"]); // only its own namespace
  });

  it("supports remove and clear scoped to the game", async () => {
    const store = memoryBridgeStore();
    const a = wireGame({ slug: "snake", branch: "main", store });
    const other = wireGame({ slug: "breakout", branch: "main", store });
    await a.storage.set("x", 1);
    await a.storage.set("y", 2);
    await other.storage.set("z", 3);

    await a.storage.remove("x");
    expect(await a.storage.keys()).toEqual(["y"]);

    await a.storage.clear();
    expect(await a.storage.keys()).toEqual([]);
    // clear() must NOT touch another game's data.
    expect(await other.storage.get("z")).toBe(3);
  });

  it("drops messages whose source identity is not the expected iframe window", async () => {
    const store = memoryBridgeStore();
    const { parent } = wireGame({ slug: "snake", branch: "main", store });
    // A spoofed handshake from a different window object must be ignored.
    await parent.handle(
      { __gitcade: "gitcade.storage", v: 1, type: "handshake-init", nonce: "evil" },
      { id: "attacker" },
    );
    // No session established → a subsequent (also spoofed) set is dropped silently.
    await parent.handle(
      {
        __gitcade: "gitcade.storage",
        v: 1,
        type: "set",
        key: "k",
        value: '"x"',
        requestId: "r1",
        sessionId: "whatever",
        parentNonce: "whatever",
      },
      { id: "attacker" },
    );
    expect(await store.get("gc snake main k")).toBeNull();
  });
});
