"use client";

import Link from "next/link";
import { signIn, signOut, useSession } from "next-auth/react";

/** Top navigation with GitHub auth controls. */
export function Nav() {
  const { data: session, status } = useSession();
  return (
    <header className="border-b border-arcade-edge bg-arcade-panel/60">
      <nav className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <div className="flex items-center gap-6">
          <Link href="/" className="text-lg font-bold text-arcade-ink no-underline">
            🕹️ GitCade
          </Link>
          <Link href="/" className="text-sm text-arcade-mute no-underline hover:text-arcade-ink">
            Arcade
          </Link>
          <Link
            href="/publish"
            className="text-sm text-arcade-mute no-underline hover:text-arcade-ink"
          >
            Publish
          </Link>
          <Link
            href="/parts"
            className="text-sm text-arcade-mute no-underline hover:text-arcade-ink"
          >
            Marketplace
          </Link>
          <Link
            href="/compare"
            className="text-sm text-arcade-mute no-underline hover:text-arcade-ink"
          >
            Compare
          </Link>
        </div>
        <div className="flex items-center gap-3">
          {status === "authenticated" && session?.user ? (
            <>
              <span className="hidden text-sm text-arcade-mute sm:inline">
                {session.user.name ?? "signed in"}
              </span>
              {session.user.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={session.user.image}
                  alt=""
                  className="h-7 w-7 rounded-full border border-arcade-edge"
                />
              ) : null}
              <button className="gc-btn" onClick={() => signOut()}>
                Sign out
              </button>
            </>
          ) : (
            <button className="gc-btn gc-btn-primary" onClick={() => signIn("github")}>
              Sign in with GitHub
            </button>
          )}
        </div>
      </nav>
    </header>
  );
}
