# packages/

Publishable npm packages that form the GitCade technical standard.

| Package | Path | Published as |
|---|---|---|
| SDK — schema + entity-component runtime + validator CLI | `packages/sdk/` | `@gitcade/sdk` (public npm) |
| Component Library — behaviors, systems, entities, art, audio, UI, FX | `packages/library/` | `@gitcade/library` (public npm) |

These are the frozen contracts the rest of the platform builds on. Both are
published to **public npm** so standalone game repos and the build worker can
resolve them outside the monorepo; the monorepo uses workspace linking for
internal development only.
