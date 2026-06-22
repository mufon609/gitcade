# Lumen: Echoes of the Dusklands

A 2D side-scrolling platformer for GitCade. Guide **Lumen**, a luminous wisp, left-to-right
across the drifting twilight ruins of the **Dusklands** to the Beacon — over one-way ledges,
moving driftstones, spike corridors, a slope, a ladder, a riftgate pair, and a vertical lift,
dodging patrolling driftwraiths and the void below.

**Headline feature — the Echo.** Every attempt is recorded; the *next* attempt opens with a
skippable, deterministic replay of your last run (a violet "Echo") before live play. It rides
the SDK run-recorder (`createGame({ seed, record:true })` → `getRecording()`) + the library
`ReplayIntro` host helper — a fixed per-level seed means the Echo re-simulates byte-for-byte in
the identical world, so it lines up with how you play.

## The game is data

Gameplay is **authored JSON composing `@gitcade/library` + SDK parts** — no gameplay logic in
code. Balance lives in [`config.json`](./config.json) (referenced as `$cfg.*`); the only code is
host glue in [`src/main.ts`](./src/main.ts) (audio, screen juice, pause, and the Echo attempt loop).

- [`src/scenes/play-base.json`](./src/scenes/play-base.json) — the shared shell (player, camera,
  systems, FX), authored once. A future level-2 unit `extends` it.
- [`src/scenes/level-1.json`](./src/scenes/level-1.json) — **generated** by
  [`scripts/gen-level.mjs`](./scripts/gen-level.mjs) (`npm run gen:level`), the deterministic
  source for the 100×15 tilemap + obstacle layout, exactly as `gen-art.mjs` is for the art. Edit
  the generator, not the JSON.
- Art: the committed, original `public/assets/lumen/*.png` (see [`ART.md`](./ART.md)) — generated
  by `npm run gen:art`, never synced from the library.
- The **HUD is data**: `screen:true` canvas entities in `play-base` — text widgets `bind` to the
  strings `format-binding` derives, and a `hud-bar` health bar reads the player's own `state.hp`
  (`valueEntity`). The engine draws them fixed under the follow-camera, so they stay put while the
  world scrolls — no DOM overlay, no host mirror.

## Parts used (pinned to `@gitcade/library@1.13.0`)

Behaviors: `move-platformer@1.3.0`, `sprite-state-machine@1.0.0`, `face-velocity@1.0.0`,
`health-and-death@1.0.0`, `dust@1.0.0`, `collect-on-touch@1.0.0`, `tween@1.0.0`,
`ai-patrol@1.0.0`, `contact-damage@1.0.0`, `follow-path@1.1.0`, `portal@1.0.0`,
`trigger-zone@1.1.0`, `hud-bar@1.1.0` (+ SDK built-ins `velocity`, `sprite-animate`).
Systems: `camera-follow@2.0.0`, `camera-shake@1.0.0`, `score@1.0.0`, `lives-respawn@1.1.0`,
`format-binding@1.0.0`, `sparkle@1.0.0`, `explosion@1.0.0` (+ SDK built-in `aabb-collision`).
Tile collision (solid / one-way / slope / ladder) is the SDK `collider` + tilemap-property path.

## Run

```bash
npm run gen:art      # (re)generate the committed art        — rarely needed
npm run gen:level    # (re)generate src/scenes/level-1.json  — after editing the generator
npm run dev          # vite dev server
npm run build        # static /dist (the build-worker artifact)
npm test             # headless smoke + the Echo byte-replay determinism test
npm run validate     # gitcade validate . → exit 0 = publishable
```

Controls: **← → / A·D** move · **Space / W / ↑** jump · **↓ / S** drop-through & climb ·
**P / Esc** pause · **any key** skips the Echo.

## Notes

- **Checkpoints move the respawn point.** Each `trigger-zone` checkpoint writes its position to
  `world.state` (`setRespawnKey`), and `lives-respawn` (`respawnStateKey`) respawns there — so a
  mid-level death returns you to the last checkpoint, not the level start.
- **One canonical death.** Spikes and the void deal lethal `contact-damage` (not a raw `kill`), so
  every death — spike, void, or a drained wraith — drives the player's `health-and-death` and fires
  the single `died` event the host binds explosion + flash + shake to.
- **Catalog sync:** `@gitcade/library`'s `package.json` was already `1.13.0` but its generated
  `CATALOG.json` version header still read `1.12.1` (it only regenerates at publish). Regenerated
  via `npm run catalog` (version-header only; parts byte-identical) so `part:"id@1.x"` provenance
  pinned to `1.13.0` resolves. No part definitions changed.
