"use client";

import { useEffect, useRef, useState } from "react";
import { libraryAssetUrl } from "@/lib/preview-url";

/** The preview descriptor stored on each Part row (see lib/catalog.ts#previewFor). */
export type Preview =
  | { kind: "sprite"; src: string; sheet?: { frameWidth: number; frameHeight: number; frameCount: number } }
  | { kind: "sfx"; sfx: string }
  | { kind: "music"; music: string }
  | { kind: "behavior"; behaviorType: string }
  | { kind: "none" };

/**
 * Live part preview, "where feasible" (Phase 6):
 *  - sprite → render the served PNG (sheets show the first frame, cropped on canvas)
 *  - sfx    → a play button driving the LIBRARY's runtime Web Audio synth (dynamic-
 *             imported on first click so it stays out of the initial bundle)
 *  - music  → play/stop the library's generative chiptune loop
 *  - behavior → boot a tiny SDK micro-scene that exercises the behavior, in a canvas
 *  - none   → a graceful placeholder
 * Every dynamic path is wrapped so a failure degrades to a disabled control rather
 * than crashing the page.
 */
export function PartPreview({ preview, size = 96 }: { preview: Preview; size?: number }) {
  if (preview.kind === "sprite") return <SpritePreview preview={preview} size={size} />;
  if (preview.kind === "sfx") return <SfxPreview sfx={preview.sfx} />;
  if (preview.kind === "music") return <MusicPreview music={preview.music} />;
  if (preview.kind === "behavior") return <BehaviorPreview behaviorType={preview.behaviorType} size={size} />;
  return (
    <div className="flex h-24 items-center justify-center rounded-md border border-arcade-edge bg-black/30 text-xs text-arcade-mute">
      no preview
    </div>
  );
}

function SpritePreview({
  preview,
  size,
}: {
  preview: Extract<Preview, { kind: "sprite" }>;
  size: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const url = libraryAssetUrl(preview.src);
  const [err, setErr] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = new Image();
    img.onload = () => {
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // For sheets, draw only the first frame; otherwise draw the whole image.
      const fw = preview.sheet?.frameWidth ?? img.width;
      const fh = preview.sheet?.frameHeight ?? img.height;
      const scale = Math.min(canvas.width / fw, canvas.height / fh);
      const dw = fw * scale;
      const dh = fh * scale;
      ctx.drawImage(img, 0, 0, fw, fh, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
    };
    img.onerror = () => setErr(true);
    img.src = url;
  }, [url, preview.sheet]);

  if (err) {
    return (
      <div className="flex h-24 items-center justify-center rounded-md border border-arcade-edge bg-black/30 text-xs text-arcade-mute">
        sprite unavailable
      </div>
    );
  }
  return (
    <div className="flex items-center justify-center rounded-md border border-arcade-edge bg-[repeating-conic-gradient(#1a1a28_0%_25%,#13131e_0%_50%)_50%/16px_16px]">
      <canvas ref={canvasRef} width={size} height={size} className="m-2" />
    </div>
  );
}

/** Lazily create one shared AudioContext (browsers require a user gesture first). */
let sharedCtx: AudioContext | null = null;
function getCtx(): AudioContext | null {
  try {
    if (!sharedCtx) {
      const AC = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
      sharedCtx = new AC();
    }
    if (sharedCtx.state === "suspended") void sharedCtx.resume();
    return sharedCtx;
  } catch {
    return null;
  }
}

function SfxPreview({ sfx }: { sfx: string }) {
  const [disabled, setDisabled] = useState(false);
  const play = async () => {
    try {
      const ctx = getCtx();
      if (!ctx) return setDisabled(true);
      const { playSfx } = await import("@gitcade/library");
      playSfx(ctx, ctx.destination, sfx, 0.5);
    } catch {
      setDisabled(true);
    }
  };
  return (
    <button className="gc-btn w-full" onClick={play} disabled={disabled} title={`play ${sfx}`}>
      {disabled ? "preview unavailable" : `▶ play "${sfx}"`}
    </button>
  );
}

function MusicPreview({ music }: { music: string }) {
  const [playing, setPlaying] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const playerRef = useRef<{ stop: () => void } | null>(null);

  const toggle = async () => {
    try {
      if (playing) {
        playerRef.current?.stop();
        playerRef.current = null;
        setPlaying(false);
        return;
      }
      const ctx = getCtx();
      if (!ctx) return setDisabled(true);
      const { MusicPlayer } = await import("@gitcade/library");
      const player = new MusicPlayer(ctx, ctx.destination, music);
      player.start();
      playerRef.current = player;
      setPlaying(true);
    } catch {
      setDisabled(true);
    }
  };

  useEffect(() => () => playerRef.current?.stop(), []);

  return (
    <button className="gc-btn w-full" onClick={toggle} disabled={disabled} title={`loop ${music}`}>
      {disabled ? "preview unavailable" : playing ? `■ stop "${music}"` : `▶ loop "${music}"`}
    </button>
  );
}

function BehaviorPreview({ behaviorType, size }: { behaviorType: string; size: number }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<"idle" | "running" | "unavailable">("idle");

  const boot = async () => {
    const host = hostRef.current;
    if (!host) return;
    setStatus("running");
    try {
      const { bootBehaviorMicroScene } = await import("@/lib/behavior-demo");
      await bootBehaviorMicroScene(host, behaviorType, size);
    } catch {
      setStatus("unavailable");
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={hostRef}
        className="flex items-center justify-center overflow-hidden rounded-md border border-arcade-edge bg-black"
        style={{ height: size * 1.6 }}
      >
        {status === "idle" && <span className="text-xs text-arcade-mute">behavior demo</span>}
        {status === "unavailable" && (
          <span className="text-xs text-arcade-mute">preview unavailable</span>
        )}
      </div>
      {status !== "running" && status !== "unavailable" && (
        <button className="gc-btn" onClick={boot}>
          ▶ run demo
        </button>
      )}
    </div>
  );
}
