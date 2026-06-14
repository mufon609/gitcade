// Thin GitHub helpers used by the publish flow. v1 is PUBLIC REPOS ONLY (Locked
// Decision: repo visibility) — we enforce that at publish time here. We fetch the
// candidate game.json over the raw/contents API and read repo visibility. Calls
// are unauthenticated by default (public repos need no token); an optional user
// token raises the rate limit and lets a user publish a repo they can see.
import { env } from "./env";

export interface RepoRef {
  owner: string;
  repo: string;
}

/** Parse an owner/repo out of any common GitHub URL form. Returns null if it is
 *  not a recognizable github.com repo URL. */
export function parseRepoUrl(input: string): RepoRef | null {
  const trimmed = input.trim();
  // Accept: https://github.com/o/r(.git), git@github.com:o/r.git, o/r
  const ssh = trimmed.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (ssh) return { owner: ssh[1], repo: ssh[2] };
  const shorthand = trimmed.match(/^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
  try {
    const u = new URL(trimmed);
    if (u.hostname.replace(/^www\./, "") !== "github.com") return null;
    const parts = u.pathname.replace(/^\/+|\/+$/g, "").split("/");
    if (parts.length < 2) return null;
    return { owner: parts[0], repo: parts[1].replace(/\.git$/, "") };
  } catch {
    // Not a URL — fall back to the shorthand "owner/repo".
    if (shorthand) return { owner: shorthand[1], repo: shorthand[2] };
    return null;
  }
}

/** Canonical https clone URL the worker will clone (anonymous). */
export function cloneUrl(ref: RepoRef): string {
  return `https://github.com/${ref.owner}/${ref.repo}.git`;
}

function ghHeaders(token?: string): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "gitcade-platform",
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

export interface RepoMeta {
  ok: boolean;
  isPrivate?: boolean;
  defaultBranch?: string;
  error?: string;
}

/** Read repo metadata (visibility + default branch). Public-repo enforcement. */
export async function getRepoMeta(ref: RepoRef, token?: string): Promise<RepoMeta> {
  const res = await fetch(`https://api.github.com/repos/${ref.owner}/${ref.repo}`, {
    headers: ghHeaders(token),
    cache: "no-store",
  });
  if (res.status === 404) {
    return { ok: false, error: "Repository not found (it must be a PUBLIC GitHub repo)." };
  }
  if (!res.ok) {
    return { ok: false, error: `GitHub API error fetching repo (${res.status}).` };
  }
  const body = (await res.json()) as { private?: boolean; default_branch?: string };
  return { ok: true, isPrivate: !!body.private, defaultBranch: body.default_branch ?? "main" };
}

/** Fetch a repo file (e.g. game.json) at a branch via the raw endpoint. */
export async function getRepoFile(
  ref: RepoRef,
  path: string,
  branch: string,
  token?: string,
): Promise<{ ok: boolean; content?: string; error?: string }> {
  const url = `https://raw.githubusercontent.com/${ref.owner}/${ref.repo}/${branch}/${path}`;
  const res = await fetch(url, { headers: ghHeaders(token), cache: "no-store" });
  if (res.status === 404) return { ok: false, error: `${path} not found on branch "${branch}".` };
  if (!res.ok) return { ok: false, error: `Failed to fetch ${path} (${res.status}).` };
  return { ok: true, content: await res.text() };
}

/** The URL that prompts the owner to install the GitCade GitHub App on their repo.
 *  After install, GitHub redirects to our /api/github/app/callback with
 *  installation_id + the state we pass (the gameId), which we persist. */
export function appInstallUrl(gameId: string): string {
  const base = `https://github.com/apps/${env.githubAppSlug}/installations/new`;
  // `state` round-trips back on the post-install redirect so we know which Game
  // to attach the installation to.
  return `${base}?state=${encodeURIComponent(gameId)}`;
}
