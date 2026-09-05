import Link from "next/link";
import { requireAdmin } from "@/lib/auth/guards";
import { buildWhatsAppLink } from "@/lib/whatsapp";
import {
  FULFILMENT_QUEUE_STATES,
  listPrintQueue,
  printDestinationText,
  type PrintQueueRow,
} from "@/lib/services/print-fulfilment";
import type { DeliveryZone, FulfilmentState } from "@/generated/prisma/client";
import { QueueTabs } from "./queue-tabs";
import { RowActions, type AdvanceStep } from "./row-actions";

// Age badges are live, so this can't be statically cached.
export const dynamic = "force-dynamic";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const dateFormatter = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" });

// Date.now() called directly in a component body trips react-hooks/purity — the
// impure read lives here and the timestamp is passed down as a prop (same
// pattern as admin/orders/page.tsx).
function currentTimeMs(): number {
  return Date.now();
}

function isQueueState(value: string): value is (typeof FULFILMENT_QUEUE_STATES)[number] {
  return (FULFILMENT_QUEUE_STATES as readonly string[]).includes(value);
}

function AgeBadge({ since, now }: { since: Date; now: number }) {
  const ageMs = now - since.getTime();
  const days = ageMs / DAY_MS;
  const cls =
    days >= 5
      ? "bg-danger-bg text-danger"
      : days >= 2
        ? "bg-warning-bg text-warning"
        : "bg-admin-bg text-admin-ink-muted";
  const label =
    ageMs < DAY_MS
      ? `${Math.max(1, Math.floor(ageMs / HOUR_MS))}h waiting`
      : `${Math.floor(days)}d waiting`;
  return (
    <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>
  );
}

function dispatchLabel(zone: DeliveryZone | null): string {
  if (zone === "PICKUP") return "Mark collected";
  if (zone === "REST_OF_ZAMBIA") return "Mark handed over";
  return "Mark dispatched";
}

function stepsFor(state: FulfilmentState, zone: DeliveryZone | null): AdvanceStep[] {
  if (state === "AWAITING_PACKING") {
    return [{ to: "PACKED", label: "Mark packed", tone: "primary" }];
  }
  if (state === "PACKED") {
    return [{ to: "DISPATCHED", label: dispatchLabel(zone), tone: "primary" }];
  }
  return [
    { to: "DELIVERED", label: "Mark delivered", tone: "primary" },
    { to: "RETURNED", label: "Delivery failed", tone: "danger" },
  ];
}

function waMessage(reference: string, state: FulfilmentState, zone: DeliveryZone | null): string {
  const phrase =
    state === "AWAITING_PACKING" || state === "PACKED"
      ? "your book is being packed"
      : state === "DISPATCHED"
        ? zone === "PICKUP"
          ? "your book is ready to collect"
          : "your book is on its way"
        : "your order";
  return `Hi, about your order ${reference} — ${phrase}.\n\nYangeni Chendela`;
}

function QueueCard({ row, now }: { row: PrintQueueRow; now: number }) {
  const { order } = row;
  const since = order.paymentConfirmedAt ?? order.createdAt;
  const steps = stepsFor(row.fulfilmentState, order.deliveryZone);

  return (
    <li className="rounded border border-admin-border bg-admin-surface p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link
            href={`/admin/fulfilment/${order.reference}`}
            className="truncate font-medium tabular underline"
          >
            {order.reference}
          </Link>
          <p className="truncate text-sm text-admin-ink-muted">
            {order.customerName} · <span className="tabular">{order.customerPhone}</span>
          </p>
        </div>
        <AgeBadge since={since} now={now} />
      </div>

      <p className="mt-2 text-sm">
        {row.quantity}× {row.titleSnapshot}
      </p>
      <p className="mt-1 text-sm text-admin-ink-muted">
        {printDestinationText(order.deliveryZone, order.deliveryAddress)}
      </p>

      {row.fulfilmentState === "DISPATCHED" ? (
        <p className="mt-1 text-xs text-admin-ink-muted">
          {row.dispatchedAt ? `Sent ${dateFormatter.format(row.dispatchedAt)}` : "Sent"}
          {row.trackingNote ? ` · ${row.trackingNote}` : ""}
        </p>
      ) : null}

      <RowActions
        orderItemId={row.id}
        steps={steps}
        showTrackingNote={row.fulfilmentState === "PACKED"}
        waHref={buildWhatsAppLink(
          order.customerPhone,
          waMessage(order.reference, row.fulfilmentState, order.deliveryZone),
        )}
      />
    </li>
  );
}

export default async function FulfilmentQueuePage({
  searchParams,
}: PageProps<"/admin/fulfilment">) {
  await requireAdmin();

  const sp = await searchParams;
  const raw = typeof sp.state === "string" ? sp.state : "";
  const state: FulfilmentState = isQueueState(raw) ? raw : "AWAITING_PACKING";

  const rows = await listPrintQueue(state);
  const now = currentTimeMs();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">Print fulfilment</h1>
        <a
          href={`/api/admin/fulfilment/export?state=${state}`}
          className="shrink-0 text-sm underline"
        >
          Download CSV
        </a>
      </div>

      <QueueTabs active={state} />

      {rows.length === 0 ? (
        <p className="text-sm text-admin-ink-muted">Nothing here right now.</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <QueueCard key={row.id} row={row} now={now} />
          ))}
        </ul>
      )}
    </div>
  );
}
