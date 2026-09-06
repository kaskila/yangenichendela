import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { SITE } from "@/lib/site";

// The shared chrome for every public page: header, footer, and the site-wide
// metadata defaults. The (shop) and (admin) route groups have their own
// (or no) layout and never inherit this — the pay/status pages are
// deliberately chrome-free.
//
// Every page here is a Server Component and renders fully without JavaScript.
// The nav is a plain always-visible row (no disclosure widget, no hamburger)
// so it cannot break in the Facebook in-app browser.

const SITE_DESCRIPTION =
  "Fifteen years in human resources across seven organisations. HR Director at " +
  "Lubona Meat Products, Director of WANGA HR Consultancy, and author of Become " +
  "Unstoppable and Level Up.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE.baseUrl),
  title: {
    default: `${SITE.name} — HR director and author`,
    template: `%s — ${SITE.name}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE.name,
  openGraph: {
    type: "website",
    siteName: SITE.name,
    title: `${SITE.name} — HR director and author`,
    description: SITE_DESCRIPTION,
    url: "/",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: SITE.name }],
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE.name} — HR director and author`,
    description: SITE_DESCRIPTION,
    images: ["/og.png"],
  },
};

const NAV = [
  { href: "/books", label: "Books" },
  { href: "/about", label: "About" },
  { href: "/speaking", label: "Speaking" },
  { href: "/advisory", label: "Advisory" },
  { href: "/contact", label: "Contact" },
] as const;

function Monogram() {
  return (
    <svg
      viewBox="0 0 62 34"
      width="44"
      height="24"
      aria-hidden="true"
      focusable="false"
      className="shrink-0 text-surface-inverse"
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M5 5 L16 18 L16 29 M27 5 L16 18" />
        <path d="M57 9.5 a11 11 0 1 0 0 15" />
      </g>
    </svg>
  );
}

function SiteHeader() {
  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:py-5">
        <Link
          href="/"
          className="flex items-center gap-2.5 text-lg font-semibold text-ink"
        >
          <Monogram />
          <span>{SITE.name}</span>
        </Link>
        <nav aria-label="Primary">
          <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm font-medium text-ink-muted">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="hover:text-ink">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <div className="h-0.5 bg-surface-inverse" />
    </header>
  );
}

function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="mt-16 border-t border-border bg-surface-raised">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-10 text-sm text-ink-muted sm:flex-row sm:justify-between">
        <div>
          <p className="font-semibold text-ink">{SITE.name}</p>
          <p className="mt-1">{SITE.location}</p>
        </div>
        <nav aria-label="Elsewhere" className="flex flex-wrap gap-x-5 gap-y-1.5">
          <a
            href={SITE.socials.linkedin}
            target="_blank"
            rel="me noopener noreferrer"
            className="hover:text-ink"
          >
            LinkedIn
          </a>
          <a
            href={SITE.socials.facebook}
            target="_blank"
            rel="me noopener noreferrer"
            className="hover:text-ink"
          >
            Facebook
          </a>
          <a href={`mailto:${SITE.socials.email}`} className="hover:text-ink">
            Email
          </a>
          <Link href="/terms" className="hover:text-ink">
            Terms
          </Link>
          <Link href="/privacy" className="hover:text-ink">
            Privacy
          </Link>
        </nav>
      </div>
      <p className="mx-auto w-full max-w-5xl px-4 pb-8 text-xs text-ink-muted">
        © {year} {SITE.name}
      </p>
    </footer>
  );
}

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader />
      {children}
      <SiteFooter />
    </>
  );
}
