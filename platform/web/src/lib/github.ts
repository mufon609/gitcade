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

// ─────────────────────────── Phase 5: fork + branch ops ───────────────────────────
// These act under a USER's OAuth token (the `public_repo` scope 4B already
// requested — never a new scope, never admin:repo_hook). Forking creates a REAL
// public repo under the acting user's account.

export interface ForkResult {
  ok: boolean;
  /** owner/repo of the new fork (the authenticated user's namespace). */
  ref?: RepoRef;
  fullName?: string;
  cloneUrl?: string;
  htmlUrl?: string;
  defaultBranch?: string;
  error?: string;
}

/** Kick off a GitHub fork of `ref` under the token-owner's account. NOTE: the fork
 *  API is ASYNC — a 202 means "accepted", the repo may not be clonable yet. Always
 *  follow with {@link waitForRepoReady} before enqueueing a build. */
export async function forkRepo(ref: RepoRef, token: string): Promise<ForkResult> {
  const res = await fetch(`https://api.github.com/repos/${ref.owner}/${ref.repo}/forks`, {
    method: "POST",
    headers: ghHeaders(token),
    // default_branch_only keeps the fork lean (we only build tracked branches).
    body: JSON.stringify({ default_branch_only: false }),
    cache: "no-store",
  });
  if (res.status === 401 || res.status === 403) {
    return { ok: false, error: "GitHub rejected the fork (token missing the public_repo scope?)." };
  }
  if (res.status !== 202 && res.status !== 200) {
    return { ok: false, error: `GitHub fork API returned ${res.status}.` };
  }
  const body = (await res.json()) as {
    full_name?: string;
    owner?: { login?: string };
    name?: string;
    clone_url?: string;
    html_url?: string;
    default_branch?: string;
  };
  const owner = body.owner?.login;
  const repo = body.name;
  if (!owner || !repo) return { ok: false, error: "GitHub fork response was missing owner/repo." };
  return {
    ok: true,
    ref: { owner, repo },
    fullName: body.full_name,
    cloneUrl: body.clone_url ?? `https://github.com/${owner}/${repo}.git`,
    htmlUrl: body.html_url,
    defaultBranch: body.default_branch ?? "main",
  };
}

/** Poll a (freshly-forked) repo until it is fully created and clonable. The fork
 *  API returns before GitHub finishes copying the git data, so we check that the
 *  repo exists AND reports a non-zero size / a readable default branch HEAD. Uses
 *  exponential backoff capped at ~`capMs` total (default 30s). Returns ready=false
 *  if it never became ready in time (caller surfaces honest progress). */
export async function waitForRepoReady(
  ref: RepoRef,
  token: string,
  opts: { capMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<{ ready: boolean; defaultBranch?: string; waitedMs: number; attempts: number }> {
  const capMs = opts.capMs ?? 30_000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const start = Date.now();
  let delay = 500;
  let attempts = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    attempts++;
    const meta = await getRepoMeta(ref, token);
    if (meta.ok) {
      const branch = meta.defaultBranch ?? "main";
      // Confirm the default branch HEAD is resolvable — the strongest "clonable" signal.
      const head = await getBranchHead(ref, branch, token);
      if (head.ok && head.sha) {
        return { ready: true, defaultBranch: branch, waitedMs: Date.now() - start, attempts };
      }
    }
    if (Date.now() - start + delay > capMs) {
      return { ready: false, defaultBranch: meta.defaultBranch, waitedMs: Date.now() - start, attempts };
    }
    await sleep(delay);
    delay = Math.min(delay * 1.6, 4000); // exponential backoff, capped per-step
  }
}

/** Resolve a branch's HEAD commit sha. Used by the fork-readiness poll, the webhook
 *  (informational), and the polling fallback (compare head vs last built commit). */
export async function getBranchHead(
  ref: RepoRef,
  branch: string,
  token?: string,
): Promise<{ ok: boolean; sha?: string; error?: string }> {
  const res = await fetch(
    `https://api.github.com/repos/${ref.owner}/${ref.repo}/commits/${encodeURIComponent(branch)}`,
    { headers: { ...ghHeaders(token), Accept: "application/vnd.github.sha" }, cache: "no-store" },
  );
  if (res.status === 404 || res.status === 422) return { ok: false, error: "branch not found" };
  if (!res.ok) return { ok: false, error: `GitHub API ${res.status}` };
  const sha = (await res.text()).trim();
  return { ok: true, sha };
}

export interface BranchInfo {
  name: string;
  sha: string;
}

/** List all branches of a repo (name + head sha). */
export async function listBranches(ref: RepoRef, token?: string): Promise<BranchInfo[]> {
  const out: BranchInfo[] = [];
  for (let page = 1; page <= 5; page++) {
    const res = await fetch(
      `https://api.github.com/repos/${ref.owner}/${ref.repo}/branches?per_page=100&page=${page}`,
      { headers: ghHeaders(token), cache: "no-store" },
    );
    if (!res.ok) break;
    const body = (await res.json()) as Array<{ name: string; commit: { sha: string } }>;
    for (const b of body) out.push({ name: b.name, sha: b.commit.sha });
    if (body.length < 100) break;
  }
  return out;
}

export interface CompareResult {
  ok: boolean;
  /** Filenames changed between base...head. */
  files: string[];
  aheadBy?: number;
  behindBy?: number;
  error?: string;
}

/** Compare base...head across repos (fork lineage). `head` is expressed as
 *  `{owner}:{branch}` against the base repo, which GitHub resolves across forks
 *  sharing history. Returns the changed filenames so the fork tree can show a
 *  changed-files count and decide whether only config.json changed. */
export async function compareRefs(
  baseRef: RepoRef,
  baseBranch: string,
  headRef: RepoRef,
  headBranch: string,
  token?: string,
): Promise<CompareResult> {
  const basis = `${encodeURIComponent(baseBranch)}...${encodeURIComponent(`${headRef.owner}:${headBranch}`)}`;
  const res = await fetch(
    `https://api.github.com/repos/${baseRef.owner}/${baseRef.repo}/compare/${basis}`,
    { headers: ghHeaders(token), cache: "no-store" },
  );
  if (!res.ok) return { ok: false, files: [], error: `GitHub compare API ${res.status}` };
  const body = (await res.json()) as {
    files?: Array<{ filename: string }>;
    ahead_by?: number;
    behind_by?: number;
  };
  return {
    ok: true,
    files: (body.files ?? []).map((f) => f.filename),
    aheadBy: body.ahead_by,
    behindBy: body.behind_by,
  };
}

/** Read a file (decoded) plus its blob sha — the sha is required to PUT an update. */
export async function getFileWithSha(
  ref: RepoRef,
  path: string,
  branch: string,
  token?: string,
): Promise<{ ok: boolean; content?: string; sha?: string; error?: string }> {
  const res = await fetch(
    `https://api.github.com/repos/${ref.owner}/${ref.repo}/contents/${path}?ref=${encodeURIComponent(branch)}`,
    { headers: ghHeaders(token), cache: "no-store" },
  );
  if (res.status === 404) return { ok: false, error: `${path} not found on "${branch}".` };
  if (!res.ok) return { ok: false, error: `GitHub contents API ${res.status}` };
  const body = (await res.json()) as { content?: string; encoding?: string; sha?: string };
  if (!body.content || body.encoding !== "base64") return { ok: false, error: "unexpected contents encoding" };
  const content = Buffer.from(body.content, "base64").toString("utf8");
  return { ok: true, content, sha: body.sha };
}

/** Commit an update (or create) of a file on a branch via the contents API. */
export async function putFile(
  ref: RepoRef,
  path: string,
  branch: string,
  content: string,
  message: string,
  token: string,
  sha?: string,
): Promise<{ ok: boolean; commit?: string; error?: string }> {
  const res = await fetch(`https://api.github.com/repos/${ref.owner}/${ref.repo}/contents/${path}`, {
    method: "PUT",
    headers: ghHeaders(token),
    body: JSON.stringify({
      message,
      content: Buffer.from(content, "utf8").toString("base64"),
      branch,
      ...(sha ? { sha } : {}),
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    const txt = await res.text();
    return { ok: false, error: `GitHub contents PUT ${res.status}: ${txt.slice(0, 200)}` };
  }
  const body = (await res.json()) as { commit?: { sha?: string } };
  return { ok: true, commit: body.commit?.sha };
}

/** Create a new branch ref pointing at `fromSha`. Used to spin up a rebalance
 *  branch on a fork (compare-play demo / future remix). */
export async function createBranch(
  ref: RepoRef,
  newBranch: string,
  fromSha: string,
  token: string,
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`https://api.github.com/repos/${ref.owner}/${ref.repo}/git/refs`, {
    method: "POST",
    headers: ghHeaders(token),
    body: JSON.stringify({ ref: `refs/heads/${newBranch}`, sha: fromSha }),
    cache: "no-store",
  });
  if (res.status === 422) return { ok: true }; // already exists — idempotent
  if (!res.ok) return { ok: false, error: `GitHub create-ref ${res.status}` };
  return { ok: true };
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
