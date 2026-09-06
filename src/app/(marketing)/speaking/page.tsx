import type { Metadata } from "next";
import Link from "next/link";

// Honest stub — there is no client-supplied speaking content yet. Kept out of
// the index so an empty page doesn't get crawled.
export const metadata: Metadata = {
  title: "Speaking",
  robots: { index: false, follow: true },
};

export default function SpeakingPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-16">
      <h1 className="text-title font-semibold text-ink">Speaking</h1>
      <p className="mt-4 text-ink">
        A fuller page about Yangeni&rsquo;s speaking is on the way. In the
        meantime, reach him through the{" "}
        <Link href="/contact" className="text-accent-ink underline">
          contact page
        </Link>
        .
      </p>
    </main>
  );
}
