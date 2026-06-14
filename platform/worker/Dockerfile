# The WORKER image (deployment-topology decision: the worker runs in Docker and
# launches builds as SIBLING containers via the mounted host socket — NOT
# Docker-in-Docker). It needs only the docker CLI (talks to the host daemon over
# /var/run/docker.sock), Node, and the worker source. The BUILDER image is
# separate (builder/Dockerfile) and is what sibling build containers run.
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git tar \
    && rm -rf /var/lib/apt/lists/*

# Static docker CLI only (no daemon) — it drives the host daemon via the socket.
ADD https://download.docker.com/linux/static/stable/x86_64/docker-27.3.1.tgz /tmp/docker.tgz
RUN tar -xzf /tmp/docker.tgz -C /usr/local/bin --strip-components=1 docker/docker && rm /tmp/docker.tgz

WORKDIR /app
COPY package.json tsconfig.json ./
COPY prisma ./prisma
# @gitcade/sdk resolves from PUBLIC npm here (standalone image — no workspace).
RUN npm install --no-audit --no-fund && npx prisma generate
COPY src ./src
COPY bin ./bin

# Default to the long-running poller; override with `build <repoUrl> <branch>`.
ENTRYPOINT ["npx", "tsx", "src/cli.ts"]
CMD ["start"]
