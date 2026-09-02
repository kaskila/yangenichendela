import type { Metadata } from "next";
import Link from "next/link";
import { formatMinor } from "@/lib/money";
import { cheapestAvailableFormat, listPublishedBooks } from "@/lib/services/books";
import { BookCover } from "./book-cover";

// Server Component, no client JS. Small collection: no pagination, filters,
// search or sort control.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Books — Yangeni Chendela",
  description:
    "Books by Yangeni Chendela, author of Become Unstoppable and Level Up.",
};

const COVER_W = 132;
const COVER_H = 198;

export default async function BooksCataloguePage() {
  const books = await listPublishedBooks();

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
      <h1 className="text-title font-semibold text-ink">Books</h1>

      {books.length === 0 ? (
        <p className="mt-4 text-ink-muted">There are no books to show yet.</p>
      ) : (
        <ul className="mt-8 space-y-6">
          {books.map((book) => {
            const cheapest = cheapestAvailableFormat(book);
            return (
              <li key={book.id}>
                <article className="relative flex gap-4 rounded-lg border border-border bg-surface-raised p-4 sm:gap-6 sm:p-6">
                  <BookCover
                    url={book.coverImageUrl}
                    title={book.title}
                    width={COVER_W}
                    height={COVER_H}
                    className="shrink-0"
                  />
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold text-ink">
                      <Link
                        href={`/books/${book.slug}`}
                        className="after:absolute after:inset-0"
                      >
                        {book.title}
                      </Link>
                    </h2>
                    {book.subtitle ? (
                      <p className="mt-1 text-ink-muted">{book.subtitle}</p>
                    ) : null}
                    {book.categoryLine ? (
                      <p className="mt-2 text-sm uppercase tracking-wide text-ink-muted">
                        {book.categoryLine}
                      </p>
                    ) : null}
                    {cheapest ? (
                      <p className="mt-3 font-medium text-ink">
                        From {formatMinor(cheapest.priceMinor, cheapest.currency)}
                      </p>
                    ) : null}
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
