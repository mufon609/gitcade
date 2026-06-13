#!/usr/bin/env bash
# ============================================================
# GitCade — one-time environment prep for Kali Linux (rolling)
# Run as your normal user: bash setup-kali.sh
# It will ask for sudo ONCE for system packages, then never again.
# After this script, no AI session should ever need sudo.
# ============================================================
set -euo pipefail

# REQUIRED up front — fail before any sudo work, not after
: "${GIT_NAME:?Set GIT_NAME first, e.g.: GIT_NAME='Jane Doe' GIT_EMAIL='jane@x.com' bash setup-kali.sh}"
: "${GIT_EMAIL:?Set GIT_EMAIL first}"

echo "==> [1/7] System packages (sudo required once)"
# Kali rolling breaks when partially upgraded: a mixed bookworm/kali-rolling
# package set is the usual cause of unsatisfiable chromium/docker deps.
# full-upgrade (NOT plain upgrade) may add/remove packages to resolve this.
sudo apt update
echo "    Running full-upgrade to heal any partial-upgrade state (can take a while)..."
sudo apt full-upgrade -y || {
  echo "!! full-upgrade hit conflicts. Try: sudo apt --fix-broken install"
  echo "   then re-run this script. Stopping so you don't build on a broken base."
  exit 1
}

# Install in GROUPS so one bad package can't sink the rest.
# Failures in non-core groups are recorded and reported at the end, not fatal.
FAILED_GROUPS=()

echo "    [core] git toolchain + utilities"
sudo apt install -y git curl wget ca-certificates gnupg jq unzip \
  || { echo "!! CORE group failed — cannot continue"; exit 1; }

echo "    [build] compiler + native libs for node-canvas"
sudo apt install -y build-essential pkg-config python3 \
  libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev \
  || FAILED_GROUPS+=("build-libs (node-canvas native compile may fail; browser-based rendering tests still work)")

echo "    [gh] GitHub CLI"
sudo apt install -y gh || {
  echo "      gh not in distro repos — adding GitHub's official apt repo"
  sudo mkdir -p -m 755 /etc/apt/keyrings
  wget -qO- https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null
  sudo apt update && sudo apt install -y gh || FAILED_GROUPS+=("gh (install manually: https://github.com/cli/cli/blob/trunk/docs/install_linux.md)")
}

echo "    [chromium] headless browser"
# Kali ships chromium as its own metapackage; the Debian 'chromium' can pull
# unsatisfiable libflac12/chromium-common across mixed repos. Try Kali's first.
# NOT fatal if it fails — Phase 1+ smoke tests can use Playwright's bundled Chromium.
sudo apt install -y chromium 2>/dev/null \
  || sudo apt install -y chromium-browser 2>/dev/null \
  || FAILED_GROUPS+=("chromium (NOT fatal — use Playwright's bundled Chromium; see CHROMIUM NOTE at end)")

echo "==> [2/7] Docker (official repo — distro docker.io pulls unsatisfiable containerd/runc on rolling)"
if ! command -v docker >/dev/null; then
  sudo install -m 0755 -d /etc/apt/keyrings
  # Kali is Debian-based; use Docker's Debian bookworm repo (stable codename).
  curl -fsSL https://download.docker.com/linux/debian/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg 2>/dev/null || true
  sudo chmod a+r /etc/apt/keyrings/docker.gpg 2>/dev/null || true
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian bookworm stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
  sudo apt update
  sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin \
    || FAILED_GROUPS+=("docker (install manually: https://docs.docker.com/engine/install/debian/)")
fi

echo "==> Enabling Docker without sudo"
if command -v docker >/dev/null; then
  sudo systemctl enable --now docker
  sudo usermod -aG docker "$USER"
  # NOTE: group change needs a re-login (or run: newgrp docker)
else
  FAILED_GROUPS+=("docker daemon not present — see manual link above")
fi

echo "==> [3/7] Node via nvm (user-space — no sudo ever needed for npm)"
# nvm may already live at the XDG path (~/.config/nvm) or the classic ~/.nvm.
# Detect an existing install before reinstalling; only bootstrap to ~/.nvm if
# neither exists. (Sourcing a hardcoded ~/.nvm/nvm.sh under `set -e` was a fatal
# crash when nvm was actually at ~/.config/nvm.)
if [ -s "$HOME/.config/nvm/nvm.sh" ]; then
  export NVM_DIR="$HOME/.config/nvm"
elif [ -s "$HOME/.nvm/nvm.sh" ]; then
  export NVM_DIR="$HOME/.nvm"
else
  export NVM_DIR="$HOME/.nvm"
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
fi
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
nvm install 22
nvm alias default 22
corepack enable || true

echo "==> [4/7] Git identity (validated at script start)"
git config --global user.name  "$GIT_NAME"
git config --global user.email "$GIT_EMAIL"
git config --global init.defaultBranch main
# NOTE: no credential.helper store — gh auth setup-git handles github.com
# securely; the plaintext store helper is unnecessary and worse.

echo "==> [5/7] GitHub auth (interactive — do this now, not mid-build)"
echo "    Running: gh auth login  (choose HTTPS + browser/token)"
gh auth status || gh auth login
gh auth setup-git   # git push/pull now uses gh credentials — no password walls

echo "==> [6/7] Local Postgres via Docker (dev database)"
mkdir -p ~/gitcade-infra
cat > ~/gitcade-infra/docker-compose.yml <<'EOF'
services:
  db:
    image: postgres:16
    restart: unless-stopped
    environment:
      POSTGRES_USER: gitcade
      POSTGRES_PASSWORD: gitcade
      POSTGRES_DB: gitcade
    ports: ["127.0.0.1:5432:5432"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U gitcade"]
      interval: 3s
      timeout: 3s
      retries: 15
    volumes: [pgdata:/var/lib/postgresql/data]
  minio:   # local S3-compatible artifact storage (stand-in for S3/R2)
    image: minio/minio
    restart: unless-stopped
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: gitcade
      MINIO_ROOT_PASSWORD: gitcade-secret
    ports: ["127.0.0.1:9000:9000", "127.0.0.1:9001:9001"]
    volumes: [miniodata:/data]
volumes:
  pgdata:
  miniodata:
EOF
docker compose -f ~/gitcade-infra/docker-compose.yml up -d || \
  echo "!! If this failed with a permissions error, log out/in (docker group) and run: docker compose -f ~/gitcade-infra/docker-compose.yml up -d"

echo "==> [7/7] Sanity checks"
node -v && npm -v
git --version
gh auth status
docker ps || true
chromium --version || true

echo ""
echo "============================================================"
if [ ${#FAILED_GROUPS[@]} -eq 0 ]; then
  echo " DONE — all package groups installed cleanly."
else
  echo " DONE WITH WARNINGS — these groups need attention:"
  for g in "${FAILED_GROUPS[@]}"; do echo "   - $g"; done
fi
echo ""
echo " Re-login once (docker group), then verify:"
echo "   docker ps            -> shows postgres + minio"
echo "   gh auth status       -> logged in"
echo ""
echo " Dev connection strings for .env:"
echo "   DATABASE_URL=postgresql://gitcade:gitcade@localhost:5432/gitcade"
echo "   S3_ENDPOINT=http://localhost:9000  (keys: gitcade / gitcade-secret)"
echo "   S3_FORCE_PATH_STYLE=true   # MinIO needs path-style; real S3 = false"
echo ""
echo " CHROMIUM NOTE: if chromium failed above, do NOT fight apt."
echo " Phase 1+ headless tests should use Playwright's own Chromium:"
echo "   npm i -D playwright   &&   npx playwright install chromium"
echo " (system deps are already present from the build-libs group)."
echo ""
echo " Place ENVIRONMENT.md in the repo root so every AI session"
echo " knows the rules of this machine."
echo "============================================================"
