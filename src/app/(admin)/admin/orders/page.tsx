import Link from "next/link";
import { requireAdmin } from "@/lib/auth/guards";
import { formatMinor } from "@/lib/money";
import {
  listOrdersByPaymentState,
  listPendingClaims,
  type ClaimQueueRow,
} from "@/lib/services/claim-review";
import type { MobileNetwork, Order, PaymentClaim, PaymentState } from "@/generated/prisma/client";
import { QueueFilterForm, QueueTabs } from "./queue-filters";

// Default landing page for the admin. Age badges are live, so this can't be
// statically cached.
export const dynamic = "force-dynamic";

const TAB_TO_STATE: Record<string, PaymentState> = {
  confirmed: "CONFIRMED",
  underpaid: "UNDERPAID",
  rejected: "REJECTED",
};

const HOUR_MS = 60 * 60 * 1000;

// A plain helper, not a component — react-hooks/purity flags Date.now() called
// directly inside a component/hook body, so the impure call lives here and
// every component receives the timestamp as a prop instead.
function currentTimeMs(): number {
  return Date.now();
}

function AgeBadge({ createdAt, now }: { createdAt: Date; now: number }) {
  const ageHours = (now - createdAt.getTime()) / HOUR_MS;
  const cls =
    ageHours >= 24
      ? "bg-danger-bg text-danger"
      : ageHours >= 6
        ? "bg-warning-bg text-warning"
        : "bg-admin-bg text-admin-ink-muted";
  const label =
    ageHours < 1
      ? "just now"
      : ageHours < 24
        ? `${Math.floor(ageHours)}h ago`
        : `${Math.floor(ageHours / 24)}d ago`;
  return (
    <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>
  );
}

function ClaimCard({ claim, now }: { claim: ClaimQueueRow; now: number }) {
  return (
    <li className="rounded border border-admin-border bg-admin-surface p-3">
      <Link href={`/admin/orders/${claim.order.reference}`} className="block">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-medium tabular underline">{claim.order.reference}</p>
            <p className="truncate text-sm text-admin-ink-muted">{claim.order.customerName}</p>
          </div>
          <AgeBadge createdAt={claim.createdAt} now={now} />
        </div>
        <div className="mt-2 flex items-baseline justify-between gap-2">
          <span className="text-lg font-semibold tabular">
            {formatMinor(claim.order.totalMinor, claim.order.currency)}
          </span>
          <span className="text-xs text-admin-ink-muted">{claim.network}</span>
        </div>
        <p className="mt-1 truncate text-sm tabular text-admin-ink-muted">
          {claim.transactionId}
        </p>
      </Link>
    </li>
  );
}

function OrderCard({ order }: { order: Order & { claims: PaymentClaim[] } }) {
  const latestClaim = order.claims[0];
  return (
    <li className="rounded border border-admin-border bg-admin-surface p-3">
      <Link href={`/admin/orders/${order.reference}`} className="block">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-medium tabular underline">{order.reference}</p>
            <p className="truncate text-sm text-admin-ink-muted">{order.customerName}</p>
          </div>
          <span className="shrink-0 text-xs text-admin-ink-muted">
            {order.updatedAt.toLocaleDateString()}
          </span>
        </div>
        <div className="mt-2 flex items-baseline justify-between gap-2">
          <span className="text-lg font-semibold tabular">
            {formatMinor(order.totalMinor, order.currency)}
          </span>
          {latestClaim ? (
            <span className="text-xs text-admin-ink-muted">{latestClaim.network}</span>
          ) : null}
        </div>
        {latestClaim ? (
          <p className="mt-1 truncate text-sm tabular text-admin-ink-muted">
            {latestClaim.transactionId}
          </p>
        ) : null}
      </Link>
    </li>
  );
}

export default async function AdminOrdersQueue({
  searchParams,
}: PageProps<"/admin/orders">) {
  await requireAdmin();

  const sp = await searchParams;
  const tab = typeof sp.tab === "string" ? sp.tab : "review";
  const networkParam = typeof sp.network === "string" ? sp.network : "";
  const network =
    networkParam === "AIRTEL" || networkParam === "MTN" || networkParam === "ZAMTEL"
      ? (networkParam as MobileNetwork)
      : null;
  const search = typeof sp.q === "string" ? sp.q : "";

  const state = TAB_TO_STATE[tab];

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Orders</h1>

      <QueueTabs active={tab} />
      <QueueFilterForm tab={tab} network={network ?? ""} search={search} />

      {state ? (
        <OrderList state={state} network={network} search={search} />
      ) : (
        <ClaimList network={network} search={search} />
      )}
    </div>
  );
}

async function ClaimList({
  network,
  search,
}: {
  network: MobileNetwork | null;
  search: string;
}) {
  const claims = await listPendingClaims({ network, search });

  if (claims.length === 0) {
    return <p className="text-sm text-admin-ink-muted">Nothing waiting for review.</p>;
  }

  const now = currentTimeMs();
  return (
    <ul className="space-y-2">
      {claims.map((claim) => (
        <ClaimCard key={claim.id} claim={claim} now={now} />
      ))}
    </ul>
  );
}

async function OrderList({
  state,
  network,
  search,
}: {
  state: PaymentState;
  network: MobileNetwork | null;
  search: string;
}) {
  const orders = await listOrdersByPaymentState(state, { network, search });

  if (orders.length === 0) {
    return <p className="text-sm text-admin-ink-muted">No orders here yet.</p>;
  }

  return (
    <ul className="space-y-2">
      {orders.map((order) => (
        <OrderCard key={order.id} order={order} />
      ))}
    </ul>
  );
}
