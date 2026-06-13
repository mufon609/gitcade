# Phase 0 — Credential Checklist

The only thing between this machine and starting the GitCade build. Local infra
(Postgres, MinIO, Node, Docker, gh auth) is **already done** — this list is the
external accounts a build session cannot create for you. Work top to bottom;
each step ends with the `.env` key(s) it fills. When every key in `.env` is set,
the box is build-ready.

> Copy `.env.example` → `.env` first: `cp .env.example .env`

---

## Already set for you (verify, don't change)
- [x] `DATABASE_URL` — local Postgres 16 (running, healthy)
- [x] `S3_ENDPOINT` / `S3_BUCKET` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` / `S3_FORCE_PATH_STYLE` — local MinIO (running, healthy)
- [x] `ARTIFACT_SERVER_PORT` / `ARTIFACT_BASE_URL` / `BUILDER_IMAGE` / `QUEUE_POLL_INTERVAL_MS` / `NEXTAUTH_URL` — sane local defaults

---

## 1. GitHub organization → `GITHUB_ORG`
- [ ] github.com → **+** → New organization (Free plan is fine). Pick a name, e.g. `gitcade-games`.
- [ ] Set `GITHUB_ORG` to that name (the slug, not the display name).

## 2. GitHub OAuth App → `GITHUB_OAUTH_ID`, `GITHUB_OAUTH_SECRET`
Platform login + repo operations under each user's token.
- [ ] Org → Settings → Developer settings → **OAuth Apps** → New OAuth App.
- [ ] Homepage URL: `http://localhost:3000`
- [ ] Authorization callback URL: `http://localhost:3000/api/auth/callback/github`
- [ ] Copy the **Client ID** → `GITHUB_OAUTH_ID`.
- [ ] **Generate a new client secret** → `GITHUB_OAUTH_SECRET` (shown once — copy now).
- [ ] (Scopes are requested by the app at login: `read:user user:email public_repo`. `public_repo` is required — forks/remix commits fail without it.)

## 3. GitHub App → `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`
Distinct from the OAuth App. Owns governance auto-commits + the one app-level webhook.
- [ ] Org → Settings → Developer settings → **GitHub Apps** → New GitHub App.
- [ ] Permissions → Repository → **Contents: Read & write**.
- [ ] Subscribe to events → **Push**.
- [ ] Webhook: **Active**. URL = your smee.io URL from step 4 (do step 4 first or come back). Set a **Webhook secret** (any random string) → `GITHUB_WEBHOOK_SECRET`.
- [ ] "Where can this app be installed?" → Only this account (fine for v1).
- [ ] Create. Copy the **App ID** → `GITHUB_APP_ID`.
- [ ] Scroll to **Private keys** → Generate a private key → downloads a `.pem`.
      Either paste its contents into `GITHUB_APP_PRIVATE_KEY` as one line with
      literal `\n` between lines, **or** drop the file somewhere outside git and
      set `GITHUB_APP_PRIVATE_KEY_PATH` instead. Never commit the `.pem`.

## 4. smee.io channel → `WEBHOOK_PROXY_URL`
GitHub can't reach localhost; smee relays webhooks to your machine.
- [ ] Go to https://smee.io → **Start a new channel**. Copy the URL.
- [ ] `WEBHOOK_PROXY_URL` = that URL.
- [ ] Use the **same URL** as the GitHub App's webhook URL (step 3).

## 5. NextAuth secret → `NEXTAUTH_SECRET`
- [ ] Run: `openssl rand -base64 32`
- [ ] Paste the output into `NEXTAUTH_SECRET`.

## 6. npm — publish access for `@gitcade` (no `.env` key; gate-time)
Not needed to start; required at the Phase 1 and Phase 2B **publish gates**.
- [ ] `npm login` (creates/uses your npmjs account).
- [ ] Claim the scope: create an npm org/scope named `gitcade` (npmjs.com → add org), or confirm `@gitcade` is yours. Publishing `@gitcade/sdk` later needs this.

## 7. Anthropic API key → `ANTHROPIC_API_KEY` (optional)
- [ ] Only if your Claude Code build sessions need a key here. Skip if Claude Code is already authenticated.

---

## Done check
```bash
# every non-comment, non-local key has a value:
grep -vE '^\s*#|^\s*$' .env | grep -E '=$' && echo "^ still-empty keys above" || echo "all keys filled ✓"
```
When that prints `all keys filled ✓` (and the empty ones are only optional), you're ready for the **Phase 1** single-shot prompt.
