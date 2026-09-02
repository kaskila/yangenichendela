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
export default function AdminLoginPage() {
  return (
    <main style={{ padding: "2rem", maxWidth: "24rem" }}>
      <h1>Sign in</h1>
      <LoginForm />
    </main>
  );
}
