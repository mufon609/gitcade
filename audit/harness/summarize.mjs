/**
 * Run a play-game scenario and print a compact, greppable summary: per-step
 * scene/state-subset/entity-tallies/eval, plus console-error / page-error / request
 * failure counts. Usage: node summarize.mjs <scenario.mjs> [stateKeys,comma,sep] [tags,comma,sep]
 */
import { playGame } from "./play-game.mjs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const file = process.argv[2];
const stateKeys = (process.argv[3] || "").split(",").filter(Boolean);
const tags = (process.argv[4] || "").split(",").filter(Boolean);

const mod = await import(resolve(process.cwd(), file));
const r = await playGame(mod.default);

console.log("boot:", JSON.stringify(r.bootResult));
for (const t of r.timeline) {
  const st = stateKeys.length
    ? stateKeys.map((k) => `${k}=${JSON.stringify(t.state[k])}`).join(" ")
    : "";
  const tg = tags.length
    ? tags.map((tag) => `${tag}=${t.entities.filter((e) => e.tags.includes(tag)).length}`).join(" ")
    : "";
  const ev = t.eval !== undefined ? ` eval=${JSON.stringify(t.eval)}` : "";
  console.log(`[${t.label}] scene=${t.scene} nz=${t.nonzero} ${st} ${tg}${ev}`);
}
const cerr = r.console.filter((c) => c.type === "error" || c.type === "pageerror");
console.log("CONSOLE-ERRORS:", cerr.length, JSON.stringify(cerr.slice(0, 5)));
console.log("PAGE-ERRORS:", r.pageErrors.length, JSON.stringify(r.pageErrors.slice(0, 3)));
console.log(
  "REQ-FAILURES:",
  r.requestFailures.length,
  JSON.stringify([...new Set(r.requestFailures.map((f) => f.url.split("/").pop()))].slice(0, 10)),
);
