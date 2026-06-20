# examples/

Reference games that exercise `@gitcade/sdk` directly inside the monorepo (via the
workspace link). They are **not** seed content — the six launch games live in
`games/` and ship as standalone GitHub repos.

| Example | Path | Proves |
|---|---|---|
| Pong | `examples/pong/` | A complete game built **only** from SDK primitives + JSON — zero custom code. Proof that the runtime model is strong enough. |

`examples/*` is part of the root npm workspaces so these resolve `@gitcade/sdk`
during development.
