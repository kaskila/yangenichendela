import type { Metadata } from "next";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Contact",
  description: "How to reach Yangeni Chendela — email, LinkedIn and Facebook.",
};

export default function ContactPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-16">
      <h1 className="text-title font-semibold text-ink">Contact</h1>
      <p className="mt-4 text-ink">
        The best way to reach Yangeni is by email. He&rsquo;s also on LinkedIn
        and Facebook.
      </p>

      <ul className="mt-6 space-y-2 text-ink">
        <li>
          Email:{" "}
          <a
            href={`mailto:${SITE.socials.email}`}
            className="text-accent-ink underline"
          >
            {SITE.socials.email}
          </a>
        </li>
        <li>
          <a
            href={SITE.socials.linkedin}
            target="_blank"
            rel="me noopener noreferrer"
            className="text-accent-ink underline"
          >
            LinkedIn
          </a>
        </li>
        <li>
          <a
            href={SITE.socials.facebook}
            target="_blank"
            rel="me noopener noreferrer"
            className="text-accent-ink underline"
          >
            Facebook
          </a>
        </li>
      </ul>

      <p className="mt-6 text-sm text-ink-muted">A contact form will come later.</p>
    </main>
  );
}
