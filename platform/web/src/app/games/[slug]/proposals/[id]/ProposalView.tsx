"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ConfigDiff } from "@/components/ConfigDiff";
import { AntiBrigadingNotice } from "@/components/AntiBrigadingNotice";

interface Tally {
  yes: number;
  no: number;
  total: number;
  yesPct: number;
  quorumMet: boolean;
  thresholdMet: boolean;
  passing: boolean;
}
interface ProposalProps {
  id: string;
  type: string;
  status: string;
  body: string | null;
  baseConfig: unknown;
  headConfig: unknown;
  changeSummary: string[];
  thresholdPct: number;
  quorum: number;
  windowDays: number;
  closesAt: string | null;
  vetoedAt: string | null;
  vetoReason: string | null;
  appliedCommit: string | null;
  repoUrl: string;
}

const AUTO = (t: string) => t === "CONFIG_CHANGE" || t === "PART_SWAP";

export function ProposalView({
  slug,
  proposal,
  viewer,
  initialTally,
  initialMyVote,
  initialEligibility,
}: {
  slug: string;
  proposal: ProposalProps;
  viewer: { signedIn: boolean; isOwner: boolean; isAuthor: boolean };
  initialTally: Tally;
  initialMyVote: "YES" | "NO" | null;
  initialEligibility: { eligible: boolean; reasons: string[] } | null;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(proposal.status);
  const [tally, setTally] = useState(initialTally);
  const [myVote, setMyVote] = useState(initialMyVote);
  const [eligibility, setEligibility] = useState(initialEligibility);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [voteReasons, setVoteReasons] = useState<string[] | null>(null);
  const [forkSlug, setForkSlug] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/proposals/${proposal.id}/tally`, { cache: "no-store" });
      const data = await res.json();
      if (data.ok) {
        setStatus(data.status);
        setTally(data.tally);
        setMyVote(data.myVote);
        if (data.eligibility) setEligibility(data.eligibility);
      }
    } catch {
      /* transient */
    }
  }, [proposal.id]);

  // Poll while the proposal is live; stop once decided.
  useEffect(() => {
    if (["APPLIED", "FAILED", "VETOED"].includes(status)) return;
    const t = setInterval(refresh, 8000);
    return () => clearInterval(t);
  }, [status, refresh]);

  const post = async (path: string, body?: unknown) => {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { res, data: await res.json().catch(() => ({})) };
  };

  const vote = async (choice: "YES" | "NO") => {
    setBusy("vote");
    setVoteReasons(null);
    setMsg(null);
    const { res, data } = await post(`/api/proposals/${proposal.id}/vote`, { choice });
    setBusy(null);
    if (!res.ok) {
      if (data.reasons) setVoteReasons(data.reasons);
      else setMsg(data.error ?? "Vote failed.");
      return;
    }
    setMyVote(choice);
    setTally(data.tally);
  };

  const doAction = async (name: string, path: string, body?: unknown) => {
    setBusy(name);
    setMsg(null);
    const { res, data } = await post(path, body);
    setBusy(null);
    if (!res.ok) {
      setMsg(data.error ?? `${name} failed.`);
      return;
    }
    if (name === "fork") {
      setForkSlug(data.slug);
      return;
    }
    await refresh();
    router.refresh();
  };

  const closesAt = proposal.closesAt ? new Date(proposal.closesAt) : null;
  const windowClosed = closesAt ? Date.now() >= closesAt.getTime() : false;
  const isAuto = AUTO(proposal.type);
  const wasVetoed = !!proposal.vetoedAt || status === "VETOED";

  return (
    <div className="flex flex-col gap-5">
      {/* ── Status banner ── */}
      <StatusBanner status={status} wasVetoed={wasVetoed} vetoReason={proposal.vetoReason} appliedCommit={proposal.appliedCommit} repoUrl={proposal.repoUrl} />

      {/* ── The diff (the proposal IS the diff) ── */}
      {isAuto ? (
        <section className="gc-panel p-4">
          <h3 className="text-sm font-bold text-arcade-mute">The change this proposal applies</h3>
          {proposal.changeSummary.length > 0 && (
            <ul className="mt-2 list-inside list-disc text-xs text-arcade-ink">
              {proposal.changeSummary.map((s, i) => (
                <li key={i} className="font-mono">
                  {s}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3">
            <ConfigDiff base={proposal.baseConfig} head={proposal.headConfig} />
          </div>
          <p className="mt-2 text-[11px] text-arcade-mute">
            On pass + owner approval this is committed to <b>main</b> by the GitCade governance app (not the owner&apos;s
            token) and rebuilt.
          </p>
        </section>
      ) : (
        <section className="gc-panel p-4">
          <h3 className="text-sm font-bold text-arcade-mute">Feature request</h3>
          <pre className="mt-2 whitespace-pre-wrap text-sm text-arcade-ink">{proposal.body}</pre>
          <p className="mt-2 text-[11px] text-arcade-mute">
            Free-text proposals do not auto-apply. On pass this becomes a <b>help-wanted</b> item, closed by a PR that
            links this proposal.
          </p>
        </section>
      )}

      {/* ── Tally ── */}
      <section className="gc-panel p-4">
        <div className="flex items-center justify-between text-sm">
          <h3 className="font-bold text-arcade-mute">Tally</h3>
          <span className="text-xs text-arcade-mute">
            {status === "OPEN" && closesAt
              ? windowClosed
                ? "window closed — finalizing…"
                : `closes ${closesAt.toLocaleString()}`
              : `decided`}
          </span>
        </div>
        <TallyBar tally={tally} thresholdPct={proposal.thresholdPct} quorum={proposal.quorum} />
      </section>

      {/* ── Draft: open for voting ── */}
      {status === "DRAFT" && (viewer.isAuthor || viewer.isOwner) && (
        <button
          className="gc-btn gc-btn-primary self-start"
          disabled={busy === "open"}
          onClick={() => doAction("open", `/api/proposals/${proposal.id}/open`)}
        >
          {busy === "open" ? "Opening…" : `Open for voting (${proposal.windowDays}-day window)`}
        </button>
      )}

      {/* ── Voting ── */}
      {status === "OPEN" && !windowClosed && (
        <section className="gc-panel p-4">
          <h3 className="text-sm font-bold text-arcade-mute">Cast your vote</h3>
          <AntiBrigadingNotice compact />
          {!viewer.signedIn ? (
            <p className="mt-2 text-xs text-arcade-warn">Sign in to vote.</p>
          ) : eligibility && !eligibility.eligible ? (
            <div className="mt-2 rounded-md border border-arcade-bad/50 bg-arcade-bad/10 p-3">
              <p className="text-xs font-bold text-arcade-bad">You are not eligible to vote:</p>
              <ul className="mt-1 list-inside list-disc text-xs text-arcade-bad">
                {eligibility.reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="mt-3 flex items-center gap-3">
              <button
                className={`gc-btn ${myVote === "YES" ? "gc-btn-primary" : ""}`}
                disabled={busy === "vote"}
                onClick={() => vote("YES")}
              >
                👍 Vote yes
              </button>
              <button
                className={`gc-btn ${myVote === "NO" ? "!border-arcade-bad !text-arcade-bad" : ""}`}
                disabled={busy === "vote"}
                onClick={() => vote("NO")}
              >
                👎 Vote no
              </button>
              {myVote && <span className="text-xs text-arcade-mute">you voted {myVote.toLowerCase()}</span>}
            </div>
          )}
          {voteReasons && (
            <div className="mt-2 rounded-md border border-arcade-bad/50 bg-arcade-bad/10 p-3">
              <p className="text-xs font-bold text-arcade-bad">Blocked by the anti-brigading rule:</p>
              <ul className="mt-1 list-inside list-disc text-xs text-arcade-bad">
                {voteReasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* ── Owner controls on a PASSED proposal ── */}
      {status === "PASSED" && viewer.isOwner && isAuto && (
        <OwnerControls
          busy={busy}
          onApprove={() => doAction("approve", `/api/proposals/${proposal.id}/approve`)}
          onVeto={(reason) => doAction("veto", `/api/proposals/${proposal.id}/veto`, { reason })}
        />
      )}

      {/* ── The EXIT DOOR: fork-with-patch (most prominent after a veto) ── */}
      {isAuto && ["PASSED", "VETOED", "APPLIED"].includes(status) && (
        <ForkWithPatch
          prominent={wasVetoed}
          signedIn={viewer.signedIn}
          busy={busy === "fork"}
          forkSlug={forkSlug}
          onFork={() => doAction("fork", `/api/proposals/${proposal.id}/fork-with-patch`)}
        />
      )}

      {msg && <p className="text-sm text-arcade-bad">{msg}</p>}
    </div>
  );
}

function StatusBanner({
  status,
  wasVetoed,
  vetoReason,
  appliedCommit,
  repoUrl,
}: {
  status: string;
  wasVetoed: boolean;
  vetoReason: string | null;
  appliedCommit: string | null;
  repoUrl: string;
}) {
  const repoHtml = repoUrl.replace(/\.git$/, "");
  if (wasVetoed) {
    return (
      <div className="gc-panel border-arcade-bad/60 bg-arcade-bad/10 p-4">
        <h3 className="font-bold text-arcade-bad">PASSED · then VETOED by the owner</h3>
        <p className="mt-1 text-sm text-arcade-ink">
          <b>Owner&apos;s reason:</b> {vetoReason}
        </p>
        <p className="mt-1 text-xs text-arcade-mute">
          The community passed this, but the owner blocked it. That&apos;s fine — use the exit door below to fork the game
          with this change applied and play it anyway.
        </p>
      </div>
    );
  }
  if (status === "APPLIED") {
    return (
      <div className="gc-panel border-arcade-good/60 bg-arcade-good/10 p-4">
        <h3 className="font-bold text-arcade-good">● APPLIED to main — committed by the governance app</h3>
        {appliedCommit && (
          <p className="mt-1 text-xs text-arcade-mute">
            commit{" "}
            <a className="font-mono underline" href={`${repoHtml}/commit/${appliedCommit}`} target="_blank" rel="noreferrer">
              {appliedCommit.slice(0, 8)}
            </a>{" "}
            — no human touched git. The game is rebuilding.
          </p>
        )}
      </div>
    );
  }
  const styles: Record<string, string> = {
    DRAFT: "border-arcade-edge text-arcade-mute",
    OPEN: "border-arcade-warn/60 text-arcade-warn",
    PASSED: "border-arcade-good/60 text-arcade-good",
    FAILED: "border-arcade-bad/60 text-arcade-bad",
    HELP_WANTED: "border-arcade-warn/60 text-arcade-warn",
  };
  const label: Record<string, string> = {
    DRAFT: "Draft — not yet open for voting",
    OPEN: "Open for voting",
    PASSED: "PASSED — awaiting owner approval",
    FAILED: "FAILED — did not reach 70% / quorum",
    HELP_WANTED: "PASSED — now help-wanted (close it with a PR linking this proposal)",
  };
  return (
    <div className={`gc-panel p-3 ${styles[status] ?? ""}`}>
      <span className="text-sm font-bold">{label[status] ?? status}</span>
    </div>
  );
}

function TallyBar({ tally, thresholdPct, quorum }: { tally: Tally; thresholdPct: number; quorum: number }) {
  const yesW = tally.total === 0 ? 0 : (tally.yes / tally.total) * 100;
  return (
    <div className="mt-2">
      <div className="relative h-5 w-full overflow-hidden rounded bg-arcade-bad/30">
        <div className="h-full bg-arcade-good/70" style={{ width: `${yesW}%` }} />
        {/* threshold marker */}
        <div className="absolute top-0 h-full border-l-2 border-arcade-ink/70" style={{ left: `${thresholdPct}%` }} title={`${thresholdPct}% threshold`} />
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-4 text-xs text-arcade-mute">
        <span className="font-mono text-arcade-good">👍 {tally.yes}</span>
        <span className="font-mono text-arcade-bad">👎 {tally.no}</span>
        <span className="font-mono">{tally.yesPct}% yes (need {thresholdPct}%)</span>
        <span className={tally.quorumMet ? "text-arcade-good" : "text-arcade-warn"}>
          quorum {tally.total}/{quorum} {tally.quorumMet ? "✓" : ""}
        </span>
        <span className={tally.passing ? "text-arcade-good" : "text-arcade-mute"}>
          {tally.passing ? "passing" : "not passing"}
        </span>
      </div>
    </div>
  );
}

function OwnerControls({
  busy,
  onApprove,
  onVeto,
}: {
  busy: string | null;
  onApprove: () => void;
  onVeto: (reason: string) => void;
}) {
  const [vetoing, setVetoing] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <section className="gc-panel border-arcade-warn/40 p-4">
      <h3 className="text-sm font-bold text-arcade-ink">Owner decision</h3>
      <p className="mt-1 text-xs text-arcade-mute">
        This proposal passed the community vote. Approve to auto-commit it to main via the governance app, or veto with a
        public reason.
      </p>
      <div className="mt-3 flex flex-wrap gap-3">
        <button className="gc-btn gc-btn-primary" disabled={busy === "approve"} onClick={onApprove}>
          {busy === "approve" ? "Committing via app…" : "✓ Approve & auto-commit to main"}
        </button>
        <button className="gc-btn !border-arcade-bad !text-arcade-bad" onClick={() => setVetoing((v) => !v)}>
          Veto…
        </button>
      </div>
      {vetoing && (
        <div className="mt-3">
          <textarea
            className="gc-input w-full text-sm"
            rows={2}
            placeholder="Public reason for the veto (required)…"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <button
            className="gc-btn mt-2 !border-arcade-bad !text-arcade-bad"
            disabled={busy === "veto" || !reason.trim()}
            onClick={() => onVeto(reason)}
          >
            {busy === "veto" ? "Vetoing…" : "Confirm veto"}
          </button>
        </div>
      )}
    </section>
  );
}

function ForkWithPatch({
  prominent,
  signedIn,
  busy,
  forkSlug,
  onFork,
}: {
  prominent: boolean;
  signedIn: boolean;
  busy: boolean;
  forkSlug: string | null;
  onFork: () => void;
}) {
  if (forkSlug) {
    return (
      <div className="gc-panel border-arcade-good/60 bg-arcade-good/10 p-4">
        <h3 className="font-bold text-arcade-good">● Forked with the proposal applied</h3>
        <p className="mt-1 text-sm">
          Your fork is building.{" "}
          <Link href={`/games/${forkSlug}`} className="underline">
            Play {forkSlug} →
          </Link>
        </p>
      </div>
    );
  }
  return (
    <section className={`gc-panel p-4 ${prominent ? "border-arcade-good/60 bg-arcade-good/5" : ""}`}>
      <h3 className={`text-sm font-bold ${prominent ? "text-arcade-good" : "text-arcade-ink"}`}>
        ⑂ Exit door — fork from here with this proposal applied
      </h3>
      <p className="mt-1 text-xs text-arcade-mute">
        {prominent
          ? "The owner vetoed this, but you don't need their permission. One click forks the game with this exact change applied — immediately playable."
          : "Don't want to wait on the owner? Fork the game with this change already applied."}
      </p>
      {signedIn ? (
        <button className={`gc-btn mt-3 ${prominent ? "gc-btn-primary" : ""}`} disabled={busy} onClick={onFork}>
          {busy ? "Forking & applying…" : "⑂ Fork with this proposal applied"}
        </button>
      ) : (
        <p className="mt-2 text-xs text-arcade-warn">Sign in to fork.</p>
      )}
    </section>
  );
}
