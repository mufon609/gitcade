"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { RemixModel } from "@/lib/remix";
import { PartPreview } from "@/components/PartPreview";
import { ConfigDiff } from "@/components/ConfigDiff";
import { buildArtifactIndexUrl } from "@/lib/artifact-url";
import { PlayPane } from "@/components/PlayPane";
import { libraryAssetUrl } from "@/lib/preview-url";

type SpriteSwaps = Record<string, string>;
type MovementSwaps = Record<string, string>;
type ConfigEdits = Record<string, number>;

/** The Remix editor: point-and-click sprite/movement/config edits → one readable
 *  commit → rebuild → hot-swap the player when green. */
export function RemixEditor({
  slug,
  branch,
  model,
  artifactBase,
}: {
  slug: string;
  branch: string;
  model: RemixModel;
  artifactBase: string;
}) {
  const [spriteSwaps, setSpriteSwaps] = useState<SpriteSwaps>({});
  const [movementSwaps, setMovementSwaps] = useState<MovementSwaps>({});
  const [configEdits, setConfigEdits] = useState<ConfigEdits>({});

  const [phase, setPhase] = useState<"edit" | "committing" | "building" | "live" | "error">("edit");
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<{ message: string; where?: string }[] | null>(null);
  const [summary, setSummary] = useState<string[]>([]);
  const [logs, setLogs] = useState<string | null>(null);
  const [commitSha, setCommitSha] = useState<string | null>(null);

  const baseConfig = useMemo(() => {
    const obj: Record<string, number | string | boolean> = {};
    for (const leaf of model.configLeaves) obj[leaf.path] = leaf.value;
    return obj;
  }, [model.configLeaves]);

  const headConfig = useMemo(() => ({ ...baseConfig, ...configEdits }), [baseConfig, configEdits]);

  const changeCount =
    Object.keys(spriteSwaps).length + Object.keys(movementSwaps).length + Object.keys(configEdits).length;

  const spriteSrcById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of model.spriteOptions) {
      const src = (s.sprite as { src?: string }).src;
      if (src) m.set(s.partId, src);
    }
    return m;
  }, [model.spriteOptions]);

  const commit = async () => {
    setPhase("committing");
    setError(null);
    setIssues(null);
    try {
      const res = await fetch(`/api/remix/${slug}/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spriteSwaps, movementSwaps, configEdits }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        if (data.issues) setIssues(data.issues);
        setError(data.error ?? "Remix was rejected.");
        setPhase("error");
        return;
      }
      setSummary(data.summary ?? []);
      setCommitSha(data.commit ?? null);
      setPhase("building");
      void pollBuild();
    } catch (e) {
      setError((e as Error).message);
      setPhase("error");
    }
  };

  const pollBuild = async () => {
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2500));
      try {
        const res = await fetch(`/api/games/${slug}/build-status`, { cache: "no-store" });
        const data = await res.json();
        if (data.state === "LIVE") {
          setPhase("live");
          return;
        }
        if (data.state === "FAILED") {
          setLogs(data.logs ?? null);
          setError("The rebuild failed the validator.");
          setPhase("error");
          return;
        }
      } catch {
        /* transient */
      }
    }
    setError("Timed out waiting for the rebuild. Check the game page.");
    setPhase("error");
  };

  // Cache-bust the artifact by commit so the hot-swap shows the rebuilt game.
  const indexUrl = `${buildArtifactIndexUrl(artifactBase, slug, branch)}${commitSha ? `?c=${commitSha.slice(0, 8)}` : ""}`;

  if (phase === "live") {
    return (
      <div className="flex flex-col gap-4">
        <div className="gc-panel border-arcade-good/50 p-4">
          <h3 className="font-bold text-arcade-good">● Remix live — playing your rebuilt fork</h3>
          <ul className="mt-2 list-inside list-disc text-xs text-arcade-mute">
            {summary.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
        <PlayPane slug={slug} branch={branch} indexUrl={indexUrl} />
        <div className="flex gap-3">
          <Link href={`/games/${slug}`} className="gc-btn no-underline">
            Open game page
          </Link>
          <button
            className="gc-btn"
            onClick={() => {
              setPhase("edit");
              setSpriteSwaps({});
              setMovementSwaps({});
              setConfigEdits({});
            }}
          >
            Remix again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* ── Sprite swaps ── */}
      <section className="gc-panel p-4">
        <h3 className="text-sm font-bold text-arcade-mute">1 · Swap a sprite</h3>
        {model.entities.length === 0 ? (
          <p className="mt-2 text-xs text-arcade-mute">No swappable sprites in this scene.</p>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {model.entities.map((e) => {
              const chosen = spriteSwaps[e.id];
              const curSrc = (e.sprite as { src?: string }).src;
              const previewSrc = chosen ? spriteSrcById.get(chosen) : curSrc;
              return (
                <div key={e.id} className="flex items-center gap-3 rounded-md border border-arcade-edge p-3">
                  {previewSrc && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={libraryAssetUrl(previewSrc)}
                      alt=""
                      width={40}
                      height={40}
                      style={{ imageRendering: "pixelated" }}
                      className="rounded bg-black/40"
                    />
                  )}
                  <div className="flex-1">
                    <div className="font-mono text-xs">{e.id}</div>
                    <select
                      className="gc-input mt-1 w-full text-xs"
                      value={chosen ?? ""}
                      onChange={(ev) => {
                        const v = ev.target.value;
                        setSpriteSwaps((s) => {
                          const next = { ...s };
                          if (v) next[e.id] = v;
                          else delete next[e.id];
                          return next;
                        });
                      }}
                    >
                      <option value="">— keep current —</option>
                      {model.spriteOptions.map((o) => (
                        <option key={o.partId} value={o.partId}>
                          {o.partId} ({o.license})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Movement swaps ── */}
      <section className="gc-panel p-4">
        <h3 className="text-sm font-bold text-arcade-mute">2 · Swap a movement behavior</h3>
        {model.movementSlots.length === 0 ? (
          <p className="mt-2 text-xs text-arcade-mute">No movement behaviors in this scene.</p>
        ) : (
          <div className="mt-3 flex flex-col gap-3">
            {model.movementSlots.map((slot) => (
              <div key={slot.key} className="flex flex-wrap items-center gap-3 rounded-md border border-arcade-edge p-3">
                <div className="text-xs">
                  <span className="font-mono">{slot.entityId}</span>{" "}
                  <span className="text-arcade-mute">currently {slot.currentType}</span>
                </div>
                <select
                  className="gc-input ml-auto text-xs"
                  value={movementSwaps[slot.key] ?? ""}
                  onChange={(ev) => {
                    const v = ev.target.value;
                    setMovementSwaps((s) => {
                      const next = { ...s };
                      if (v) next[slot.key] = v;
                      else delete next[slot.key];
                      return next;
                    });
                  }}
                >
                  <option value="">— keep {slot.currentType} —</option>
                  {slot.options.map((o) => (
                    <option key={o.partId} value={o.partId}>
                      {o.partId}
                      {o.source === "user" ? " (community)" : ""}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Config tunables ── */}
      <section className="gc-panel p-4">
        <h3 className="text-sm font-bold text-arcade-mute">3 · Tune the balance (config.json)</h3>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {model.configLeaves
            .filter((l) => l.kind === "number")
            .map((leaf) => {
              const value = configEdits[leaf.path] ?? (leaf.value as number);
              const changed = configEdits[leaf.path] !== undefined && configEdits[leaf.path] !== leaf.value;
              return (
                <div key={leaf.path} className="rounded-md border border-arcade-edge p-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-mono">{leaf.path}</span>
                    <span className={changed ? "text-arcade-warn" : "text-arcade-mute"}>
                      {value}
                      {changed && ` (was ${leaf.value})`}
                    </span>
                  </div>
                  <input
                    type="range"
                    className="mt-2 w-full"
                    min={leaf.min}
                    max={leaf.max}
                    step={leaf.step}
                    value={value}
                    onChange={(ev) => {
                      const v = Number(ev.target.value);
                      setConfigEdits((c) => {
                        const next = { ...c };
                        if (v === leaf.value) delete next[leaf.path];
                        else next[leaf.path] = v;
                        return next;
                      });
                    }}
                  />
                </div>
              );
            })}
        </div>
      </section>

      {/* ── Diff preview + commit ── */}
      {Object.keys(configEdits).length > 0 && (
        <section className="gc-panel p-4">
          <h3 className="text-sm font-bold text-arcade-mute">config.json change preview</h3>
          <ConfigDiff base={baseConfig} head={headConfig} compact />
        </section>
      )}

      {issues && (
        <div className="gc-panel border-arcade-bad/50 p-4">
          <h3 className="font-bold text-arcade-bad">This remix would be invalid — blocked before commit</h3>
          <ul className="mt-2 list-inside list-disc text-xs text-arcade-bad">
            {issues.map((i, n) => (
              <li key={n}>
                {i.message}
                {i.where ? <span className="text-arcade-mute"> ({i.where})</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && !issues && (
        <div className="gc-panel border-arcade-bad/50 p-4 text-sm text-arcade-bad">
          {error}
          {logs && (
            <pre className="mt-2 max-h-72 overflow-auto rounded-md border border-arcade-edge bg-black/40 p-3 text-xs text-arcade-ink">
              {logs}
            </pre>
          )}
        </div>
      )}

      <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-arcade-edge bg-arcade-bg/90 py-3">
        <span className="text-xs text-arcade-mute">
          {changeCount === 0 ? "No changes yet." : `${changeCount} change${changeCount === 1 ? "" : "s"} staged.`}
        </span>
        <button
          className="gc-btn gc-btn-primary"
          disabled={changeCount === 0 || phase === "committing" || phase === "building"}
          onClick={commit}
        >
          {phase === "committing"
            ? "Committing…"
            : phase === "building"
              ? "◌ Rebuilding your fork…"
              : "Commit remix & rebuild"}
        </button>
      </div>
    </div>
  );
}
