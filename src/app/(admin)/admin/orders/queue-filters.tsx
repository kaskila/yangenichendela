"use client";

import { useSearchParams } from "next/navigation";
import { useRef } from "react";

// Tab links are plain <a> navigation — no JS required to switch views. The
// network/search controls live in one <form method="get"> with a visible
// "Filter" submit button as the no-JS floor; onChange/auto-submit is a JS
// enhancement only (CLAUDE.md: content and forms must work without
// JavaScript, e.g. in the Facebook in-app browser).
const TABS = [
  { key: "review", label: "Needs review" },
  { key: "confirmed", label: "Confirmed" },
  { key: "underpaid", label: "Underpaid" },
  { key: "rejected", label: "Rejected" },
] as const;

export function QueueTabs({ active }: { active: string }) {
  const searchParams = useSearchParams();

  return (
    <div className="flex gap-1 overflow-x-auto border-b border-admin-border">
      {TABS.map((tab) => {
        const params = new URLSearchParams(searchParams);
        params.set("tab", tab.key);
        params.delete("q");
        const isActive = active === tab.key;
        return (
          <a
            key={tab.key}
            href={`/admin/orders?${params.toString()}`}
            aria-current={isActive ? "page" : undefined}
            className={`shrink-0 border-b-2 px-3 py-2 text-sm font-medium ${
              isActive
                ? "border-admin-ink text-admin-ink"
                : "border-transparent text-admin-ink-muted"
            }`}
          >
            {tab.label}
          </a>
        );
      })}
    </div>
  );
}

export function QueueFilterForm({
  tab,
  network,
  search,
}: {
  tab: string;
  network: string;
  search: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      method="get"
      action="/admin/orders"
      className="flex flex-wrap items-center gap-2"
      onChange={() => {
        // JS enhancement: auto-submit on change via the browser's own GET
        // navigation (not a fetch). The "Filter" button below is the no-JS
        // fallback.
        formRef.current?.requestSubmit();
      }}
    >
      <input type="hidden" name="tab" value={tab} />
      <select
        name="network"
        defaultValue={network}
        className="rounded border border-admin-border bg-admin-surface px-2 py-2 text-sm"
      >
        <option value="">All networks</option>
        <option value="AIRTEL">Airtel</option>
        <option value="MTN">MTN</option>
        <option value="ZAMTEL">Zamtel</option>
      </select>
      <input
        type="search"
        name="q"
        defaultValue={search}
        placeholder="Reference, phone, name, transaction ID…"
        className="min-w-0 flex-1 rounded border border-admin-border bg-admin-surface px-3 py-2 text-sm"
      />
      <button
        type="submit"
        className="shrink-0 rounded border border-admin-border px-3 py-2 text-sm font-medium"
      >
        Filter
      </button>
    </form>
  );
}
