import { z } from "zod";
import { db } from "@/lib/db";

// Newsletter capture for the public pages (CLAUDE.md job 3 — grow the list).
//
// No authorization: the homepage form that calls this is deliberately public.
//
// There is no transactional email yet (build order item 10), so this cannot
// send a double opt-in confirmation. New addresses are stored as PENDING with
// their capture source; the confirm + unsubscribe flow lands with item 10. The
// homepage copy is worded accordingly ("we've got your address", not "you're
// subscribed").

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(
    z
      .email({ message: "That email didn't look right — try again." })
      .max(200, "That email is too long."),
  );

export type SubscribeResult =
  | { ok: true }
  | { ok: false; error: "invalid_email" };

/**
 * Idempotent by email: a repeat submission succeeds without changing the
 * existing row, so the form never reveals whether an address is already on the
 * list. A previously UNSUBSCRIBED address is left as-is — opting back in needs
 * the item-10 email flow.
 */
export async function subscribeToNewsletter(input: {
  email: string;
  source: string;
}): Promise<SubscribeResult> {
  const parsed = emailSchema.safeParse(input.email);
  if (!parsed.success) return { ok: false, error: "invalid_email" };

  await db.newsletterSubscriber.upsert({
    where: { email: parsed.data },
    create: { email: parsed.data, source: input.source },
    update: {},
  });
  return { ok: true };
}
