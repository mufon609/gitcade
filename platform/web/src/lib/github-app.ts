// GitHub App authentication for GOVERNANCE AUTO-COMMITS (Phase 7).
//
// LOCKED DECISION (Governance commit credential): a passed + owner-approved
// config-change / part-swap proposal commits to the game's CANONICAL repo
// (gitcade-games/{slug}) using a GitHub APP INSTALLATION ACCESS TOKEN — NEVER the
// owner's stored OAuth token. OAuth tokens expire and get revoked; a governance
// auto-commit failing silently months later is unacceptable. This is also DISTINCT
// from Phase 6 remix commits (which use the USER's OAuth token to THEIR fork).
//
// The flow GitHub requires:
//   1. Mint a short-lived JWT signed with the App PRIVATE KEY (RS256), iss=appId.
//   2. POST /app/installations/{installationId}/access_tokens with that JWT →
//      a per-installation access token (contents:write on the installed repos).
//   3. Commit with THAT token. GitHub attributes the commit to the App bot
//      (e.g. `gitcade-governance[bot]`) — i.e. authored by the app, no human.
//
// We mint the JWT with Node's built-in `crypto` (RS256) — zero new dependency.
// This module is SERVER-ONLY (node:crypto + node:fs); import it from route
// handlers / services only, never from a client component.
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { env } from "./env";
import type { RepoRef } from "./github";

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

/** Resolve the App private key PEM from env: inline (with literal `\n` un-escaped)
 *  or a file path. A governance auto-commit cannot proceed without it — this is a
 *  CORE credential, so we throw loudly rather than invent anything. */
export function loadAppPrivateKey(): string {
  const inline = env.githubAppPrivateKey.trim();
  if (inline) {
    // `.env` may store the PEM with literal backslash-n line breaks.
    return inline.includes("-----BEGIN") ? inline.replace(/\\n/g, "\n") : Buffer.from(inline, "base64").toString("utf8");
  }
  const path = env.githubAppPrivateKeyPath.trim();
  if (path) {
    const resolved = path.startsWith("/") ? path : `${env.repoRoot}/${path.replace(/^\.?\//, "")}`;
    return readFileSync(resolved, "utf8");
  }
  throw new Error(
    "[CRITICAL] No GitHub App private key configured (GITHUB_APP_PRIVATE_KEY or GITHUB_APP_PRIVATE_KEY_PATH). " +
      "Governance auto-commit uses the App installation, never the owner's OAuth token — it cannot proceed without the key.",
  );
}

/** Mint a short-lived App JWT (RS256). `iss` is the numeric App id. Valid window is
 *  intentionally small (GitHub allows ≤10 min; we use ~9). */
export function mintAppJwt(now: number = Date.now()): string {
  const appId = env.githubAppId.trim();
  if (!appId) {
    throw new Error("[CRITICAL] GITHUB_APP_ID is not set — cannot mint the App JWT for governance commits.");
  }
  const iat = Math.floor(now / 1000) - 60; // backdate 60s for clock skew
  const payload = { iat, exp: iat + 540, iss: appId }; // exp ≈ 9 min
  const header = { alg: "RS256", typ: "JWT" };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = base64url(signer.sign(loadAppPrivateKey()));
  return `${signingInput}.${signature}`;
}

function appHeaders(jwt: string): Record<string, string> {
  return {
    Authorization: `Bearer ${jwt}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "gitcade-governance",
  };
}

export interface InstallationToken {
  ok: boolean;
  token?: string;
  expiresAt?: string;
  error?: string;
}

/** Exchange the App JWT for an INSTALLATION ACCESS TOKEN (contents:write on the
 *  installed repos). This is the token a governance auto-commit pushes with. */
export async function getInstallationToken(installationId: string, now?: number): Promise<InstallationToken> {
  let jwt: string;
  try {
    jwt = mintAppJwt(now);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  const res = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers: appHeaders(jwt),
    cache: "no-store",
  });
  if (!res.ok) {
    const txt = await res.text();
    return { ok: false, error: `installation token mint failed (${res.status}): ${txt.slice(0, 200)}` };
  }
  const body = (await res.json()) as { token?: string; expires_at?: string };
  if (!body.token) return { ok: false, error: "installation token response missing token" };
  return { ok: true, token: body.token, expiresAt: body.expires_at };
}

/** Resolve the App installation id on a repo (GET /repos/{owner}/{repo}/installation,
 *  App-JWT authenticated). Used to BACKFILL Game.installationId from the live API —
 *  verified-not-hardcoded — and by the governance-enable flow for new games. */
export async function getRepoInstallationId(ref: RepoRef, now?: number): Promise<{ ok: boolean; id?: string; error?: string }> {
  let jwt: string;
  try {
    jwt = mintAppJwt(now);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  const res = await fetch(`https://api.github.com/repos/${ref.owner}/${ref.repo}/installation`, {
    headers: appHeaders(jwt),
    cache: "no-store",
  });
  if (res.status === 404) return { ok: false, error: "App is not installed on this repo." };
  if (!res.ok) return { ok: false, error: `installation lookup failed (${res.status}).` };
  const body = (await res.json()) as { id?: number };
  if (body.id == null) return { ok: false, error: "installation response missing id." };
  return { ok: true, id: String(body.id) };
}
