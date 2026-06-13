# Phase 0 — Credential Checklist

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
- **This repo ≠ the game repos.** `GITHUB_ORG` only controls where the Phase 3 *game* repos (snake, breakout, forks…) get created — not where this platform/control repo lives.

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
- **The scopes line is informational, not a step.** Classic OAuth Apps don't set scopes on the creation form — the app requests `read:user user:email public_repo` at login time (wired into the NextAuth provider in Phase 4B). Nothing to fill on this page for scopes.
- **The client secret is saved the instant you generate it — copy it immediately.** The full value is shown only once; afterward you can only regenerate, not re-view. The **"Update application"** button only saves the URL/name fields — you don't need it to keep the secret, and clicking it won't wipe the secret.

## 3. GitHub App → `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`
Distinct from the OAuth App. Owns governance auto-commits + the one app-level webhook.
- [ ] Org → Settings → Developer settings → **GitHub Apps** → New GitHub App.
- [ ] **Name** (see note below): something like `gitcade-governance`.
- [ ] **Homepage URL** (required field): `http://localhost:3000` (or your org URL `https://github.com/gitcade-games`). Purely informational for a GitHub App — no auth role, not stored in `.env`.
- [ ] **Description** (public, shown to users on the install page) — paste:

  ```
  GitCade governance bot. When a community proposal passes its vote, this app commits the
  approved change — a config tweak or component swap — directly to the game's repository, so the
  outcome of a vote becomes a real commit no human edited. It also receives push events to keep
  the build pipeline in sync. Installed per game; it only ever writes changes a passed vote authorized.
  ```
- [x] Permissions → Repository → **Contents: Read & write**.
- [x] Subscribe to events → **Push**.
- [x] Webhook: **Active**. URL = your smee.io URL from step 4 (do step 4 first or come back). Set a **Webhook secret** (any random string) → `GITHUB_WEBHOOK_SECRET`.
- [ ] "Where can this app be installed?" → Only this account (fine for v1).
- [ ] Create. Copy the **App ID** → `GITHUB_APP_ID`.
- [ ] Scroll to **Private keys** → Generate a private key → downloads a `.pem`. Save it one of the two ways below.

**Note — App name**

Must be **globally unique across all of GitHub** (not just your org), and it becomes the **bot identity** on every governance commit — they'll be authored by `<slug>[bot]`. Don't reuse the org name (`gitcade-games`); pick something descriptive like `gitcade-governance` so the history reads clearly. The name is **not** stored in `.env`.

**Note — Saving the private key**

Recommended (file path, no escaping): move the `.pem` into the repo's `secrets/` folder (already gitignored) and point `.env` at it, leaving the inline key blank:

```
GITHUB_APP_PRIVATE_KEY=
GITHUB_APP_PRIVATE_KEY_PATH=./secrets/<your-app>.private-key.pem
```

Alternative (inline, for hosts that can't ship a file, e.g. Vercel): collapse the whole PEM onto ONE line, replacing each real line break with a literal `\n` (backslash + n, *not* an actual newline — the app converts them back at load):

```
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIB...\n...\n-----END RSA PRIVATE KEY-----\n"
```

Never commit the `.pem` — the `*.pem` and `secrets/` rules in `.gitignore` already prevent it.

## 4. smee.io channel → `WEBHOOK_PROXY_URL`
GitHub can't reach localhost; smee relays webhooks to your machine.
- [x] Go to https://smee.io → **Start a new channel**. Copy the URL.
- [x] `WEBHOOK_PROXY_URL` = that URL.
- [x] Use the **same URL** as the GitHub App's webhook URL (step 3).

**Notes**
- Creating the channel is just "Start a new channel" + copy the URL — but the channel alone does nothing until you run the smee client locally.
- Follow the instructions shown on the smee.io page: `npm i -g smee-client`, then `smee -u <your-url> -t <target>`. With no `-t` it forwards to `http://127.0.0.1:3000` by default — fine for now; the real webhook path gets set when the receiver is built (Phase 5).
- Only needed during local dev — in production the webhook points straight at your real public server and smee is dropped.

## 5. NextAuth secret → `NEXTAUTH_SECRET`
- [x] Run: `openssl rand -base64 32`
- [x] Paste the output into `NEXTAUTH_SECRET`.

## 6. npm — publish access for `@gitcade` (no `.env` key; gate-time)
Not needed to start; required at the Phase 1 and Phase 2B **publish gates**.
- [ ] `npm login` (creates/uses your npmjs account).
- [ ] Claim the scope: create an npm org/scope named `gitcade` (npmjs.com → add org), or confirm `@gitcade` is yours. Publishing `@gitcade/sdk` later needs this.

## 7. Anthropic API key → `ANTHROPIC_API_KEY` (optional)
- [ ] Only if your Claude Code build sessions need a key here. Skip if Claude Code is already authenticated.

---

## Done check
```bash
# flags ONLY keys whose value is truly empty (KEY= with nothing after):
grep -E '^[A-Za-z_]+=$' .env && echo "^ genuinely-empty keys above" || echo "all keys filled ✓"
```
Two values are *expected* to show as empty and are NOT problems:
- **`GITHUB_APP_PRIVATE_KEY`** — blank on purpose when you use the `GITHUB_APP_PRIVATE_KEY_PATH` file method (step 3). The key is in the `.pem`, not inline.
- **`ANTHROPIC_API_KEY`** (optional) — if you don't need it.

Don't use `grep -E '=$'` here — it false-flags any base64 secret (e.g. `NEXTAUTH_SECRET` from `openssl rand -base64 32`) because base64 padding ends in `=`. The anchored `^[A-Za-z_]+=$` above matches only lines with an empty value.

When the only empty keys are the expected ones above, you're ready for the **Phase 1** single-shot prompt.

---

## First-run FAQ / gotchas

Things that tripped up the first run-through — read these if a step feels ambiguous.

- **"Do I need a separate GitHub account / org?"** No. An org is a free namespace under your existing login (or skip it: `GITHUB_ORG=<your-username>`). `GITHUB_ORG` only decides where the *game* repos land — it has nothing to do with where this platform repo lives.

- **OAuth App vs GitHub App — they are two different registrations** with different jobs:
  - **OAuth App** (step 2) = how *users* log in, and repo operations done under each user's own token (creating forks, pushing remix commits). Configured by Homepage + callback URL; no scopes set on the form.
  - **GitHub App** (step 3) = the platform's own bot. Owns governance auto-commits and the single app-level **push** webhook. Configured by Contents:R/W permission + Push event + webhook URL/secret + a generated private key.

- **OAuth App "Enable Device Flow"** → leave unchecked (browser redirect flow, not device flow).

- **OAuth App scopes** aren't set on the creation page — the app requests them at login (Phase 4B).

- **OAuth App client secret** is saved the moment you generate it; copy it immediately (shown once). "Update application" only saves the URL/name fields, not the secret.

- **GitHub App name** must be globally unique and becomes the `<slug>[bot]` commit author — use something like `gitcade-governance`, not the org name. The name isn't stored in `.env`.

- **smee.io** is just a relay so GitHub can reach `localhost`. Creating the channel is one click, but you must also run the `smee-client` locally for events to flow (and only during local dev).

- **No `sudo` is needed anywhere in this build.** Local infra (Postgres, MinIO, Docker, Node, build libs) and headless Chromium (bundled with Playwright, dependency-validated) are all already installed. If a tool seems missing, check the bundled/aliased path before reaching for apt — see `ENVIRONMENT.md`.
