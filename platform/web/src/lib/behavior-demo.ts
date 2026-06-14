// Client-only: boot a tiny SDK micro-scene that exercises ONE catalog behavior in
// a live game loop, for the marketplace behavior preview. Dynamic-imported so the
// SDK/library never enter the initial bundle. Best-effort + defensive: any failure
// throws and the caller degrades to "preview unavailable".
//
// The scene is a small bounded world with a single actor that carries the behavior
// under test, plus the SDK `velocity` integrator and `bounce-world-edges`, and a
// throwaway "demo-seed" behavior that gives it an initial velocity so motion is
// visible. The point is to prove the behavior is real code running on the frozen
// SDK runtime — not to reproduce its host game.
import type { BehaviorFn } from "@gitcade/sdk";

/** Recursively collect `$cfg.<path>` keys referenced anywhere in a value. */
function collectCfgKeys(value: unknown, out: Set<string>): void {
  if (typeof value === "string") {
    const m = value.match(/^\$cfg\.(.+)$/);
    if (m) out.add(m[1]);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectCfgKeys(v, out);
    return;
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) collectCfgKeys(v, out);
  }
}

/** A sane numeric default for a tunable, inferred from its key name. */
function defaultFor(key: string): number {
  const k = key.toLowerCase();
  if (/(interval|cooldown|time|delay|duration)/.test(k)) return 0.8;
  if (/(speed|vel)/.test(k)) return 70;
  if (/(range|radius|dist)/.test(k)) return 120;
  if (/(damage|dmg|value|gain|amount)/.test(k)) return 5;
  if (/(hp|health|lives|count|max)/.test(k)) return 5;
  return 40;
}

export async function bootBehaviorMicroScene(
  host: HTMLElement,
  behaviorType: string,
  size = 96,
): Promise<() => void> {
  const sdk = await import("@gitcade/sdk");
  const lib = await import("@gitcade/library");
  const { createGame } = sdk;
  const registry = lib.createLibraryRegistry().clone();

  if (!registry.hasBehavior(behaviorType)) {
    throw new Error(`behavior "${behaviorType}" is not a runtime type (no live demo)`);
  }

  // A throwaway behavior that seeds an initial velocity once, so the actor moves.
  const demoSeed: BehaviorFn = (entity) => {
    const e = entity as unknown as { state: Record<string, unknown>; vx: number; vy: number };
    if (!e.state.__seeded) {
      e.state.__seeded = true;
      e.vx = 55;
      e.vy = 35;
    }
  };
  registry.registerBehavior("demo-seed", demoSeed);

  // The behavior under test, with its catalog default params (fetched via the part
  // API so $cfg keys resolve to real defaults). Falls back to no params.
  let params: Record<string, unknown> = {};
  try {
    const res = await fetch(`/api/parts/${encodeURIComponent(behaviorType)}`);
    if (res.ok) {
      const data = await res.json();
      params = (data?.definition?.params as Record<string, unknown>) ?? {};
    }
  } catch {
    /* defaults */
  }

  const cfgKeys = new Set<string>();
  collectCfgKeys(params, cfgKeys);
  const config: Record<string, number> = {};
  for (const k of cfgKeys) config[k] = defaultFor(k);

  const W = 220;
  const H = 220;
  const manifest = {
    name: "demo",
    slug: "behavior-demo",
    description: "",
    version: "0.0.0",
    engine: "gitcade-sdk",
    sdkVersion: "0.1.0",
    entryPoint: "demo.json",
    license: "MIT",
    authors: ["preview"],
    tier: "open",
  };
  const scene = {
    id: "demo",
    size: { width: W, height: H },
    background: "#0b0b16",
    entities: [
      {
        id: "actor",
        sprite: { kind: "shape", shape: "circle", color: "#7af7c8" },
        size: { w: 22, h: 22 },
        position: { x: W / 2, y: H / 2 },
        tags: ["actor", "player"],
        layer: 2,
        behaviors: [
          { type: "demo-seed", params: {} },
          { type: behaviorType, params },
          { type: "velocity", params: {} },
          { type: "bounce-world-edges", params: {} },
        ],
      },
    ],
    systems: [],
  };

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  canvas.style.width = `${Math.round(size * 1.6)}px`;
  canvas.style.height = `${Math.round(size * 1.6)}px`;
  canvas.style.imageRendering = "pixelated";
  host.innerHTML = "";
  host.appendChild(canvas);

  const game = createGame(
    { manifest, config, scenes: [scene] },
    { canvas, registry, attachInput: false },
  );
  game.start();
  return () => game.stop();
}
