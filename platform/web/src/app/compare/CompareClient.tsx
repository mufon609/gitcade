"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PlayPane } from "@/components/PlayPane";
import { ConfigDiff } from "@/components/ConfigDiff";
import type { ConfigChange } from "@/lib/configdiff";

interface Side {
  slug: string;
  name: string;
  branch: string;
  repoUrl: string;
  playable: boolean;
  indexUrl: string;
}

/** The two-pane compare view. Each <PlayPane> owns its own storage-bridge channel
 *  (matched by event.source === its iframe.contentWindow), so a save in one pane is
 *  invisible to the other — proven independent even for two branches of one game.
 *  The picker rewrites the URL so any comparison is shareable. */
export function CompareClient({
  sideA,
  sideB,
  games,
  configChanges,
  defaults,
}: {
  sideA: Side | null;
  sideB: Side | null;
  games: Array<{ slug: string; name: string }>;
  configChanges: ConfigChange[] | null;
  defaults: { a: string; ab: string; b: string; bb: string };
}) {
  const router = useRouter();
  const [form, setForm] = useState(defaults);

  const apply = () => {
    const p = new URLSearchParams();
    if (form.a) p.set("a", form.a);
    if (form.ab) p.set("ab", form.ab);
    if (form.b) p.set("b", form.b);
    if (form.bb) p.set("bb", form.bb);
    router.push(`/compare?${p.toString()}`);
  };

  const Pane = ({ side, label }: { side: Side | null; label: string }) => {
    if (!side) {
      return (
        <div className="gc-panel flex aspect-[4/3] items-center justify-center p-6 text-center text-arcade-mute">
          Pick side {label} below.
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between text-sm">
          <span className="font-bold">{side.name}</span>
          <span className="gc-chip">{side.branch}</span>
        </div>
        {side.playable ? (
          // key on slug+branch so switching sides fully remounts the bridge.
          <PlayPane key={`${side.slug}@${side.branch}`} slug={side.slug} branch={side.branch} indexUrl={side.indexUrl} />
        ) : (
          <div className="gc-panel flex aspect-[4/3] items-center justify-center p-6 text-center text-arcade-warn">
            {side.name} @ {side.branch} has no successful build yet.
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Pane side={sideA} label="A" />
        <Pane side={sideB} label="B" />
      </div>

      {configChanges && (
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-bold text-arcade-mute">
            config.json diff — {sideA?.name}/{sideA?.branch} → {sideB?.name}/{sideB?.branch}
          </h3>
          <ConfigDiff changes={configChanges} emptyLabel="Identical config between these two." />
        </div>
      )}

      <form
        className="gc-panel flex flex-wrap items-end gap-3 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        <datalist id="game-slugs">
          {games.map((g) => (
            <option key={g.slug} value={g.slug}>
              {g.name}
            </option>
          ))}
        </datalist>
        <Field label="A · game" value={form.a} onChange={(v) => setForm({ ...form, a: v })} list />
        <Field label="A · branch" value={form.ab} onChange={(v) => setForm({ ...form, ab: v })} placeholder="(default)" />
        <Field label="B · game" value={form.b} onChange={(v) => setForm({ ...form, b: v })} list />
        <Field label="B · branch" value={form.bb} onChange={(v) => setForm({ ...form, bb: v })} placeholder="(default)" />
        <button className="gc-btn gc-btn-primary" type="submit">
          Compare
        </button>
      </form>
      <p className="text-xs text-arcade-mute">
        Tip: each pane keeps its own saves (namespaced by game+branch and routed by iframe identity) —
        play both, and high scores / progress stay independent.
      </p>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  list,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  list?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-arcade-mute">
      {label}
      <input
        className="gc-input w-44 py-1"
        value={value}
        placeholder={placeholder}
        list={list ? "game-slugs" : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
