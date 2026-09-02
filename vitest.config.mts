import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // Applies pending migrations to the .env.test database once before the run.
    globalSetup: ["./src/test/global-setup.ts"],
    // Loads .env.test into process.env before `@/lib/db` evaluates.
    setupFiles: ["./src/test/load-test-env.ts"],
    // One shared Postgres database — run test files serially so the 250-way
    // concurrency test does not compete with other files for the pool.
    fileParallelism: false,
    hookTimeout: 60_000,
    testTimeout: 60_000,
  },
  resolve: {
    alias: {
      // Mirror the `@/*` alias from tsconfig.json without pulling in an extra
      // plugin dependency.
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
