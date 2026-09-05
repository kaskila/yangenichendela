import type { Metadata } from "next";
import Link from "next/link";
import { formatMinor } from "@/lib/money";
import { getDownloadInfoForItem } from "@/lib/services/fulfilment";
import { formatExpiryLusaka, loadOrderOr404, PAYMENT_STATE_TEXT } from "./order-access";
import { DownloadSection } from "./download-section";

export const dynamic = "force-dynamic";

// Private per-order URL — never index it.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  title: "Your order — Yangeni Chendela",
};

const FORMAT_LABEL: Record<string, string> = { PRINT: "Print", EBOOK: "Ebook" };
const ZONE_LABEL: Record<string, string> = {
  LUSAKA: "Delivery in Lusaka",
  REST_OF_ZAMBIA: "Elsewhere in Zambia (you arrange courier)",
  PICKUP: "Collect in person",
};

export default async function OrderStatusPage({
  params,
  searchParams,
}: PageProps<"/orders/[reference]">) {
  const { reference } = await params;
  const sp = await searchParams;
  const token = sp.t;
  const order = await loadOrderOr404(reference, token);
  const t = token as string;

  const justSubmitted = sp.submitted === "1" && order.paymentState === "SUBMITTED";

  const ebookItems = order.items.filter((item) => item.formatSnapshot === "EBOOK");
  const downloads =
    order.paymentState === "CONFIRMED"
      ? await Promise.all(
          ebookItems.map(async (item) => ({
            item,
            info: await getDownloadInfoForItem(item.id),
          })),
        )
      : [];

  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <h1 className="text-title font-semibold text-ink">
        Order {order.reference}
      </h1>

      {justSubmitted ? (
        <p
          role="status"
          className="mt-3 rounded border border-border bg-surface-raised px-3 py-2 text-sm text-ink"
        >
          Thanks — we&rsquo;ve got your payment reference.
        </p>
      ) : null}

      <p className="mt-3 rounded border border-border bg-surface-raised px-3 py-2 text-sm font-medium text-ink">
        {PAYMENT_STATE_TEXT[order.paymentState] ?? "Being handled"}
      </p>

      {order.paymentState === "SUBMITTED" ? (
        <p className="mt-2 text-sm text-ink-muted">
          Yangeni checks payments by hand — usually within a day. You&rsquo;ll
          hear once it&rsquo;s confirmed; it isn&rsquo;t instant.
        </p>
      ) : null}

      {order.paymentState === "PENDING" || order.paymentState === "REJECTED" ? (
        <Link
          href={`/orders/${order.reference}/pay?t=${encodeURIComponent(t)}`}
          className="mt-3 inline-block rounded bg-surface-inverse px-4 py-2 text-sm font-medium text-ink-inverse!"
        >
          {order.paymentState === "REJECTED" ? "Send your reference again" : "How to pay"}
        </Link>
      ) : null}

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-ink">What you ordered</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {order.items.map((item) => (
            <li key={item.id} className="flex justify-between gap-4">
              <span className="text-ink">
                {item.titleSnapshot} ·{" "}
                {FORMAT_LABEL[item.formatSnapshot] ?? item.formatSnapshot}
                {item.quantity > 1 ? ` × ${item.quantity}` : ""}
              </span>
              <span className="tabular text-ink">
                {formatMinor(item.unitPriceMinor * item.quantity, item.currency)}
              </span>
            </li>
          ))}
        </ul>

        <dl className="mt-4 space-y-1 border-t border-border pt-3 text-sm tabular">
          <div className="flex justify-between gap-4">
            <dt className="text-ink-muted">Subtotal</dt>
            <dd className="text-ink">
              {formatMinor(order.subtotalMinor, order.currency)}
            </dd>
          </div>
          {order.deliveryZone ? (
            <div className="flex justify-between gap-4">
              <dt className="text-ink-muted">
                {ZONE_LABEL[order.deliveryZone] ?? "Delivery"}
              </dt>
              <dd className="text-ink">
                {order.deliveryMinor === 0
                  ? "Free"
                  : formatMinor(order.deliveryMinor, order.currency)}
              </dd>
            </div>
          ) : null}
          <div className="flex justify-between gap-4 border-t border-border pt-1 font-semibold">
            <dt className="text-ink">Total</dt>
            <dd className="text-ink">
              {formatMinor(order.totalMinor, order.currency)}
            </dd>
          </div>
        </dl>

        {order.deliveryAddress ? (
          <p className="mt-4 text-sm text-ink-muted">
            Delivering to: <span className="text-ink">{order.deliveryAddress}</span>
          </p>
        ) : null}
      </section>

      {downloads.length > 0 ? (
        <section className="mt-8 space-y-3">
          <h2 className="text-lg font-semibold text-ink">Your ebook</h2>
          {downloads.map(({ item, info }) => (
            <DownloadSection
              key={item.id}
              orderReference={order.reference}
              accessToken={t}
              orderItemId={item.id}
              title={item.titleSnapshot}
              usable={info?.usable ?? false}
              downloadHref={info ? `/api/downloads/${info.token}` : "#"}
              expiresAtLabel={info ? formatExpiryLusaka(info.expiresAt) : ""}
              downloadsRemaining={info?.downloadsRemaining ?? 0}
            />
          ))}
        </section>
      ) : null}

      <p className="mt-8 text-xs text-ink-muted">
        Bookmark this page — it is your record of the order until confirmation
        email is available.
      </p>
    </main>
  );
}
