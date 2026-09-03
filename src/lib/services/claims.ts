import { z } from "zod";
import { db } from "@/lib/db";
import { MobileNetwork, Prisma } from "@/generated/prisma/client";
import type { PaymentClaim } from "@/generated/prisma/client";
import { isUniqueViolationOn } from "@/lib/prisma-errors";
import {
  PaymentTransitionError,
  recordOrderEvent,
  transitionPayment,
} from "@/lib/payments/transitions";
import { getOrderByReference } from "@/lib/services/orders";

// Buyer claim submission. The system never asserts money arrived — everything
// here is an unverified *claim* (docs/manual-mobile-money-flow.md §1). A receipt
// image is NOT verification: it can be edited, or be a genuine receipt for a
// payment to someone else. The real control is the admin typing the amount they
// can see in the mobile money account before confirming — that gate still stands.
//
// No authorization here: the checkout/pay flow is deliberately public. submitClaim
// validates the order's accessToken itself.
//
// NO transaction-reference format regex (CLAUDE.md / §5.5): the real Airtel, MTN
// and Zamtel receipt formats have not been seen. A false rejection at this moment
// costs a sale; junk is caught by the admin. Validate length only.

const NORM_MIN = 6;
const NORM_MAX = 30;
const CLAIMS_PER_ORDER = 3;
const CLAIMS_PER_EMAIL_HOUR = 5;
const CLAIMS_PER_IP_HOUR = 10;
const HOUR_MS = 60 * 60 * 1000;

// States from which PaymentState -> SUBMITTED is legal (see
// LEGAL_PAYMENT_TRANSITIONS in src/lib/payments/transitions.ts).
const CLAIMABLE_STATES = new Set(["PENDING", "REJECTED", "EXPIRED"]);

/** §5.2 verbatim: uppercase, drop everything non-alphanumeric. Without this the
 *  @@unique([network, transactionIdNorm]) duplicate defence is useless. */
export function normaliseTransactionId(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export type SubmitClaimInput = {
  orderReference: string;
  accessToken: string;
  network: string;
  senderPhone: string;
  transactionId: string;
  receiptImageUrl?: string | null;
  ip?: string | null;
};

export type FieldIssues = Record<string, string>;

export type SubmitClaimResult =
  | { ok: true; claim: PaymentClaim }
  | { ok: false; error: "invalid_input"; issues: FieldIssues }
  | { ok: false; error: "order_not_found" }
  | { ok: false; error: "not_awaiting_payment" }
  | { ok: false; error: "duplicate_reference" }
  | { ok: false; error: "rate_limited"; scope: "order" | "email" | "ip" };

const inputSchema = z.object({
  orderReference: z.string().trim().min(1, "Missing order reference."),
  accessToken: z.string().trim().min(1, "Missing order token."),
  network: z.enum([MobileNetwork.AIRTEL, MobileNetwork.MTN, MobileNetwork.ZAMTEL]),
  senderPhone: z
    .string()
    .trim()
    .min(6, "Enter the phone number you paid from.")
    .max(20, "That phone number is too long."),
  transactionId: z.string().trim().min(1, "Enter the transaction reference."),
  receiptImageUrl: z.string().trim().url().nullish(),
  ip: z.string().trim().max(64).nullish(),
});

function flatten(error: z.ZodError): FieldIssues {
  const issues: FieldIssues = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".") || "form";
    if (!(key in issues)) issues[key] = issue.message;
  }
  return issues;
}

async function writeRateLimitFlag(data: {
  orderId: string;
  email: string | null;
  ip: string | null;
  scope: "order" | "email" | "ip";
  network: string;
}): Promise<void> {
  await db.flag.create({
    data: {
      type: "ratelimit.hit",
      severity: "warn",
      orderId: data.orderId,
      email: data.email,
      ipAddress: data.ip,
      detail: { scope: data.scope, network: data.network } satisfies Prisma.InputJsonObject,
    },
  });
}

export async function submitClaim(
  input: SubmitClaimInput,
): Promise<SubmitClaimResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "invalid_input", issues: flatten(parsed.error) };
  }
  const v = parsed.data;

  const norm = normaliseTransactionId(v.transactionId);
  if (norm.length < NORM_MIN || norm.length > NORM_MAX) {
    return {
      ok: false,
      error: "invalid_input",
      issues: {
        transactionId: `Enter the whole transaction ID from your SMS — it should be ${NORM_MIN}–${NORM_MAX} characters.`,
      },
    };
  }

  const order = await getOrderByReference(v.orderReference);
  if (!order || order.accessToken !== v.accessToken) {
    return { ok: false, error: "order_not_found" };
  }

  if (!CLAIMABLE_STATES.has(order.paymentState)) {
    return { ok: false, error: "not_awaiting_payment" };
  }

  // --- rate limits (docs §5.5). On breach: a Flag, then refuse. ---
  const since = new Date(Date.now() - HOUR_MS);

  const flagArgs = (scope: "order" | "email" | "ip") => ({
    orderId: order.id,
    email: order.customerEmail,
    ip: v.ip ?? null,
    scope,
    network: v.network,
  });

  if ((await db.paymentClaim.count({ where: { orderId: order.id } })) >= CLAIMS_PER_ORDER) {
    await writeRateLimitFlag(flagArgs("order"));
    return { ok: false, error: "rate_limited", scope: "order" };
  }

  if (
    (await db.paymentClaim.count({
      where: {
        order: { customerEmail: order.customerEmail },
        createdAt: { gte: since },
      },
    })) >= CLAIMS_PER_EMAIL_HOUR
  ) {
    await writeRateLimitFlag(flagArgs("email"));
    return { ok: false, error: "rate_limited", scope: "email" };
  }

  if (
    v.ip &&
    (await db.paymentClaim.count({
      where: { ipAddress: v.ip, createdAt: { gte: since } },
    })) >= CLAIMS_PER_IP_HOUR
  ) {
    await writeRateLimitFlag(flagArgs("ip"));
    return { ok: false, error: "rate_limited", scope: "ip" };
  }

  // --- the write: claim first, then the guarded transition. The transition is
  //     also the concurrency control — two simultaneous submissions both create
  //     their claim, but only one can move PENDING -> SUBMITTED; the loser's
  //     transaction (and its claim) rolls back. ---
  try {
    const claim = await db.$transaction(async (tx) => {
      const created = await tx.paymentClaim.create({
        data: {
          orderId: order.id,
          network: v.network,
          senderPhone: v.senderPhone,
          transactionId: v.transactionId,
          transactionIdNorm: norm,
          receiptImageUrl: v.receiptImageUrl ?? null,
          ipAddress: v.ip ?? null,
        },
      });
      await transitionPayment(tx, order.id, "SUBMITTED", { type: "BUYER" }, {
        claimId: created.id,
        network: v.network,
        transactionIdNorm: norm,
      });
      return created;
    });
    return { ok: true, claim };
  } catch (error) {
    if (isUniqueViolationOn(error, "transactionidnorm")) {
      await recordDuplicateAttempt({
        orderId: order.id,
        email: order.customerEmail,
        ip: v.ip ?? null,
        network: v.network,
        transactionId: v.transactionId,
        transactionIdNorm: norm,
      });
      return { ok: false, error: "duplicate_reference" };
    }
    if (error instanceof PaymentTransitionError) {
      // A concurrent claim won the transition. The pre-check passed; the guard
      // did not. Nothing was persisted.
      return { ok: false, error: "not_awaiting_payment" };
    }
    throw error;
  }
}

async function recordDuplicateAttempt(d: {
  orderId: string;
  email: string;
  ip: string | null;
  network: MobileNetwork;
  transactionId: string;
  transactionIdNorm: string;
}): Promise<void> {
  const prior = await db.paymentClaim.findFirst({
    where: { network: d.network, transactionIdNorm: d.transactionIdNorm },
    select: { orderId: true },
  });
  const relatedOrderId =
    prior && prior.orderId !== d.orderId ? prior.orderId : null;

  await db.$transaction(async (tx) => {
    await tx.flag.create({
      data: {
        type: "claim.duplicate_attempt",
        severity: "warn",
        orderId: d.orderId,
        relatedOrderId,
        email: d.email,
        ipAddress: d.ip,
        detail: {
          network: d.network,
          transactionId: d.transactionId,
        } satisfies Prisma.InputJsonObject,
      },
    });
    await recordOrderEvent(tx, {
      orderId: d.orderId,
      type: "claim.duplicate_attempt",
      actor: { type: "BUYER" },
      metadata: {
        network: d.network,
        transactionId: d.transactionId,
        ...(relatedOrderId ? { relatedOrderId } : {}),
      },
    });
  });
}
