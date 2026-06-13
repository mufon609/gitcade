#!/usr/bin/env node
// Thin CLI shim. Kept as a checked-in file (not bundled) so the shebang is
// reliable across npm installs and the published tarball. Delegates to the
// built validator CLI. Exit code is propagated by the CLI itself.
import { run } from "../dist/cli.js";

run(process.argv.slice(2)).catch((err) => {
  console.error(err?.stack ?? String(err));
  process.exit(1);
});
