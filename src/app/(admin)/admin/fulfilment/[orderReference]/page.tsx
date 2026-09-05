import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/guards";
import { getOrderForSlip, printDestinationText } from "@/lib/services/print-fulfilment";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";

const dateFormatter = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" });

export default async function PackingSlipPage({
  params,
}: PageProps<"/admin/fulfilment/[orderReference]">) {
  await requireAdmin();
  const { orderReference } = await params;

  const order = await getOrderForSlip(orderReference);
  if (!order) notFound();

  return (
    <div className="space-y-6">
      <div className="no-print flex items-center justify-between gap-3">
        <Link href="/admin/fulfilment" className="text-sm underline">
          Back to queue
        </Link>
        <PrintButton />
      </div>

      <article className="space-y-6 rounded border border-admin-border bg-admin-surface p-5 print:border-0 print:p-0">
        <header className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-admin-ink-muted">Packing slip</p>
          <h1 className="text-2xl font-bold tabular">{order.reference}</h1>
          <p className="text-sm text-admin-ink-muted">
            Ordered {dateFormatter.format(order.createdAt)}
          </p>
        </header>

        <section className="space-y-1">
          <h2 className="text-sm font-semibold text-admin-ink-muted">Send to</h2>
          <p className="font-medium">{order.customerName}</p>
          <p className="tabular">{order.customerPhone}</p>
          <p>{printDestinationText(order.deliveryZone, order.deliveryAddress)}</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-admin-ink-muted">In this parcel</h2>
          {order.items.length === 0 ? (
            <p className="text-sm text-admin-ink-muted">No print items on this order.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-admin-border">
                  <th className="py-1 font-semibold">Book</th>
                  <th className="py-1 text-right font-semibold">Qty</th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((item) => (
                  <tr key={item.id} className="border-b border-admin-border">
                    <td className="py-1.5">{item.titleSnapshot}</td>
                    <td className="py-1.5 text-right tabular">{item.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </article>
    </div>
  );
}
