import Link from "next/link";
import { requireAdmin } from "@/lib/auth/guards";
import { minorToDecimalString } from "@/lib/money";
import { getStoreSettings, listMerchantNumbers } from "@/lib/services/store";
import type { MerchantNumber } from "@/generated/prisma/client";
import { DeliveryFeeForm } from "./delivery-fee-form";
import { MerchantNumberForm } from "./merchant-number-form";
import { setMerchantNumberActiveAction } from "./actions";

const NETWORKS = ["AIRTEL", "MTN", "ZAMTEL"] as const;
const NETWORK_LABEL: Record<string, string> = {
  AIRTEL: "Airtel",
  MTN: "MTN",
  ZAMTEL: "Zamtel",
};

function Badge({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "on" | "off" | "info";
}) {
  const cls =
    tone === "on"
      ? "bg-success-bg text-success"
      : tone === "off"
        ? "bg-admin-bg text-admin-ink-muted"
        : "bg-admin-bg text-admin-ink";
  return (
    <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${cls}`}>
      {children}
    </span>
  );
}

function MerchantRow({ n }: { n: MerchantNumber }) {
  return (
    <li className="rounded border border-admin-border bg-admin-surface p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium tabular">{n.number}</p>
          {n.accountName ? (
            <p className="text-sm text-admin-ink-muted">{n.accountName}</p>
          ) : null}
          {n.label ? (
            <p className="text-xs text-admin-ink-muted">{n.label}</p>
          ) : null}
        </div>
        <Link href={`/admin/settings/${n.id}`} className="shrink-0 text-sm underline">
          Edit
        </Link>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Badge tone="info">
          {n.accountType === "MERCHANT" ? "Registered merchant" : "Personal wallet"}
        </Badge>
        {n.isPrimary ? <Badge tone="on">On instructions page</Badge> : null}
        <Badge tone={n.isActive ? "on" : "off"}>
          {n.isActive ? "Active" : "Inactive"}
        </Badge>
        <form action={setMerchantNumberActiveAction} className="ml-auto">
          <input type="hidden" name="id" value={n.id} />
          <input type="hidden" name="active" value={n.isActive ? "false" : "true"} />
          <button type="submit" className="text-xs underline text-admin-ink-muted">
            {n.isActive ? "Deactivate" : "Reactivate"}
          </button>
        </form>
      </div>
    </li>
  );
}

export default async function AdminSettingsPage() {
  await requireAdmin();

  const [settings, numbers] = await Promise.all([
    getStoreSettings(),
    listMerchantNumbers(),
  ]);

  return (
    <div className="space-y-8">
      <h1 className="text-lg font-semibold">Settings</h1>

      <section className="space-y-3 rounded border border-admin-border bg-admin-surface p-4">
        <h2 className="text-sm font-semibold text-admin-ink-muted">Delivery</h2>
        <DeliveryFeeForm
          currentKwacha={minorToDecimalString(settings.deliveryLusakaMinor)}
        />
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-admin-ink-muted">
          Mobile money numbers
        </h2>

        {numbers.length === 0 ? (
          <p className="text-sm text-admin-ink-muted">
            No numbers yet. Add the first one below.
          </p>
        ) : (
          NETWORKS.filter((net) => numbers.some((n) => n.network === net)).map(
            (net) => (
              <div key={net} className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-admin-ink-muted">
                  {NETWORK_LABEL[net]}
                </h3>
                <ul className="space-y-2">
                  {numbers
                    .filter((n) => n.network === net)
                    .map((n) => (
                      <MerchantRow key={n.id} n={n} />
                    ))}
                </ul>
              </div>
            ),
          )
        )}
      </section>

      <section className="space-y-3 rounded border border-admin-border bg-admin-surface p-4">
        <h2 className="text-sm font-semibold">Add a number</h2>
        <MerchantNumberForm />
      </section>
    </div>
  );
}
