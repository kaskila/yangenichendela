import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

// Server Component. The interactive part is the LoginForm leaf only — the page
// itself stays on the server. This route sits outside the (admin) route group
// so it is not behind requireAdmin(); otherwise a signed-out visitor would be
// redirected here in a loop.
//
// `flex-1` fills the column the root layout's <body> lays out, so the card
// centres in the viewport.
export default function AdminLoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center bg-admin-bg px-4 py-10">
      <div className="w-full max-w-sm space-y-6 rounded-lg border border-admin-border bg-admin-surface p-6">
        <h1 className="text-lg font-semibold text-admin-ink">Sign in</h1>
        <LoginForm />
      </div>
    </main>
  );
}
