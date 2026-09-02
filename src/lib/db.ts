import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

// Single PrismaClient for the whole app. In development Next.js re-evaluates
// modules on every hot reload, which would otherwise open a fresh connection
// pool per edit until the database refuses new connections — so the instance is
// stashed on `globalThis` and reused.
//
// Prisma 7 has no query engine binary: the connection is owned by a driver
// adapter (node-postgres) that we construct here. `DATABASE_URL` is the Neon
// pooled connection string; it is read lazily by the pool on first query, so
// this module is safe to import at build time with no database configured.

const createPrismaClient = () =>
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

const globalForPrisma = globalThis as unknown as {
  prisma?: ReturnType<typeof createPrismaClient>;
};

export const db = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
