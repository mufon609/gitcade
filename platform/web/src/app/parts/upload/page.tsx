import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { PartUploadForm } from "./PartUploadForm";

export const dynamic = "force-dynamic";

export default async function PartUploadPage() {
  const session = await getServerSession(authOptions);
  const signedIn = !!(session?.user as { id?: string } | undefined)?.id;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/parts" className="text-xs text-arcade-mute no-underline">
          ← Marketplace
        </Link>
        <h1 className="text-2xl font-bold">Publish a part</h1>
        <p className="max-w-2xl text-sm text-arcade-mute">
          Publish a custom behavior or entity from your game&apos;s <code>src/custom-behaviors/</code> to
          the public catalog. Submission runs schema validation <strong>and your unit test in the
          build sandbox</strong> (not in the web server) — a part that fails either is rejected with
          readable errors. A license is mandatory. Published user parts are <em>vendored</em> into
          forks at remix time; the library is never modified.
        </p>
      </div>

      {signedIn ? (
        <PartUploadForm />
      ) : (
        <div className="gc-panel p-8 text-center text-sm text-arcade-mute">
          Sign in with GitHub to publish a part.
        </div>
      )}
    </div>
  );
}
