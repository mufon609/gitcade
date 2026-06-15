"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { RemixModel } from "@/lib/remix";
import { ConfigDiff } from "@/components/ConfigDiff";
import { AntiBrigadingNotice } from "@/components/AntiBrigadingNotice";

type Mode = "CONFIG_CHANGE" | "PART_SWAP" | "FEATURE_REQUEST" | "BUG";

/** Author a governance proposal. config-change / part-swap reuse the same
 *  point-and-click model as Remix mode (the proposal IS the diff); feature-request
 *  is free text; bug files a report. */
export function NewProposalEditor({ slug, tier, startBug }: { slug: string; tier: string; startBug: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(startBug ? "BUG" : "CONFIG_CHANGE");
  const [model, setModel] = useState<RemixModel | null>(null);
  const [modelErr, setModelErr] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [spriteSwaps, setSpriteSwaps] = useState<Record<string, string>>({});
  const [movementSwaps, setMovementSwaps] = useState<Record<string, string>>({});
  const [configEdits, setConfigEdits] = useState<Record<string, number>>({});
  const [windowDays, setWindowDays] = useState(5);
  const [quorum, setQuorum] = useState(10);
  const [thresholdPct, setThresholdPct] = useState(70);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<{ message: string; where?: string }[] | null>(null);

  const needsModel = mode === "CONFIG_CHANGE" || mode === "PART_SWAP";

  // Load the point-and-click model lazily when an edit mode is selected.
  useEffect(() => {
    if (!needsModel || model || modelErr) return;
    void (async () => {
      try {
        const res = await fetch(`/api/games/${slug}/propose-model`, { cache: "no-store" });
        const data = await res.json();
        if (data.ok) setModel(data.model);
        else setModelErr(data.error ?? "Could not load the game model.");
      } catch (e) {
        setModelErr((e as Error).message);
      }
    })();
  }, [needsModel, model, modelErr, slug]);

  const baseConfig = useMemo(() => {
    const obj: Record<string, number | string | boolean> = {};
    for (const leaf of model?.configLeaves ?? []) obj[leaf.path] = leaf.value;
    return obj;
  }, [model]);
  const headConfig = useMemo(() => ({ ...baseConfig, ...configEdits }), [baseConfig, configEdits]);

  const editCount =
    Object.keys(spriteSwaps).length + Object.keys(movementSwaps).length + Object.keys(configEdits).length;

  const submit = async () => {
    setBusy(true);
    setError(null);
    setIssues(null);
    try {
      if (mode === "BUG") {
        const res = await fetch(`/api/games/${slug}/bugs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, body }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          setError(data.error ?? "Could not file the bug.");
          return;
        }
        router.push(`/games/${slug}#community`);
        router.refresh();
        return;
      }

      const edits =
        mode === "FEATURE_REQUEST" ? undefined : { spriteSwaps, movementSwaps, configEdits };
      const res = await fetch(`/api/games/${slug}/proposals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: mode, title, body, edits, windowDays, quorum, thresholdPct, open: true }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        if (data.issues) setIssues(data.issues);
        setError(data.error ?? "Could not create the proposal.");
        return;
      }
      router.push(`/games/${slug}/proposals/${data.id}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const canSubmit =
    !busy &&
    title.trim().length > 0 &&
    (mode === "FEATURE_REQUEST" || mode === "BUG" ? body.trim().length > 0 : editCount > 0);

  return (
    <div className="flex flex-col gap-5">
      {/* Mode picker */}
      <div className="flex flex-wrap gap-2">
        {(
          [
            ["CONFIG_CHANGE", "⚙ Config change"],
            ["PART_SWAP", "🧩 Part swap"],
            ["FEATURE_REQUEST", "💡 Feature request"],
            ["BUG", "🐞 Bug report"],
          ] as [Mode, string][]
        ).map(([m, label]) => (
          <button
            key={m}
            className={`gc-btn ${mode === m ? "gc-btn-primary" : ""}`}
            onClick={() => {
              setMode(m);
              setError(null);
              setIssues(null);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {mode !== "BUG" && tier !== "ecosystem" && needsModel && (
        <p className="text-xs text-arcade-warn">Config/part proposals require an ecosystem-tier game.</p>
      )}

      {/* Title + rationale */}
      <section className="gc-panel p-4">
        <label className="text-xs font-bold text-arcade-mute">Title</label>
        <input
          className="gc-input mt-1 w-full"
          placeholder={mode === "BUG" ? "Short summary of the bug" : "What should change, in one line"}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <label className="mt-3 block text-xs font-bold text-arcade-mute">
          {mode === "FEATURE_REQUEST" ? "Description + acceptance criteria" : mode === "BUG" ? "Steps to reproduce / what happens" : "Rationale (optional)"}
        </label>
        <textarea
          className="gc-input mt-1 w-full text-sm"
          rows={mode === "FEATURE_REQUEST" || mode === "BUG" ? 5 : 2}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </section>

      {/* Edit surface for config / part-swap */}
      {needsModel && (
        <>
          {modelErr ? (
            <p className="gc-panel p-4 text-sm text-arcade-bad">{modelErr}</p>
          ) : !model ? (
            <p className="gc-panel p-4 text-sm text-arcade-mute">Loading the game model…</p>
          ) : mode === "CONFIG_CHANGE" ? (
            <section className="gc-panel p-4">
              <h3 className="text-sm font-bold text-arcade-mute">Tune the balance (config.json)</h3>
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
                          onChange={(e) => {
                            const v = Number(e.target.value);
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
              {Object.keys(configEdits).length > 0 && (
                <div className="mt-4">
                  <h4 className="text-xs font-bold text-arcade-mute">change preview</h4>
                  <ConfigDiff base={baseConfig} head={headConfig} compact />
                </div>
              )}
            </section>
          ) : (
            <section className="gc-panel p-4">
              <h3 className="text-sm font-bold text-arcade-mute">Swap a part</h3>
              {model.entities.length === 0 && model.movementSlots.length === 0 ? (
                <p className="mt-2 text-xs text-arcade-mute">No swappable parts in this scene.</p>
              ) : (
                <div className="mt-3 flex flex-col gap-3">
                  {model.entities.map((e) => (
                    <div key={e.id} className="flex flex-wrap items-center gap-3 rounded-md border border-arcade-edge p-3">
                      <span className="font-mono text-xs">{e.id} sprite</span>
                      <select
                        className="gc-input ml-auto text-xs"
                        value={spriteSwaps[e.id] ?? ""}
                        onChange={(ev) => {
                          const v = ev.target.value;
                          setSpriteSwaps((s) => {
                            const n = { ...s };
                            if (v) n[e.id] = v;
                            else delete n[e.id];
                            return n;
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
                  ))}
                  {model.movementSlots.map((slot) => (
                    <div key={slot.key} className="flex flex-wrap items-center gap-3 rounded-md border border-arcade-edge p-3">
                      <span className="font-mono text-xs">
                        {slot.entityId} movement <span className="text-arcade-mute">({slot.currentType})</span>
                      </span>
                      <select
                        className="gc-input ml-auto text-xs"
                        value={movementSwaps[slot.key] ?? ""}
                        onChange={(ev) => {
                          const v = ev.target.value;
                          setMovementSwaps((s) => {
                            const n = { ...s };
                            if (v) n[slot.key] = v;
                            else delete n[slot.key];
                            return n;
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
          )}
        </>
      )}

      {/* Voting config (proposals only) */}
      {mode !== "BUG" && (
        <section className="gc-panel p-4">
          <h3 className="text-sm font-bold text-arcade-mute">Voting window</h3>
          <div className="mt-2 grid grid-cols-3 gap-3 text-xs">
            <label className="flex flex-col gap-1">
              Window (days, 1–14)
              <input
                type="number"
                min={1}
                max={14}
                className="gc-input"
                value={windowDays}
                onChange={(e) => setWindowDays(Math.min(14, Math.max(1, Number(e.target.value))))}
              />
            </label>
            <label className="flex flex-col gap-1">
              Quorum (min votes)
              <input type="number" min={1} className="gc-input" value={quorum} onChange={(e) => setQuorum(Math.max(1, Number(e.target.value)))} />
            </label>
            <label className="flex flex-col gap-1">
              Pass threshold (%)
              <input
                type="number"
                min={50}
                max={100}
                className="gc-input"
                value={thresholdPct}
                onChange={(e) => setThresholdPct(Math.min(100, Math.max(50, Number(e.target.value))))}
              />
            </label>
          </div>
          <div className="mt-3">
            <AntiBrigadingNotice compact />
          </div>
        </section>
      )}

      {issues && (
        <div className="gc-panel border-arcade-bad/50 p-4">
          <h3 className="font-bold text-arcade-bad">This proposal would produce an invalid game — fix before submitting</h3>
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
      {error && !issues && <p className="text-sm text-arcade-bad">{error}</p>}

      <button className="gc-btn gc-btn-primary self-start" disabled={!canSubmit} onClick={submit}>
        {busy
          ? "Submitting…"
          : mode === "BUG"
            ? "File bug report"
            : "Create proposal & open voting"}
      </button>
    </div>
  );
}
