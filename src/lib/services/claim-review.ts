import { db } from "@/lib/db";
import { PaymentState } from "@/generated/prisma/client";
import type {
  MobileNetwork,
  Order,
  OrderEvent,
  PaymentClaim,
  Prisma,
} from "@/generated/prisma/client";
import { parseKwachaToMinor } from "@/lib/money";
import { recordOrderEvent, transitionPayment } from "@/lib/payments/transitions";
import { REJECTION_REASONS } from "@/lib/rejection-reasons";
import type { RejectionReasonCode } from "@/lib/rejection-reasons";
import { fulfilOrderOnConfirm } from "@/lib/services/fulfilment";
import type { OrderWithItems } from "@/lib/services/orders";

export { REJECTION_REASONS, type RejectionReasonCode } from "@/lib/rejection-reasons";

// Admin-side claim review: the queue, the single-order review screen, and the
// three decisions (confirm/mark-underpaid, reject, reopen). Companion to
// src/lib/services/claims.ts (buyer-facing submission, left untouched) — this
// file composes transitionPayment() rather than reimplementing any state
// change, per CLAUDE.md Absolute Rule 3.
//
// NO authorization here, matching books.ts / store.ts / claims.ts: requireAdmin()
// is the server action layer's job (CLAUDE.md Rule 5), so these functions stay
// directly testable.
//
// The non-negotiable this whole file exists to protect (docs §5.5): the admin
// types the amount they observed, and the SERVER decides whether that's a
// match, a shortfall or an overpayment — never the client's label.

export type FieldIssues = Record<string, string>;

const REJECTION_REASON_CODES = new Set(REJECTION_REASONS.map((r) => r.code));

const REOPEN_WINDOW_MS = 48 * 60 * 60 * 1000; // generous by design, same as order creation

// --- reads -------------------------------------------------------------

export type OrderForReview = OrderWithItems & {
  claims: PaymentClaim[];
  events: OrderEvent[];
};

/** Everything the review screen needs, one query. Null for an unknown
 *  reference (page 404s). Claims include rejected ones (history); events are
 *  the full append-only timeline. */
export function getOrderForReview(reference: string): Promise<OrderForReview | null> {
  return db.order.findUnique({
    where: { reference: reference.trim().toUpperCase() },
    include: {
      items: true,
      claims: { orderBy: { createdAt: "desc" } },
      events: { orderBy: { createdAt: "asc" } },
    },
  });
}

export type ClaimQueueRow = PaymentClaim & { order: Order };

export type QueueFilters = {
  network?: MobileNetwork | null;
  search?: string | null;
};

function searchClause(search: string | null | undefined): Prisma.PaymentClaimWhereInput[] {
  const q = search?.trim();
  if (!q) return [];
  const insensitive = { contains: q, mode: "insensitive" as const };
  return [
    { transactionId: insensitive },
    { order: { reference: insensitive } },
    { order: { customerName: insensitive } },
    { order: { customerEmail: insensitive } },
    { order: { customerPhone: insensitive } },
  ];
}

/** The default queue view (spec 6.1): claims awaiting review, oldest first. */
export function listPendingClaims(filters: QueueFilters = {}): Promise<ClaimQueueRow[]> {
  const or = searchClause(filters.search);
  return db.paymentClaim.findMany({
    where: {
      status: "PENDING_REVIEW",
      ...(filters.network ? { network: filters.network } : {}),
      ...(or.length ? { OR: or } : {}),
    },
    include: { order: true },
    orderBy: { createdAt: "asc" },
  });
}

/** The "find a confirmed / rejected order" tabs (spec 6.1). Order-centric,
 *  not claim-centric: claim.status alone can't distinguish CONFIRMED from
 *  UNDERPAID (both leave the claim ACCEPTED — see decideClaim). Each row
 *  carries its most recent claim for display. */
export async function listOrdersByPaymentState(
  state: PaymentState,
  filters: QueueFilters = {},
): Promise<(Order & { claims: PaymentClaim[] })[]> {
  const q = filters.search?.trim();
  const insensitive = { contains: q ?? "", mode: "insensitive" as const };

  return db.order.findMany({
    where: {
      paymentState: state,
      ...(q
        ? {
            OR: [
              { reference: insensitive },
              { customerName: insensitive },
              { customerEmail: insensitive },
              { customerPhone: insensitive },
              { claims: { some: { transactionId: insensitive } } },
            ],
          }
        : {}),
      ...(filters.network ? { claims: { some: { network: filters.network } } } : {}),
    },
    include: {
      claims: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: { updatedAt: "desc" },
  });
}

// --- decide (confirm / mark underpaid) ----------------------------------

export type DecideClaimInput = {
  claimId: string;
  /** Raw kwacha as typed by the admin — never prefilled, never defaulted. */
  matchedAmountKwacha: string;
  reviewNote?: string | null;
  actorId: string;
};

export type DecideClaimResult =
  | { ok: true; order: Order; outcome: "CONFIRMED" | "UNDERPAID" }
  | { ok: false; error: "invalid_input"; issues: FieldIssues }
  | { ok: false; error: "already_reviewed" }
  | { ok: false; error: "not_found" };

/**
 * The Confirm / Mark-underpaid action, unified into one function: the server
 * — never the client's button label — decides which bucket the typed amount
 * falls into, by comparing against the order's stored totalMinor.
 *
 * ConflictError / IllegalTransitionError (both PaymentTransitionError) are
 * left to propagate uncaught — a genuine fault (someone else won the race,
 * docs §5.7), for the action layer to catch as "someone already confirmed
 * this order." If transitionPayment throws, the whole transaction rolls back
 * before the claim row is ever touched.
 */
export async function decideClaim(input: DecideClaimInput): Promise<DecideClaimResult> {
  const parsedAmount = parseKwachaToMinor(input.matchedAmountKwacha);
  if (!parsedAmount.ok) {
    return {
      ok: false,
      error: "invalid_input",
      issues: { matchedAmountKwacha: parsedAmount.error },
    };
  }
  const matchedAmountMinor = parsedAmount.minor;

  const claim = await db.paymentClaim.findUnique({
    where: { id: input.claimId },
    include: { order: true },
  });
  if (!claim) return { ok: false, error: "not_found" };
  if (claim.status !== "PENDING_REVIEW") {
    return { ok: false, error: "already_reviewed" };
  }

  const note = input.reviewNote?.trim() || null;
  const isOverpayment = matchedAmountMinor > claim.order.totalMinor;
  if (isOverpayment && !note) {
    return {
      ok: false,
      error: "invalid_input",
      issues: {
        reviewNote:
          "This is more than the order total — add a note explaining what will happen to the difference before confirming.",
      },
    };
  }

  const outcome: "CONFIRMED" | "UNDERPAID" =
    matchedAmountMinor < claim.order.totalMinor ? "UNDERPAID" : "CONFIRMED";

  const order = await db.$transaction(async (tx) => {
    // Guarded state change first (Rule 3/4). Throws ConflictError or
    // IllegalTransitionError if the order moved underneath us — nothing below
    // runs, and the transaction rolls back.
    const updated = await transitionPayment(tx, claim.orderId, outcome, {
      type: "ADMIN",
      id: input.actorId,
    }, { claimId: claim.id, matchedAmountMinor });

    // Side effect on the claim row, after the guarded change succeeded, same
    // transaction. ACCEPTED covers both outcomes — the reference itself was
    // legitimately matched in both cases; paymentState is what distinguishes
    // "fully paid" from "short."
    await tx.paymentClaim.update({
      where: { id: claim.id },
      data: {
        status: "ACCEPTED",
        reviewedById: input.actorId,
        reviewedAt: new Date(),
        matchedAmountMinor,
        reviewNote: note,
      },
    });

    return updated;
  });

  // Side effect, strictly after the transaction above has committed (Rule 4):
  // a rolled-back transaction that had already issued a download token could
  // not be undone. Email is still a later slice.
  if (outcome === "CONFIRMED") {
    await fulfilOrderOnConfirm(order.id);
  }

  return { ok: true, order, outcome };
}

// --- reject --------------------------------------------------------------

export type RejectClaimInput = {
  claimId: string;
  reasonCode: string;
  note?: string | null;
  actorId: string;
};

export type RejectClaimResult =
  | { ok: true; order: Order }
  | { ok: false; error: "invalid_input"; issues: FieldIssues }
  | { ok: false; error: "already_reviewed" }
  | { ok: false; error: "not_found" };

export async function rejectClaim(input: RejectClaimInput): Promise<RejectClaimResult> {
  if (!REJECTION_REASON_CODES.has(input.reasonCode as RejectionReasonCode)) {
    return {
      ok: false,
      error: "invalid_input",
      issues: { reasonCode: "Choose a reason from the list." },
    };
  }

  const claim = await db.paymentClaim.findUnique({
    where: { id: input.claimId },
    include: { order: true },
  });
  if (!claim) return { ok: false, error: "not_found" };
  if (claim.status !== "PENDING_REVIEW") {
    return { ok: false, error: "already_reviewed" };
  }

  const order = await db.$transaction(async (tx) => {
    const updated = await transitionPayment(tx, claim.orderId, "REJECTED", {
      type: "ADMIN",
      id: input.actorId,
    }, { claimId: claim.id, reasonCode: input.reasonCode });

    await tx.paymentClaim.update({
      where: { id: claim.id },
      data: {
        status: "REJECTED",
        reviewedById: input.actorId,
        reviewedAt: new Date(),
        rejectionReason: input.reasonCode,
        reviewNote: input.note?.trim() || null,
      },
    });

    return updated;
  });

  // Next slice: rejection email (with the reason shown verbatim) goes here.
  return { ok: true, order };
}

// --- reopen ---------------------------------------------------------------

export type ReopenOrderInput = { orderId: string; actorId: string };

export type ReopenOrderResult =
  | { ok: true; paymentExpiresAt: Date }
  | { ok: false; error: "not_expired" };

/**
 * NOT a transitionPayment call — paymentState is untouched. The buyer-facing
 * pay page already treats EXPIRED as claimable and submitClaim() already
 * legally transitions EXPIRED -> SUBMITTED (see CLAIMABLE_STATES in
 * claims.ts); the actual gap this closes is that paymentExpiresAt sits in the
 * past, which makes the pay page's "held until <time>" copy false. This just
 * extends the window so that promise stays true, guarded the same way as
 * transitionPayment's own conditional update.
 */
export async function reopenOrder(input: ReopenOrderInput): Promise<ReopenOrderResult> {
  const newExpiresAt = new Date(Date.now() + REOPEN_WINDOW_MS);

  return db.$transaction(async (tx) => {
    const updated = await tx.order.updateMany({
      where: { id: input.orderId, paymentState: PaymentState.EXPIRED },
      data: { paymentExpiresAt: newExpiresAt },
    });
    if (updated.count === 0) {
      return { ok: false, error: "not_expired" } as const;
    }

    await recordOrderEvent(tx, {
      orderId: input.orderId,
      type: "order.reopened",
      actor: { type: "ADMIN", id: input.actorId },
      metadata: { newExpiresAt: newExpiresAt.toISOString() },
    });

    return { ok: true, paymentExpiresAt: newExpiresAt } as const;
  });
}
