import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy",
  robots: { index: false, follow: true },
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-16">
      <h1 className="text-title font-semibold text-ink">Privacy</h1>
      <p className="mt-4 text-ink">This page is coming soon.</p>
      <p className="mt-4 text-ink">
        If you join the mailing list, your email address is stored so Yangeni can
        contact you, and nothing else.
      </p>
    </main>
  );
}
