"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const EXAMPLE_SOURCE = `import type { BehaviorFn } from "@gitcade/sdk";

/**
 * drift-x — a self-contained custom behavior: nudges an entity's horizontal
 * velocity by a tunable acceleration each tick. (Balance via $cfg in real use.)
 */
export const driftX: BehaviorFn = (entity, _world, params, _dt) => {
  const ax = (params.ax as number) ?? 0;
  (entity as unknown as { vx: number }).vx += ax;
};

export default driftX;
`;

const EXAMPLE_TEST = `import { describe, it, expect } from "vitest";
import driftX from "../src/drift-x";

describe("drift-x", () => {
  it("adds horizontal acceleration to the entity velocity", () => {
    const entity = { vx: 0, vy: 0 } as unknown as Parameters<typeof driftX>[0];
    driftX(entity, {} as never, { ax: 5 } as never, 1 / 60);
    expect((entity as unknown as { vx: number }).vx).toBe(5);
  });
});
`;

export function PartUploadForm() {
  const router = useRouter();
  const [form, setForm] = useState({
    id: "",
    kind: "behavior" as "behavior" | "entity",
    category: "movement",
    tags: "custom",
    description: "",
    license: "" as "" | "MIT" | "CC-BY-4.0",
    source: "",
    test: "",
  });
  const [phase, setPhase] = useState<"edit" | "validating" | "done" | "error">("edit");
  const [errors, setErrors] = useState<string[]>([]);
  const [log, setLog] = useState<string | null>(null);
  const [published, setPublished] = useState<{ partId: string } | null>(null);

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const loadExample = () =>
    setForm({
      id: "drift-x",
      kind: "behavior",
      category: "movement",
      tags: "movement,custom,demo",
      description: "Nudges an entity's horizontal velocity by a tunable acceleration each tick.",
      license: "MIT",
      source: EXAMPLE_SOURCE,
      test: EXAMPLE_TEST,
    });

  const submit = async () => {
    setPhase("validating");
    setErrors([]);
    setLog(null);
    try {
      const res = await fetch("/api/parts/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setErrors(data.errors ?? [data.error ?? "Upload failed."]);
        setLog(data.log ?? null);
        setPhase("error");
        return;
      }
      setPublished({ partId: data.partId });
      setLog(data.log ?? null);
      setPhase("done");
    } catch (e) {
      setErrors([(e as Error).message]);
      setPhase("error");
    }
  };

  if (phase === "done" && published) {
    return (
      <div className="gc-panel border-arcade-good/50 p-6">
        <h3 className="font-bold text-arcade-good">✓ Published “{published.partId}” to the catalog</h3>
        <p className="mt-1 text-sm text-arcade-mute">
          Schema check + your unit test passed in the build sandbox.
        </p>
        <div className="mt-3 flex gap-3">
          <button className="gc-btn gc-btn-primary" onClick={() => router.push(`/parts/${published.partId}`)}>
            View part page
          </button>
          <button className="gc-btn" onClick={() => router.push("/parts")}>
            Back to marketplace
          </button>
        </div>
        {log && (
          <pre className="mt-3 max-h-72 overflow-auto rounded-md border border-arcade-edge bg-black/40 p-3 text-xs">
            {log}
          </pre>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <button className="gc-btn" onClick={loadExample}>
          Load a working example
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs">
          part id (kebab-case)
          <input className="gc-input" value={form.id} onChange={(e) => set("id", e.target.value)} placeholder="drift-x" />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          kind
          <select className="gc-input" value={form.kind} onChange={(e) => set("kind", e.target.value)}>
            <option value="behavior">behavior</option>
            <option value="entity">entity</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          category
          <input className="gc-input" value={form.category} onChange={(e) => set("category", e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          tags (comma-separated)
          <input className="gc-input" value={form.tags} onChange={(e) => set("tags", e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs sm:col-span-2">
          description
          <input className="gc-input" value={form.description} onChange={(e) => set("description", e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          license <span className="text-arcade-warn">(required)</span>
          <select className="gc-input" value={form.license} onChange={(e) => set("license", e.target.value)}>
            <option value="">— select a license —</option>
            <option value="MIT">MIT (code)</option>
            <option value="CC-BY-4.0">CC-BY-4.0 (assets)</option>
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-1 text-xs">
        implementation source (src/&lt;id&gt;.ts)
        <textarea
          className="gc-input min-h-[10rem] font-mono text-xs"
          value={form.source}
          onChange={(e) => set("source", e.target.value)}
          placeholder="export const myBehavior: BehaviorFn = (entity, world, params, dt) => { … }"
        />
      </label>

      <label className="flex flex-col gap-1 text-xs">
        unit test (tests/&lt;id&gt;.test.ts) — the validation gate
        <textarea
          className="gc-input min-h-[10rem] font-mono text-xs"
          value={form.test}
          onChange={(e) => set("test", e.target.value)}
          placeholder={`import { describe, it, expect } from "vitest";\nimport part from "../src/<id>";`}
        />
      </label>

      {errors.length > 0 && (
        <div className="gc-panel border-arcade-bad/50 p-4">
          <h3 className="font-bold text-arcade-bad">Rejected</h3>
          <ul className="mt-2 list-inside list-disc text-xs text-arcade-bad">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
          {log && (
            <pre className="mt-2 max-h-72 overflow-auto rounded-md border border-arcade-edge bg-black/40 p-3 text-xs text-arcade-ink">
              {log}
            </pre>
          )}
        </div>
      )}

      <div className="flex items-center justify-between">
        <span className="text-xs text-arcade-mute">
          {phase === "validating" ? "Running schema check + your unit test in the sandbox (~1–2 min)…" : ""}
        </span>
        <button className="gc-btn gc-btn-primary" onClick={submit} disabled={phase === "validating"}>
          {phase === "validating" ? "◌ Validating in sandbox…" : "Publish to catalog"}
        </button>
      </div>
    </div>
  );
}
