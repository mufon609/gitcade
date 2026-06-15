/**
 * Stage-5a per-game replay driver. Forked from harness.mjs runScenario, but:
 *  - boots a REAL game (its game.json + config.json + every scene JSON) through a
 *    registry that has the game's custom parts registered (build-game-bundle.mjs);
 *  - serves the game's built /dist as the web root so asset paths (assets/sprites/…)
 *    resolve exactly as in production — so a missing asset shows as a real request
 *    failure, not a silent pass;
 *  - records console errors + page errors over the whole timeline.
 *
 * Programmatic: import { playGame } and pass { slug, actions, persistentStorage }.
 * The actions vocabulary matches harness.mjs (step/keydown/keyup/click/eval) plus
 * { reboot:true }, { goScene:id }, { emit:event }.
 */
import http from "node:http";
import { readFileSync as rfs, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, extname, join } from "node:path";
import puppeteer from "puppeteer-core";
import { buildGameBundle } from "./build-game-bundle.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const CHROME =
  process.env.CHROME_BIN ||
  `${process.env.HOME}/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome`;

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".css": "text/css",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

function hostHtml(slug) {
  return `<!doctype html><html><head><meta charset="utf-8"/><style>
    html,body{margin:0;background:#111;} #game{display:block;image-rendering:pixelated;}
  </style></head><body><canvas id="game"></canvas>
  <script src="/__harness/game-${slug}.js"></script></body></html>`;
}

function loadSources(slug) {
  const gdir = resolve(repoRoot, "games", slug);
  const manifest = JSON.parse(rfs(join(gdir, "game.json"), "utf8"));
  const config = JSON.parse(rfs(join(gdir, "config.json"), "utf8"));
  const sceneDir = join(gdir, "src", "scenes");
  // Order scenes so entryPoint is first (the SDK boots scenes[0]).
  const entry = manifest.entryPoint.split("/").pop();
  const files = readdirSync(sceneDir)
    .filter((f) => f.endsWith(".json"))
    .sort((a, b) => (a === entry ? -1 : b === entry ? 1 : a.localeCompare(b)));
  const scenes = files.map((f) => JSON.parse(rfs(join(sceneDir, f), "utf8")));
  return { manifest, config, scenes };
}

export async function playGame(cfg) {
  const slug = cfg.slug;
  const bundle = await buildGameBundle(slug);
  const sources = loadSources(slug);
  const distDir = resolve(repoRoot, "games", slug, "dist");

  const server = await new Promise((res) => {
    const s = http.createServer(async (req, rep) => {
      const url = (req.url || "/").split("?")[0];
      // Harness bundle.
      if (url === `/__harness/game-${slug}.js`) {
        rep.setHeader("content-type", "text/javascript");
        return rep.end(rfs(bundle));
      }
      if (url === "/" || url === "/index.html") {
        rep.setHeader("content-type", "text/html");
        return rep.end(hostHtml(slug));
      }
      // Browsers auto-request /favicon.ico; the real artifact-server serves one.
      // Answer 204 here so a harness-only 404 doesn't masquerade as a game error.
      if (url === "/favicon.ico") {
        rep.statusCode = 204;
        return rep.end();
      }
      // Everything else: serve from the game's built dist (assets, etc.).
      const path = resolve(distDir, "." + url);
      if (!path.startsWith(distDir) || !existsSync(path)) {
        rep.statusCode = 404;
        return rep.end("not found");
      }
      rep.setHeader("content-type", MIME[extname(path)] || "application/octet-stream");
      rep.end(rfs(path));
    });
    s.listen(0, "127.0.0.1", () => res(s));
  });
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  const console_ = [];
  const pageErrors = [];
  const requestFailures = [];

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: cfg.headed ? false : "shell",
    args: ["--no-sandbox", "--disable-gpu", "--use-gl=swiftshader", "--disable-dev-shm-usage"],
  });
  try {
    const page = await browser.newPage();
    const w = sources.scenes?.[0]?.size?.width ?? 800;
    const h = sources.scenes?.[0]?.size?.height ?? 600;
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });

    page.on("console", (m) => console_.push({ type: m.type(), text: m.text() }));
    page.on("pageerror", (e) => pageErrors.push(String(e)));
    page.on("requestfailed", (r) =>
      requestFailures.push({ url: r.url(), err: r.failure()?.errorText }),
    );

    await page.goto(`${base}/`, { waitUntil: "load" });
    const bootResult = await page.evaluate(
      (s, o) => window.__GC.boot(s, o || {}),
      sources,
      { persistentStorage: !!cfg.persistentStorage },
    );

    const timeline = [];
    const sample = async (label, extra) => {
      const hash = await page.evaluate(() => {
        const c = document.getElementById("game");
        const ctx = c.getContext("2d");
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        let h = 2166136261 >>> 0;
        for (let i = 0; i < d.length; i += 257) {
          h ^= d[i];
          h = Math.imul(h, 16777619) >>> 0;
        }
        let nonzero = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i] | d[i + 1] | d[i + 2]) nonzero++;
        return { hash: h.toString(16), nonzero };
      });
      const state = await page.evaluate(() => window.__GC.state());
      const scene = await page.evaluate(() => window.__GC.scene());
      const entities = await page.evaluate(() => window.__GC.entities());
      timeline.push({ label, scene, ...hash, state, entities, ...(extra !== undefined ? { eval: extra } : {}) });
    };

    await sample("boot");

    for (const action of cfg.actions || []) {
      await applyAction(page, action);
      if (action.label || action.sample !== false) {
        await sample(action.label || actionLabel(action), action.__evalResult);
      }
    }

    return { base, bootResult, timeline, console: console_, pageErrors, requestFailures };
  } finally {
    await browser.close();
    server.close();
  }
}

function actionLabel(a) {
  if (a.step != null) return `step+${a.step}`;
  if (a.click) return `click(${a.click.x},${a.click.y})`;
  if (a.keydown) return `keydown ${a.keydown}`;
  if (a.keyup) return `keyup ${a.keyup}`;
  if (a.reboot) return `reboot`;
  if (a.goScene) return `goScene ${a.goScene}`;
  if (a.emit) return `emit ${a.emit}`;
  if (a.eval) return `eval`;
  return "action";
}

async function applyAction(page, a) {
  if (a.keydown) await page.keyboard.down(a.keydown);
  if (a.keyup) await page.keyboard.up(a.keyup);
  if (a.click) {
    await page.mouse.move(a.click.x, a.click.y);
    await page.mouse.down();
    if (a.holdFrames) await page.evaluate((n) => window.__GC.step(n), a.holdFrames);
    await page.mouse.up();
  }
  if (a.reboot) await page.evaluate(() => window.__GC.reboot());
  if (a.goScene) await page.evaluate((id, keep) => window.__GC.goScene(id, keep), a.goScene, a.keep);
  if (a.emit) await page.evaluate((e, d) => window.__GC.emit(e, d), a.emit, a.data);
  if (a.step != null) await page.evaluate((n) => window.__GC.step(n), a.step);
  if (a.eval) {
    a.__evalResult = await page.evaluate((code) => new Function("return (" + code + ")()")(), a.eval);
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: node play-game.mjs <scenario.mjs>");
    process.exit(2);
  }
  const mod = await import(resolve(process.cwd(), file));
  const report = await playGame(mod.default);
  console.log(JSON.stringify(report, null, 2));
}
