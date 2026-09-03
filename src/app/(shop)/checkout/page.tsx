import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatMinor } from "@/lib/money";
import { getPurchasableBookFormat } from "@/lib/services/books";
import { getStoreSettings } from "@/lib/services/store";
import { BookCover } from "@/app/(marketing)/books/book-cover";
import { CheckoutForm } from "./checkout-form";

export const dynamic = "force-dynamic";

// A per-transaction dead end — nothing to index.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  title: "Checkout — Yangeni Chendela",
};

const FORMAT_LABEL: Record<string, string> = { PRINT: "Print", EBOOK: "Ebook" };

// Reveal the address field and swap the total purely with CSS, so it is correct
// with JavaScript disabled. The server re-computes the real total regardless.
const REVEAL_CSS = `
.ca-line-lusaka,.ca-total-lusaka{display:none}
.checkout-root:has(input[name="deliveryZone"][value="LUSAKA"]:checked) .ca-total-plain{display:none}
.checkout-root:has(input[name="deliveryZone"][value="LUSAKA"]:checked) .ca-line-lusaka,
.checkout-root:has(input[name="deliveryZone"][value="LUSAKA"]:checked) .ca-total-lusaka{display:block}
.ca-address{display:none}
.checkout-root:has(input[name="deliveryZone"][value="LUSAKA"]:checked) .ca-address,
.checkout-root:has(input[name="deliveryZone"][value="REST_OF_ZAMBIA"]:checked) .ca-address{display:block}
`;

export default async function CheckoutPage({
  searchParams,
}: PageProps<"/checkout">) {
  const { format: formatId } = await searchParams;
  if (typeof formatId !== "string") notFound();

  const format = await getPurchasableBookFormat(formatId);
  if (!format) notFound();

  const settings = await getStoreSettings();

  const isPrint = format.type === "PRINT";
  const label = FORMAT_LABEL[format.type] ?? format.type;
  const priceMinor = format.priceMinor;
  const lusakaTotal = priceMinor + settings.deliveryLusakaMinor;
  const outOfStock =
    isPrint && format.stockOnHand !== null && format.stockOnHand <= 0;

  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      <style>{REVEAL_CSS}</style>

      <Link href={`/books/${format.book.slug}`} className="text-sm text-ink-muted underline">
        ← Back to {format.book.title}
      </Link>

      <h1 className="mt-4 text-title font-semibold text-ink">Checkout</h1>

      <div className="checkout-root mt-6">
        <section
          aria-label="Order summary"
          className="flex gap-4 rounded-lg border border-border bg-surface-raised p-4"
        >
          <BookCover
            url={format.book.coverImageUrl}
            title={format.book.title}
            width={72}
            height={108}
            className="shrink-0"
          />
          <div className="min-w-0 text-sm">
            <p className="font-semibold text-ink">{format.book.title}</p>
            {format.book.subtitle ? (
              <p className="text-ink-muted">{format.book.subtitle}</p>
            ) : null}
            <p className="mt-1 text-ink-muted">
              {label} · {formatMinor(priceMinor, format.currency)}
            </p>

            <dl className="mt-3 space-y-0.5 tabular">
              <div className="flex justify-between gap-4">
                <dt className="text-ink-muted">Book</dt>
                <dd className="text-ink">{formatMinor(priceMinor, format.currency)}</dd>
              </div>

              {isPrint ? (
                <div className="ca-line-lusaka flex justify-between gap-4">
                  <dt className="text-ink-muted">Delivery (Lusaka)</dt>
                  <dd className="text-ink">
                    {formatMinor(settings.deliveryLusakaMinor, format.currency)}
                  </dd>
                </div>
              ) : null}

              <div className="ca-total-plain flex justify-between gap-4 border-t border-border pt-1 font-semibold">
                <dt className="text-ink">Total</dt>
                <dd className="text-ink">{formatMinor(priceMinor, format.currency)}</dd>
              </div>

              {isPrint ? (
                <div className="ca-total-lusaka flex justify-between gap-4 border-t border-border pt-1 font-semibold">
                  <dt className="text-ink">Total</dt>
                  <dd className="text-ink">
                    {formatMinor(lusakaTotal, format.currency)}
                  </dd>
                </div>
              ) : null}
            </dl>

            {isPrint ? (
              <p className="mt-2 text-xs text-ink-muted">
                Collection and delivery outside Lusaka are free.
              </p>
            ) : (
              <p className="mt-2 text-xs text-ink-muted">
                An ebook — nothing to deliver.
              </p>
            )}
          </div>
        </section>

        {outOfStock ? (
          <p className="mt-4 rounded border border-border bg-surface-raised px-3 py-2 text-sm text-ink">
            This print run is currently out of stock. You can still place the
            order, but it will wait until copies are back.
          </p>
        ) : null}

        <CheckoutForm
          bookFormatId={format.id}
          isPrint={isPrint}
          deliveryLusakaMinor={settings.deliveryLusakaMinor}
          currency={format.currency}
        />
      </div>
    </main>
  );
}
