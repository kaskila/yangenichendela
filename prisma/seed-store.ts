/**
 * Seed store configuration for local development.
 *
 *   npx tsx prisma/seed-store.ts
 *   npm run db:seed:store
 *
 * Creates the StoreSettings singleton (schema defaults) and the Airtel + MTN
 * merchant numbers. The numbers are READ FROM ENV VARS, never hardcoded
 * (CLAUDE.md Rule 9) — a merchant number in a committed file is a leaked secret
 * in a small market. A missing var is a warning, not an error: the real numbers
 * are still a client open-item.
 *
 * Re-runnable: an existing row is left as-is.
 */
import "./load-env";
import { db } from "@/lib/db";

type Seed = { network: "AIRTEL" | "MTN"; envVar: string };

const NUMBERS: Seed[] = [
  { network: "AIRTEL", envVar: "MERCHANT_AIRTEL_NUMBER" },
  { network: "MTN", envVar: "MERCHANT_MTN_NUMBER" },
];

async function main() {
  const settings = await db.storeSettings.upsert({
    where: { id: "singleton" },
    create: {},
    update: {},
  });
  console.log(
    `  StoreSettings ready (deliveryLusakaMinor=${settings.deliveryLusakaMinor})`,
  );

  for (const { network, envVar } of NUMBERS) {
    const number = process.env[envVar]?.trim();
    if (!number) {
      console.warn(`  ${envVar} not set — skipping ${network}`);
      continue;
    }

    const existing = await db.merchantNumber.findUnique({
      where: { network_number: { network, number } },
    });
    if (existing) {
      console.log(`  ${network}: ${number} already present — skipped`);
      continue;
    }

    await db.merchantNumber.create({
      data: {
        network,
        number,
        // PERSONAL is the safe default — whether the client's lines are personal
        // or registered business accounts is an open item. Change in the admin.
        accountType: "PERSONAL",
        isActive: true,
        isPrimary: true,
        label: "seeded",
      },
    });
    console.log(`  ${network}: ${number} created`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
