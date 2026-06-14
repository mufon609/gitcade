"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession, signIn } from "next-auth/react";

/**
 * The Fork button. Calls /api/fork (user's OAuth token, server-side), which forks
 * the repo, waits for it to be clonable, rewrites its manifest slug, registers the
 * fork Game, and enqueues its build. On success we redirect to the new game page,
 * which shows honest BUILDING→LIVE progress. GitHub-slow (503) is retryable.
 */
export function ForkButton({ slug }: { slug: string }) {
  const { status } = useSession();
  const router = useRouter();
  const [phase, setPhase] = useState<"idle" | "forking" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);

  if (status === "unauthenticated") {
    return (
      <button className="gc-btn" onClick={() => signIn("github")}>
        Sign in to fork
      </button>
    );
  }

  const fork = async () => {
    setPhase("forking");
    setError(null);
    const t0 = Date.now();
    try {
      const res = await fetch("/api/fork", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setElapsed(Date.now() - t0);
        setError(data.error ?? "Fork failed.");
        setPhase("error");
        return;
      }
      // Straight to the fork's page — it polls build status to playable.
      router.push(`/games/${data.slug}`);
    } catch (e) {
      setError((e as Error).message);
      setPhase("error");
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <button
        className="gc-btn gc-btn-primary w-fit"
        onClick={fork}
        disabled={phase === "forking"}
        title="Fork this game to your GitHub account and play your copy"
      >
        {phase === "forking" ? "⑂ Forking…" : "⑂ Fork & play"}
      </button>
      {phase === "forking" && (
        <span className="text-xs text-arcade-mute">
          Forking on GitHub, waiting for it to be clonable, then building your copy…
        </span>
      )}
      {phase === "error" && error && (
        <span className="text-xs text-arcade-bad">
          {error}{" "}
          <button className="underline" onClick={fork}>
            retry
          </button>
          {elapsed != null ? ` (after ${(elapsed / 1000).toFixed(1)}s)` : ""}
        </span>
      )}
    </div>
  );
}
