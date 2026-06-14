// GitHub OAuth via NextAuth (v4) with the Prisma adapter + database sessions.
//
// AUTH SCOPES ARE EXPLICIT AND LOAD-BEARING (per the phase contract):
//   read:user user:email public_repo
// `public_repo` is REQUIRED NOW even though forks (Phase 5) and remix commits
// (Phase 6) are what use it — NextAuth's identity-only default would 403 there and
// force a painful re-consent of every user. We do NOT request admin:repo_hook —
// webhooks are app-owned (Locked Decision). The GitHub access token is stored by
// the adapter on the Account row so later phases can act as the user.
import type { NextAuthOptions } from "next-auth";
import GitHubProvider from "next-auth/providers/github";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import { prisma } from "./prisma";
import { env } from "./env";

export const GITHUB_SCOPES = "read:user user:email public_repo";

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  secret: env.nextAuthSecret,
  session: { strategy: "database" },
  providers: [
    GitHubProvider({
      clientId: env.githubOAuthId,
      clientSecret: env.githubOAuthSecret,
      authorization: { params: { scope: GITHUB_SCOPES } },
      // Capture the GitHub login so Phase 5 can build {slug}--{username} fork slugs.
      profile(profile) {
        return {
          id: String(profile.id),
          name: profile.name ?? profile.login,
          email: profile.email,
          image: profile.avatar_url,
          githubLogin: profile.login,
        } as { id: string; name: string | null; email: string | null; image: string | null; githubLogin: string };
      },
    }),
  ],
  callbacks: {
    // Database sessions: expose the user id (and github login) to the app.
    async session({ session, user }) {
      if (session.user) {
        (session.user as { id?: string }).id = user.id;
        (session.user as { githubLogin?: string | null }).githubLogin = (
          user as { githubLogin?: string | null }
        ).githubLogin;
      }
      return session;
    },
  },
};

/** Read the stored GitHub OAuth access token for a user (repo ops in Phase 5/6).
 *  Returns null if the user has no linked GitHub account. */
export async function getUserGitHubToken(userId: string): Promise<string | null> {
  const account = await prisma.account.findFirst({
    where: { userId, provider: "github" },
    select: { access_token: true },
  });
  return account?.access_token ?? null;
}
