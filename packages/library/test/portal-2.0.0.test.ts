import { describe, it, expect } from "vitest";
import { makeWorld, makeEntity, collide } from "./helpers.js";
import { portal } from "../src/behaviors/portal.js";

/**
 * 2.0.0 (BREAKING) — portal is the 1.13.0 batch's one MAJOR part bump: a full rewrite from the
 * old timer/cooldown model to a TIMER-FREE CONTACT-EDGE trigger. An entrant teleports ONCE on the
 * tick it goes not-overlapping → overlapping, and not again until it leaves and returns; an entrant
 * PLACED onto the paired exit by a teleport is never bounced back — arrival is suppressed on the
 * DESTINATION's own state, so it holds regardless of the two portals' order in the behavior pass.
 * Both per-portal records (`__portalInside` / `__portalArrived`) ride the snapshot, so replays and
 * ghosts stay in lockstep across engines. These cases pin that breaking contract; no `portal@0.x` /
 * `@1.x` pin survives anywhere in the repo.
 */
const DT = 1 / 60;

describe("portal", () => {
  it("teleports a tagged entity to a fixed destination point on a fresh edge", () => {
    const world = makeWorld();
    const p = makeEntity(world, { id: "portal", x: 0, y: 0, w: 20, h: 20, tags: ["portal"] });
    const player = makeEntity(world, { id: "p", x: 5, y: 5, w: 16, h: 16, tags: ["player"] });
    collide(p, player);
    portal(p, world, { tag: "player", to: { x: 400, y: 300 } }, DT);
    expect(player.cx).toBe(400);
    expect(player.cy).toBe(300);
  });

  // A paired-portal fixture that faithfully reproduces the engine tick model: collisions are CLEARED
  // and recomputed from CURRENT positions (the aabb-collision system) BEFORE behaviors run, so a
  // mid-tick teleport only appears in the destination's collisions on the NEXT tick — exactly the
  // ordering the timer-free edge model is designed against (see game.ts fixed-update order).
  function pairedRifts(order: "AB" | "BA" = "AB") {
    const world = makeWorld();
    const riftA = makeEntity(world, { id: "rift-A", x: 100, y: 100, w: 32, h: 48, tags: ["rift"] });
    const riftB = makeEntity(world, { id: "rift-B", x: 500, y: 100, w: 32, h: 48, tags: ["rift"] });
    const player = makeEntity(world, { id: "player", x: 0, y: 0, w: 16, h: 16, tags: ["player"] });
    const paramsFor = (r: typeof riftA) => ({ tag: "player", targetId: r === riftA ? "rift-B" : "rift-A" });
    let teleports = 0;
    world.events.on("portal", () => (teleports += 1));

    const overlap = (a: typeof riftA, b: typeof player) =>
      a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    const placeOn = (r: typeof riftA) => {
      player.x = r.x + r.w / 2 - player.w / 2;
      player.y = r.y + r.h / 2 - player.h / 2;
    };
    const tick = () => {
      for (const e of [riftA, riftB, player]) e.collisions.length = 0;
      if (overlap(riftA, player)) collide(riftA, player);
      if (overlap(riftB, player)) collide(riftB, player);
      const run = order === "AB" ? [riftA, riftB] : [riftB, riftA];
      for (const r of run) portal(r, world, paramsFor(r), DT);
    };
    return { world, riftA, riftB, player, placeOn, tick, teleports: () => teleports };
  }

  it("teleports ONCE on a fresh entry to the paired exit", () => {
    const { riftA, riftB, player, placeOn, tick, teleports } = pairedRifts();
    tick(); // player off both rifts → nothing
    expect(teleports()).toBe(0);

    placeOn(riftA); // walk onto rift-A
    tick(); // fresh edge → teleport to rift-B's center
    expect(teleports()).toBe(1);
    expect(player.cx).toBe(riftB.cx);
    expect(player.cy).toBe(riftB.cy);
  });

  it("does NOT bounce back while the entrant LINGERS on the exit (the regression)", () => {
    const { riftA, riftB, player, placeOn, tick, teleports } = pairedRifts();
    placeOn(riftA);
    tick(); // teleport A → B (once)
    expect(teleports()).toBe(1);

    // Hold still on rift-B far past any old cooldown horizon. The timer version re-fired every
    // `cooldown` seconds (~48 ticks at 0.8s), ping-ponging B → A → B; the edge version never does.
    for (let i = 0; i < 200; i++) tick();
    expect(teleports()).toBe(1); // still exactly one teleport — no bounce-back
    expect(player.cx).toBe(riftB.cx); // still on B, never returned to A
  });

  it("re-fires only after the entrant moves OFF and back ON", () => {
    const { riftA, riftB, player, placeOn, tick, teleports } = pairedRifts();
    placeOn(riftA);
    tick(); // A → B
    for (let i = 0; i < 5; i++) tick(); // linger on B (no re-fire)
    expect(teleports()).toBe(1);

    player.x = 0; // step OFF every rift
    player.y = 0;
    tick(); // leaving clears the occupying mark
    expect(teleports()).toBe(1);

    placeOn(riftB); // step back ON rift-B → a genuine fresh edge
    tick();
    expect(teleports()).toBe(2);
    expect(player.cx).toBe(riftA.cx); // sent back to A this time
    expect(player.cy).toBe(riftA.cy);
  });

  it("suppresses the arrival regardless of the two portals' tick order", () => {
    // Run the destination portal's behavior BEFORE the source's. The arrival marker lives on the
    // destination's STATE (set by the source, read at the top of the destination's NEXT tick), so a
    // teleport still fires exactly once and the arrival is still suppressed — order-independent.
    const { riftA, riftB, player, placeOn, tick, teleports } = pairedRifts("BA");
    placeOn(riftA);
    tick(); // A → B
    expect(teleports()).toBe(1);
    tick(); // first tick the entrant is seen on B: consumed as an arrival, NOT bounced
    expect(teleports()).toBe(1);
    expect(player.cx).toBe(riftB.cx);
  });
});
