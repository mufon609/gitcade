// OPEN-tier headless load check (runs INSIDE the builder container, stage 2).
//
// Per the Open-tier-validation locked decision, an open game passes if it has a
// valid manifest + license (checked worker-side), builds to a static /dist, and
// "loads without console errors". This serves /dist over loopback (the only
// interface available under `--network none`) and loads it in the bundled
// Chromium, failing the build on any console error / uncaught page error /
// failed asset request.
//
// Usage: node headless-check.mjs <distDir>
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

// puppeteer-core is installed GLOBALLY in the image. ESM import does not honor
// the global modules path, so resolve it via createRequire anchored at
// /usr/local/lib/node_modules (whose parent's node_modules IS that dir). This
// works regardless of the cwd (we run from inside the game's repo dir).
const require = createRequire("/usr/local/lib/node_modules/_resolver.cjs");
const puppeteer = require("puppeteer-core");

const distDir = process.argv[2];
if (!distDir) {
  console.error("headless-check: <distDir> required");
  process.exit(2);
}

const CHROMIUM = process.env.CHROMIUM_BIN || "/usr/bin/chromium";

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function serve(dir) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
      // The browser auto-probes /favicon.ico; a 404 there would log a spurious
      // console.error and fail an otherwise-fine open game. Answer it emptily.
      if (urlPath === "/favicon.ico") {
        res.writeHead(204).end();
        return;
      }
      if (urlPath === "/" || urlPath.endsWith("/")) urlPath += "index.html";
      // Prevent path traversal; resolve within dist.
      const filePath = path.join(dir, path.normalize(urlPath).replace(/^(\.\.[/\\])+/, ""));
      if (!filePath.startsWith(path.resolve(dir))) {
        res.writeHead(403).end();
        return;
      }
      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404).end();
          return;
        }
        res.writeHead(200, {
          "Content-Type": CONTENT_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream",
        });
        res.end(data);
      });
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

const errors = [];
let browser;
try {
  const server = await serve(path.resolve(distDir));
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/`;

  browser = await puppeteer.launch({
    executablePath: CHROMIUM,
    headless: true,
    // No GPU on this box (ENVIRONMENT.md) + root-in-container needs --no-sandbox.
    args: ["--no-sandbox", "--disable-gpu", "--use-gl=swiftshader", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
  });
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("requestfailed", (req) =>
    errors.push(`requestfailed: ${req.url()} (${req.failure()?.errorText || "unknown"})`),
  );

  console.log(`[headless-check] loading ${url}`);
  await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
  // Let the game boot a few frames.
  await new Promise((r) => setTimeout(r, 2500));

  await browser.close();
  browser = undefined;
  server.close();
} catch (e) {
  errors.push(`launch/load failure: ${e?.message || e}`);
} finally {
  if (browser) await browser.close().catch(() => {});
}

if (errors.length) {
  console.error("\n[headless-check] FAILED — the game logged errors while loading:");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
console.log("[headless-check] OK — game loaded with no console errors");
