// The artifact server (Locked Decision: Artifact serving). Streams built game
// artifacts from the bucket at GET /artifacts/{game}/{branch}/{path} with the
// strict game CSP, correct content-types, and immutable cache headers. NO
// presigned URLs (they break relative asset paths) and NO raw bucket exposure
// (it can't set the CSP). This is the only path by which a game reaches a
// browser.
import http from "node:http";
import type { Readable } from "node:stream";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { env } from "./env.js";
import { artifactHeaders } from "./headers.js";

export const s3 = new S3Client({
  endpoint: env.s3Endpoint,
  region: env.s3Region,
  forcePathStyle: env.s3ForcePathStyle,
  credentials: { accessKeyId: env.s3AccessKeyId, secretAccessKey: env.s3SecretAccessKey },
});

const ROUTE = /^\/artifacts\/([^/]+)\/([^/]+)\/(.*)$/;

export async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" }).end("Method Not Allowed");
    return;
  }

  const url = new URL(req.url || "/", "http://localhost");
  if (url.pathname === "/healthz") {
    res.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
    return;
  }
  // Browsers auto-probe /favicon.ico when a game is opened top-level (not in the
  // iframe). Answer emptily so it doesn't surface as a console error in testing.
  if (url.pathname === "/favicon.ico") {
    res.writeHead(204).end();
    return;
  }

  const m = ROUTE.exec(url.pathname);
  if (!m) {
    res.writeHead(404, { "Content-Type": "text/plain" }).end("Not Found. Use /artifacts/{game}/{branch}/{path}");
    return;
  }

  const [, game, branch] = m;
  let assetPath = decodeURIComponent(m[3]);
  // Directory / root request → serve the game's entry document.
  if (assetPath === "" || assetPath.endsWith("/")) assetPath += "index.html";
  // Reject traversal — only serve within {game}/{branch}/.
  if (assetPath.split("/").some((seg) => seg === "..")) {
    res.writeHead(400, { "Content-Type": "text/plain" }).end("Bad path");
    return;
  }

  const key = `${game}/${branch}/${assetPath}`;
  // Conditional GET: forward the client's validators to the bucket so revalidating a
  // `no-cache` HTML entry returns 304 (empty body) instead of re-streaming it. The
  // immutable hashed assets never reach this — the browser won't revalidate them
  // within their year-long max-age. This is a CDN-correctness header adjustment only;
  // it changes neither the {game}/{branch}/{path} URL convention nor the game CSP.
  const inm = req.headers["if-none-match"];
  const ims = req.headers["if-modified-since"];
  const imsDate = typeof ims === "string" ? new Date(ims) : undefined;
  try {
    const obj = await s3.send(
      new GetObjectCommand({
        Bucket: env.s3Bucket,
        Key: key,
        ...(typeof inm === "string" ? { IfNoneMatch: inm } : {}),
        ...(imsDate && !isNaN(imsDate.getTime()) ? { IfModifiedSince: imsDate } : {}),
      }),
    );
    const headers = artifactHeaders(assetPath, env.platformOrigin);
    if (obj.ContentLength != null) headers["Content-Length"] = String(obj.ContentLength);
    // Validators so a browser/CDN can cheaply revalidate the no-cache HTML entry.
    if (obj.ETag) headers["ETag"] = obj.ETag;
    if (obj.LastModified) headers["Last-Modified"] = obj.LastModified.toUTCString();
    res.writeHead(200, headers);
    if (req.method === "HEAD" || !obj.Body) {
      res.end();
      return;
    }
    const body = obj.Body as Readable;
    body.on("error", () => { if (!res.writableEnded) res.destroy(); });
    body.pipe(res);
  } catch (err: any) {
    const httpStatus = err?.$metadata?.httpStatusCode;
    const name = err?.name || "";
    // The bucket reports the conditional match as 304 (Not Modified) — relay it with
    // the validators + cache policy and no body.
    if (httpStatus === 304 || name === "NotModified" || name === "304") {
      const h = artifactHeaders(assetPath, env.platformOrigin);
      delete h["Content-Type"]; // a 304 must not carry an entity body / type
      if (typeof inm === "string") h["ETag"] = inm;
      res.writeHead(304, h);
      res.end();
      return;
    }
    if (name === "NoSuchKey" || name === "NotFound" || httpStatus === 404) {
      res.writeHead(404, { "Content-Type": "text/plain" }).end(`Not Found: ${key}`);
    } else {
      console.error(`[artifact-server] error serving ${key}:`, err?.message || err);
      res.writeHead(502, { "Content-Type": "text/plain" }).end("Upstream storage error");
    }
  }
}

export function createServer(): http.Server {
  return http.createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      console.error("[artifact-server] unhandled:", err);
      if (!res.headersSent) res.writeHead(500).end("Internal Error");
    });
  });
}

// Entry point (skipped when imported by tests).
if (process.argv[1] && process.argv[1].endsWith("server.ts")) {
  createServer().listen(env.port, () => {
    console.log(`[artifact-server] listening on http://localhost:${env.port}`);
    console.log(`[artifact-server] GET /artifacts/{game}/{branch}/{path}  bucket=${env.s3Bucket}`);
  });
}
