"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { AntiBrigadingNotice } from "@/components/AntiBrigadingNotice";

interface TallyLite {
  yes: number;
  no: number;
  total: number;
  yesPct: number;
  quorumMet: boolean;
  passing: boolean;
}
interface ProposalLite {
  id: string;
  type: string;
  status: string;
  title: string;
  closesAt: string | null;
  vetoedAt: string | null;
  author: string | null;
  tally: TallyLite;
}
interface BugLite {
  id: string;
  title: string;
  status: string;
  proposalId: string | null;
  reporter: string | null;
}

const STATUS_STYLE: Record<string, string> = {
  DRAFT: "text-arcade-mute",
  OPEN: "text-arcade-warn",
  PASSED: "text-arcade-good",
  APPLIED: "text-arcade-good",
  FAILED: "text-arcade-bad",
  VETOED: "text-arcade-bad",
  HELP_WANTED: "text-arcade-warn",
};

const TYPE_LABEL: Record<string, string> = {
  CONFIG_CHANGE: "config",
  PART_SWAP: "part-swap",
  FEATURE_REQUEST: "feature",
};

/** The Community tab: open proposals with live tallies, history, and the bug list.
 *  Governance-disabled games (App not installed) show a clear notice instead. */
export function CommunityPanel({
  slug,
  governanceEnabled,
  isOwner,
}: {
  slug: string;
  governanceEnabled: boolean;
  isOwner: boolean;
}) {
  const { status } = useSession();
  const [proposals, setProposals] = useState<ProposalLite[]>([]);
  const [bugs, setBugs] = useState<BugLite[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = async () => {
    try {
      const [pRes, bRes] = await Promise.all([
        fetch(`/api/games/${slug}/proposals`, { cache: "no-store" }),
        fetch(`/api/games/${slug}/bugs`, { cache: "no-store" }),
      ]);
      const p = await pRes.json();
      const b = await bRes.json();
      if (p.ok) setProposals(p.proposals);
      if (b.ok) setBugs(b.bugs);
    } catch {
      /* transient */
    } finally {
      setLoaded(true);
    }
  };

  useEffect(() => {
    void load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const open = proposals.filter((p) => p.status === "OPEN" || p.status === "DRAFT");
  const history = proposals.filter((p) => !["OPEN", "DRAFT"].includes(p.status));

  return (
    <section id="community" className="gc-panel p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold">🏛 Community governance</h2>
        {governanceEnabled && status === "authenticated" && (
          <div className="flex gap-2">
            <Link href={`/games/${slug}/proposals/new`} className="gc-btn gc-btn-primary no-underline">
              + New proposal
            </Link>
            <Link href={`/games/${slug}/proposals/new?bug=1`} className="gc-btn no-underline">
              Report a bug
            </Link>
          </div>
        )}
      </div>

      {!governanceEnabled ? (
        <p className="mt-3 text-sm text-arcade-mute">
          Governance is not enabled for this game — the GitCade App is not installed on its repo, so proposals can&apos;t
          auto-commit. The owner can enable it from the publish flow.
        </p>
      ) : (
        <div className="mt-4 flex flex-col gap-5">
          <AntiBrigadingNotice />

          {/* Open proposals */}
          <div>
            <h3 className="text-sm font-bold text-arcade-mute">Open proposals</h3>
            {open.length === 0 ? (
              <p className="mt-2 text-xs text-arcade-mute">
                {loaded ? "No open proposals. Start one above." : "Loading…"}
              </p>
            ) : (
              <ul className="mt-2 flex flex-col gap-2">
                {open.map((p) => (
                  <ProposalRow key={p.id} slug={slug} p={p} />
                ))}
              </ul>
            )}
          </div>

          {/* History */}
          {history.length > 0 && (
            <div>
              <h3 className="text-sm font-bold text-arcade-mute">History</h3>
              <ul className="mt-2 flex flex-col gap-2">
                {history.map((p) => (
                  <ProposalRow key={p.id} slug={slug} p={p} />
                ))}
              </ul>
            </div>
          )}

          {/* Bug tracker */}
          <div>
            <h3 className="text-sm font-bold text-arcade-mute">Bug reports</h3>
            {bugs.length === 0 ? (
              <p className="mt-2 text-xs text-arcade-mute">No bugs reported.</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-1">
                {bugs.map((b) => (
                  <li key={b.id} className="flex items-center gap-2 text-xs">
                    <span className={b.status === "OPEN" ? "text-arcade-warn" : "text-arcade-mute"}>●</span>
                    <span className="text-arcade-ink">{b.title}</span>
                    <span className="text-arcade-mute">— {b.reporter}</span>
                    {b.status === "CONVERTED" && b.proposalId && (
                      <Link href={`/games/${slug}/proposals/${b.proposalId}`} className="underline">
                        → proposal
                      </Link>
                    )}
                    {isOwner && b.status === "OPEN" && <ConvertBug bugId={b.id} onDone={load} />}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function ProposalRow({ slug, p }: { slug: string; p: ProposalLite }) {
  const closes = p.closesAt ? new Date(p.closesAt) : null;
  const closesSoon = closes ? closes.getTime() - Date.now() : null;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-arcade-edge p-3">
      <Link href={`/games/${slug}/proposals/${p.id}`} className="font-bold no-underline hover:underline">
        {p.title}
      </Link>
      <span className="gc-chip text-[10px]">{TYPE_LABEL[p.type] ?? p.type}</span>
      <span className={`text-xs font-bold ${STATUS_STYLE[p.status] ?? ""}`}>
        {p.vetoedAt ? "PASSED · VETOED" : p.status}
      </span>
      <span className="ml-auto font-mono text-xs text-arcade-mute">
        {p.tally.yes}/{p.tally.total} · {p.tally.yesPct}%{p.tally.quorumMet ? "" : " (quorum?)"}
      </span>
      {p.status === "OPEN" && closesSoon !== null && (
        <span className="text-[10px] text-arcade-mute">
          {closesSoon > 0 ? `closes in ${Math.ceil(closesSoon / 86_400_000)}d` : "window closed"}
        </span>
      )}
    </li>
  );
}

function ConvertBug({ bugId, onDone }: { bugId: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="gc-btn ml-auto !py-0.5 text-[10px]"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch(`/api/bugs/${bugId}/convert`, { method: "POST" });
        setBusy(false);
        onDone();
      }}
    >
      {busy ? "…" : "→ proposal"}
    </button>
  );
}
