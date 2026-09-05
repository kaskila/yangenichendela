import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/guards";
import { formatMinor } from "@/lib/money";
import { getSignedReceiptUrl } from "@/lib/cloudinary";
import { getOrderForReview } from "@/lib/services/claim-review";
import { listDownloadTokensForOrder, type DownloadTokenWithLogs } from "@/lib/services/fulfilment";
import { REJECTION_REASONS } from "@/lib/rejection-reasons";
import type { OrderEvent, PaymentClaim } from "@/generated/prisma/client";
import { ClaimDecisionForm } from "./claim-decision-form";
import { RejectForm } from "./reject-form";
import { ReopenForm } from "./reopen-form";

export const dynamic = "force-dynamic";

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
});

const CLAIM_STATUS_LABEL: Record<string, string> = {
  PENDING_REVIEW: "Awaiting review",
  ACCEPTED: "Accepted",
  REJECTED: "Rejected",
  DUPLICATE_FLAGGED: "Duplicate flagged",
};

const REJECTION_REASON_LABEL: Record<string, string> = Object.fromEntries(
  REJECTION_REASONS.map((r) => [r.code, r.label]),
);

function ClaimHistoryRow({ claim }: { claim: PaymentClaim }) {
  return (
    <li className="rounded border border-admin-border p-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{CLAIM_STATUS_LABEL[claim.status] ?? claim.status}</span>
        <span className="text-xs text-admin-ink-muted">
          {dateFormatter.format(claim.createdAt)}
        </span>
      </div>
      <p className="mt-1 text-admin-ink-muted">
        {claim.network} · <span className="tabular">{claim.transactionId}</span>
      </p>
      {claim.matchedAmountMinor !== null ? (
        <p className="tabular text-admin-ink-muted">
          Matched: {formatMinor(claim.matchedAmountMinor)}
        </p>
      ) : null}
      {claim.rejectionReason ? (
        <p className="text-admin-ink-muted">
          Reason: {REJECTION_REASON_LABEL[claim.rejectionReason] ?? claim.rejectionReason}
        </p>
      ) : null}
      {claim.reviewNote ? <p className="text-admin-ink-muted">Note: {claim.reviewNote}</p> : null}
    </li>
  );
}

// A plain helper, not a component — react-hooks/purity flags Date.now()
// called directly inside a component/hook body (see also admin/orders/page.tsx).
function currentTimeMs(): number {
  return Date.now();
}

function DownloadTokenRow({ token, now }: { token: DownloadTokenWithLogs; now: number }) {
  const distinctIps = new Set(token.logs.map((l) => l.ipAddress).filter(Boolean)).size;
  return (
    <li className="rounded border border-admin-border p-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">
          {token.downloadCount} of {token.maxDownloads} used
        </span>
        <span className="text-xs text-admin-ink-muted">
          {token.revokedAt
            ? "Revoked"
            : token.expiresAt.getTime() > now
              ? `Expires ${dateFormatter.format(token.expiresAt)}`
              : "Expired"}
        </span>
      </div>
      <p className="mt-1 text-xs text-admin-ink-muted">
        Issued {dateFormatter.format(token.createdAt)}
        {distinctIps > 1 ? ` · downloaded from ${distinctIps} different IPs` : ""}
      </p>
      {token.logs.length > 0 ? (
        <ul className="mt-1 space-y-0.5 text-xs text-admin-ink-muted">
          {token.logs.map((log) => (
            <li key={log.id} className="tabular">
              {dateFormatter.format(log.createdAt)} · {log.ipAddress ?? "unknown IP"} ·{" "}
              {log.userAgent ?? "unknown device"}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function TimelineRow({ event }: { event: OrderEvent }) {
  return (
    <li className="border-l-2 border-admin-border py-1 pl-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{event.type}</span>
        <span className="text-xs text-admin-ink-muted">
          {dateFormatter.format(event.createdAt)}
        </span>
      </div>
      <p className="text-xs text-admin-ink-muted">
        {event.actorType}
        {event.fromState ? ` · ${event.fromState} → ${event.toState}` : ""}
      </p>
    </li>
  );
}

export default async function OrderReviewPage({
  params,
}: PageProps<"/admin/orders/[orderReference]">) {
  await requireAdmin();
  const { orderReference: reference } = await params;

  const order = await getOrderForReview(reference);
  if (!order) notFound();

  const pendingClaim = order.claims.find((c) => c.status === "PENDING_REVIEW") ?? null;
  const receiptUrl = pendingClaim?.receiptImageUrl
    ? getSignedReceiptUrl(pendingClaim.receiptImageUrl)
    : null;
  const downloadTokens = await listDownloadTokensForOrder(order.id);
  const now = currentTimeMs();

  return (
    <div className="space-y-6 pb-24">
      <div className="flex items-center justify-between gap-3">
        <h1 className="truncate text-lg font-semibold tabular">{order.reference}</h1>
        <Link href="/admin/orders" className="shrink-0 text-sm underline">
          Back to queue
        </Link>
      </div>

      <section className="space-y-2 rounded border border-admin-border bg-admin-surface p-4">
        <p className="text-sm text-admin-ink-muted">
          {order.customerName} · {order.customerEmail} · {order.customerPhone}
        </p>
        <p className="text-2xl font-semibold tabular">
          {formatMinor(order.totalMinor, order.currency)}
        </p>
        <ul className="text-sm text-admin-ink-muted">
          {order.items.map((item) => (
            <li key={item.id}>
              {item.quantity}× {item.titleSnapshot} ({item.formatSnapshot}) —{" "}
              {formatMinor(item.unitPriceMinor * item.quantity, item.currency)}
            </li>
          ))}
        </ul>
      </section>

      {pendingClaim ? (
        <section className="space-y-4 rounded border border-admin-border bg-admin-surface p-4">
          <h2 className="text-sm font-semibold text-admin-ink-muted">Buyer&rsquo;s claim</h2>
          <p className="text-sm">
            {pendingClaim.network} · sent from{" "}
            <span className="tabular">{pendingClaim.senderPhone}</span>
          </p>
          <p className="text-sm">
            Reference as typed: <span className="tabular font-medium">{pendingClaim.transactionId}</span>
          </p>

          {pendingClaim.receiptImageUrl ? (
            receiptUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- admin-only, signed, never a public asset
              <img
                src={receiptUrl}
                alt="Receipt screenshot"
                className="max-h-96 w-full rounded border border-admin-border object-contain"
              />
            ) : (
              <p className="text-sm text-admin-ink-muted">
                A receipt was uploaded, but image delivery isn&rsquo;t configured here.
              </p>
            )
          ) : (
            <p className="text-sm text-admin-ink-muted">No receipt uploaded.</p>
          )}

          <ClaimDecisionForm
            claimId={pendingClaim.id}
            orderReference={order.reference}
            totalMinor={order.totalMinor}
            currency={order.currency}
          />
          <RejectForm claimId={pendingClaim.id} orderReference={order.reference} />
        </section>
      ) : (
        <section className="rounded border border-admin-border bg-admin-surface p-4">
          <h2 className="text-sm font-semibold text-admin-ink-muted">Claim status</h2>
          <p className="mt-1 text-sm">
            {order.paymentState === "PENDING"
              ? "No claim submitted yet."
              : `This order is ${order.paymentState.toLowerCase()} — nothing awaiting review.`}
          </p>
        </section>
      )}

      {order.paymentState === "EXPIRED" ? (
        <section className="rounded border border-admin-border bg-admin-surface p-4">
          <ReopenForm orderId={order.id} orderReference={order.reference} />
        </section>
      ) : null}

      {order.claims.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-admin-ink-muted">Claim history</h2>
          <ul className="space-y-2">
            {order.claims.map((claim) => (
              <ClaimHistoryRow key={claim.id} claim={claim} />
            ))}
          </ul>
        </section>
      ) : null}

      {downloadTokens.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-admin-ink-muted">Downloads</h2>
          <ul className="space-y-2">
            {downloadTokens.map((token) => (
              <DownloadTokenRow key={token.id} token={token} now={now} />
            ))}
          </ul>
        </section>
      ) : null}

      <section className="space-y-1">
        <h2 className="text-sm font-semibold text-admin-ink-muted">Order timeline</h2>
        <ul className="space-y-1">
          {order.events.map((event) => (
            <TimelineRow key={event.id} event={event} />
          ))}
        </ul>
      </section>
    </div>
  );
}
