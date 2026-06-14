// Single Prisma client for the worker process.
import { PrismaClient } from "@prisma/client";
import { env } from "./env.js";

export const prisma = new PrismaClient({
  datasources: { db: { url: env.databaseUrl } },
});
