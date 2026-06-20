# The Reuse Proof

The heart of the library's reuse claim. Four **distinct genres**, each a real
`gitcade validate`-able ecosystem game, built from the **same four library parts**:

| part | role across all four genres |
|---|---|
| `ai-chase` | the threat moves toward a target |
| `contact-damage` | touching something hurts it |
| `wave-spawner` | the threat arrives in escalating waves |
| `health-and-death` | mortal things track hp and die |

plus SDK built-ins (`velocity`, `aabb-collision`, `clamp-to-world`) and a player
control/feedback part per genre. **No genre needed a one-off behavior.** Where a
genre seemed to want something new, an existing part was *generalized* instead:

- **`ai-chase` gained `lockAxis`** — so the same chaser produces straight-down
  **space-invaders descent**, not just omnidirectional pursuit.
- **`health-and-death` gained `lifespan`** — so the same part also expires bullets
  and melee hitboxes, instead of a separate TTL behavior.

## The four demos

| folder | genre | how the four parts express it |
|---|---|---|
| `snake-threat/` | snake-tail threat | a growing swarm chases and contact-damages the idle player to death |
| `creep-wave/` | tower defense | creeps chase the core; static towers (just `contact-damage`) cut them down |
| `arena-mobs/` | survival arena | scaling waves swarm a thorns player; adds the storage-backed `score` system |
| `invaders-descent/` | space invaders | Y-locked invaders descend their column; the ship's `shoot` bullets kill them |

## Running them

Each demo is its own workspace package (mirroring how ecosystem games and the
build worker consume `@gitcade/library` from npm). Build the library
first, then:

```bash
# from a demo folder, e.g. proofs/arena-mobs
npm test                 # headless smoke: boots, runs to a deterministic win/lose
npm run validate         # gitcade validate . — schema + no-magic-numbers + smoke

# or all four at once, from the repo root:
npm run validate:proofs
```

The demos reference parts by `type` (not `partId@version` provenance), so they
validate in-monorepo without a published catalog in `node_modules` — exactly how
a developer iterates before publishing.
