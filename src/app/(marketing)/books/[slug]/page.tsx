import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cloudinaryTransform } from "@/lib/cloudinary-url";
import { formatMinor, minorToDecimalString } from "@/lib/money";
import {
  availableFormats,
  getPublishedBookBySlug,
  type BookWithFormats,
} from "@/lib/services/books";
import { BookCover } from "../book-cover";

export const dynamic = "force-dynamic";

const SITE_NAME = "Yangeni Chendela";
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

const COVER_W = 220;
const COVER_H = 330;

const FORMAT_LABEL: Record<string, string> = { PRINT: "Print", EBOOK: "Ebook" };

// Deduped: generateMetadata and the page both need the book.
const loadBook = cache((slug: string) => getPublishedBookBySlug(slug));

function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** A meta/OG description from the book's own words, ~160 chars, word-boundary. */
function metaDescription(description: string): string | undefined {
  const clean = cleanText(description);
  if (!clean) return undefined;
  if (clean.length <= 160) return clean;
  return `${clean.slice(0, 157).replace(/\s+\S*$/, "")}…`;
}

function bookName(book: BookWithFormats): string {
  return book.subtitle ? `${book.title}: ${book.subtitle}` : book.title;
}

function offerAvailability(
  format: BookWithFormats["formats"][number],
): string {
  return format.type === "PRINT" && format.stockOnHand === 0
    ? "https://schema.org/OutOfStock"
    : "https://schema.org/InStock";
}

export async function generateMetadata({
  params,
}: PageProps<"/books/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const book = await loadBook(slug);
  if (!book) return { title: "Book not found" };

  const title = `${book.title} — ${SITE_NAME}`;
  const description = metaDescription(book.description);
  const path = `/books/${book.slug}`;

  const images = book.coverImageUrl
    ? [
        {
          url: cloudinaryTransform(
            book.coverImageUrl,
            "c_fill,w_1200,h_630,q_auto,f_auto",
          ),
          width: 1200,
          height: 630,
          alt: `Cover of ${book.title}`,
        },
      ]
    : undefined;

  return {
    metadataBase: new URL(BASE_URL),
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "book",
      title,
      description,
      url: path,
      siteName: SITE_NAME,
      images,
    },
    twitter: {
      card: images ? "summary_large_image" : "summary",
      title,
      description,
    },
  };
}

function BookJsonLd({ book }: { book: BookWithFormats }) {
  const offers = availableFormats(book).map((f) => ({
    "@type": "Offer",
    price: minorToDecimalString(f.priceMinor),
    priceCurrency: f.currency,
    availability: offerAvailability(f),
    itemCondition: "https://schema.org/NewCondition",
  }));

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Book",
    name: bookName(book),
    author: { "@type": "Person", name: SITE_NAME },
    url: `${BASE_URL}/books/${book.slug}`,
    ...(book.coverImageUrl ? { image: book.coverImageUrl } : {}),
    ...(cleanText(book.description)
      ? { description: cleanText(book.description) }
      : {}),
    ...(offers.length ? { offers } : {}),
  };

  return (
    <script
      type="application/ld+json"
      // JSON.stringify output, with "<" escaped so a value can't close the tag.
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
      }}
    />
  );
}

function FormatCard({
  format,
}: {
  format: BookWithFormats["formats"][number];
}) {
  const label = FORMAT_LABEL[format.type] ?? format.type;
  const outOfStock = format.type === "PRINT" && format.stockOnHand === 0;

  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <h3 className="font-semibold text-ink">{label}</h3>
      <p className="mt-1 text-lg font-medium text-ink">
        {formatMinor(format.priceMinor, format.currency)}
      </p>

      {format.type === "PRINT" ? (
        <p className="mt-1 text-sm text-ink-muted">
          Delivery calculated at checkout.
        </p>
      ) : null}

      {outOfStock ? (
        <p className="mt-4 text-sm font-medium text-ink">Currently out of stock</p>
      ) : (
        <>
          {/* Inert until the cart slice. `disabled` real button; the `!` forces
              the colour past globals.css's unlayered `:where(button){color:inherit}`. */}
          <button
            type="button"
            disabled
            className="mt-4 w-full cursor-not-allowed rounded border border-border px-4 py-2 text-sm font-medium text-ink-muted!"
          >
            Buy the {label.toLowerCase()}
          </button>
          <p className="mt-2 text-xs text-ink-muted">Checkout opens soon.</p>
        </>
      )}
    </div>
  );
}

export default async function BookDetailPage({
  params,
}: PageProps<"/books/[slug]">) {
  const { slug } = await params;
  const book = await loadBook(slug);
  if (!book) notFound();

  const description = book.description.trim();
  const formats = availableFormats(book).sort((a, b) =>
    a.type === b.type ? 0 : a.type === "PRINT" ? -1 : 1,
  );

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:py-14">
      <Link href="/books" className="text-sm text-ink-muted underline">
        ← All books
      </Link>

      <article className="mt-6">
        {/* Hero — the case starts here; price comes later. */}
        <div className="flex flex-col gap-6 sm:flex-row">
          <BookCover
            url={book.coverImageUrl}
            title={book.title}
            width={COVER_W}
            height={COVER_H}
            eager
            className="shrink-0"
          />
          <div>
            <h1 className="text-title font-semibold text-ink">{book.title}</h1>
            {book.subtitle ? (
              <p className="mt-2 text-lg text-ink-muted">{book.subtitle}</p>
            ) : null}
            {book.categoryLine ? (
              <p className="mt-3 text-sm uppercase tracking-wide text-ink-muted">
                {book.categoryLine}
              </p>
            ) : null}
            <p className="mt-3 text-sm text-ink-muted">by {book.authorCredit}</p>
          </div>
        </div>

        {/* The book's own words. Nothing here if `description` is empty. */}
        {description ? (
          <section className="mt-10">
            <h2 className="text-lg font-semibold text-ink">About this book</h2>
            <p className="mt-3 whitespace-pre-line text-ink">{description}</p>
          </section>
        ) : null}

        {/* Bio — every clause is sourced from docs/client-facts.md. */}
        <section className="mt-10">
          <h2 className="text-lg font-semibold text-ink">About the author</h2>
          <p className="mt-3 text-ink">
            Yangeni Chendela has spent fifteen years in human resources across
            seven organisations. He is Human Resources Director at Lubona Meat
            Products and Director of WANGA HR Consultancy, and the author of
            Become Unstoppable and Level Up.
          </p>
        </section>

        {/* The decision moment — given room. */}
        <section className="mt-10">
          <h2 className="text-lg font-semibold text-ink">Choose a format</h2>
          {formats.length === 0 ? (
            <p className="mt-3 text-ink-muted">
              This book isn&rsquo;t available for purchase yet.
            </p>
          ) : (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {formats.map((format) => (
                <FormatCard key={format.id} format={format} />
              ))}
            </div>
          )}
        </section>
      </article>

      <BookJsonLd book={book} />
    </main>
  );
}
