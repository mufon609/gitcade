"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSession, signIn } from "next-auth/react";

type Phase = "idle" | "submitting" | "building" | "live" | "failed" | "rejected";

interface PublishResponse {
  ok: boolean;
  slug?: string;
  tier?: "ecosystem" | "open";
  installUrl?: string | null;
  errors?: string[];
  error?: string;
  stage?: string;
}
interface StatusResponse {
  ok: boolean;
  state?: "BUILDING" | "LIVE" | "FAILED";
  stage?: string | null;
  logs?: string | null;
}

export function PublishClient() {
  const { status } = useSession();
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [errors, setErrors] = useState<string[]>([]);
  const [slug, setSlug] = useState<string | null>(null);
  const [tier, setTier] = useState<"ecosystem" | "open" | null>(null);
  const [installUrl, setInstallUrl] = useState<string | null>(null);
  const [logs, setLogs] = useState<string | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  };
  useEffect(() => () => stopPolling(), []);

  const poll = useCallback((gameSlug: string) => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/games/${gameSlug}/build-status`, { cache: "no-store" });
        const data: StatusResponse = await res.json();
        setStage(data.stage ?? null);
        if (data.state === "LIVE") {
          stopPolling();
          setPhase("live");
        } else if (data.state === "FAILED") {
          stopPolling();
          setLogs(data.logs ?? "(no logs)");
          setPhase("failed");
        }
      } catch {
        /* transient — keep polling */
      }
    }, 2000);
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors([]);
    setLogs(null);
    setPhase("submitting");
    try {
      const res = await fetch("/api/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl, branch: branch || undefined }),
      });
      const data: PublishResponse = await res.json();
      if (!res.ok || !data.ok) {
        setErrors(data.errors ?? [data.error ?? "Publish failed."]);
        setPhase("rejected");
        return;
      }
      setSlug(data.slug ?? null);
      setTier(data.tier ?? null);
      setInstallUrl(data.installUrl ?? null);
      setPhase("building");
      if (data.slug) poll(data.slug);
    } catch (err) {
      setErrors([(err as Error).message]);
      setPhase("rejected");
    }
  };

  if (status === "unauthenticated") {
    return (
      <div className="gc-panel p-6">
        <p className="mb-3 text-arcade-mute">Sign in with GitHub to publish a game.</p>
        <button className="gc-btn gc-btn-primary" onClick={() => signIn("github")}>
          Sign in with GitHub
        </button>
      </div>
    );
  }

  const busy = phase === "submitting" || phase === "building";

  return (
    <div className="flex flex-col gap-5">
      <form onSubmit={submit} className="gc-panel flex flex-col gap-3 p-5">
        <label className="text-sm text-arcade-mute" htmlFor="repoUrl">
          Public GitHub repo URL
        </label>
        <input
          id="repoUrl"
          className="gc-input"
          placeholder="https://github.com/gitcade-games/snake"
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
          disabled={busy}
          required
        />
        <label className="text-sm text-arcade-mute" htmlFor="branch">
          Branch <span className="opacity-60">(optional — defaults to the repo default)</span>
        </label>
        <input
          id="branch"
          className="gc-input"
          placeholder="main"
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          disabled={busy}
        />
        <div>
          <button className="gc-btn gc-btn-primary" type="submit" disabled={busy || !repoUrl}>
            {busy ? "Working…" : "Publish"}
          </button>
        </div>
      </form>

      {phase === "rejected" && errors.length > 0 && (
        <div className="gc-panel border-arcade-bad/50 p-5">
          <h3 className="font-bold text-arcade-bad">Couldn’t publish</h3>
          <ul className="mt-2 list-disc pl-5 text-sm text-arcade-ink">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {(phase === "building" || phase === "live" || phase === "failed") && (
        <div className="gc-panel p-5">
          <div className="flex items-center justify-between">
            <h3 className="font-bold">
              {slug} <span className="gc-chip ml-2">{tier}</span>
            </h3>
            <span
              className={
                phase === "live"
                  ? "text-arcade-good"
                  : phase === "failed"
                    ? "text-arcade-bad"
                    : "text-arcade-warn"
              }
            >
              {phase === "building" ? `◌ building${stage ? ` · ${stage}` : ""}` : null}
              {phase === "live" ? "● live" : null}
              {phase === "failed" ? "✕ build failed" : null}
            </span>
          </div>

          {phase === "building" && (
            <p className="mt-2 text-sm text-arcade-mute">
              The build worker is cloning, validating, and building your game. This page polls every
              couple seconds…
            </p>
          )}

          {phase === "live" && (
            <div className="mt-3 flex flex-col gap-3">
              <p className="text-sm text-arcade-ink">Your game passed the validator and is live.</p>
              <Link href={`/games/${slug}`} className="gc-btn gc-btn-primary w-fit no-underline">
                Play it →
              </Link>
              {installUrl && (
                <div className="mt-2 rounded-md border border-arcade-edge p-3 text-sm">
                  <p className="font-medium">Enable community governance (optional)</p>
                  <p className="mt-1 text-arcade-mute">
                    Install the GitCade GitHub App on this repo so passed proposals can auto-commit
                    later. <strong>Phase 7 proposals stay disabled until you install it.</strong>
                  </p>
                  <a className="gc-btn mt-2 inline-block no-underline" href={installUrl}>
                    Install the GitCade App →
                  </a>
                </div>
              )}
            </div>
          )}

          {phase === "failed" && (
            <div className="mt-3 flex flex-col gap-2">
              <p className="text-sm text-arcade-ink">
                The validator rejected this build. These are the worker’s logs, verbatim:
              </p>
              <pre className="max-h-96 overflow-auto rounded-md border border-arcade-edge bg-black/40 p-3 text-xs text-arcade-ink">
                {logs}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
