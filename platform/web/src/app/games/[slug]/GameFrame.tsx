"use client";

import { useEffect, useRef, useState } from "react";
import { ParentBridge, localStorageBridgeStore, bridgeKeyPrefix } from "@/lib/bridge";

/**
 * The PLAYER. Loads the game's built artifact from the artifact origin in an
 * iframe with `sandbox="allow-scripts"` ONLY (opaque origin — NO allow-same-origin,
 * by design / Locked Decision). Implements the PARENT SIDE of the storage bridge
 * (identity + nonce handshake; never origin strings) and posts a play heartbeat
 * that creates/updates a PlaySession row.
 */
export function GameFrame({
  slug,
  branch,
  indexUrl,
}: {
  slug: string;
  branch: string;
  indexUrl: string;
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [bridgeState, setBridgeState] = useState<"connecting" | "connected">("connecting");
  const [savedKeys, setSavedKeys] = useState(0);
  const [lastOp, setLastOp] = useState<string>("");

  // ── Storage bridge (parent side) ──
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    // The iframe's WindowProxy is stable across the artifact's own navigation, so
    // capturing it once is a valid identity anchor for event.source checks.
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

    void beat(); // create the PlaySession immediately on play
    const interval = setInterval(() => {
      if (!stopped) void beat();
    }, 10000);

    const flush = () => {
      if (!playSessionId) return;
      const durationSec = Math.floor((Date.now() - startedAt) / 1000);
      const payload = JSON.stringify({ slug, branch, playSessionId, durationSec });
      // sendBeacon survives page unload.
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
  }, [slug, branch]);

  return (
    <div className="flex flex-col gap-2">
      <div className="gc-panel overflow-hidden p-0">
        <iframe
          ref={iframeRef}
          src={indexUrl}
          title={slug}
          // SECURITY: scripts only — opaque origin, no same-origin, no top-nav.
          sandbox="allow-scripts"
          className="block aspect-[4/3] w-full bg-black"
          allow="autoplay; gamepad"
        />
      </div>
      <div className="flex items-center justify-between text-xs text-arcade-mute">
        <span>
          storage bridge:{" "}
          <span className={bridgeState === "connected" ? "text-arcade-good" : "text-arcade-warn"}>
            {bridgeState === "connected" ? "● connected" : "◌ connecting"}
          </span>{" "}
          · {savedKeys} saved key{savedKeys === 1 ? "" : "s"} (namespaced {slug}/{branch})
          {lastOp ? ` · last: ${lastOp}` : ""}
        </span>
        <span className="opacity-60">sandbox=allow-scripts · opaque origin</span>
      </div>
    </div>
  );
}
