// Loads .env.test into process.env for the Vitest run. Used both as a Vitest
// `setupFile` (so `@/lib/db` sees the test DATABASE_URL before it evaluates)
// and by the migrate step in global-setup.ts.
//
// Hand-rolled rather than process.loadEnvFile() because .env.test carries a
// stray keyless first line; this parser just skips anything that is not
// KEY=VALUE.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

let loaded = false;

export function loadTestEnv(): void {
  if (loaded) return;
  loaded = true;

  const path = resolve(process.cwd(), ".env.test");
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    // No .env.test — rely on the ambient environment (e.g. CI secrets).
    return;
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!key) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // The test env is authoritative for the test run.
    process.env[key] = value;
  }
}

loadTestEnv();
