import { PublishClient } from "./PublishClient";

export const metadata = { title: "Publish a game — GitCade" };

export default function PublishPage() {
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Publish a game</h1>
        <p className="mt-1 text-arcade-mute">
          Paste a <strong>public</strong> GitHub repo containing a GitCade game (a <code>game.json</code>{" "}
          at its root). The build pipeline clones it, validates it, builds it, and — if it passes —
          puts it live. <strong>The validator is the gate.</strong>
        </p>
      </div>
      <PublishClient />
    </div>
  );
}
