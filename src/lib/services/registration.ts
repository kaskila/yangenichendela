import { z } from "zod";
import { db } from "@/lib/db";
import { Prisma, RegistrationStatus } from "@/generated/prisma/client";
import type { Registration } from "@/generated/prisma/client";

// Launch registration service. Owns the 200-seat capacity cap for the Level Up
// book launch. CLAUDE.md: a count-then-insert oversells a public capped event
// the moment the link reaches a crowd, so the seat is claimed with a single
// atomic guarded decrement and nothing in here ever reads seatsRemaining to
// then decide.
//
// No authorization here on purpose. requireAdmin() / requireStaff() belong to
// the server-action layer; keeping this file auth-free is what lets the tests
// exercise it directly.
//
// Ordinary outcomes ("full", "already registered", "closed", "not found",
// "already checked in") are returned as discriminated-union results the UI
// renders. Throwing is reserved for genuine faults.

// --- registration codes --------------------------------------------------------
// Read aloud at the door and typed on phones, so the alphabet drops 0/O and
// 1/I/L. Prefix matches the Order.reference house style (YC-...).

const CODE_PREFIX = "YC-";
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;
const CODE_MAX_ATTEMPTS = 5;

function generateCode(): string {
  const n = CODE_ALPHABET.length;
  // Reject the tail of the uint32 range that would bias the modulo.
  const limit = Math.floor(0x1_0000_0000 / n) * n;
  const buf = new Uint32Array(1);
  let body = "";
  while (body.length < CODE_LENGTH) {
    crypto.getRandomValues(buf);
    if (buf[0] >= limit) continue;
    body += CODE_ALPHABET[buf[0] % n];
  }
  return CODE_PREFIX + body;
}

// --- phone normalisation -----------------------------------------------------
// Accepts 0977..., +260977..., 260977... and spaced variants; normalises to
// +260 E.164. Returns null for anything that is not a plausible Zambian mobile.

export function normaliseZambianPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");

  let national: string | null = null;
  if (digits.length === 12 && digits.startsWith("260")) national = digits.slice(3);
  else if (digits.length === 10 && digits.startsWith("0")) national = digits.slice(1);
  else if (digits.length === 9) national = digits;

  if (national === null) return null;
  const candidate = `+260${national}`;
  return /^\+260[97]\d{8}$/.test(candidate) ? candidate : null;
}

// --- input schema ------------------------------------------------------------

const registerInputSchema = z.object({
  eventSlug: z.string().trim().min(1),
  name: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .transform((s) => s.replace(/\s+/g, " ")),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email({ message: "Enter a valid email address." })),
  phone: z
    .string()
    .trim()
    .min(1)
    .transform((val, ctx) => {
      const normalised = normaliseZambianPhone(val);
      if (normalised === null) {
        ctx.addIssue({ code: "custom", message: "Enter a Zambian mobile number." });
        return z.NEVER;
      }
      return normalised;
    }),
  // No `organisation`: the Registration model has no column for it. If the
  // launch ever needs to capture employer, that is a schema change first.
});

export type RegisterInput = z.input<typeof registerInputSchema>;

// --- result types ----------------------------------------------------------

type FieldIssues = Record<string, string[] | undefined>;

export type RegisterResult =
  | {
      ok: true;
      deduped: boolean;
      status: typeof RegistrationStatus.CONFIRMED | typeof RegistrationStatus.WAITLIST;
      registration: Registration;
    }
  | { ok: false; reason: "invalid_input"; issues: FieldIssues }
  | { ok: false; reason: "event_not_found" }
  | { ok: false; reason: "registration_closed" };

export type CancelResult =
  | { ok: true; promoted: Registration | null }
  | { ok: false; reason: "not_found" };

export type CheckInResult =
  | { ok: true; outcome: "checked_in" | "already_checked_in"; registration: Registration }
  | { ok: false; reason: "not_found" };

// --- helpers ---------------------------------------------------------------

function isUniqueViolation(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
  );
}

/** Does a P2002 target point at the email uniqueness constraint (vs. code)? */
function isEmailCollision(error: Prisma.PrismaClientKnownRequestError): boolean {
  const target = String(error.meta?.target ?? "").toLowerCase();
  return target.includes("email");
}

// --- register --------------------------------------------------------------

export async function registerForEvent(input: RegisterInput): Promise<RegisterResult> {
  const parsed = registerInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "invalid_input",
      issues: z.flattenError(parsed.error).fieldErrors,
    };
  }
  const { eventSlug, name, email, phone } = parsed.data;

  return db.$transaction(
    async (tx) => {
      const event = await tx.launchEvent.findUnique({ where: { slug: eventSlug } });
      if (!event) return { ok: false, reason: "event_not_found" } as const;
      if (!event.registrationOpen) {
        return { ok: false, reason: "registration_closed" } as const;
      }

      const existing = await tx.registration.findUnique({
        where: { eventId_email: { eventId: event.id, email } },
      });

      // A live registration for this email — return it unchanged. People
      // double-tap the submit button on a bad connection.
      if (existing && existing.status !== RegistrationStatus.CANCELLED) {
        return {
          ok: true,
          deduped: true,
          status: existing.status as
            | typeof RegistrationStatus.CONFIRMED
            | typeof RegistrationStatus.WAITLIST,
          registration: existing,
        } as const;
      }

      // Claim a seat. THE critical line: one atomic guarded decrement, no
      // read-then-decide, no row counting. Postgres row-locks the event so
      // exactly `capacity` concurrent callers see count === 1.
      const claimed = await tx.launchEvent.updateMany({
        where: { id: event.id, seatsRemaining: { gt: 0 } },
        data: { seatsRemaining: { decrement: 1 } },
      });
      const gotSeat = claimed.count === 1;

      const status = gotSeat
        ? RegistrationStatus.CONFIRMED
        : RegistrationStatus.WAITLIST;
      const waitlistRank = gotSeat
        ? null
        : (await tx.registration.count({
            where: { eventId: event.id, status: RegistrationStatus.WAITLIST },
          })) + 1;

      // Revive a previously CANCELLED row rather than inserting — the
      // @@unique([eventId, email]) would otherwise lock this email out forever.
      if (existing) {
        for (let attempt = 0; attempt < CODE_MAX_ATTEMPTS; attempt++) {
          try {
            const revived = await tx.registration.update({
              where: { id: existing.id },
              data: {
                name,
                phone,
                status,
                waitlistRank,
                code: generateCode(),
                checkedInAt: null,
                checkedInById: null,
              },
            });
            return { ok: true, deduped: false, status, registration: revived } as const;
          } catch (error) {
            if (isUniqueViolation(error) && !isEmailCollision(error)) continue;
            throw error;
          }
        }
        throw new Error("registration: exhausted code attempts reviving a row");
      }

      for (let attempt = 0; attempt < CODE_MAX_ATTEMPTS; attempt++) {
        try {
          const created = await tx.registration.create({
            data: {
              eventId: event.id,
              code: generateCode(),
              name,
              email,
              phone,
              status,
              waitlistRank,
            },
          });
          return { ok: true, deduped: false, status, registration: created } as const;
        } catch (error) {
          if (isUniqueViolation(error)) {
            // A concurrent first-time submission for the same email won the
            // race — return its row as a dedupe rather than throwing.
            if (isEmailCollision(error)) {
              const winner = await tx.registration.findUnique({
                where: { eventId_email: { eventId: event.id, email } },
              });
              if (winner) {
                return {
                  ok: true,
                  deduped: true,
                  status: winner.status as
                    | typeof RegistrationStatus.CONFIRMED
                    | typeof RegistrationStatus.WAITLIST,
                  registration: winner,
                } as const;
              }
            } else {
              continue; // code collision — try another
            }
          }
          throw error;
        }
      }
      throw new Error("registration: exhausted code attempts creating a row");
    },
    { timeout: 20_000, maxWait: 20_000 },
  );
}

// --- cancel ---------------------------------------------------------------

export async function cancelRegistration(code: string): Promise<CancelResult> {
  const normalised = code.trim().toUpperCase();

  return db.$transaction(
    async (tx) => {
      const registration = await tx.registration.findUnique({
        where: { code: normalised },
      });
      if (!registration) return { ok: false, reason: "not_found" } as const;

      if (registration.status === RegistrationStatus.CANCELLED) {
        return { ok: true, promoted: null } as const;
      }

      const wasConfirmed = registration.status === RegistrationStatus.CONFIRMED;

      await tx.registration.update({
        where: { id: registration.id },
        data: { status: RegistrationStatus.CANCELLED, waitlistRank: null },
      });

      // Cancelling a waitlisted delegate frees no seat and promotes no one.
      if (!wasConfirmed) return { ok: true, promoted: null } as const;

      // Confirmed cancellation: promote the waitlist head OR return the seat —
      // never both, or the same seat is issued twice.
      for (;;) {
        const head = await tx.registration.findFirst({
          where: { eventId: registration.eventId, status: RegistrationStatus.WAITLIST },
          orderBy: [{ waitlistRank: "asc" }, { createdAt: "asc" }],
        });

        if (!head) {
          await tx.launchEvent.update({
            where: { id: registration.eventId },
            data: { seatsRemaining: { increment: 1 } },
          });
          return { ok: true, promoted: null } as const;
        }

        const promotedCount = await tx.registration.updateMany({
          where: { id: head.id, status: RegistrationStatus.WAITLIST },
          data: { status: RegistrationStatus.CONFIRMED, waitlistRank: null },
        });
        if (promotedCount.count === 1) {
          const promoted = await tx.registration.findUnique({ where: { id: head.id } });
          return { ok: true, promoted } as const;
        }
        // Someone else promoted this head first — look at the next one.
      }
    },
    { timeout: 20_000, maxWait: 20_000 },
  );
}

// --- check-in -----------------------------------------------------------------

export async function checkIn(code: string, staffUserId: string): Promise<CheckInResult> {
  const normalised = code.trim().toUpperCase();

  // Guard is exactly { code, checkedInAt: null } per CLAUDE.md.
  const updated = await db.registration.updateMany({
    where: { code: normalised, checkedInAt: null },
    data: { checkedInAt: new Date(), checkedInById: staffUserId },
  });

  if (updated.count === 1) {
    const registration = await db.registration.findUnique({ where: { code: normalised } });
    return { ok: true, outcome: "checked_in", registration: registration! };
  }

  const existing = await db.registration.findUnique({ where: { code: normalised } });
  if (!existing) return { ok: false, reason: "not_found" };

  // Already checked in — a neutral outcome, not an error. Two staff phones
  // scan the same delegate and nobody at the door should see a red banner.
  return { ok: true, outcome: "already_checked_in", registration: existing };
}
