/**
 * GitCade engine-audit observation harness (the Stage 0 deliverable).
 *
 * Loads an arbitrary SDK scene in a real headless Chrome, drives scripted input
 * (keyboard codes + pointer clicks at WORLD coordinates), and samples, over a
 * timeline: canvas-pixel hashes (to detect rendering & animation), console
 * messages, page errors, request failures, and a deep snapshot of `world.state`
 * and live entities. Every "works"/"broken" verdict in ENGINE-AUDIT.md is backed
 * by a report this produced.
 *
 * Design:
 *  - A scene is booted through the SAME path a real game uses (createGame + a
 *    library-loaded registry — see entry.mjs), so observations transfer.
 *  - The fixed-timestep sim is advanced by the driver (step N), not by rAF, so
 *    timelines are deterministic and reproducible run-to-run.
 *  - The canvas renders 1:1 at the page origin, so a click at client (x,y) lands
 *    at world (x,y). Chrome synthesizes pointer events from the mouse, which is
 *    exactly the public input path the SDK's Input.attach listens on.
 *
 * Usage (programmatic): import { runScenario } and pass { sources, actions }.
 * Usage (CLI): node harness.mjs <scenario.mjs>  — the scenario default-exports
 * { sources, actions, bootOpts? }.
 */
import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, extname } from "node:path";
import { spawnSync } from "node:child_process";
import puppeteer from "puppeteer-core";

const here = dirname(fileURLToPath(import.meta.url));
const CHROME =
  process.env.CHROME_BIN ||
  `${process.env.HOME}/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome`;

const MIME = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json" };

/** Build (or rebuild) the browser bundle so the harness always runs current dist. */
function ensureBundle() {
  const r = spawnSync("node", [resolve(here, "build-bundle.mjs")], { stdio: "inherit" });
  if (r.status !== 0) throw new Error("bundle build failed");
}

/** Serve the harness directory on an ephemeral loopback port. */
function serve() {
  return new Promise((res) => {
    const server = http.createServer(async (req, rep) => {
      const url = (req.url || "/").split("?")[0];
      const path = resolve(here, "." + (url === "/" ? "/host.html" : url));
      if (!path.startsWith(here) || !existsSync(path)) {
        rep.statusCode = 404;
        return rep.end("not found");
      }
      const body = await readFile(path);
      rep.setHeader("content-type", MIME[extname(path)] || "application/octet-stream");
      rep.end(body);
    });
    server.listen(0, "127.0.0.1", () => res(server));
  });
}

/**
 * Run a scenario and return a structured report.
 * @param {object} cfg
 * @param {object} cfg.sources  { manifest, config, scenes }
 * @param {object} [cfg.bootOpts]  passed to __GC.boot (e.g. { libraryOnly:false })
 * @param {Array}  cfg.actions  declarative action list (see applyAction)
 * @param {boolean} [cfg.headed] launch headed to watch (X11 present)
 */
export async function runScenario(cfg) {
  ensureBundle();
  const server = await serve();
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  const console_ = [];
  const pageErrors = [];
  const requestFailures = [];

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: cfg.headed ? false : "shell",
    args: [
      "--no-sandbox",
      "--disable-gpu",
      "--use-gl=swiftshader",
      "--disable-dev-shm-usage",
    ],
  });
  try {
    const page = await browser.newPage();
    const w = cfg.sources?.scenes?.[0]?.size?.width ?? 800;
    const h = cfg.sources?.scenes?.[0]?.size?.height ?? 600;
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });

    page.on("console", (m) => console_.push({ type: m.type(), text: m.text() }));
    page.on("pageerror", (e) => pageErrors.push(String(e)));
    page.on("requestfailed", (r) =>
      requestFailures.push({ url: r.url(), err: r.failure()?.errorText }),
    );

    const resp = await page.goto(`${base}/host.html`, { waitUntil: "load" });
    const httpStatus = resp?.status() ?? null;

    // Boot the scene.
    const bootResult = await page.evaluate(
      (sources, opts) => window.__GC.boot(sources, opts || {}),
      cfg.sources,
      cfg.bootOpts || {},
    );
    const info = await page.evaluate(() => window.__GC.info());

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
        // also count non-background (alpha>0 & not uniform) pixels cheaply
        let nonzero = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i] | d[i + 1] | d[i + 2]) nonzero++;
        return { hash: h.toString(16), nonzero };
      });
      const state = await page.evaluate(() => window.__GC.state());
      const entities = await page.evaluate(() => window.__GC.entities());
      // Record the eval result whenever one was produced — including falsy values
      // (false/0/"") so a probe asserting `isBuildable(...) === false` is observable.
      timeline.push({ label, ...hash, state, entities, ...(extra !== undefined ? { eval: extra } : {}) });
    };

    await sample("boot");

    for (const action of cfg.actions || []) {
      await applyAction(page, action);
      if (action.label || action.sample !== false) {
        await sample(action.label || actionLabel(action), action.__evalResult);
      }
    }

    return {
      httpStatus,
      bootResult,
      info,
      timeline,
      console: console_,
      pageErrors,
      requestFailures,
    };
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
  if (a.eval) return `eval`;
  return "action";
}

/** Apply one declarative action against the page. */
async function applyAction(page, a) {
  if (a.keydown) await page.keyboard.down(a.keydown);
  if (a.keyup) await page.keyboard.up(a.keyup);
  if (a.click) {
    // client coords == world coords (canvas at origin, 1:1). Chrome turns these
    // mouse events into the pointer events the SDK's Input listens for.
    await page.mouse.move(a.click.x, a.click.y);
    await page.mouse.down();
    if (a.holdFrames) {
      await page.evaluate((n) => window.__GC.step(n), a.holdFrames);
      // Capture what a data-driven part would see DURING the hold: the engine's
      // view of the active pointer (world coords) — this is the only click signal.
      a.__evalResult = { pointersWhileDown: await page.evaluate(() => window.__GC.pointers()) };
    }
    await page.mouse.up();
  }
  if (a.pointerdown) {
    await page.mouse.move(a.pointerdown.x, a.pointerdown.y);
    await page.mouse.down();
  }
  if (a.pointerup) {
    await page.mouse.up();
  }
  if (a.step != null) await page.evaluate((n) => window.__GC.step(n), a.step);
  if (a.eval) {
    const out = await page.evaluate((code) => {
      // eslint-disable-next-line no-new-func
      return new Function("return (" + code + ")()")();
    }, a.eval);
    a.__evalResult = out;
  }
}

// ---- CLI ----
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: node harness.mjs <scenario.mjs>");
    process.exit(2);
  }
  const mod = await import(resolve(process.cwd(), file));
  const report = await runScenario(mod.default);
  console.log(JSON.stringify(report, null, 2));
}
