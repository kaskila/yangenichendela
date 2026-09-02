// Side-effect import: load `.env` before anything that reads process.env.
// Imported first by prisma/seed-admin.ts because ES module imports are hoisted
// and run in order — a plain `process.loadEnvFile()` in the script body would
// run *after* `@/lib/db` had already read an empty DATABASE_URL.
try {
  process.loadEnvFile();
} catch {
  // No .env file — rely on the ambient environment.
}
