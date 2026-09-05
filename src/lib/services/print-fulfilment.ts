import { db } from "@/lib/db";
import { FulfilmentState } from "@/generated/prisma/client";
import type { DeliveryZone, Order, OrderItem } from "@/generated/prisma/client";
import { recordOrderEvent } from "@/lib/payments/transitions";

// The print packing queue (docs §6.4, CLAUDE.md build item 12). Companion to
// fulfilment.ts: that file puts a PRINT item INTO the queue on payment
// confirmation (fulfilOrderOnConfirm -> AWAITING_PACKING); this file moves it
// THROUGH the queue.
//
// FulfilmentState lives on OrderItem, not Order — a mixed cart fulfils its
// ebook half instantly and its print half here (docs §2.2).
//
// NO authorization here, matching every other service (books.ts, claim-review.ts
// …): requireAdmin() is the action/route layer's job (CLAUDE.md Rule 5).
//
// The state change is a guarded conditional updateMany with the expected current
// state in the `where`, exactly like transitionPayment() in
// src/lib/payments/transitions.ts. Two taps on a slow connection both read the
// same `from`, both fire the update, but the second matches zero rows —
// "conflict", surfaced to the admin as "That order has already moved on."

/**
 * Legal fulfilment transitions. NOT_STARTED and DELIVERED_DIGITAL list nothing:
 * that is what keeps ebook items (and unconfirmed print items) out of the
 * machine entirely. DELIVERED and RETURNED are terminal.
 */
export const LEGAL_FULFILMENT_TRANSITIONS: Record<
  FulfilmentState,
  readonly FulfilmentState[]
> = {
  NOT_STARTED: [],
  DELIVERED_DIGITAL: [],
  AWAITING_PACKING: ["PACKED"],
  PACKED: ["DISPATCHED"],
  DISPATCHED: ["DELIVERED", "RETURNED"],
  DELIVERED: [],
  RETURNED: [],
};

/** The three tabs on the queue screen, in workflow order. */
export const FULFILMENT_QUEUE_STATES = [
  FulfilmentState.AWAITING_PACKING,
  FulfilmentState.PACKED,
  FulfilmentState.DISPATCHED,
] as const;

export type PrintQueueRow = OrderItem & { order: Order };

/** One tab of the queue: PRINT items in `state`, oldest order first. Ebook
 *  items are excluded by the formatSnapshot filter — they never have a PRINT
 *  fulfilment state anyway, but the filter makes that explicit and cheap. */
export function listPrintQueue(state: FulfilmentState): Promise<PrintQueueRow[]> {
  return db.orderItem.findMany({
    where: { fulfilmentState: state, formatSnapshot: "PRINT" },
    include: { order: true },
    orderBy: { order: { createdAt: "asc" } },
  });
}

export type AdvancePrintItemInput = {
  orderItemId: string;
  to: FulfilmentState;
  actorId: string;
  /** Free text — courier name, waybill, whatever he uses. Only meaningful on
   *  the move to DISPATCHED; written whenever provided. */
  trackingNote?: string | null;
};

export type AdvancePrintItemResult =
  | { ok: true; item: OrderItem }
  | { ok: false; error: "not_found" }
  | { ok: false; error: "illegal_transition" }
  | { ok: false; error: "order_not_confirmed" }
  | { ok: false; error: "conflict" };

/**
 * Move one print OrderItem one step along the machine. Guarded and audited:
 *   - illegal (from -> to) pair, ebook item, or unconfirmed order -> refused,
 *     nothing written.
 *   - concurrent advance won the race -> "conflict", nothing written.
 *   - success -> the item is updated and exactly one OrderEvent is appended
 *     (Rule 6), both in one transaction.
 *
 * An item may only advance while its order is CONFIRMED (docs §2.2) — a print
 * order must never ship for money that was never confirmed. Enforced here, not
 * in the UI.
 */
export async function advancePrintItem(
  input: AdvancePrintItemInput,
): Promise<AdvancePrintItemResult> {
  const trackingNote =
    input.trackingNote === undefined
      ? undefined
      : input.trackingNote?.trim()
        ? input.trackingNote.trim()
        : null;

  return db.$transaction(async (tx) => {
    const item = await tx.orderItem.findUnique({
      where: { id: input.orderItemId },
      include: { order: true },
    });
    if (!item) return { ok: false, error: "not_found" } as const;

    const allowed = LEGAL_FULFILMENT_TRANSITIONS[item.fulfilmentState] ?? [];
    if (!allowed.includes(input.to)) {
      return { ok: false, error: "illegal_transition" } as const;
    }

    if (item.order.paymentState !== "CONFIRMED") {
      return { ok: false, error: "order_not_confirmed" } as const;
    }

    const updated = await tx.orderItem.updateMany({
      where: { id: item.id, fulfilmentState: item.fulfilmentState },
      data: {
        fulfilmentState: input.to,
        ...(input.to === FulfilmentState.DISPATCHED ? { dispatchedAt: new Date() } : {}),
        ...(trackingNote === undefined ? {} : { trackingNote }),
      },
    });
    if (updated.count === 0) {
      return { ok: false, error: "conflict" } as const;
    }

    await recordOrderEvent(tx, {
      orderId: item.orderId,
      type: `fulfilment.${input.to.toLowerCase()}`,
      fromState: item.fulfilmentState,
      toState: input.to,
      actor: { type: "ADMIN", id: input.actorId },
      metadata: { orderItemId: item.id },
    });

    return {
      ok: true,
      item: await tx.orderItem.findUniqueOrThrow({ where: { id: item.id } }),
    } as const;
  });
}

export type OrderForSlip = Order & { items: OrderItem[] };

/** Order + its PRINT items for the packing slip. Null -> the page 404s. */
export function getOrderForSlip(reference: string): Promise<OrderForSlip | null> {
  return db.order.findUnique({
    where: { reference: reference.trim().toUpperCase() },
    include: { items: { where: { formatSnapshot: "PRINT" } } },
  });
}

/**
 * Admin-facing one-line destination for a print item. PICKUP and
 * REST_OF_ZAMBIA carry no address — both need Yangeni to phone the buyer, so
 * say that rather than show an empty field. For those two, "dispatched" means
 * "handed over", not "with a courier".
 */
export function printDestinationText(
  zone: DeliveryZone | null,
  address: string | null,
): string {
  switch (zone) {
    case "LUSAKA":
      return address ?? "Lusaka (no address on file — call the buyer)";
    case "PICKUP":
      return "Collect in person — call the buyer to arrange";
    case "REST_OF_ZAMBIA":
      return "Rest of Zambia — buyer arranges courier, call to coordinate";
    default:
      return address ?? "No delivery details";
  }
}
