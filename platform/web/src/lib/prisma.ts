// Single Prisma client for the web app. Generated from THIS app's superset schema
// (which includes the frozen BuildJob/Build tables verbatim), pointed at the same
// DATABASE_URL the worker uses. Rows the web app inserts into BuildJob are
// byte-identical to the worker's own — that IS honoring the frozen enqueue
// contract (see src/lib/queue.ts).
import { PrismaClient } from "@prisma/client";
import { env } from "./env";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: { db: { url: env.databaseUrl } },
  });

// Avoid exhausting Postgres connections during Next.js dev hot-reload.
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
