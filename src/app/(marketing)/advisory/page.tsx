import type { Metadata } from "next";
import Link from "next/link";

// Honest stub. The one factual sentence is sourced from docs/client-facts.md
// ("WANGA HR Consultancy — confirmed"): a real firm he has directed since 2014.
// What the firm offers, its clients and whether it carries its own brand are all
// still open questions, so nothing more is claimed.
export const metadata: Metadata = {
  title: "Advisory",
  robots: { index: false, follow: true },
};

export default function AdvisoryPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-16">
      <h1 className="text-title font-semibold text-ink">Advisory</h1>
      <p className="mt-4 text-ink">
        WANGA HR Consultancy is Yangeni&rsquo;s HR consultancy, which he has
        directed since 2014. A fuller page about the practice is on the way.
      </p>
      <p className="mt-4 text-ink">
        To talk in the meantime, use the{" "}
        <Link href="/contact" className="text-accent-ink underline">
          contact page
        </Link>
        .
      </p>
    </main>
  );
}
