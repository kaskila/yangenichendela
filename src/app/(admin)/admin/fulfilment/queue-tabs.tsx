"use client";

// Plain <a> navigation — no JS required to switch tabs (CLAUDE.md: the admin
// must work in the Facebook in-app browser). Client only so the active tab can
// be underlined; carries no other state.

const TABS = [
  { state: "AWAITING_PACKING", label: "Awaiting packing" },
  { state: "PACKED", label: "Packed" },
  { state: "DISPATCHED", label: "Dispatched" },
] as const;

export function QueueTabs({ active }: { active: string }) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-admin-border">
      {TABS.map((tab) => {
        const isActive = active === tab.state;
        return (
          <a
            key={tab.state}
            href={`/admin/fulfilment?state=${tab.state}`}
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
