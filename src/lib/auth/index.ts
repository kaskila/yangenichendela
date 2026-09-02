import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/lib/db";

// Better Auth configuration.
//
// Email + password only. No social providers. No public sign-up: admin and
// staff accounts are created by hand (a seed script / prisma studio), so the
// sign-up endpoint is disabled outright.
//
// `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` are read from the environment.
export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,

  database: prismaAdapter(db, {
    provider: "postgresql",
    transaction: true,
  }),

  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
  },

  user: {
    additionalFields: {
      // Authorisation role. Not settable through any auth endpoint — changed
      // only via a trusted server context. Rides on the session user so the
      // guards can read it without a second query.
      role: {
        type: ["ADMIN", "STAFF"],
        required: false,
        input: false,
        defaultValue: "STAFF",
      },
    },
  },

  // Must be the last plugin so it can write Set-Cookie from server actions.
  plugins: [nextCookies()],
});

export type Session = typeof auth.$Infer.Session;
export type SessionUser = Session["user"];
