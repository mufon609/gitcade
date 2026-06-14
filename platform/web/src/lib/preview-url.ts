// Map a catalog sprite `src` (e.g. "assets/sprites/player-blob.png") to the path
// the platform serves library previews from (public/library-assets, synced from
// @gitcade/library). Client-safe (pure string), shared by the preview components.
export function libraryAssetUrl(src: string): string {
  const cleaned = src.replace(/^\.?\//, "").replace(/^assets\//, "");
  return `/library-assets/${cleaned}`;
}
