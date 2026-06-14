// Phase 6 browser proof — "rows in the DB is NOT the feature works". Drives a real
// Chrome-for-Testing through the SHIPPED product path:
//   1. /parts marketplace renders parts grouped into buckets.
//   2. a part page shows a "used in N games" count (the back-link from "made from").
//   3. /games/snake renders the "Made from" panel with linked catalog part chips.
//   4. the REMIXED fork /games/snake--mufon609 PLAYS in-iframe (the swapped sprite +
//      movement build, opaque-origin sandbox + CORS patch): the iframe module runs
//      and a <canvas> renders.
import puppeteer from "puppeteer-core";

const CHROME =
  process.env.CHROME_BIN || `${process.env.HOME}/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome`;
const BASE = process.env.BASE_URL || "http://localhost:3000";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const pass = (m) => (console.log("✓ " + m), results.push(true));
const fail = (m) => (console.error("✗ " + m), results.push(false));

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--use-gl=swiftshader", "--disable-dev-shm-usage"],
  });
  try {
    const page = await browser.newPage();

    // 1. Marketplace renders parts.
    await page.goto(`${BASE}/parts`, { waitUntil: "networkidle2", timeout: 30000 });
    await page.waitForSelector("section h2", { timeout: 15000 });
    const buckets = await page.$$eval("section h2", (els) => els.map((e) => e.textContent?.trim() ?? ""));
    const partLinks = await page.$$eval('a[href^="/parts/"]', (els) => els.length);
    if (buckets.length >= 5 && partLinks > 20) pass(`marketplace: ${buckets.length} buckets, ${partLinks} part links`);
    else fail(`marketplace thin: buckets=${buckets.length} links=${partLinks}`);

    // 2. A part page shows "used in N games".
    await page.goto(`${BASE}/parts/move-grid-step`, { waitUntil: "networkidle2", timeout: 30000 });
    const usedIn = await page.$$eval("h3", (els) => els.map((e) => e.textContent ?? "").find((t) => /used in/i.test(t)) ?? "");
    const n = Number((usedIn.match(/used in (\d+)/i) ?? [])[1] ?? "0");
    if (n >= 1) pass(`part page move-grid-step: "${usedIn.trim()}"`);
    else fail(`part page used-in count is ${n} (expected ≥1)`);

    // 3. Made-from panel on a seed game.
    await page.goto(`${BASE}/games/snake`, { waitUntil: "networkidle2", timeout: 30000 });
    await sleep(1500);
    const madeFrom = await page.evaluate(() => {
      const h = [...document.querySelectorAll("h3")].find((e) => /made from/i.test(e.textContent ?? ""));
      if (!h) return null;
      const panel = h.closest(".gc-panel");
      const chips = panel ? [...panel.querySelectorAll('a[href^="/parts/"]')].map((a) => a.textContent?.trim()) : [];
      return { heading: h.textContent?.trim(), chips };
    });
    if (madeFrom && madeFrom.chips.length >= 3) pass(`made-from panel: "${madeFrom.heading}" → ${madeFrom.chips.join(", ")}`);
    else fail(`made-from panel missing/thin: ${JSON.stringify(madeFrom)}`);

    // 4. The remixed fork plays in-iframe.
    await page.goto(`${BASE}/games/snake--mufon609`, { waitUntil: "networkidle2", timeout: 30000 });
    await sleep(1500);
    const iframe = await page.$('iframe[sandbox="allow-scripts"]');
    if (!iframe) {
      fail("remixed fork: no sandboxed iframe (game not LIVE?)");
    } else {
      const frame = await iframe.contentFrame();
      try {
        await frame.waitForSelector("canvas", { timeout: 15000 });
        const dims = await frame.$eval("canvas", (c) => ({ w: c.width, h: c.height }));
        if (dims.w > 0 && dims.h > 0) pass(`remixed fork plays in-iframe: <canvas> ${dims.w}×${dims.h}`);
        else fail(`remixed fork canvas has zero size`);
      } catch {
        fail("remixed fork: <canvas> never rendered in-iframe");
      }
    }
  } finally {
    await browser.close();
  }

  const ok = results.every(Boolean);
  console.log(`\n${results.filter(Boolean).length}/${results.length} browser checks passed`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
