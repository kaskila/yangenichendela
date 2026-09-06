import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms",
  robots: { index: false, follow: true },
};

export default function TermsPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-16">
      <h1 className="text-title font-semibold text-ink">Terms</h1>
      <p className="mt-4 text-ink">This page is coming soon.</p>
    </main>
  );
}
