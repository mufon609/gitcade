#!/usr/bin/env bash
# STAGE 1 — WITH NETWORK: anonymous shallow clone + dependency install.
# Runs inside an ephemeral sibling container on the default (networked) bridge.
# Args: <repoUrl> <branch>
set -euo pipefail

REPO_URL="${1:?repoUrl required}"
BRANCH="${2:?branch required}"

echo "==> [stage1] anonymous shallow clone: ${REPO_URL} @ ${BRANCH}"
# v1 is PUBLIC repos only (visibility enforced at publish, not here) — no token.
rm -rf /workspace/repo
git clone --depth 1 --single-branch --branch "${BRANCH}" "${REPO_URL}" /workspace/repo
cd /workspace/repo

echo "==> [stage1] resolved commit: $(git rev-parse HEAD)"
git rev-parse HEAD > /workspace/commit.txt

echo "==> [stage1] npm install (pinned @gitcade/sdk + @gitcade/library from public npm)"
# Deterministic if a lockfile exists; tolerant otherwise. Network is available
# in this stage ONLY.
if [ -f package-lock.json ]; then
  npm ci --no-audit --no-fund
else
  npm install --no-audit --no-fund
fi

echo "==> [stage1] OK"
