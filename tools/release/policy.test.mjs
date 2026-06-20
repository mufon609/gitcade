// Tests for the release policy — run via `node --test tools/release/` (no workspace,
// no vitest; node:test is built in). Dev tooling that gates irreversible actions earns
// tests. Everything runs against TEMP fixtures so the real repo is never touched.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  roleOf,
  expectedPins,
  repinText,
  repinGameManifest,
  caretIncludes,
  computeRepins,
  auditPackages,
  planNpmPublish,
  runNpmPublish,
  SDK_PEER,
} from "./policy.mjs";

// ── a temp fixture repo ───────────────────────────────────────────────────────
function writeRepo(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gitcade-policy-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, typeof content === "string" ? content : JSON.stringify(content, null, 2) + "\n");
  }
  return root;
}
const CLEAN = () => ({
  "package.json": { name: "root", workspaces: ["packages/*", "packages/library/proofs/*", "games/*", "platform/*"] },
  "packages/sdk/package.json": { name: "@gitcade/sdk", version: "1.11.0" },
  "packages/library/package.json": { name: "@gitcade/library", version: "1.10.1", peerDependencies: { "@gitcade/sdk": "^1.10.0" }, devDependencies: { "@gitcade/sdk": "^1.10.0" } },
  "packages/library/CATALOG.json": { version: "1.10.1", parts: [] },
  "games/foo/package.json": { name: "foo", dependencies: { "@gitcade/sdk": "1.11.0", "@gitcade/library": "1.10.1" } },
  "games/foo/game.json": { sdkVersion: "1.11.0", libraryVersion: "1.10.1" },
  "packages/library/proofs/bar/package.json": { name: "bar", dependencies: { "@gitcade/sdk": "*", "@gitcade/library": "*" } },
  "platform/baz/package.json": { name: "baz", dependencies: { "@gitcade/sdk": "*" } },
});

// ── roleOf — closed classifier ────────────────────────────────────────────────
test("roleOf classifies known roots and THROWS on the unknown (no silent default)", () => {
  assert.equal(roleOf("packages/sdk"), "core");
  assert.equal(roleOf("packages/library"), "core");
  assert.equal(roleOf("games/snake"), "game");
  assert.equal(roleOf("packages/library/proofs/platformer-push"), "internal");
  assert.equal(roleOf("platform/web"), "internal");
  assert.equal(roleOf("examples/pong"), "internal");
  assert.equal(roleOf("templates/game-scaffold"), "internal");
  assert.throws(() => roleOf("packages/mystery"), /unclassified/);
  assert.throws(() => roleOf("weird/x"), /unclassified/);
});

// ── expectedPins per role ─────────────────────────────────────────────────────
test("expectedPins resolves each role to its pin policy", () => {
  const v = { sdk: "1.11.0", library: "1.10.1" };
  assert.deepEqual(expectedPins("internal", v), { "@gitcade/sdk": "*", "@gitcade/library": "*" });
  assert.deepEqual(expectedPins("game", v), { "@gitcade/sdk": "1.11.0", "@gitcade/library": "1.10.1" });
  assert.deepEqual(expectedPins("core", v), { "@gitcade/sdk": SDK_PEER });
});

// ── caretIncludes ─────────────────────────────────────────────────────────────
test("caretIncludes: ^1.10.0 includes 1.10.0 / 1.11.0 but not 1.9.x / 2.0.0 / non-caret", () => {
  assert.ok(caretIncludes("1.10.0", "^1.10.0"));
  assert.ok(caretIncludes("1.11.0", "^1.10.0"));
  assert.ok(!caretIncludes("1.9.9", "^1.10.0"));
  assert.ok(!caretIncludes("2.0.0", "^1.10.0"));
  assert.ok(!caretIncludes("1.11.0", "1.10.x")); // not a caret → false (the old broken peer)
});

// ── repin transforms ──────────────────────────────────────────────────────────
test("repinText is byte-preserving, fixes drift, and is idempotent", () => {
  const v = { sdk: "1.11.0", library: "1.10.1" };
  const stale = '{\n  "dependencies": {\n    "@gitcade/sdk": "0.1.0",\n    "@gitcade/library": "0.9.0"\n  }\n}\n';
  const fixed = repinText(stale, "internal", v);
  assert.ok(fixed.includes('"@gitcade/sdk": "*"') && fixed.includes('"@gitcade/library": "*"'));
  assert.equal(repinText(fixed, "internal", v), fixed); // idempotent
  // game role pins exact; library (core) widens BOTH peer + dev occurrences.
  assert.ok(repinText(stale, "game", v).includes('"@gitcade/sdk": "1.11.0"'));
  const libText = '{\n  "peerDependencies": { "@gitcade/sdk": "1.10.x" },\n  "devDependencies": { "@gitcade/sdk": "1.10.1" }\n}\n';
  const libFixed = repinText(libText, "core", v);
  assert.equal((libFixed.match(/"@gitcade\/sdk": "\^1\.10\.0"/g) || []).length, 2);
});

test("repinGameManifest rewrites sdkVersion + libraryVersion only", () => {
  const gj = '{\n  "sdkVersion": "1.10.1",\n  "libraryVersion": "1.10.0",\n  "name": "x"\n}\n';
  const out = repinGameManifest(gj, { sdk: "1.11.0", library: "1.10.1" });
  assert.ok(out.includes('"sdkVersion": "1.11.0"') && out.includes('"libraryVersion": "1.10.1"') && out.includes('"name": "x"'));
});

// ── computeRepins / auditPackages on fixtures ─────────────────────────────────
test("a CLEAN repo: auditPackages has no issues and computeRepins is a no-op", () => {
  const root = writeRepo(CLEAN());
  try {
    assert.deepEqual(auditPackages(root).issues, []);
    assert.deepEqual(computeRepins(root), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a DRIFTED repo: doctor flags it, sync fixes it, and a 2nd sync is a no-op", () => {
  const files = CLEAN();
  files["games/foo/package.json"].dependencies["@gitcade/sdk"] = "1.10.0"; // stale game pin
  files["packages/library/proofs/bar/package.json"].dependencies["@gitcade/sdk"] = "0.9.0"; // stale internal pin
  files["games/foo/game.json"].libraryVersion = "1.10.0"; // game.json drift
  const root = writeRepo(files);
  try {
    const issues = auditPackages(root).issues;
    assert.ok(issues.some((i) => i.pkg === "games/foo" && /1\.10\.0/.test(i.msg)));
    assert.ok(issues.some((i) => i.pkg === "packages/library/proofs/bar"));
    assert.ok(issues.some((i) => i.pkg === "games/foo/game.json"));
    // Apply the computed repins (what `sync` writes), then re-audit.
    const repins = computeRepins(root);
    assert.ok(repins.length >= 2);
    for (const { path: rel, after } of repins) fs.writeFileSync(path.join(root, rel), after);
    assert.deepEqual(computeRepins(root), []); // idempotent: second pass is a no-op
    assert.deepEqual(auditPackages(root).issues, []); // and the tree is now clean
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("auditPackages flags an UNCLASSIFIED workspace package rather than defaulting it", () => {
  const files = CLEAN();
  files["package.json"].workspaces.push("weird/*");
  files["weird/x/package.json"] = { name: "x", dependencies: { "@gitcade/sdk": "1.0.0" } };
  const root = writeRepo(files);
  try {
    assert.ok(auditPackages(root).issues.some((i) => i.pkg === "weird/x" && /unclassified/.test(i.msg)));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("auditPackages flags a catalog/library version mismatch", () => {
  const files = CLEAN();
  files["packages/library/CATALOG.json"].version = "1.10.0"; // != library 1.10.1
  const root = writeRepo(files);
  try {
    assert.ok(auditPackages(root).issues.some((i) => /CATALOG/.test(i.pkg) && /catalog\.version/.test(i.msg)));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── publish planning (divergence-aware + skip-live) ───────────────────────────
test("planNpmPublish reads each package's own version and SKIPS one already live", () => {
  const pkgs = [{ name: "@gitcade/sdk", version: "1.11.0" }, { name: "@gitcade/library", version: "1.10.1" }];
  const isLive = (name) => name === "@gitcade/sdk"; // sdk already published, library not
  const plan = planNpmPublish(pkgs, isLive);
  assert.equal(plan.find((s) => s.name === "@gitcade/sdk").action, "skip");
  assert.equal(plan.find((s) => s.name === "@gitcade/library").action, "publish");
});

test("runNpmPublish --dry-run mutates NOTHING (exec is never called)", () => {
  const calls = [];
  const exec = (c, a) => calls.push([c, a]);
  const steps = [{ name: "@gitcade/sdk", version: "1.11.0", action: "publish" }, { name: "@gitcade/library", version: "1.10.1", action: "publish" }];
  const published = runNpmPublish(steps, { dryRun: true, exec });
  assert.equal(calls.length, 0);
  assert.deepEqual(published, []);
});

test("runNpmPublish executes publishes and honors skip", () => {
  const calls = [];
  const exec = (c, a) => calls.push([c, ...a]);
  const steps = [{ name: "@gitcade/sdk", version: "1.11.0", action: "skip" }, { name: "@gitcade/library", version: "1.10.1", action: "publish" }];
  const published = runNpmPublish(steps, { dryRun: false, exec });
  assert.deepEqual(published, ["@gitcade/library"]);
  assert.deepEqual(calls, [["npm", "publish", "-w", "@gitcade/library"]]);
});
