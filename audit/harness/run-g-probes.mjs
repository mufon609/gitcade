/**
 * Run the g* acceptance probes and print, per probe, each labeled eval result and
 * the final entity positions — the compact view used to confirm 0.2.0 flips each
 * FAIL baseline to PASS. Not a test runner; an observation aid.
 */
import { runScenario } from "./harness.mjs";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const only = process.argv[2];
const files = readdirSync(resolve(here, "scenarios"))
  .filter((f) => /^g\d/.test(f) && f.endsWith(".mjs"))
  .filter((f) => !only || f.includes(only))
  .sort();

for (const file of files) {
  const mod = await import(resolve(here, "scenarios", file));
  const report = await runScenario(mod.default);
  console.log(`\n===== ${file} =====`);
  console.log(`scene now: ${report.info?.sceneId}  worldHasTilemap: ${report.info?.worldHasTilemap}`);
  for (const row of report.timeline) {
    if (row.eval !== undefined) {
      console.log(`  [${row.label}] => ${JSON.stringify(row.eval)}`);
    }
  }
  // Final state + entity centers (used by g4/g6 review).
  const last = report.timeline[report.timeline.length - 1];
  console.log(`  final state: ${JSON.stringify(last.state)}`);
  if (report.pageErrors.length) console.log(`  PAGE ERRORS: ${JSON.stringify(report.pageErrors)}`);
}
