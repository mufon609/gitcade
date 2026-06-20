# PERFORMANCE.md — GitCade Performance Pass

Optimization only — **no new features**. Every item below is backed by a **measured
before/after** (Lighthouse scores, `EXPLAIN ANALYZE` plans, query counts, queue
load numbers), not "should be faster". Frozen contracts were respected: no table was
reshaped (the frozen `BuildJob`/`Build` tables are byte-identical), and no
SDK/library/queue-schema/artifact-URL/storage-bridge/CSP contract changed.

Measured on the dev box (Postgres 16, MinIO, Chrome-for-Testing 148) on 2026-06-15.

---

## 1. DB indexes on hot paths — EXPLAIN-proven

### Method
The dev DB has only 8 games, so its planner seq-scans everything regardless of
indexing — useless for proving index *selection*. So a throwaway **`gitcade_perf`**
database was created with the **identical schema** and **realistic volume** (5,000
games, 1,500 forks of one game), then `ANALYZE`d.
Each candidate was tested with the **exact SQL Prisma emits** (captured via the
Prisma query-event log), `EXPLAIN ANALYZE` run with and without the index.

The governing rule — *"add only indexes a real query uses;
prove each with an index scan, not a seq scan"* — was applied strictly. A
candidate that the planner **refused to use** was dropped rather than shipped as
dead write-overhead.

### ✅ Verified already-covered (existing indexes used — no change needed)
- **Fork-tree lineage** — `WHERE parentGameId=?`: **Index Scan using
  `Game_parentGameId_idx`** (2.57 ms for 1,500 direct forks). Already optimal.
- **Heartbeat PlaySession** — `WHERE userId=? AND gameId=?`
  uses the existing `PlaySession_userId_gameId_idx`; heartbeat read/update is by PK.
- **Build queue (frozen — not modified)** — the claim (`WHERE status='PENDING'
  ORDER BY createdAt`) is covered by `BuildJob_status_createdAt_idx`; the dedup
  lookup (`gameSlug, branch, status`) by `BuildJob_gameSlug_branch_status_idx`.
  Both already exist; the frozen tables were left byte-identical.

### ❌ Tested and NOT added (planner refuses them — would be dead write-overhead)
- **`Game([status, createdAt])` (home grid)** — Prisma emits
  `ORDER BY status::text ASC, "createdAt" DESC` (it **casts the enum to text**). A
  b-tree on the `status` *enum column* cannot satisfy an order on `status::text`;
  and with **no WHERE and no LIMIT** the planner reads every row, so seq-scan +
  in-memory sort is optimal regardless:
  ```
  Sort (… Sort Key: ((status)::text), "createdAt" DESC; quicksort 622kB)
    -> Seq Scan on "Game"   Execution Time: 13.8 ms  (5,000 games)
  ```
  The genuine scaling fix here is **keyset pagination** (don't load the whole
  arcade), which is a feature change — out of scope for this pass. Documented in the
  schema next to the existing `Game` indexes.

---

## 2. N+1 audit on hot pages — collapsed, with before/after query counts

Measured by counting Prisma query events for the exact code paths against the
realistic `gitcade_perf` data.

| Hot path | Before | After | Notes |
|---|---|---|---|
| **"Made from"** indexer (`indexGameParts`, lazy on first game view) | **6** @ 3 refs; **16** @ 8 refs | **1** | per-ref `part.findFirst` (exact + fallback) → one `findMany({ partId: { in } })`, resolved in memory. |
| **Game page** SSR reads | 4 **sequential** round-trips | 1 **parallel** batch | `refreshGameStatus`, playCount, branches, parent were awaited serially; now one `Promise.all` (independent reads). |

- Home **grid** was audited and is **not** N+1: a single `game.findMany` feeds the
  whole grid; search/filter is entirely client-side (`HomeGrid.tsx`), so no
  per-card query exists.
- Fork-tree ancestor walk is a bounded loop of `findUnique` by PK (depth-capped at
  32, realistically ≤ 3); the per-fork diff fan-out is already `Promise.all` and is
  GitHub-API-bound, not DB. Left as-is.

---

## 3. Lighthouse — home + a game page (real Chrome-for-Testing runs)

`npx lighthouse` against the **production** build (`next start`), headless
Chrome-for-Testing with software GL. Scores are `performance / accessibility /
best-practices / SEO`.

| Page | Before | After | Fixed |
|---|---|---|---|
| **Home** (`/`) | 100 / **98** / **96** / 100 | **100 / 100 / 100 / 100** | heading-order, console-error (favicon) |
| **Game** (`/games/idle-clicker`) | 96 / **85** / **96** / 100 | **96 / 100 / 100 / 100** | color-contrast, definition-list, heading-order, select-name, console-error |

**Fixes (a11y + correctness only — no behaviour change):**
- **favicon 404** → added `src/app/icon.svg` (Next injects `<link rel="icon">`, so
  the browser stops probing `/favicon.ico`). Clears the only `errors-in-console`
  finding on **both** pages → best-practices 96 → 100.
- **heading-order** — game-card titles and panel/section headings skipped from
  `<h1>` to `<h3>`; promoted the intervening section headings to `<h2>`
  (`GameCard`, game page Stats/Manifest, `MadeFrom`, `ForkTree`).
- **color-contrast** — `MadeFrom`'s version label used `text-arcade-edge`
  (#2b3142, a border colour) as text → contrast 1.27. Switched to `text-arcade-mute`
  (passing). Same fix applied to the parts pages for consistency.
- **definition-list** — the Manifest `<dl>` contained bare `<div>`s; restructured
  into proper `<div><dt>…</dt><dd>…</dd></div>` groups.
- **select-name** — the branch-switcher `<select>` had a visual label but no
  programmatic association; added `aria-label`.

**Performance** was already strong (home 100, game 96) and is unchanged. The
remaining sub-100 perf audits on the game page (`legacy-javascript`,
`render-blocking`, `bf-cache`) are **Next.js framework internals** — the SWC
legacy-JS target, framework CSS delivery, and `force-dynamic` `no-store` defeating
the back/forward cache. Addressing them requires a Next config eject or a framework
upgrade (the security audit already tracks a dedicated Next 16 upgrade) and/or
behaviour changes — out of scope for a no-feature perf pass. No image-dimension or
unsized-element findings exist (the SDK/game art is canvas-rendered; the platform
uses no `next/image`).

---

## 4. Artifact cache headers — CDN-correct, with a real gap fixed

**Verified already correct:** hashed assets get
`Cache-Control: public, max-age=31536000, immutable`; the HTML entry gets
`no-cache` (revalidate). The strict game CSP and the `{game}/{branch}/{path}` URL
convention are untouched.

**Real gap found + fixed (service-level header adjustment only):** the artifact
server forwarded **no validator** (no `ETag` / `Last-Modified`), so a browser/CDN
honouring `no-cache` on the HTML entry had nothing to revalidate against — it
re-downloaded the **full body every time**. Fix (`artifact-server/src/server.ts`):
forward the bucket object's `ETag` + `Last-Modified` on 200, and **pass the client's
`If-None-Match` / `If-Modified-Since` through to the bucket** so a match returns a
bodyless **304**.

```
# before fix: every HTML load streamed the full body
GET …/idle-clicker/main/index.html          → 200, body = 3714 bytes (always)

# after fix:
GET …/idle-clicker/main/index.html          → 200 + ETag "f8ce0bb6…" + Last-Modified
GET … (If-None-Match: "f8ce0bb6…")          → 304 Not Modified, body = 0 bytes, Cache-Control: no-cache
GET …/assets/index-*.js  (hashed)           → 200, Cache-Control: public, max-age=31536000, immutable (+ ETag)
```
**Saves the full HTML body (≈3.7 KB here) on every repeat play / branch nav.**
No contract changed: CSP, content-types, ACAO `*`, and the URL convention are
byte-identical (verified on the wire). Regression test added to
`artifact-server/tests/headers.test.ts` (now **9/9** green).

---

## 5. Build queue — concurrency cap + dedup under load

Tested the **real** `worker/src/queue.ts` (`enqueueBuild`, `claimJobs`) and the
`worker.ts` capacity gating. `WORKER_CONCURRENCY` defaults to **2**.

### ✅ Concurrency cap holds — no thundering herd (DEMONSTRATED)
With 12 PENDING jobs and cap = 2:
```
tick1: claimJobs(2) → claimed 2,  inFlight=2
tick2: inFlight==cap, capacity=0 → claimed 0   (never exceeds the cap)
after one finishes → refill claims exactly 1
```
`claimJobs` uses `FOR UPDATE SKIP LOCKED`, so N workers never double-claim. The cap
strictly bounds **concurrent build containers** — there is no container storm even
under a backlog.

### ✅ Dedup coalesces the designed pattern (DEMONSTRATED)
Rapid **sequential** pushes — the real webhook / poll access pattern (events arrive
one after another) — coalesce correctly:
```
20 rapid SEQUENTIAL enqueues of the same (game, branch) → created=1, deduped=19, 1 PENDING row
```

### ⚠ Finding: dedup is best-effort, not atomic (pre-existing, frozen queue)
Under **artificially simultaneous** parallel enqueues of the *identical*
`(game, branch)`, the `findFirst`-then-`create` window races and can stack redundant
jobs:
```
25 truly-concurrent enqueues (Promise.all) → trial 1: created=1 (cold pool serialized);
                                             trials 2–6: created=25 (RACE — stacked)
```
This is a **pre-existing property of the frozen queue**, not introduced here, and
its blast radius is **bounded by the (working) concurrency cap** — redundant jobs
drain ≤ 2 at a time, never a container storm; and rebuilds are idempotent (same
commit → same artifact). It does **not** affect the real access pattern (webhook /
poll / fork / publish each enqueue **once**, sequentially).

A robust fix is a **partial unique index** on `BuildJob(gameSlug, branch) WHERE
status IN ('PENDING','RUNNING')` + `INSERT … ON CONFLICT` — but that alters the
**frozen queue/Build schema contract**, which this perf pass must not touch
(it would HALT for a human decision). **Recommended as a dedicated queue patch.**
Documented here and in DECISIONS.md; not silently changed.

---

## Outstanding follow-ups
- **Existing hot-path indexes verified adequate** (fork lineage, heartbeat
  PlaySession, the frozen build-queue indexes); frozen `BuildJob`/`Build`
  byte-identical.
- **Constant-query "made-from" path** + a parallelized game page.
- **Conditional-GET (ETag/304)** on the artifact server (CDN-ready).
- **A documented, bounded queue-dedup race** to fix as a queue patch (not a
  blocker; the cap contains it).

## How to re-run the proofs
1. Lighthouse: `CHROME_PATH=$(command -v chromium) npx lighthouse <url> --chrome-flags="--headless --no-sandbox --disable-gpu --use-gl=swiftshader"` against the running `next start` (`:3000`) + artifact server (`:3001`).
2. EXPLAIN: recreate `gitcade_perf` (`createdb`, `prisma db push`), seed realistic volume, `EXPLAIN ANALYZE` the Prisma-emitted SQL with/without each index.
3. N+1 counts: Prisma `$on('query')` counter around the route code paths.
4. Queue: drive `enqueueBuild`/`claimJobs` with `Promise.all` (parallel) and a `for await` loop (sequential); inspect PENDING rows.
