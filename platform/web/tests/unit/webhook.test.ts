import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { verifyGithubSignature, parsePushEvent } from "@/lib/webhook";

const SECRET = "test-webhook-secret";
function sign(body: string, secret = SECRET): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

describe("verifyGithubSignature", () => {
  const body = JSON.stringify({ hello: "world" });

  it("accepts a correct signature", () => {
    expect(verifyGithubSignature(SECRET, body, sign(body))).toBe(true);
  });

  it("rejects a tampered body", () => {
    expect(verifyGithubSignature(SECRET, body + " ", sign(body))).toBe(false);
  });

  it("rejects a wrong secret", () => {
    expect(verifyGithubSignature(SECRET, body, sign(body, "other"))).toBe(false);
  });

  it("fails closed on empty secret or missing header", () => {
    expect(verifyGithubSignature("", body, sign(body))).toBe(false);
    expect(verifyGithubSignature(SECRET, body, null)).toBe(false);
  });
});

describe("parsePushEvent", () => {
  const base = {
    ref: "refs/heads/main",
    after: "abc123def4567890abc123def4567890abc12345",
    deleted: false,
    repository: {
      full_name: "gitcade-games/snake",
      clone_url: "https://github.com/gitcade-games/snake.git",
      html_url: "https://github.com/gitcade-games/snake",
    },
  };

  it("parses a branch push to ref + branch + commit", () => {
    const p = parsePushEvent(base)!;
    expect(p.branch).toBe("main");
    expect(p.ref).toEqual({ owner: "gitcade-games", repo: "snake" });
    expect(p.repoCloneUrl).toBe("https://github.com/gitcade-games/snake.git");
    expect(p.commit).toBe(base.after);
    expect(p.deleted).toBe(false);
  });

  it("parses a non-main branch", () => {
    expect(parsePushEvent({ ...base, ref: "refs/heads/cheap-towers" })?.branch).toBe("cheap-towers");
  });

  it("ignores tag pushes", () => {
    expect(parsePushEvent({ ...base, ref: "refs/tags/v1.0.0" })).toBeNull();
  });

  it("marks branch deletions and nulls the all-zero deletion sha", () => {
    const p = parsePushEvent({ ...base, deleted: true, after: "0000000000000000000000000000000000000000" })!;
    expect(p.deleted).toBe(true);
    expect(p.commit).toBeNull();
  });

  it("returns null on malformed payloads", () => {
    expect(parsePushEvent({})).toBeNull();
    expect(parsePushEvent({ ref: "refs/heads/x" })).toBeNull(); // no repository
  });
});
