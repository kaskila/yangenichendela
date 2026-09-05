"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Three equal, full-width tap targets under the header — thumb-reachable on a
// phone, not a hover menu. A client leaf only so the current section can be
// highlighted; it carries no other state.
const LINKS = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/books", label: "Books" },
  { href: "/admin/orders", label: "Orders" },
  { href: "/admin/fulfilment", label: "Packing" },
  { href: "/admin/settings", label: "Settings" },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Admin sections"
      className="no-print border-b border-admin-border bg-admin-surface"
    >
      <div className="mx-auto flex w-full max-w-3xl overflow-x-auto">
        {LINKS.map((link) => {
          const active = isActive(pathname, link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={`flex-1 border-b-2 px-3 py-3 text-center text-sm font-medium sm:flex-none sm:px-5 ${
                active
                  ? "border-admin-ink text-admin-ink"
                  : "border-transparent text-admin-ink-muted"
              }`}
            >
              {link.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
