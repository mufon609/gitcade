# packages/

Publishable npm packages that form the GitCade technical standard.

| Package | Path | Phase | Published as |
|---|---|---|---|
| SDK — schema + entity-component runtime + validator CLI | `packages/sdk/` | Phase 1 | `@gitcade/sdk` (public npm) |
| Component Library — behaviors, systems, entities, art, audio, UI, FX | `packages/library/` | Phases 2A + 2B | `@gitcade/library` (public npm) |

These are the frozen contracts the rest of the platform builds on. Per the
Locked Architecture Decisions (MASTER-PLAN.md §2), both are published to
**public npm** so standalone game repos and the build worker can resolve them
outside the monorepo; the monorepo uses workspace linking for internal
development only.

> Placeholder — the package directories are created by their respective phases.
> See **MASTER-PLAN.md** for the build order and per-phase prompts.
