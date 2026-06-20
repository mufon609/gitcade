# Releasing GitCade

Cutting a release of `@gitcade/sdk` + `@gitcade/library` (and the repinned game
artifacts) is **four commands**. The tools are the source of truth — this doc is just
the order. Full runbook: [`tools/release/README.md`](./tools/release/README.md).

```bash
npm run release:doctor              # audit role→pin invariants + creds (read-only); fix issues before continuing
npm run release:sync                # apply the pin policy + regen catalog + refresh lockfile (idempotent)
npm run release:gate                # clean `npm ci` install + build + test + validate + npm pack --dry-run
npm run release:publish             # SAFE BY DEFAULT — a rehearsal (dry-run); mutates nothing
npm run release:publish -- --yes    # the REAL publish: npm + monorepo push + game repos + MinIO artifacts
```

- **`publish` is safe by default.** A real publish runs ONLY with an explicit `-- --yes`. Every other
  form — bare, `--dry-run`, or even `--yes` *without* the `--` (npm swallows it) — is a rehearsal that
  mutates nothing. So a mistyped flag can never trigger an irreversible publish.
- **Version bumps are a human decision** (see [CLAUDE.md](./CLAUDE.md) → release protocol): bump
  `packages/sdk` and/or `packages/library` `version` first; `sync` propagates it everywhere else.
- sdk and library may be at **different versions** — `publish` reads each package's own version and
  **skips any already on npm** (idempotent/resumable), so a re-run after a partial failure is safe.
- The role → pin policy lives in **one place**, [`tools/release/policy.mjs`](./tools/release/policy.mjs)
  (role derived from path; `doctor` fails loud on any unclassified package). Tooling tests:
  `npm run release:test`.
