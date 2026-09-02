import { Prisma, PaymentState } from "@/generated/prisma/client";
import type { ActorType, Order, OrderEvent } from "@/generated/prisma/client";

// The ONLY function in the codebase permitted to write Order.paymentState
// (CLAUDE.md Absolute Rule 3). Every route, action, script and cron calls this.
//
// Mechanism (Absolute Rule 4): a guarded conditional update carries the expected
// current state in its `where`. Two admins confirming the same order at once
// both read `SUBMITTED`, both fire the update — but the second one matches zero
// rows and throws. The guard IS the concurrency control; there is no
// read-then-decide.
//
// Transaction discipline (Rule 4, and §5.7 of docs/manual-mobile-money-flow.md):
//   - transitionPayment TAKES a Prisma transaction client; it never opens its
//     own. Callers compose it with their other writes so the state change and
//     its OrderEvent commit together or not at all.
//   - Side effects (email, download tokens, Notification rows) are the CALLER's
//     job and happen AFTER the transaction commits. A rolled-back transaction
//     that has already sent an email cannot be undone.
//   - The two writes here — order.updateMany and orderEvent.create — touch no
//     unique constraint, so no P2002 is reachable. There is deliberately no
//     broad catch: it would only mask real faults.

export class PaymentTransitionError extends Error {}

/** The (from -> to) pair is not in the legal table (includes same-state). */
export class IllegalTransitionError extends PaymentTransitionError {
  constructor(from: PaymentState | string, to: PaymentState | string) {
    super(`Illegal payment transition: ${from} -> ${to}`);
    this.name = "IllegalTransitionError";
  }
}

/** No order with the given id. */
export class OrderNotFoundError extends PaymentTransitionError {
  constructor(orderId: string) {
    super(`No order ${orderId}`);
    this.name = "OrderNotFoundError";
  }
}

/**
 * The guarded update matched zero rows: the order left `from` between our read
 * and our write — a concurrent transition won. Never retried silently.
 */
export class ConflictError extends PaymentTransitionError {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

export type EventActor = { type: ActorType; id?: string | null };

/**
 * Legal transitions (CLAUDE.md Rule 3 / spec §2.1). Anything not listed — a
 * same-state move included, since no state lists itself — is an
 * IllegalTransitionError.
 */
export const LEGAL_PAYMENT_TRANSITIONS: Record<
  PaymentState,
  readonly PaymentState[]
> = {
  PENDING: ["SUBMITTED", "EXPIRED", "CANCELLED"],
  SUBMITTED: ["CONFIRMED", "REJECTED", "UNDERPAID", "EXPIRED"],
  REJECTED: ["SUBMITTED"],
  UNDERPAID: ["CONFIRMED", "REFUNDED"],
  CONFIRMED: ["REFUNDED"],
  EXPIRED: ["SUBMITTED"],
  CANCELLED: [],
  REFUNDED: [],
};

type TxClient = Prisma.TransactionClient;

/**
 * Append an OrderEvent (CLAUDE.md Rule 6 — append-only, never updated or
 * deleted). Used by transitionPayment for state changes, and exported for the
 * non-transition mutations that still need an audit row: claim submitted, email
 * sent, download issued.
 */
export function recordOrderEvent(
  tx: TxClient,
  params: {
    orderId: string;
    /** e.g. "payment.confirmed", "claim.submitted", "email.sent". */
    type: string;
    fromState?: string | null;
    toState?: string | null;
    actor: EventActor;
    metadata?: Prisma.InputJsonValue;
  },
): Promise<OrderEvent> {
  return tx.orderEvent.create({
    data: {
      orderId: params.orderId,
      type: params.type,
      fromState: params.fromState ?? null,
      toState: params.toState ?? null,
      actorType: params.actor.type,
      actorId: params.actor.id ?? null,
      ...(params.metadata === undefined ? {} : { metadata: params.metadata }),
    },
  });
}

/**
 * Move an order's paymentState to `to`, writing the matching OrderEvent in the
 * same transaction. Throws — never returns a failure — because every failure
 * here is a fault:
 *   - OrderNotFoundError    unknown orderId
 *   - IllegalTransitionError (from -> to) not in LEGAL_PAYMENT_TRANSITIONS
 *   - ConflictError          the order moved underneath us (concurrent write)
 *
 * On success returns the updated order, re-read inside the transaction.
 * `paymentConfirmedAt` is set when and only when `to === CONFIRMED`.
 */
export async function transitionPayment(
  tx: TxClient,
  orderId: string,
  to: PaymentState,
  actor: EventActor,
  metadata?: Prisma.InputJsonValue,
): Promise<Order> {
  const order = await tx.order.findUnique({ where: { id: orderId } });
  if (!order) throw new OrderNotFoundError(orderId);

  const from = order.paymentState;
  const allowed = LEGAL_PAYMENT_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    // Covers same-state moves and any `to` not in the enum. Nothing has been
    // written at this point.
    throw new IllegalTransitionError(from, to);
  }

  // Guarded conditional update (Rule 4). The expected `from` is in the `where`,
  // so a concurrent transition that already moved the order matches 0 rows.
  const updated = await tx.order.updateMany({
    where: { id: orderId, paymentState: from },
    data: {
      paymentState: to,
      ...(to === PaymentState.CONFIRMED ? { paymentConfirmedAt: new Date() } : {}),
    },
  });

  if (updated.count === 0) {
    throw new ConflictError(
      `Order ${orderId} was no longer in ${from} when the ${to} transition ran`,
    );
  }

  await recordOrderEvent(tx, {
    orderId,
    type: `payment.${to.toLowerCase()}`,
    fromState: from,
    toState: to,
    actor,
    metadata,
  });

  return tx.order.findUniqueOrThrow({ where: { id: orderId } });
}
