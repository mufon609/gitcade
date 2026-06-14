// Pure, env-free artifact URL builder. Kept SEPARATE from artifact.ts (which reads
// the server-only env) so client components (the branch switcher, the compare
// panes) can compute per-branch artifact URLs without dragging dotenv/env into the
// browser bundle. The URL convention is the FROZEN 4A one:
//   {base}/artifacts/{gameSlug}/{branch}/{path}   (index.html at the branch root)
export function buildArtifactIndexUrl(base: string, gameSlug: string, branch = "main"): string {
  const b = base.replace(/\/+$/, "");
  return `${b}/artifacts/${encodeURIComponent(gameSlug)}/${encodeURIComponent(branch)}/index.html`;
}
