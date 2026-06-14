"use client";

import { useEffect, useState } from "react";
import { useSession, signIn } from "next-auth/react";

/** "Join community" button → writes a CommunityMembership (Phase 7 voting basis). */
export function JoinCommunity({ slug }: { slug: string }) {
  const { status } = useSession();
  const [member, setMember] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status !== "authenticated") return;
    fetch(`/api/community/join?slug=${encodeURIComponent(slug)}`)
      .then((r) => r.json())
      .then((d) => setMember(!!d.member))
      .catch(() => setMember(false));
  }, [slug, status]);

  if (status === "unauthenticated") {
    return (
      <button className="gc-btn" onClick={() => signIn("github")}>
        Sign in to join
      </button>
    );
  }
  if (member) {
    return <span className="gc-chip gc-tier-ecosystem w-fit">★ Member</span>;
  }
  return (
    <button
      className="gc-btn gc-btn-primary w-fit"
      disabled={busy || member === null}
      onClick={async () => {
        setBusy(true);
        try {
          const res = await fetch("/api/community/join", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ slug }),
          });
          const d = await res.json();
          if (d.ok) setMember(true);
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "Joining…" : "Join community"}
    </button>
  );
}
