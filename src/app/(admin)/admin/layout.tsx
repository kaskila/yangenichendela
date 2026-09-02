import type { ReactNode } from "react";
import { requireAdmin } from "@/lib/auth/guards";
import { signOutAction } from "./actions";
import { AdminNav } from "./admin-nav";

// The admin shell. The (admin) group layout already gates every route with
// requireAdmin(); this one draws the chrome and needs the user for the email.
//
// A tool, not a brochure: neutral greys, one thin green bar as the only brand
// tie-in, dense spacing. Mobile-first — the nav is a bottom bar within thumb
// reach on a phone (see AdminNav).
export default async function AdminSectionLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await requireAdmin();

  return (
    <div className="flex min-h-full flex-col bg-admin-bg text-admin-ink">
      {/* The only brand element in the whole admin. Decorative (no text), but
          it carries an explicit on-dark foreground so anything ever placed in
          it stays legible rather than inheriting the dark admin ink. */}
      <div className="h-1 bg-surface-inverse text-admin-on-dark" />

      <header className="border-b border-admin-border bg-admin-surface">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-2">
          <span className="font-semibold">Admin</span>
          <div className="flex min-w-0 items-center gap-3">
            <span className="hidden truncate text-xs text-admin-ink-muted sm:inline">
              {user.email}
            </span>
            <form action={signOutAction}>
              {/* Explicit colour: globals.css's unlayered
                  `:where(button){ color: inherit }` beats plain utilities, so
                  this button would otherwise depend on an ancestor. */}
              <button
                type="submit"
                className="shrink-0 rounded border border-admin-border px-2 py-1 text-sm text-admin-ink!"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
        <p className="mx-auto w-full max-w-3xl truncate px-4 pb-1 text-xs text-admin-ink-muted sm:hidden">
          {user.email}
        </p>
      </header>

      <AdminNav />

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-5">{children}</main>
    </div>
  );
}
