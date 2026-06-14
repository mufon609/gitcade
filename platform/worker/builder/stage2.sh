#!/usr/bin/env bash
# STAGE 2 — NETWORK NONE: tier-appropriate validation + static build.
# Runs inside an ephemeral sibling container started with `--network none`, so
# nothing here may touch the network (deps were installed in stage 1). The only
# interface available is loopback (`lo`) — the OPEN-tier headless check relies
# on that to serve /dist to its own in-container Chromium.
# Args: <tier>   (ecosystem | open)
set -euo pipefail

TIER="${1:?tier required}"
cd /workspace/repo

if [ "${TIER}" = "ecosystem" ]; then
  echo "==> [stage2] ECOSYSTEM tier — full \`gitcade validate\`"
  # The published validator CLI (installed in stage 1 via @gitcade/sdk's bin):
  # schema + no-magic-numbers + no-raw-storage + headless smoke (defers to the
  # game's own `npm test`). Exit 0 = publishable.
  npx --no-install gitcade validate .
else
  echo "==> [stage2] OPEN tier — manifest+license validated worker-side; build + headless load check here"
fi

echo "==> [stage2] npm run build (static /dist)"
npm run build

if [ ! -d /workspace/repo/dist ] || [ -z "$(ls -A /workspace/repo/dist 2>/dev/null)" ]; then
  echo "ERROR: build produced no /dist output" >&2
  exit 1
fi

if [ "${TIER}" = "open" ]; then
  echo "==> [stage2] OPEN tier — headless load check (no console errors)"
  # Serves /dist on 127.0.0.1 (loopback works under --network none) and loads
  # it in the bundled Chromium, failing on any console error / page error.
  node /usr/local/bin/headless-check.mjs /workspace/repo/dist
fi

echo "==> [stage2] OK"
