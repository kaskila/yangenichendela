import path from "node:path";
import { defineConfig } from "prisma/config";

// Prisma 7 no longer auto-loads `.env`, and (unlike the app) the Prisma CLI
// does not go through Next.js's env loading. Pull `.env` in ourselves using the
// Node built-in — no dependency. Absent file (e.g. plain `prisma generate` in
// CI) is fine.
try {
  process.loadEnvFile();
} catch {
  // no .env file present
}

// Replaces the old package.json#prisma block and the implicit schema lookup.
// Connection URLs live in the `datasource` block of schema.prisma at build
// time via the driver adapter (src/lib/db.ts); migrations use DIRECT_URL here.
export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    path: path.join("prisma", "migrations"),
  },
  datasource: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "",
  },
});
