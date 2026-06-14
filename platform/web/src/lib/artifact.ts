// Artifact URL conventions — must match the 4A artifact server exactly:
//   {ARTIFACT_BASE_URL}/artifacts/{gameSlug}/{branch}/{path}
// index.html lives at the branch root. The iframe loads this opaque cross-origin
// URL with sandbox="allow-scripts" only (Locked Decision: game storage isolation).
import { env } from "./env";

/** URL of a game's built artifact entry (index.html) for a given branch. */
export function artifactIndexUrl(gameSlug: string, branch = "main"): string {
  const base = env.artifactBaseUrl.replace(/\/+$/, "");
  return `${base}/artifacts/${encodeURIComponent(gameSlug)}/${encodeURIComponent(branch)}/index.html`;
}

/** The artifact origin (scheme + host) — used for nothing security-relevant on
 *  the parent side (the iframe is opaque-origin), but handy for display/debug. */
export function artifactOrigin(): string {
  try {
    return new URL(env.artifactBaseUrl).origin;
  } catch {
    return env.artifactBaseUrl;
  }
}
