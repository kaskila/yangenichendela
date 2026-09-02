/**
 * Create an admin or staff account by hand.
 *
 *   npx tsx prisma/seed-admin.ts <email> <password> <name> <ADMIN|STAFF>
 *   npm run db:seed:admin -- <email> <password> <name> <ADMIN|STAFF>
 *
 * There is no public sign-up and no verification email, so operator accounts
 * are seeded this way. The password is hashed with Better Auth's OWN hasher
 * (reached through `auth.$context`) — sign-in verifies with that same
 * algorithm, so bcrypt or any other library would silently fail to log in.
 *
 * The user row and its credential `account` row are written in one
 * transaction. Refuses to run if the email already exists.
 */
import "./load-env";
import { createLocalAccountIssuer } from "better-auth/db";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

const MIN_PASSWORD_LENGTH = 12;
const ROLES = ["ADMIN", "STAFF"] as const;
type Role = (typeof ROLES)[number];

function fail(message: string): never {
  console.error(`\n  ${message}\n`);
  console.error(
    "  Usage: npx tsx prisma/seed-admin.ts <email> <password> <name> <ADMIN|STAFF>\n",
  );
  process.exit(1);
}

async function main() {
  const [emailRaw, password, name, roleRaw] = process.argv.slice(2);

  if (!emailRaw || !password || !name || !roleRaw) {
    fail("All four arguments are required.");
  }

  const email = emailRaw.trim().toLowerCase();
  if (!email.includes("@")) {
    fail(`"${emailRaw}" does not look like an email address.`);
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    fail(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  const role = roleRaw.toUpperCase() as Role;
  if (!ROLES.includes(role)) {
    fail(`Role must be one of: ${ROLES.join(", ")}.`);
  }

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    fail(`A user with email ${email} already exists (id ${existing.id}).`);
  }

  const ctx = await auth.$context;
  const passwordHash = await ctx.password.hash(password);

  const genId = (model: "user" | "account") => {
    const id = ctx.generateId({ model });
    return typeof id === "string" && id.length > 0 ? id : crypto.randomUUID();
  };

  const userId = genId("user");

  await db.$transaction(async (tx) => {
    await tx.user.create({
      data: {
        id: userId,
        email,
        name: name.trim(),
        // Seeded by hand — there is no verification email to send.
        emailVerified: true,
        role,
      },
    });

    await tx.account.create({
      data: {
        id: genId("account"),
        userId,
        // Matches what Better Auth's own email/password sign-up writes.
        providerId: "credential",
        issuer: createLocalAccountIssuer("credential"),
        accountId: userId,
        password: passwordHash,
      },
    });
  });

  console.log(`\n  Created ${role} account for ${email} (id ${userId}).\n`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
