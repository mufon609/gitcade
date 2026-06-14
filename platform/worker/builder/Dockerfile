# GitCade builder image — the ephemeral SIBLING container every build runs in.
#
# Per the Locked Deployment-topology decision and ENVIRONMENT.md: the worker
# launches builds beside itself (NOT Docker-in-Docker) from THIS image. The
# host's `chromium` shim is invisible inside containers, so the image bundles
# its own Chromium (used for OPEN-tier headless load checks). Expect ~1.5-2 GB
# — noted in DECISIONS.md per the disk-hygiene rule; this is expected, not a
# blocker.
#
# `apt-get` here runs at IMAGE BUILD time (we are root in the build context) —
# this is NOT the forbidden host `apt`; ENVIRONMENT.md's no-apt rule is about
# the host machine, not Dockerfiles.
FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    # puppeteer-core must NOT download its own Chromium — we use the apt one.
    PUPPETEER_SKIP_DOWNLOAD=1 \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    CHROMIUM_BIN=/usr/bin/chromium

RUN apt-get update && apt-get install -y --no-install-recommends \
      # clone + TLS
      git ca-certificates \
      # headless browser (OPEN-tier load check) + its runtime libraries
      chromium \
      fonts-liberation libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
      libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
      libxrandr2 libgbm1 libasound2 libpangocairo-1.0-0 libpango-1.0-0 \
      libcairo2 libxshmfence1 \
      # node-canvas build deps (optional native dep some games may pull)
      build-essential pkg-config libcairo2-dev libpango1.0-dev libjpeg-dev \
      libgif-dev librsvg2-dev \
    && rm -rf /var/lib/apt/lists/*

# puppeteer-core is tiny (no bundled browser) — used only by headless-check.mjs.
RUN npm install -g puppeteer-core@23.11.1

# Stage scripts + the OPEN-tier headless checker are baked in so the worker only
# has to `docker run <image> stage1.sh ...` — nothing is bind-mounted from the
# (host-invisible) worker filesystem.
COPY stage1.sh stage2.sh headless-check.mjs /usr/local/bin/
RUN chmod +x /usr/local/bin/stage1.sh /usr/local/bin/stage2.sh

# The build workspace is a NAMED Docker volume mounted here (shared between the
# two stage containers; the worker never shares its own filesystem).
WORKDIR /workspace
