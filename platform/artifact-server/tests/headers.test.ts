// Header-assertion test (Phase 4A requirement): upload a fixture artifact to the
// real bucket, start the artifact server, fetch index.html + one asset, and
// assert the strict CSP + correct content-types + cache policy. Also unit-tests
// the pure header builders.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type http from "node:http";
import { PutObjectCommand, DeleteObjectsCommand, CreateBucketCommand } from "@aws-sdk/client-s3";
import { createServer, s3 } from "../src/server.js";
import { env } from "../src/env.js";
import { artifactHeaders, gameCsp, cacheControlFor, contentTypeFor } from "../src/headers.js";

const GAME = "__test_headers__";
const BRANCH = "main";
const PREFIX = `${GAME}/${BRANCH}`;
const INDEX = `<!doctype html><html><body><script type="module" src="/assets/app.js"></script></body></html>`;
const APP_JS = `console.log("hi");`;

let server: http.Server;
let base: string;

beforeAll(async () => {
  try {
    await s3.send(new CreateBucketCommand({ Bucket: env.s3Bucket }));
  } catch {
    /* bucket already exists */
  }
  await s3.send(
    new PutObjectCommand({ Bucket: env.s3Bucket, Key: `${PREFIX}/index.html`, Body: INDEX, ContentType: "x/wrong" }),
  );
  await s3.send(
    new PutObjectCommand({ Bucket: env.s3Bucket, Key: `${PREFIX}/assets/app.js`, Body: APP_JS, ContentType: "x/wrong" }),
  );
  server = createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await s3.send(
    new DeleteObjectsCommand({
      Bucket: env.s3Bucket,
      Delete: { Objects: [{ Key: `${PREFIX}/index.html` }, { Key: `${PREFIX}/assets/app.js` }] },
    }),
  );
});

describe("pure header builders", () => {
  it("CSP locks down default-src and network, allows framing by the platform", () => {
    const csp = gameCsp("http://localhost:3000");
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("frame-ancestors 'self' http://localhost:3000");
  });
  it("content-types map by extension", () => {
    expect(contentTypeFor("index.html")).toBe("text/html; charset=utf-8");
    expect(contentTypeFor("app.js")).toBe("text/javascript; charset=utf-8");
    expect(contentTypeFor("sprite.png")).toBe("image/png");
  });
  it("hashed assets are immutable; html revalidates", () => {
    expect(cacheControlFor("assets/app-abc123.js")).toContain("immutable");
    expect(cacheControlFor("index.html")).toBe("no-cache");
  });
  it("artifactHeaders bundles content-type + CSP + cache + nosniff", () => {
    const h = artifactHeaders("app.js", "http://localhost:3000");
    expect(h["Content-Type"]).toBe("text/javascript; charset=utf-8");
    expect(h["Content-Security-Policy"]).toContain("default-src 'none'");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    // Regression guard: opaque-origin iframes fetch module scripts in CORS mode,
    // so artifacts MUST carry ACAO or in-iframe play breaks (see BLOCKED.md fix).
    expect(h["Access-Control-Allow-Origin"]).toBe("*");
  });
});

describe("served artifact responses", () => {
  it("serves index.html with text/html, the strict CSP, and no-cache", async () => {
    const res = await fetch(`${base}/artifacts/${GAME}/${BRANCH}/index.html`);
    expect(res.status).toBe(200);
    // Server sets the correct content-type, NOT the wrong one we stored.
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const csp = res.headers.get("content-security-policy") || "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src 'none'");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(await res.text()).toContain("<script");
  });

  it("serves a JS asset with text/javascript and immutable cache", async () => {
    const res = await fetch(`${base}/artifacts/${GAME}/${BRANCH}/assets/app.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(res.headers.get("cache-control")).toContain("immutable");
    // A null-origin (sandboxed) document must be allowed to load this module.
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("root of a branch serves index.html", async () => {
    const res = await fetch(`${base}/artifacts/${GAME}/${BRANCH}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
  });

  it("missing object → 404", async () => {
    const res = await fetch(`${base}/artifacts/${GAME}/${BRANCH}/nope.js`);
    expect(res.status).toBe(404);
  });

  it("forwards an ETag and honors If-None-Match with a 304 (Phase 8B caching)", async () => {
    // First load: must carry a validator so a browser/CDN can revalidate the
    // no-cache HTML entry cheaply instead of re-downloading the full body.
    const first = await fetch(`${base}/artifacts/${GAME}/${BRANCH}/index.html`);
    expect(first.status).toBe(200);
    const etag = first.headers.get("etag");
    expect(etag).toBeTruthy();

    // Revalidation with the matching validator → 304, empty body, cache policy kept.
    const second = await fetch(`${base}/artifacts/${GAME}/${BRANCH}/index.html`, {
      headers: { "If-None-Match": etag as string },
    });
    expect(second.status).toBe(304);
    expect(second.headers.get("cache-control")).toBe("no-cache");
    expect(await second.text()).toBe("");
  });
});
