"use client";

import { useEffect, useRef, useState } from "react";
import { ParentBridge, localStorageBridgeStore, bridgeKeyPrefix } from "@/lib/bridge";

/**
 * One sandboxed game player: an `allow-scripts`-only iframe (opaque origin, no
 * same-origin — Locked Decision) loading a built artifact, wired to the PARENT side
 * of the storage bridge and posting a play heartbeat. Extracted from GameFrame so
 * the single-game player AND the /compare route (two panes side by side) share ONE
 * implementation.
 *
 * ISOLATION (the compare-play guarantee): each pane constructs its own ParentBridge
 * bound to its OWN iframe.contentWindow. Inbound messages are matched by
 * `event.source === expectedSource` (identity, never origin — opaque iframes report
 * "null"), so pane A never answers pane B's messages. Saves are additionally
 * namespaced by gameSlug+branch, so even two branches of the same game cannot read
 * each other's saves. Both panes sharing one parent window is exactly what the
 * source-identity protocol exists for.
 */
export function PlayPane({
  slug,
  branch,
  indexUrl,
  heartbeat = true,
  className = "block aspect-[4/3] w-full bg-black",
}: {
  slug: string;
  branch: string;
  indexUrl: string;
  /** Record a PlaySession heartbeat (default true; compare panes also count as plays). */
  heartbeat?: boolean;
  className?: string;
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [bridgeState, setBridgeState] = useState<"connecting" | "connected">("connecting");
  const [savedKeys, setSavedKeys] = useState(0);
  const [lastOp, setLastOp] = useState<string>("");

  // ── Storage bridge (parent side) ──
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const target = iframe.contentWindow;

    const refreshSavedCount = () => {
      const prefix = bridgeKeyPrefix(slug, branch);
      let n = 0;
      try {
        for (let i = 0; i < window.localStorage.length; i++) {
          const k = window.localStorage.key(i);
          if (k && k.startsWith(prefix)) n++;
        }
      } catch {
        /* ignore */
      }
      setSavedKeys(n);
    };

    const bridge = new ParentBridge({
      gameSlug: slug,
      branch,
      expectedSource: target,
      store: localStorageBridgeStore(window.localStorage),
      reply: (msg) => iframe.contentWindow?.postMessage(msg, "*"),
      onEvent: (ev) => {
        if (ev.type === "handshake") setBridgeState("connected");
        setLastOp(ev.type + (ev.key ? `(${ev.key})` : ""));
        if (ev.type === "set" || ev.type === "remove" || ev.type === "clear") refreshSavedCount();
      },
    });

    const onMessage = (e: MessageEvent) => {
      void bridge.handle(e.data, e.source);
    };
    window.addEventListener("message", onMessage);
    refreshSavedCount();
    return () => window.removeEventListener("message", onMessage);
  }, [slug, branch]);

  // ── Play heartbeat → PlaySession ──
  useEffect(() => {
    if (!heartbeat) return;
    const startedAt = Date.now();
    let playSessionId: string | null = null;
    let stopped = false;

    const beat = async () => {
      const durationSec = Math.floor((Date.now() - startedAt) / 1000);
      try {
        const res = await fetch("/api/play/heartbeat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug, branch, playSessionId, durationSec }),
        });
        const data = await res.json();
        if (data.ok && data.playSessionId) playSessionId = data.playSessionId;
      } catch {
        /* transient */
      }
    };

    void beat();
    const interval = setInterval(() => {
      if (!stopped) void beat();
    }, 10000);

    const flush = () => {
      if (!playSessionId) return;
      const durationSec = Math.floor((Date.now() - startedAt) / 1000);
      const payload = JSON.stringify({ slug, branch, playSessionId, durationSec });
      try {
        navigator.sendBeacon?.("/api/play/heartbeat", new Blob([payload], { type: "application/json" }));
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("pagehide", flush);

    return () => {
      stopped = true;
      clearInterval(interval);
      flush();
      window.removeEventListener("pagehide", flush);
    };
  }, [slug, branch, heartbeat]);

  return (
    <div className="flex flex-col gap-2">
      <div className="gc-panel overflow-hidden p-0">
        <iframe
          ref={iframeRef}
          src={indexUrl}
          title={`${slug} @ ${branch}`}
          // SECURITY: scripts only — opaque origin, no same-origin, no top-nav.
          sandbox="allow-scripts"
          className={className}
          allow="autoplay; gamepad"
        />
      </div>
      <div className="flex items-center justify-between text-xs text-arcade-mute">
        <span>
          bridge:{" "}
          <span className={bridgeState === "connected" ? "text-arcade-good" : "text-arcade-warn"}>
            {bridgeState === "connected" ? "● connected" : "◌ connecting"}
          </span>{" "}
          · {savedKeys} saved key{savedKeys === 1 ? "" : "s"} ({slug}/{branch})
          {lastOp ? ` · ${lastOp}` : ""}
        </span>
      </div>
    </div>
  );
}
