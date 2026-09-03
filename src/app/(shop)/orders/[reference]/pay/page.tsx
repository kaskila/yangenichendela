import type { Metadata } from "next";
import Link from "next/link";
import { formatMinor, minorToDecimalString } from "@/lib/money";
import { getActivePrimaryMerchantNumbers } from "@/lib/services/store";
import type { MerchantNumber } from "@/generated/prisma/client";
import {
  formatExpiryLusaka,
  loadOrderOr404,
  PAYMENT_STATE_TEXT,
} from "../order-access";
import { CopyButton } from "./copy-button";

export const dynamic = "force-dynamic";

// A private, per-order URL. Never index it.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  title: "How to pay — Yangeni Chendela",
};

const NETWORKS = [
  { key: "AIRTEL", wallet: "Airtel Money" },
  { key: "MTN", wallet: "MTN MoMo" },
] as const;
type NetworkKey = (typeof NETWORKS)[number]["key"];

function ValueRow({
  label,
  display,
  copy,
  big,
}: {
  label: string;
  display: string;
  copy: string;
  big?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded border border-border bg-surface px-3 py-2">
      <div className="min-w-0">
        <p className="text-xs text-ink-muted">{label}</p>
        <p
          className={`tabular text-ink ${big ? "text-2xl font-bold" : "font-medium"}`}
        >
          {display}
        </p>
      </div>
      <CopyButton value={copy} label={label} />
    </div>
  );
}

function PersonalSteps({
  wallet,
  number,
  amount,
  reference,
  accountName,
}: {
  wallet: string;
  number: string;
  amount: string;
  reference: string;
  accountName: string | null;
}) {
  return (
    <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-ink">
      <li>Open {wallet} on your phone.</li>
      <li>
        Choose <strong>Send Money</strong>.
      </li>
      <li>
        Enter this number: <span className="tabular font-medium">{number}</span>.
      </li>
      <li>
        Enter this exact amount: <strong>{amount}</strong>. Do not round it.
      </li>
      <li>
        If it asks for a reference or a reason, enter{" "}
        <span className="tabular font-medium">{reference}</span>.
      </li>
      {accountName ? (
        <li>
          Check the name shows as <strong>{accountName}</strong> before you
          confirm.
        </li>
      ) : null}
      <li>Enter your PIN to send.</li>
      <li>
        Keep the confirmation SMS — its transaction ID is what confirms your
        order.
      </li>
    </ol>
  );
}

function MerchantSteps({
  wallet,
  number,
  amount,
  reference,
  accountName,
}: {
  wallet: string;
  number: string;
  amount: string;
  reference: string;
  accountName: string | null;
}) {
  return (
    <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-ink">
      <li>Open {wallet} on your phone.</li>
      <li>
        Choose <strong>Make Payment</strong> (it may be called Pay Merchant or
        Pay Bill).
      </li>
      <li>
        Enter this merchant number:{" "}
        <span className="tabular font-medium">{number}</span>.
      </li>
      <li>
        Enter this exact amount: <strong>{amount}</strong>. Do not round it.
      </li>
      <li>
        If it asks for a reference, enter{" "}
        <span className="tabular font-medium">{reference}</span>.
      </li>
      {accountName ? (
        <li>
          Check the merchant shows as <strong>{accountName}</strong>.
        </li>
      ) : null}
      <li>Enter your PIN.</li>
      <li>Keep the confirmation SMS — its transaction ID confirms your order.</li>
    </ol>
  );
}

export default async function PayPage({
  params,
  searchParams,
}: PageProps<"/orders/[reference]/pay">) {
  const { reference } = await params;
  const sp = await searchParams;
  const token = sp.t;
  const order = await loadOrderOr404(reference, token);
  const t = token as string; // loadOrderOr404 guarantees a matching string

  const statusHref = `/orders/${order.reference}?t=${encodeURIComponent(t)}`;

  if (order.paymentState !== "PENDING") {
    return (
      <main className="mx-auto max-w-md px-4 py-10">
        <h1 className="text-title font-semibold text-ink">Order {order.reference}</h1>
        <p className="mt-4 text-ink">
          {PAYMENT_STATE_TEXT[order.paymentState] ?? "This order is being handled"}
          .
        </p>
        <Link href={statusHref} className="mt-4 inline-block text-sm text-ink underline">
          See your order
        </Link>
      </main>
    );
  }

  const numbers = await getActivePrimaryMerchantNumbers();
  const byNetwork = new Map<NetworkKey, MerchantNumber>();
  for (const n of numbers) {
    if (n.network === "AIRTEL" || n.network === "MTN") byNetwork.set(n.network, n);
  }

  const chosen =
    sp.network === "AIRTEL" || sp.network === "MTN"
      ? (sp.network as NetworkKey)
      : null;
  const chosenNumber = chosen ? byNetwork.get(chosen) : undefined;

  const amountDisplay = formatMinor(order.totalMinor, order.currency);
  const amountCopy = minorToDecimalString(order.totalMinor);

  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <h1 className="text-title font-semibold text-ink">Pay for your order</h1>
      <p className="mt-2 text-sm text-ink-muted">
        Order <span className="tabular font-medium text-ink">{order.reference}</span>
      </p>

      {byNetwork.size === 0 ? (
        <p className="mt-6 rounded border border-border bg-surface-raised p-4 text-sm text-ink">
          Payment isn&rsquo;t set up yet. Your order is saved — Yangeni will be
          in touch to arrange payment. Keep this link.
        </p>
      ) : !chosenNumber ? (
        <section className="mt-6">
          <h2 className="text-lg font-semibold text-ink">
            Step 1 — choose how you paid
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            Pay from the same network as the number you send to.
          </p>
          <div className="mt-4 grid gap-3">
            {NETWORKS.map(({ key, wallet }) => {
              const available = byNetwork.has(key);
              return available ? (
                <Link
                  key={key}
                  href={`/orders/${order.reference}/pay?t=${encodeURIComponent(t)}&network=${key}`}
                  className="block rounded-lg border border-border bg-surface-inverse px-4 py-4 text-center text-base font-semibold text-ink-inverse!"
                >
                  {wallet}
                </Link>
              ) : (
                <div
                  key={key}
                  className="rounded-lg border border-border px-4 py-4 text-center text-base font-semibold text-ink-muted"
                >
                  {wallet} — temporarily unavailable
                </div>
              );
            })}
          </div>
        </section>
      ) : (
        <PayInstructions
          order={order}
          network={chosen!}
          merchant={chosenNumber}
          amountDisplay={amountDisplay}
          amountCopy={amountCopy}
          statusHref={statusHref}
          backHref={`/orders/${order.reference}/pay?t=${encodeURIComponent(t)}`}
        />
      )}
    </main>
  );
}

function PayInstructions({
  order,
  network,
  merchant,
  amountDisplay,
  amountCopy,
  statusHref,
  backHref,
}: {
  order: Awaited<ReturnType<typeof loadOrderOr404>>;
  network: NetworkKey;
  merchant: MerchantNumber;
  amountDisplay: string;
  amountCopy: string;
  statusHref: string;
  backHref: string;
}) {
  const wallet = NETWORKS.find((n) => n.key === network)!.wallet;

  return (
    <section className="mt-6 space-y-6">
      <Link href={backHref} className="text-sm text-ink-muted underline">
        ← Choose a different network
      </Link>

      <div className="space-y-2">
        <ValueRow
          label="Amount to send"
          display={amountDisplay}
          copy={amountCopy}
          big
        />
        <ValueRow
          label={`${wallet} number`}
          display={merchant.number}
          copy={merchant.number}
        />
        <ValueRow
          label="Payment reference"
          display={order.reference}
          copy={order.reference}
        />
        {merchant.accountName ? (
          <p className="px-1 text-xs text-ink-muted">
            Account name: {merchant.accountName}
          </p>
        ) : null}
      </div>

      <div>
        <h2 className="text-lg font-semibold text-ink">
          Step 2 — send it on {wallet}
        </h2>
        {merchant.accountType === "MERCHANT" ? (
          <MerchantSteps
            wallet={wallet}
            number={merchant.number}
            amount={amountDisplay}
            reference={order.reference}
            accountName={merchant.accountName}
          />
        ) : (
          <PersonalSteps
            wallet={wallet}
            number={merchant.number}
            amount={amountDisplay}
            reference={order.reference}
            accountName={merchant.accountName}
          />
        )}
      </div>

      <div className="rounded-lg border border-border bg-surface-raised p-4">
        <h2 className="text-sm font-semibold text-ink">Before you send</h2>
        <ul className="mt-2 space-y-2 text-sm text-ink">
          <li>
            Airtel Money and MTN MoMo only. No bank transfers, no Zamtel Kwacha.
          </li>
          <li>
            Pay from the <strong>same network</strong> as the number above. A
            cross-network transfer costs you roughly four times as much.
          </li>
          <li>
            The transfer fee is yours — the network charges it on top of the
            amount.
          </li>
          <li>
            Send the <strong>exact</strong> total. Do not round. A short payment
            holds up your order.
          </li>
        </ul>
      </div>

      <p className="text-sm text-ink">
        This order is held until{" "}
        <strong>{formatExpiryLusaka(order.paymentExpiresAt)}</strong>. If that
        passes before you pay, you can still send it — Yangeni will reopen the
        order.
      </p>

      <div className="rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold text-ink">What happens next</h2>
        <p className="mt-2 text-sm text-ink">
          Once you have sent it, Yangeni checks the payment by hand and will be
          in touch. <strong>Save this link</strong> — your order and its status
          live here:
        </p>
        <Link
          href={statusHref}
          className="mt-2 block break-all text-sm text-ink underline"
        >
          {statusHref}
        </Link>
      </div>
    </section>
  );
}
