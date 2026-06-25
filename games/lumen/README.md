# Lumen: Echoes of the Dusklands

A 2D side-scrolling platformer for GitCade. Guide **Lumen**, a luminous wisp, left-to-right
across the drifting twilight ruins of the **Dusklands** to the Beacon — over one-way ledges,
moving driftstones, spike corridors, a slope, a ladder, a riftgate pair, and a vertical lift,
dodging patrolling driftwraiths, a pursuing void hunter, a rift-sentry's bolts, and the void below.

**Headline feature — the Echo.** Every level's run is recorded; the *next* attempt opens with a
skippable, deterministic replay of your last run of the level you start on (a violet "Echo") before
live play. It rides the SDK run-recorder (`createGame({ seed, record:true })` → `getRecording()`) +
the library `attachReplayLoop` host helper — a fixed per-level seed means the Echo re-simulates
byte-for-byte in the identical world, so it lines up with how you play.

**Level-select with three modes.** Clear a beacon and it joins the level-select (the **≡ Level select**
button / **L** from the result or choice card). Any cleared level relaunches — from a *canonical* start
(full HP, no mid-campaign carry) — in one of three modes the host composes from library helpers:
**▶ Echo** (watch your best run replay, via `attachReplayIntro`), **👻 Race the Ghost** (live play with
your best run as a translucent, lockstep ghost on the same canvas, via `attachGhostRace`), and **⏱
Time-Trial** (a fresh run versus your best *time* — the deterministic tick count, never wall-clock).
The run-store ranks "best" by the **fastest** clear, so the ghost you race and the Echo you watch are
your speedrun.

## The game is data

Gameplay is **authored JSON composing `@gitcade/library` + SDK parts** — no gameplay logic in
code. Balance lives in [`config.json`](./config.json) (referenced as `$cfg.*`); the only code is
host glue in [`src/main.ts`](./src/main.ts) (audio, screen juice, pause, the Echo attempt loop, and
the level-select's multi-Game practice modes — replay / ghost-race / time-trial, the same kind of
host orchestration as `ScreenEffects`, since a behavior/system can't drive a second Game).

- [`src/scenes/play-base.json`](./src/scenes/play-base.json) — the shared shell (player, camera,
  systems, FX, and the `flow.persist` carry-over set), authored once. Each level `extends` it.
- [`src/scenes/level-1.json`](./src/scenes/level-1.json) (the Dusklands gauntlet) and
  [`src/scenes/level-2.json`](./src/scenes/level-2.json) (**The Sundering Reach** — a ~3× longer,
  taller two-path world: a safe GROUND line and an optional high CLOUDS line entered through a
  riftgate, holding the bonus motes + the emberstone, rejoining before the Beacon) are each
  **generated** by their own deterministic source — [`scripts/gen-level.mjs`](./scripts/gen-level.mjs)
  (`npm run gen:level`) for level-1, [`scripts/gen-level-2.mjs`](./scripts/gen-level-2.mjs)
  (`npm run gen:level-2`) for level-2 — exactly as `gen-art.mjs` is for the art. Edit the generator,
  not the JSON.
- Art: the committed, original `public/assets/lumen/*.png` (see [`ART.md`](./ART.md)) — generated
  by `npm run gen:art`, never synced from the library.
- The **HUD is data**: `screen:true` canvas entities in `play-base` — text widgets `bind` to the
  strings `format-binding` derives, and a `hud-bar` health bar reads the player's own `state.hp`
  (`valueEntity`). The engine draws them fixed under the follow-camera, so they stay put while the
  world scrolls — no DOM overlay, no host mirror.
- [`src/scenes/menu.json`](./src/scenes/menu.json) — the **level-select** is data too. A `persistence`
  system loads the run-store's progress index (`runWon` / `runBest`) into `world.state`; a
  `level-select` system projects it into per-level keys; text widgets `bind` to the cleared/locked
  status + best score/time; and each level card carries **three mode buttons** (Echo / Race / Time-Trial),
  each a `tap-emit` **gated on the won-set** (`requireKey: "<level>:sel"`) emitting a per-(level, mode)
  event routed via the SDK `@level:<id>` flow token. Reached from the result + choice cards
  (the **≡ Level select** button / **L**).

## Parts used (pinned to `@gitcade/library@1.13.0`)

Behaviors: `move-platformer@1.3.0`, `sprite-state-machine@1.0.0`, `face-velocity@1.0.0`,
`health-and-death@1.1.0`, `dust@1.0.0`, `collect-on-touch@1.0.0`, `tween@1.0.0`,
`ai-patrol@1.0.0`, `ai-chase@1.0.0`, `ai-aim-and-fire@1.1.0`, `contact-damage@1.0.0`,
`follow-path@1.1.0`, `portal@2.0.0`, `trigger-zone@1.1.0`, `hud-bar@1.1.0`
(+ SDK built-ins `velocity`, `sprite-animate`).
Systems: `camera-follow@2.0.0`, `camera-shake@1.0.0`, `score@1.0.0`, `lives-respawn@1.1.0`,
`format-binding@1.0.0`, `sparkle@1.0.0`, `explosion@1.0.0`, `persistence@1.0.0` (the level-select
loads the progress index), `level-select@1.0.0` (the menu's projection) (+ SDK built-in `aabb-collision`).
UI: `tap-emit@1.1.0` (the menu's per-(level, mode) buttons — gated on the won-set via `requireKey`).
Tile collision (solid / one-way / slope / ladder) is the SDK `collider` + tilemap-property path.

## Run

```bash
npm run gen:art      # (re)generate the committed art          — rarely needed
npm run gen:level    # (re)generate level-1.json               — after editing scripts/gen-level.mjs
npm run gen:level-2  # (re)generate level-2.json               — after editing scripts/gen-level-2.mjs
npm run gen:levels   # both of the above
npm run dev          # vite dev server
npm run build        # static /dist (the build-worker artifact)
npm test             # headless smoke + the Echo byte-replay determinism test
npm run validate     # gitcade validate . → exit 0 = publishable
```

Controls: **← → / A·D** move · **Space / W / ↑** jump · **↓ / S** drop-through & climb ·
**P / Esc** pause · **any key** skips the Echo · **L** level select (from the result / choice card).

## Notes

- **Two levels with carry-over.** `manifest.levels` sequences `level-1` → `level-2`. Reaching a
  non-final Beacon raises a between-levels card showing the stats you keep: motes, lives, and
  bestMotes ride `scene.flow.persist`, while the player's remaining **HP** rides
  `health-and-death@1.1.0`'s `hpStateKey:"carriedHp"` (the host stashes `player.state.hp` on
  `level-clear`; the next level's rebuilt player re-seeds its hp from it). A fresh *life* still
  respawns at full HP — the `lives-respawn` prototype keeps the static `$cfg.playerHp`. On
  `level-clear` the host `requestNextLevel()`s and re-arms the run recorder *immediately* (so the
  card shows over the freshly-loaded next level, and that level records from its own tick 0); a
  continue press just resumes. The **final** Beacon has no next level, so it emits `levels-complete`
  — the win. level-2's floor sits lower than level-1's, so it `scene.overrides` the inherited player
  spawn onto its own floor (the one field-level patch a taller level needs).
- **Per-level recordings + progress (the run-store).** The library `createRunStore({ metric: "fastest" })`
  is the single durable data layer: per level it keeps the LAST recording (the campaign attract-Echo
  source — recorded on its own per-level key, with NO scene change, since a recording spanning a level
  transition would desync on replay), the BEST recording (the fastest CLEAR — the level-select Replay
  showcase + the Race ghost), and the won-set + best score/time. The host calls `recordRun(…)` at every
  run-end; the index round-trips through `manifest.persist {slot:"progress", keys:["runWon","runBest"]}`
  so the level-select menu reads it as data via its `persistence` system. Best **time** is the run's
  deterministic tick count × `fixedDt` — never wall-clock, so it stays replay-consistent.
- **Level-select + practice modes (data + `@level`, host launch).** The result and choice cards reach a
  menu (`menu.json`) of every level: cleared levels show their best score/time and offer three mode
  buttons, locked levels don't. The menu is pure data (`level-select` projection + won-gated per-(level,
  mode) `tap-emit`s + `@level:<id>` flow edges). lumen's host boots it with `levels:[]` and intercepts
  each mode event to run the launch, so the in-engine `@level` jump no-ops there — the edges stay the
  portable, validator-checked contract a non-wrapping host follows (it would simply play the level). The
  three modes — **Echo** (`attachReplayIntro` over the best recording → back to the menu), **Race the
  Ghost** (live play + `attachGhostRace` over the best recording, the ghost a second headless Game proven
  *inert* to the live sim), and **Time-Trial** (a fresh run, live-vs-best surfaced on the badge + result)
  — ALL boot the level from a **canonical** start (full HP, nothing carried). The *only* carry is the
  campaign retry's `restoreRecordingEntry`; a practice launch deliberately skips it.
- **Checkpoints move the respawn point.** Each `trigger-zone` checkpoint writes its position to
  `world.state` (`setRespawnKey`), and `lives-respawn` (`respawnStateKey`) respawns there — so a
  mid-level death returns you to the last checkpoint, not the level start.
- **Level-2 void-threats (data, not code).** The Sundering Reach adds two new mechanics from existing
  catalog parts, no engine work. A **void hunter** (`ai-chase@1.0.0`) — a sleek fuchsia voidhound that
  pursues the player in full 2D but is SLOW, so you out-run it: it swoops across you once in the open
  post-pit flat, then trails. A **rift-sentry** (`ai-aim-and-fire@1.1.0`) — an arcane turret guarding the
  Beacon run-up that lobs slow `bolt` projectiles when you're in range; keep moving (or jump) and they
  miss. Each gets a SAFE-INTRO beat (seen across open, well-lit ground before it can threaten). Both are
  wired through the shared shell's `aabb-collision.pairs` (`player×hunter`, `player×bolt`), so their
  damage routes through the player's `health-and-death` — i.e. feeds the same one canonical death below.
- **One canonical death.** Spikes, the void, the hunter's touch, and a rift-sentry bolt all deal lethal
  `contact-damage` (not a raw `kill`), so every death drives the player's `health-and-death` and fires
  the single `died` event the host binds explosion + flash + shake to.
