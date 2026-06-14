"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession, signIn } from "next-auth/react";

/**
 * The Remix button. POSTs /api/remix/start which ensures the user has an OWN copy
 * to edit (fork-on-demand if needed), then routes to that game's Remix editor. The
 * "magic demo": dragon-skin-on-Snake + new movement + a tunable, all without code.
 */
export function RemixButton({ slug }: { slug: string }) {
  const { status } = useSession();
  const router = useRouter();
  const [phase, setPhase] = useState<"idle" | "starting" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  if (status === "unauthenticated") {
    return (
      <button className="gc-btn" onClick={() => signIn("github")}>
        Sign in to remix
      </button>
    );
  }

  const start = async () => {
    setPhase("starting");
    setError(null);
    try {
      const res = await fetch("/api/remix/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Could not start remix.");
        setPhase("error");
        return;
      }
      router.push(`/games/${data.slug}/remix`);
    } catch (e) {
      setError((e as Error).message);
      setPhase("error");
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <button
        className="gc-btn gc-btn-primary w-fit"
        onClick={start}
        disabled={phase === "starting"}
        title="Remix this game — swap sprites, movement, and tunables, no code"
      >
        {phase === "starting" ? "🎨 Preparing…" : "🎨 Remix"}
      </button>
      {phase === "starting" && (
        <span className="text-xs text-arcade-mute">Forking to your account if needed, then opening Remix…</span>
      )}
      {phase === "error" && error && (
        <span className="text-xs text-arcade-bad">
          {error}{" "}
          <button className="underline" onClick={start}>
            retry
          </button>
        </span>
      )}
    </div>
  );
}
