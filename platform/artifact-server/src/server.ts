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
  try {
    const obj = await s3.send(new GetObjectCommand({ Bucket: env.s3Bucket, Key: key }));
    const headers = artifactHeaders(assetPath, env.platformOrigin);
    if (obj.ContentLength != null) headers["Content-Length"] = String(obj.ContentLength);
    res.writeHead(200, headers);
    if (req.method === "HEAD" || !obj.Body) {
      res.end();
      return;
    }
    const body = obj.Body as Readable;
    body.on("error", () => { if (!res.writableEnded) res.destroy(); });
    body.pipe(res);
  } catch (err: any) {
    const name = err?.name || "";
    if (name === "NoSuchKey" || name === "NotFound" || err?.$metadata?.httpStatusCode === 404) {
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
