# GitCade

**Git for Gamers** — a platform where AI-built, open-source browser games are
published, played, forked, remixed, and governed by community vote.

Three pillars no platform combines today: **GitHub-style forking** (every game
is a git repo; every branch is playable in one click), **OSRS-style governance**
(communities vote on proposals at a 70% threshold — and if you lose the vote,
fork it and build it anyway), and **a component marketplace as the standard**
(games are assembled from interoperable parts; compliance unlocks a free
library). Scope for v1 is single-player browser games only.

## Documentation

| Doc | What it owns |
|---|---|
| **[MASTER-PLAN.md](./MASTER-PLAN.md)** | The source of truth: vision, Locked Architecture Decisions (§2), build order + monorepo layout (§3), every phase prompt + Definition of Done, and the validation gates (§4). |
| **[CLAUDE.md](./CLAUDE.md)** | The operating contract — how each build session works (one phase per session, frozen contracts, escalation). |
| **[ENVIRONMENT.md](./ENVIRONMENT.md)** | The machine contract: what's installed, the no-sudo rule, ports, container traps, escalation protocol. |
| **[DECISIONS.md](./DECISIONS.md)** | Assumptions and reversible choices, appended by every phase. |
| **[infra/README.md](./infra/README.md)** | Deployment topology (app vs. worker vs. storage). |
| **[setup/](./setup/)** | One-time machine setup (`setup-kali.sh`), the human `CHECKLIST.md`, and `.env.example`. |

## Build phases

GitCade is built one phase per session, each ending at a handoff contract the
next phase depends on. Full prompts and Definitions of Done are in
**[MASTER-PLAN.md](./MASTER-PLAN.md)**.

| Phase | What it delivers |
|---|---|
| **0 — Infrastructure** | Accounts, credentials, and this monorepo skeleton. *(you are here)* |
| **1 — SDK** | `@gitcade/sdk`: schema + entity-component runtime + validator CLI + Pong proof. The frozen contract. |
| **2A — Library: logic** | Behaviors + systems, proven across four genres. |
| **2B — Library: presentation** | Entities, procedural art, synthesized audio, UI, FX. |
| **3 — Seed games** | Six complete games (Snake, Helicopter, Breakout, Tower Defense, Idle Clicker, Survival Arena) in standalone repos. |
| **4A — Build worker** | Repo → validated, stored, servable artifact, in isolation. Plus the artifact server. |
| **4B — Platform site** | Next.js app: publish from a repo, browse, play in a sandboxed iframe. |
| **5 — Fork engine** | One-click fork, branch play, fork tree, side-by-side compare. |
| **6 — Marketplace** | Browse parts, see what each game is made of, remix without code. |
| **7 — Governance** | Proposals, 70% voting, owner veto, passed votes that become commits. |
| **8 — Hardening + launch** | Security, performance, onboarding, ops. |

## Monorepo layout

```
gitcade/
├── packages/      # @gitcade/sdk (P1), @gitcade/library (P2A+2B)
├── games/         # six seed games (P3), later moved to standalone repos
├── platform/      # build worker + artifact server (P4A), Next.js web app (P4B+)
├── templates/     # game-scaffold (P1)
├── infra/         # deployment topology docs
├── setup/         # one-time machine setup + .env.example
├── DECISIONS.md   # assumptions, appended every phase
├── MASTER-PLAN.md # the source of truth
├── CLAUDE.md      # operating contract
└── ENVIRONMENT.md # machine contract
```

## Local development

This is an npm-workspaces monorepo on Node 22. One-time machine prep (system
packages, Docker, local Postgres + MinIO) is handled by
[`setup/setup-kali.sh`](./setup/setup-kali.sh); copy `setup/.env.example` to
`.env` and fill the external-account blanks per
[`setup/CHECKLIST.md`](./setup/CHECKLIST.md). Per-phase build instructions live
in **[MASTER-PLAN.md](./MASTER-PLAN.md)**.

## License

Code MIT, assets CC-BY (enforced at upload). See MASTER-PLAN.md §2.
