// Post-governance-removal smoke: the site runs and a game page loads + plays.
// Drives the real Chrome-for-Testing through the shipped path (no asserting from
// code): home page renders, /games/snake renders its iframe <canvas>, no console
// errors, governance UI is gone, core UI (Stats/Manifest/Fork/Remix) present.
import puppeteer from "puppeteer-core";

const CHROME =
  process.env.CHROME_BIN ||
  `${process.env.HOME}/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome`;
const BASE = process.env.BASE_URL || "http://localhost:3000";
const SLUG = "snake";

const results = [];
const pass = (m) => (console.log("✓ " + m), results.push(true));
const fail = (m) => (console.error("✗ " + m), results.push(false));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu", "--use-gl=swiftshader", "--disable-dev-shm-usage"],
});

try {
  // ---- Home page runs ----
  {
    const page = await browser.newPage();
    const errs = [];
    page.on("console", (m) => m.type() === "error" && errs.push(m.text()));
    page.on("pageerror", (e) => errs.push(String(e)));
    const res = await page.goto(`${BASE}/`, { waitUntil: "networkidle2", timeout: 30000 });
    res && res.status() === 200 ? pass(`home page HTTP 200`) : fail(`home page HTTP ${res && res.status()}`);
    const body = await page.evaluate(() => document.body.innerText);
    /governance|community vote|proposal/i.test(body)
      ? fail(`home page still shows governance copy`)
      : pass(`home page free of governance copy`);
    errs.length ? fail(`home console errors: ${errs.slice(0, 3).join(" | ")}`) : pass(`home page: no console errors`);
    await page.close();
  }

  // ---- Game page loads + the game actually boots ----
  {
    const page = await browser.newPage();
    const errs = [];
    page.on("console", (m) => m.type() === "error" && errs.push(m.text()));
    page.on("pageerror", (e) => errs.push(String(e)));

    const res = await page.goto(`${BASE}/games/${SLUG}`, { waitUntil: "networkidle2", timeout: 30000 });
    res && res.status() === 200 ? pass(`/games/${SLUG} HTTP 200`) : fail(`/games/${SLUG} HTTP ${res && res.status()}`);

    // The game plays in its sandboxed iframe → a <canvas> renders with real size.
    const frameEl = await page.waitForSelector(`iframe[title^="${SLUG}"]`, { timeout: 15000 });
    const frame = await frameEl.contentFrame();
    await frame.waitForSelector("canvas", { timeout: 15000 });
    const c = await frame.$eval("canvas", (el) => ({ w: el.width, h: el.height }));
    c.w > 0 && c.h > 0
      ? pass(`${SLUG} boots in-iframe — <canvas> ${c.w}×${c.h} rendered`)
      : fail(`${SLUG} iframe canvas missing/zero-size`);

    // Governance UI gone; core UI intact (server-rendered DOM text).
    const body = await page.evaluate(() => document.body.innerText);
    /\bcommunity members\b|join community|open proposals|governance/i.test(body)
      ? fail(`game page still shows governance UI`)
      : pass(`game page: governance UI removed`);
    // Stats/Manifest are static server text; the Fork/Remix controls render
    // auth-gated text (a sign-in prompt when logged out), so match case-insensitively.
    for (const k of ["Stats", "Manifest"]) {
      body.includes(k) ? pass(`game page shows "${k}"`) : fail(`game page missing "${k}"`);
    }
    for (const [label, re] of [["fork control", /fork/i], ["remix control", /remix/i]]) {
      re.test(body) ? pass(`game page shows ${label}`) : fail(`game page missing ${label}`);
    }
    errs.length ? fail(`game console errors: ${errs.slice(0, 3).join(" | ")}`) : pass(`game page: no console errors`);
    await page.close();
  }
} finally {
  await browser.close();
}

const ok = results.every(Boolean);
console.log(`\n${ok ? "ALL GREEN" : "FAILURES ABOVE"} — ${results.filter(Boolean).length}/${results.length} checks passed`);
process.exit(ok ? 0 : 1);
