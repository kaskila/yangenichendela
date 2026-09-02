import { execFileSync } from "node:child_process";
import { loadTestEnv } from "./load-test-env";

// Runs once before the whole Vitest suite: applies pending migrations to the
// .env.test database so integration tests hit a real, current schema. If the
// database is unreachable this throws and the suite fails here — that is the
// intended signal, not a reason to fall back to mocks.
export default function setup() {
  loadTestEnv();

  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "global-setup: no DIRECT_URL / DATABASE_URL — is .env.test present?",
    );
  }

  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
    shell: process.platform === "win32",
  });
}
