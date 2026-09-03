import { notFound } from "next/navigation";
import { getOrderByReference, type OrderWithItems } from "@/lib/services/orders";

// The reference is in the URL path; the accessToken is the query param `t`. The
// reference alone must never grant access, so a missing or wrong token 404s
// exactly like an unknown order — the page cannot tell the difference.
export async function loadOrderOr404(
  reference: string,
  token: string | string[] | undefined,
): Promise<OrderWithItems> {
  const order = await getOrderByReference(reference);
  if (!order || typeof token !== "string" || order.accessToken !== token) {
    notFound();
  }
  return order;
}

export const PAYMENT_STATE_TEXT: Record<string, string> = {
  PENDING: "Waiting for your payment",
  SUBMITTED: "Payment received — being checked",
  CONFIRMED: "Payment confirmed",
  UNDERPAID: "Payment was short of the total — he will be in touch",
  REJECTED: "Payment could not be matched — he will be in touch",
  EXPIRED: "The payment window for this order has passed",
  CANCELLED: "This order was cancelled",
  REFUNDED: "This order was refunded",
};

const TZ = "Africa/Lusaka"; // audience is in Zambia; diaspora is phase two

function dayKey(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** "today at 14:32" / "tomorrow at 09:00" / "Friday 5 September at 14:32". */
export function formatExpiryLusaka(date: Date): string {
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);

  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const target = dayKey(date);

  if (target === dayKey(now)) return `today at ${time}`;
  if (target === dayKey(tomorrow)) return `tomorrow at ${time}`;

  const day = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(date);
  return `${day} at ${time}`;
}
