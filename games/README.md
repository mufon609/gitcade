# games/

The six seed games that prove the standard composes (Phase 3):
**Snake, Helicopter, Breakout, Tower Defense, Idle Clicker, Survival Arena.**

Each is scaffolded from `templates/game-scaffold` and composes **only** parts
from `@gitcade/library` (referenced as `partId@version`) plus its own
`config.json` and scene definitions. Each game pins exact `sdkVersion` +
`libraryVersion` from public npm — **not** workspace links — because at the end
of Phase 3 each game moves to its own standalone GitHub repo and the Phase 4A
build worker must resolve everything from a public registry.

> Placeholder — the game directories are created in Phase 3.
> See **MASTER-PLAN.md** (Phase 3) for the build prompt and Definition of Done.
