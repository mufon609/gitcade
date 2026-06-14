// The headers the artifact server applies to every game asset: correct
// content-type, the STRICT game CSP, and immutable caching. This is load-bearing
// security (Locked Decision: Artifact serving) — games run in an opaque-origin
// iframe and must never reach the network or escape the sandbox.
import path from "node:path";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
};

export function contentTypeFor(file: string): string {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] || "application/octet-stream";
}

/** Build the strict game Content-Security-Policy. `default-src 'none'` plus an
 *  explicit allow-list; `connect-src 'none'` blocks network exfiltration; the
 *  storage bridge is postMessage (not CSP-governed). `frame-ancestors` limits
 *  who can embed the game to the platform origin. */
export function gameCsp(platformOrigin: string): string {
  return [
    "default-src 'none'",
    // Vite emits external module scripts ('self') + a small inline modulepreload
    // polyfill; 'unsafe-inline' is acceptable INSIDE an already opaque-origin,
    // network-denied sandbox (the real isolation is the sandbox + separate origin).
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'none'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    `frame-ancestors 'self' ${platformOrigin}`,
  ].join("; ");
}

/** Cache policy: hashed assets are immutable (Locked Decision: immutable cache
 *  headers); HTML entry points must revalidate so a rebuild surfaces. */
export function cacheControlFor(file: string): string {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".html") return "no-cache";
  return "public, max-age=31536000, immutable";
}

/** All response headers for a served artifact file. */
export function artifactHeaders(file: string, platformOrigin: string): Record<string, string> {
  return {
    "Content-Type": contentTypeFor(file),
    "Content-Security-Policy": gameCsp(platformOrigin),
    "Cache-Control": cacheControlFor(file),
    // Defense in depth alongside the CSP.
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "cross-origin",
    // Games play in sandbox="allow-scripts" iframes (opaque origin → "null").
    // ES `<script type="module">` is ALWAYS fetched in CORS mode, so a null-origin
    // document loading its own Vite entry/chunks cross-origin from this artifact
    // server is blocked without ACAO. Safe: artifacts are public, credential-free
    // static bundles, and each game's own CSP (`connect-src 'none'`) still blocks
    // exfiltration. CORP governs embedding, not module-script CORS — both are needed.
    "Access-Control-Allow-Origin": "*",
  };
}
