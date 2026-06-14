// Local-dev webhook tunnel. GitHub can't reach localhost, so the GitCade App
// delivers push events to the smee.io channel (WEBHOOK_PROXY_URL — already the
// App's webhook URL since Phase 0). This forwards that channel to the local webhook
// route. Run alongside `npm run dev`/`start`:  npm run webhook:proxy
import { spawn } from "node:child_process";
import { env } from "../src/lib/env";

const target = `${env.nextAuthUrl.replace(/\/+$/, "")}/api/webhooks/github`;
if (!env.webhookProxyUrl) {
  console.error("WEBHOOK_PROXY_URL is not set in .env — create a smee.io channel and set it (see Phase 0).");
  process.exit(1);
}

console.log(`forwarding ${env.webhookProxyUrl}  →  ${target}`);
// smee-client's bin is `smee`; npx fetches it on demand (no repo dependency added).
const child = spawn(
  "npx",
  ["--yes", "smee-client", "--url", env.webhookProxyUrl, "--target", target],
  { stdio: "inherit" },
);
child.on("exit", (code) => process.exit(code ?? 0));
