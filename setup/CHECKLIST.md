# Credential Checklist

The only thing between this machine and starting the GitCade build. Local infra
(Postgres, MinIO, Node, Docker, gh auth) is **already done** — this list is the
external accounts a build session cannot create for you. Work top to bottom;
each step ends with the `.env` key(s) it fills. When every key in `.env` is set,
the box is build-ready.

First, from the repo root: copy the template → `.env` with `cp setup/.env.example .env`

---

## Already set for you (verify, don't change)
- [x] `DATABASE_URL` — local Postgres 16 (running, healthy)
- [x] `S3_ENDPOINT` / `S3_BUCKET` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` / `S3_FORCE_PATH_STYLE` — local MinIO (running, healthy)
- [x] `ARTIFACT_SERVER_PORT` / `ARTIFACT_BASE_URL` / `BUILDER_IMAGE` / `QUEUE_POLL_INTERVAL_MS` / `NEXTAUTH_URL` — sane local defaults

---

## 1. GitHub organization → `GITHUB_ORG`
- [x] github.com → **+** → New organization (Free plan is fine). Pick a name, e.g. `gitcade-games`.
- [x] Set `GITHUB_ORG` to that name (the slug, not the display name).

**Notes**
- **No second account needed.** An organization is *not* a separate GitHub login — it's a free namespace created from your existing account; you stay the owner with the same email/password. Optional: skip the org and set `GITHUB_ORG=<your-username>` to publish game repos under your personal account instead.
- **slug vs display name.** The *slug* is the URL segment — `gitcade-games` from `github.com/gitcade-games` — not any prettified display name. So `GITHUB_ORG=gitcade-games`.
- **This repo ≠ the game repos.** `GITHUB_ORG` only controls where the *game* repos (snake, breakout, forks…) get created — not where this platform/control repo lives.

## 2. GitHub OAuth App → `GITHUB_OAUTH_ID`, `GITHUB_OAUTH_SECRET`
Platform login + repo operations under each user's token.
- [x] Org → Settings → Developer settings → **OAuth Apps** → New OAuth App.
- [x] Homepage URL: `http://localhost:3000`
- [x] Authorization callback URL: `http://localhost:3000/api/auth/callback/github`
- [x] Copy the **Client ID** → `GITHUB_OAUTH_ID`.
- [x] **Generate a new client secret** → `GITHUB_OAUTH_SECRET` (shown once — copy now).
- [x] (Scopes are requested by the app at login: `read:user user:email public_repo`. `public_repo` is required — forks/remix commits fail without it.)

**Notes**
- **Enable Device Flow → leave unchecked.** GitCade logs users in via the browser redirect (Authorization Code) flow using the callback URL above. Device Flow is for browserless/CLI devices and isn't used here.
- **The scopes line is informational, not a step.** Classic OAuth Apps don't set scopes on the creation form — the app requests `read:user user:email public_repo` at login time (wired into the NextAuth provider). Nothing to fill on this page for scopes.
- **The client secret is saved the instant you generate it — copy it immediately.** The full value is shown only once; afterward you can only regenerate, not re-view. The **"Update application"** button only saves the URL/name fields — you don't need it to keep the secret, and clicking it won't wipe the secret.

## 3. GitHub App → `GITHUB_WEBHOOK_SECRET`
Distinct from the OAuth App. Delivers the one app-level **push** webhook that keeps the build pipeline in sync when a repo (or fork) is pushed. The platform never authenticates *as* the App, so there is no App ID or private key to capture — just the webhook secret.
- [ ] Org → Settings → Developer settings → **GitHub Apps** → New GitHub App.
- [ ] **Name** (see note below): something like `gitcade-webhook`.
- [ ] **Homepage URL** (required field): `http://localhost:3000` (or your org URL `https://github.com/gitcade-games`). Purely informational for a GitHub App — no auth role, not stored in `.env`.
- [ ] **Description** (public, shown on the install page) — paste:

  ```
  GitCade build webhook. Receives push events from installed game repositories so the platform can
  keep each game's build pipeline in sync. Installed per repo; it does not write to your code.
  ```
- [x] Permissions → Repository → **Contents: Read-only** (the minimum needed to receive push events).
- [x] Subscribe to events → **Push**.
- [x] Webhook: **Active**. URL = your smee.io URL from step 4 (do step 4 first or come back). Set a **Webhook secret** (any random string) → `GITHUB_WEBHOOK_SECRET`.
- [x] "Where can this app be installed?" → Only this account (fine for v1).
- [x] Create. (No App ID or private key needed — the platform only verifies inbound webhooks with the secret above.)

**Note — App name**

Must be **globally unique across all of GitHub** (not just your org). Don't reuse the org name (`gitcade-games`); pick something descriptive like `gitcade-webhook`. The name is **not** stored in `.env`.

## 4. smee.io channel → `WEBHOOK_PROXY_URL`
GitHub can't reach localhost; smee relays webhooks to your machine.
- [x] Go to https://smee.io → **Start a new channel**. Copy the URL.
- [x] `WEBHOOK_PROXY_URL` = that URL.
- [x] Use the **same URL** as the GitHub App's webhook URL (step 3).

**Notes**
- Creating the channel is just "Start a new channel" + copy the URL — but the channel alone does nothing until you run the smee client locally.
- Follow the instructions shown on the smee.io page: `npm i -g smee-client`, then `smee -u <your-url> -t <target>`. With no `-t` it forwards to `http://127.0.0.1:3000` by default — fine for now; the real webhook path gets set when the receiver is built.
- Only needed during local dev — in production the webhook points straight at your real public server and smee is dropped.

## 5. NextAuth secret → `NEXTAUTH_SECRET`
- [x] Run: `openssl rand -base64 32`
- [x] Paste the output into `NEXTAUTH_SECRET`.

## 6. npm — publish access for `@gitcade` (no `.env` key; gate-time)
Not needed to start; required at the **publish gates**.
- [x] `npm login` (creates/uses your npmjs account).
- [x] Claim the scope: create an npm org/scope named `gitcade` (npmjs.com → add org), or confirm `@gitcade` is yours. Publishing `@gitcade/sdk` later needs this.

## 7. Anthropic API key → `ANTHROPIC_API_KEY` (optional)
- [ ] Only if your Claude Code build sessions need a key here. Skip if Claude Code is already authenticated.

---

## Done check
```bash
# flags ONLY keys whose value is truly empty (KEY= with nothing after):
grep -E '^[A-Za-z_]+=$' .env && echo "^ genuinely-empty keys above" || echo "all keys filled ✓"
```
One value is *expected* to show as empty and is NOT a problem:
- **`ANTHROPIC_API_KEY`** (optional) — if you don't need it.

Don't use `grep -E '=$'` here — it false-flags any base64 secret (e.g. `NEXTAUTH_SECRET` from `openssl rand -base64 32`) because base64 padding ends in `=`. The anchored `^[A-Za-z_]+=$` above matches only lines with an empty value.

When the only empty keys are the expected ones above, you're ready to go.

---

## First-run FAQ / gotchas

Things that tripped up the first run-through — read these if a step feels ambiguous.

- **"Do I need a separate GitHub account / org?"** No. An org is a free namespace under your existing login (or skip it: `GITHUB_ORG=<your-username>`). `GITHUB_ORG` only decides where the *game* repos land — it has nothing to do with where this platform repo lives.

- **OAuth App vs GitHub App — they are two different registrations** with different jobs:
  - **OAuth App** (step 2) = how *users* log in, and repo operations done under each user's own token (creating forks, pushing remix commits). Configured by Homepage + callback URL; no scopes set on the form.
  - **GitHub App** (step 3) = delivers the single app-level **push** webhook that keeps the build pipeline in sync. Configured by Contents:Read-only permission + Push event + webhook URL/secret. No private key — the platform never acts as the App.

- **OAuth App "Enable Device Flow"** → leave unchecked (browser redirect flow, not device flow).

- **OAuth App scopes** aren't set on the creation page — the app requests them at login.

- **OAuth App client secret** is saved the moment you generate it; copy it immediately (shown once). "Update application" only saves the URL/name fields, not the secret.

- **GitHub App name** must be globally unique — use something like `gitcade-webhook`, not the org name. The name isn't stored in `.env`.

- **smee.io** is just a relay so GitHub can reach `localhost`. Creating the channel is one click, but you must also run the `smee-client` locally for events to flow (and only during local dev).

- **No `sudo` is needed anywhere in this build.** Local infra (Postgres, MinIO, Docker, Node, build libs) and headless Chromium (bundled with Playwright, dependency-validated) are all already installed. If a tool seems missing, check the bundled/aliased path before reaching for apt — see [`archive/ENVIRONMENT.md`](./archive/ENVIRONMENT.md).
