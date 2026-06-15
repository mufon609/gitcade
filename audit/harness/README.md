# GitCade engine-audit observation harness

A re-runnable rig that loads an **arbitrary SDK scene** in a real headless Chrome,
drives scripted input (keyboard codes + pointer clicks at **world coordinates**),
and samples — over a timeline — canvas-pixel hashes, `world.state`, live entity
positions, console messages, page errors, request failures, and (via `eval`
probes) the runtime API surface a data-driven part can actually reach.

Every "works"/"broken" verdict in [`../ENGINE-AUDIT.md`](../ENGINE-AUDIT.md) is
backed by a report this produced (the `out-*.json` files here). Stage 4 per-game
audits reuse it.

## Why it's trustworthy

A scene boots through the **same path a real game uses** — `createGame` + a
registry preloaded with the whole component library (`createLibraryRegistry`),
exactly like `templates/game-scaffold/src/main.ts`. So what the harness observes
is what a shipped game observes. The fixed-timestep sim is advanced by the driver
(`step N`), not by `requestAnimationFrame`, so timelines are deterministic and
reproducible run-to-run. The canvas renders 1:1 at the page origin, so a click at
client `(x,y)` lands at world `(x,y)`, and Chrome synthesizes the pointer events
the SDK's `Input.attach` listens on — the real public input path.

## Run it

```bash
# one probe → JSON report on stdout
node audit/harness/harness.mjs audit/harness/scenarios/02-wave-spawner.mjs

# regenerate every captured report (out-*.json)
for s in 01-scene-transition 02-wave-spawner 03-pointer-pick \
         04-tilemap-query 05-spawn-placement 06-economy; do
  node audit/harness/harness.mjs audit/harness/scenarios/$s.mjs 2>/dev/null \
    > audit/harness/out-$s.json
done

# self-test the harness itself (a rect moving at 60px/s)
node audit/harness/harness.mjs audit/harness/scenarios/00-smoke.mjs
```

The harness rebuilds its browser bundle from the monorepo's current `dist/`
on every run (`build-bundle.mjs`), so it always reflects current SDK + library
source — rebuild the packages (`npm run build`) first if you changed them.

Headed (watch it play — an X11 session is present): set `headed: true` on the
scenario's default export, or `CHROME_BIN=...` to override the browser.

## Files

| File | Role |
|---|---|
| `harness.mjs` | Driver: static server + puppeteer + scripted actions + sampling. CLI + `runScenario()`. |
| `entry.mjs` | Browser control surface (`window.__GC`): boot / step / state / entities / pointers / `apiSurface` / `tryLoadScene`. |
| `host.html` | Minimal page: a canvas + the bundle. |
| `build-bundle.mjs` | esbuild bundle of `entry.mjs` (pulls SDK + library from workspace `dist/`). |
| `scenarios/*.mjs` | One repro per capability probe. Each default-exports `{ sources, actions, bootOpts? }`. |
| `out-*.json` | Captured reports — the evidence cited by the audit. |

## Action vocabulary (declarative, in `scenarios/*.mjs`)

- `{ step: N }` — advance N fixed frames, then sample
- `{ keydown: "ArrowUp" }` / `{ keyup: "ArrowUp" }` — `KeyboardEvent.code` values
- `{ click: {x,y}, holdFrames: N }` — pointer down at world (x,y), hold N frames
  (captures `activePointers()` mid-hold), then up
- `{ eval: "() => window.__GC.apiSurface()" }` — run a probe, result recorded in
  the timeline entry's `eval` field
- `label` on any action overrides the timeline label; `sample: false` skips the
  snapshot

Each timeline entry records: `label`, canvas `hash` + `nonzero` pixel count,
`state` (deep `world.state`), `entities` (id/tags/pos/size/vel), and any `eval`.
