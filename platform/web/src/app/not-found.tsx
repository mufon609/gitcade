import Link from "next/link";

export default function NotFound() {
  return (
    <div className="gc-panel p-10 text-center">
      <h1 className="text-xl font-bold">Not found</h1>
      <p className="mt-2 text-arcade-mute">That game or page doesn’t exist.</p>
      <Link href="/" className="gc-btn mt-4 inline-block no-underline">
        ← Back to the arcade
      </Link>
    </div>
  );
}
