// Augment the NextAuth session/user with the fields we expose (database sessions).
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id?: string;
      githubLogin?: string | null;
    } & DefaultSession["user"];
  }
  interface User {
    githubLogin?: string | null;
  }
}
