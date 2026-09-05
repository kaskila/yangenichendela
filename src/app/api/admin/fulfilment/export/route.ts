import { requireAdmin } from "@/lib/auth/guards";
import { toCsv } from "@/lib/csv";
import { FulfilmentState } from "@/generated/prisma/client";
import {
  FULFILMENT_QUEUE_STATES,
  listPrintQueue,
  printDestinationText,
} from "@/lib/services/print-fulfilment";

// API route (CLAUDE.md architecture: "API routes only for webhooks and
// downloads"). Yangeni prints this and works from paper. requireAdmin() first,
// same as every admin surface (Rule 5) — the (admin) route group layout does
// not wrap /api.

const HEADERS = [
  "Reference",
  "Name",
  "Phone",
  "Book",
  "Quantity",
  "Zone",
  "Address",
  "State",
  "Order date",
] as const;

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function GET(request: Request): Promise<Response> {
  await requireAdmin();

  const raw = new URL(request.url).searchParams.get("state") ?? "";
  const state: FulfilmentState = (FULFILMENT_QUEUE_STATES as readonly string[]).includes(raw)
    ? (raw as FulfilmentState)
    : FulfilmentState.AWAITING_PACKING;

  const rows = await listPrintQueue(state);

  const body = toCsv(
    HEADERS,
    rows.map((row) => [
      row.order.reference,
      row.order.customerName,
      row.order.customerPhone,
      row.titleSnapshot,
      String(row.quantity),
      row.order.deliveryZone ?? "",
      printDestinationText(row.order.deliveryZone, row.order.deliveryAddress),
      row.fulfilmentState,
      isoDate(row.order.createdAt),
    ]),
  );

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="fulfilment-${state.toLowerCase()}-${isoDate(new Date())}.csv"`,
      "cache-control": "no-store",
    },
  });
}
