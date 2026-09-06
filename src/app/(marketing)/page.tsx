import Link from "next/link";
import { formatMinor } from "@/lib/money";
import { cheapestAvailableFormat, listPublishedBooks } from "@/lib/services/books";
import { SITE } from "@/lib/site";
import { BookCover } from "./books/book-cover";
import { subscribeAction } from "./actions";

// Server Component, no client JavaScript. force-dynamic: the book list is pulled
// live and the newsletter flash message is read from the query string.
export const dynamic = "force-dynamic";

// Employment history. Sourced entirely from docs/client-facts.md — the
// Career-history table (organisation, role, dates) and the Sectors line. The
// board committee role is deliberately NOT here; it has its own section on the
// About page so it is never juxtaposed with the 2026 HR Director row.
const ROSTER = [
  { org: "Lubona Meat Products Ltd", role: "Human Resources Director", sector: "Meat processing", years: "2026–present" },
  { org: "WANGA HR Consultancy", role: "Director", sector: "HR consultancy", years: "2014–present" },
  { org: "Oryx Energies", role: "HR Manager", sector: "Energy", years: "2023–2026" },
  { org: "BDO Zambia Ltd", role: "HR and Administration Manager", sector: "Professional services", years: "2018–2023" },
  { org: "Smollan", role: "Human Resources", sector: "Retail merchandising", years: "2016–2018" },
  { org: "Mika Group of Hotels", role: "HR Manager", sector: "Hospitality", years: "2014–2016" },
  { org: "Zambeef Products PLC", role: "Regional Human Resources", sector: "Agri-processing", years: "2011–2014" },
] as const;

function PersonJsonLd() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: SITE.name,
    jobTitle: "Human Resources Director",
    worksFor: [
      { "@type": "Organization", name: "Lubona Meat Products Ltd" },
      { "@type": "Organization", name: "WANGA HR Consultancy" },
    ],
    address: {
      "@type": "PostalAddress",
      addressLocality: "Lusaka",
      addressCountry: "ZM",
    },
    url: `${SITE.baseUrl}/`,
    image: `${SITE.baseUrl}/Yangeni_hero.webp`,
    sameAs: [SITE.socials.linkedin, SITE.socials.facebook],
  };
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
      }}
    />
  );
}

function NewsletterFlash({ state }: { state: string | undefined }) {
  if (state === "1") {
    return (
      <p role="status" className="mt-4 rounded bg-surface px-3 py-2 text-sm text-ink">
        Thanks — we&rsquo;ve got your address.
      </p>
    );
  }
  if (state === "err") {
    return (
      <p role="alert" className="mt-4 rounded bg-surface px-3 py-2 text-sm text-ink">
        That email didn&rsquo;t look right — try again.
      </p>
    );
  }
  return null;
}

export default async function HomePage({ searchParams }: PageProps<"/">) {
  const [books, sp] = await Promise.all([listPublishedBooks(), searchParams]);
  const subscribed = typeof sp.subscribed === "string" ? sp.subscribed : undefined;

  return (
    <main>
      {/* Hero — the cut-out portrait sits directly on the cream, no scrim. */}
      <section className="mx-auto grid w-full max-w-5xl items-center gap-8 px-4 py-12 sm:py-16 md:grid-cols-2 md:gap-12">
        <div className="order-2 min-w-0 md:order-1">
          <h1 className="text-display font-bold tracking-tight text-ink">
            {SITE.name}
          </h1>
          <p className="mt-5 max-w-xl text-lg text-ink-muted">
            Fifteen years in human resources across seven organisations — now HR
            Director at Lubona Meat Products, Director of WANGA HR Consultancy,
            and author of Become Unstoppable and Level Up.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link
              href="/books"
              className="rounded bg-surface-inverse px-5 py-2.5 text-sm font-semibold text-ink-inverse!"
            >
              Read the books
            </Link>
            <Link
              href="/about"
              className="rounded border border-border px-5 py-2.5 text-sm font-semibold text-ink!"
            >
              About Yangeni
            </Link>
          </div>
        </div>
        <div className="order-1 min-w-0 md:order-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- a single static hero, pre-converted to a display-sized WebP with alpha (see public/Yangeni_hero.webp, ~43 KB); next/image would add its client runtime and a <picture>/srcset for no gain here */}
          <img
            src="/Yangeni_hero.webp"
            width={800}
            height={750}
            alt="Portrait of Yangeni Chendela"
            fetchPriority="high"
            decoding="async"
            className="mx-auto block h-auto w-full max-w-[18rem] sm:max-w-sm md:ml-auto md:mr-0"
          />
        </div>
      </section>

      {/* Three destinations — quiet panels, space not borders. */}
      <section className="mx-auto grid w-full max-w-5xl gap-8 px-4 py-12 sm:grid-cols-3">
        <div>
          <h2 className="text-lg font-semibold text-ink">Books</h2>
          <p className="mt-2 text-sm text-ink-muted">
            Become Unstoppable and Level Up — in print and as ebooks.
          </p>
          <Link href="/books" className="mt-3 inline-block text-sm font-medium text-accent-ink underline">
            See the books
          </Link>
        </div>
        <div>
          <h2 className="text-lg font-semibold text-ink">Speaking</h2>
          <p className="mt-2 text-sm text-ink-muted">
            Invite Yangeni to speak at your event.
          </p>
          <Link href="/speaking" className="mt-3 inline-block text-sm font-medium text-accent-ink underline">
            About speaking
          </Link>
        </div>
        <div>
          <h2 className="text-lg font-semibold text-ink">Advisory</h2>
          <p className="mt-2 text-sm text-ink-muted">
            WANGA HR Consultancy — HR advisory Yangeni has led since 2014.
          </p>
          <Link href="/advisory" className="mt-3 inline-block text-sm font-medium text-accent-ink underline">
            About the practice
          </Link>
        </div>
      </section>

      {/* The books, given room — pulled live, published only. */}
      {books.length > 0 ? (
        <section className="mx-auto w-full max-w-5xl px-4 py-12">
          <h2 className="text-title font-semibold text-ink">Books</h2>
          <ul className="mt-8 grid gap-8 sm:grid-cols-2">
            {books.map((book) => {
              const cheapest = cheapestAvailableFormat(book);
              return (
                <li key={book.id} className="flex gap-5">
                  <BookCover
                    url={book.coverImageUrl}
                    title={book.title}
                    width={120}
                    height={180}
                    className="shrink-0"
                  />
                  <div className="min-w-0">
                    <h3 className="font-semibold text-ink">
                      <Link href={`/books/${book.slug}`} className="underline">
                        {book.title}
                      </Link>
                    </h3>
                    {book.subtitle ? (
                      <p className="mt-1 text-sm text-ink-muted">{book.subtitle}</p>
                    ) : null}
                    {book.categoryLine ? (
                      <p className="mt-2 text-sm text-ink-muted">{book.categoryLine}</p>
                    ) : null}
                    {cheapest ? (
                      <p className="mt-3 text-sm font-medium text-ink">
                        From {formatMinor(cheapest.priceMinor, cheapest.currency)}
                      </p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
          <Link href="/books" className="mt-8 inline-block text-sm font-medium text-accent-ink underline">
            All books
          </Link>
        </section>
      ) : null}

      {/* Credential: the range, stated plainly. No logos. */}
      <section className="mx-auto w-full max-w-5xl px-4 py-12">
        <h2 className="text-title font-semibold text-ink">Where he has worked</h2>
        <p className="mt-3 text-ink-muted">Seven organisations. Six sectors.</p>
        <ul className="mt-8 divide-y divide-border border-y border-border">
          {ROSTER.map((row) => (
            <li
              key={row.org}
              className="flex flex-col gap-1 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4"
            >
              <span className="font-medium text-ink">{row.org}</span>
              <span className="text-sm text-ink-muted">
                {row.role} · {row.sector} · {row.years}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* The one green band on the page. */}
      <section
        id="keep-in-touch"
        className="scroll-mt-8 bg-surface-inverse"
      >
        <div className="mx-auto w-full max-w-5xl px-4 py-12">
          <h2 className="text-title font-semibold text-ink-inverse">Keep in touch</h2>
          <p className="mt-3 max-w-xl text-ink-inverse-muted">
            Add your email and Yangeni will let you know when there&rsquo;s a new
            book, or a talk worth coming to. Nothing else.
          </p>
          <form action={subscribeAction} className="mt-6 max-w-md">
            <label
              htmlFor="newsletter-email"
              className="block text-sm font-medium text-ink-inverse"
            >
              Email address
            </label>
            <div className="mt-2 flex flex-col gap-3 sm:flex-row">
              <input
                id="newsletter-email"
                type="email"
                name="email"
                required
                inputMode="email"
                autoComplete="email"
                className="min-w-0 flex-1 rounded border border-border bg-surface px-3 py-2.5 text-sm text-ink"
              />
              <button
                type="submit"
                className="rounded bg-accent px-5 py-2.5 text-sm font-semibold text-accent-on!"
              >
                Join the list
              </button>
            </div>
          </form>
          <NewsletterFlash state={subscribed} />
        </div>
      </section>

      <PersonJsonLd />
    </main>
  );
}
