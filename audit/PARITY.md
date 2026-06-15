# Ground-truth parity note (Stage 0)

**Question:** do the artifacts actually being *played* (the blobs in MinIO) match
current source? **Answer: no — every deployed seed-game blob is ~20 hours stale,
built before the entire `0.1.1` repin + per-game fix wave.** This single fact
reframes the audit: many defects you'd infer by playing the deployed games are
*already fixed in source* and were simply never republished.

## What I did

- Rebuilt all six games from current source → fresh artifacts. **All six build
  clean** (`npm run build --workspace games/*`); fresh bundles written to each
  `games/<g>/dist/assets/*.js`.
- Read the deployed blobs straight out of the MinIO filesystem backend
  (`docker exec gitcade-infra-minio-1 ls /data/gitcade-artifacts/...`) and fetched
  the live helicopter bundle through the artifact server
  (`:3001/artifacts/helicopter/main/...`).

## The mismatch (timeline)

| Artifact / commit | Time (2026-06-14, −04:00) |
|---|---|
| Deployed blobs: snake | 01:11 |
| Deployed blobs: breakout / helicopter / idle-clicker | 01:12 |
| `6a0bd46` fix(snake) repin@0.1.1 + S2/S3/S4 | **21:39** |
| `7710bd1` fix(helicopter) repin@0.1.1 (B-1) + H3 + H4 | **22:05** |
| `95e175b` fix(breakout) repin@0.1.1 (B-3/B-4) | **22:21** |
| `7675434` fix(survival-arena) repin@0.1.1 | **22:29** |
| `f5804cb` fix(idle-clicker) IC-1 + IC-2/3/4 | **22:45** |
| `b6cac0d` sdk@0.1.1 + library@0.1.1 (B-1 round-robin) | 06-14 21:07 |

Every deployed blob predates every fix commit by ~20 h. The SDK/library are at
`0.1.1` in source, but the deployed games were built against the pre-`0.1.1`
library.

## Proof on the flagship symptom — helicopter "obstacles only at the top"

Fetched the **deployed** helicopter bundle and diffed its wave-spawner against the
fresh rebuild:

- **Deployed** (`index-CzbkDFDN.js`, 117 377 B) has **no `spawnCursor`** and indexes
  spawn points as `spawnPoints[ spawnedThisWave % P.length ]`. With `waveSize:1`,
  `spawnedThisWave` resets to `0` every wave → every obstacle spawns at
  `spawnPoints[0]` = `{x:820, y:30}`. **That is the "obstacles pin to the top"
  bug, live in the deployed blob.**
- **Fresh rebuild** (`index-DZTZtc_3.js`, 117 666 B) **has `spawnCursor`** (the
  library@0.1.1 B-1 fix). Harness probe `02-wave-spawner` observes spawns cycling
  cleanly through y = 40 → 120 → 200 across 22 spawns (`spawnCursor` monotonic to
  22). See `harness/out-02-wave-spawner.json`.

```
$ grep -c spawnCursor /tmp/heli-deployed.js                  → 0   (deployed)
$ grep -c spawnCursor games/helicopter/dist/assets/*.js      → 1   (fresh)
deployed:  ...spawnPoints[A.spawnedThisWave%P.length]...      (pre-B-1, buggy)
```

## Consequence for this audit

The wave-spawner round-robin defect named in the prompt is **REFUTED in current
source / library** and **CONFIRMED only in the stale deployed blob**. Treat every
"the running game does X wrong" report the same way until proven against a fresh
rebuild: it may be a republish gap, not an engine gap. Stage 4 must re-baseline
each game on a fresh artifact before triaging, and Stage 5 must republish all six.

(Extra non-seed blobs exist too — `idle-clicker--mufon609`, `itest-snake`,
`open-demo` — fork/demo/integration-test outputs, not seed games; ignored here.)
