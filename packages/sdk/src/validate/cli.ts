import { validateGame, type ValidationResult } from "./index.js";

const VERSION = "0.1.0";

const USAGE = `gitcade — GitCade SDK CLI (v${VERSION})

Usage:
  gitcade validate <dir>     Validate a game directory; exit 0 = publishable
  gitcade --version          Print the SDK CLI version
  gitcade --help             Show this help

\`validate\` checks: game.json + config.json + scene schemas, the storage rule
(ecosystem tier), the no-magic-numbers rule (balance numbers must be \$cfg
references), partId@version catalog resolution, and a headless smoke boot.`;

/**
 * CLI entry point. Returns nothing but sets `process.exitCode`. Invoked by the
 * `bin/gitcade.mjs` shim. Kept as an exported `run(args)` so it is unit-testable.
 */
export async function run(argv: string[]): Promise<void> {
  const [cmd, ...rest] = argv;

  if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") {
    console.log(USAGE);
    return;
  }
  if (cmd === "--version" || cmd === "-v") {
    console.log(VERSION);
    return;
  }
  if (cmd === "validate") {
    const dir = rest.find((a) => !a.startsWith("-"));
    if (!dir) {
      console.error("error: `gitcade validate` requires a <dir> argument\n");
      console.error(USAGE);
      process.exitCode = 2;
      return;
    }
    const result = await validateGame(dir);
    printResult(result);
    process.exitCode = result.ok ? 0 : 1;
    return;
  }

  console.error(`error: unknown command "${cmd}"\n`);
  console.error(USAGE);
  process.exitCode = 2;
}

function printResult(r: ValidationResult): void {
  const errors = r.issues.filter((i) => i.level === "error");
  const warnings = r.issues.filter((i) => i.level === "warning");

  console.log(`\nValidating ${r.dir}`);
  if (r.tier) console.log(`  tier: ${r.tier}`);

  for (const issue of r.issues) {
    const tag = issue.level === "error" ? "ERROR" : "warn ";
    const loc = issue.where ? `  (${issue.where})` : "";
    console.log(`  [${tag}] ${issue.code}: ${issue.message}${loc}`);
  }

  // Determinism conformance advisory (when it ran — the default-registry path).
  if (r.determinism?.checked) {
    console.log(
      r.determinism.deterministic
        ? `  determinism: ✓ re-runs byte-identically on a fixed seed + input`
        : `  determinism: ⚠ diverged at frame ${r.determinism.divergedAtFrame} (advisory only)`,
    );
  }

  console.log("");
  if (r.ok) {
    const smoke = r.framesRun > 0 ? `, smoke boot ran ${r.framesRun} frames` : "";
    const warn = warnings.length ? ` (${warnings.length} warning(s))` : "";
    console.log(`✓ PASS — publishable${smoke}${warn}`);
  } else {
    console.log(`✗ FAIL — ${errors.length} error(s)${warnings.length ? `, ${warnings.length} warning(s)` : ""}`);
  }
}
