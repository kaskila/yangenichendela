import Link from "next/link";
import { requireAdmin } from "@/lib/auth/guards";
import { formatMinor } from "@/lib/money";
import { listBooksForAdmin } from "@/lib/services/books";
import type { BookFormat } from "@/generated/prisma/client";

function formatLine(f: BookFormat): string {
  const parts = [f.type, formatMinor(f.priceMinor, f.currency)];
  if (f.type === "PRINT" && f.stockOnHand !== null) {
    parts.push(`${f.stockOnHand} in stock`);
  }
  if (!f.isAvailable) parts.push("paused");
  return parts.join(" · ");
}

export default async function AdminBooksList() {
  await requireAdmin();
  const books = await listBooksForAdmin();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">Books</h1>
        <Link
          href="/admin/books/new"
          className="rounded bg-admin-ink px-3 py-2 text-sm font-medium text-admin-surface"
        >
          New book
        </Link>
      </div>

      {books.length === 0 ? (
        <p className="text-sm text-admin-ink-muted">
          No books yet. Use “New book” to add the first one.
        </p>
      ) : (
        <ul className="space-y-3">
          {books.map((book) => (
            <li
              key={book.id}
              className="rounded border border-admin-border bg-admin-surface p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link
                    href={`/admin/books/${book.id}`}
                    className="font-medium underline"
                  >
                    {book.title}
                  </Link>
                  {book.subtitle ? (
                    <p className="text-sm text-admin-ink-muted">{book.subtitle}</p>
                  ) : null}
                </div>
                <span
                  className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${
                    book.published
                      ? "bg-success-bg text-success"
                      : "bg-admin-bg text-admin-ink-muted"
                  }`}
                >
                  {book.published ? "Published" : "Draft"}
                </span>
              </div>

              <ul className="mt-2 space-y-0.5 text-sm tabular text-admin-ink-muted">
                {book.formats.length === 0 ? (
                  <li>No formats yet</li>
                ) : (
                  book.formats
                    .slice()
                    .sort((a, b) => a.type.localeCompare(b.type))
                    .map((f) => <li key={f.id}>{formatLine(f)}</li>)
                )}
              </ul>

              <p className="mt-2 text-xs text-admin-ink-muted">
                Sort order {book.sortOrder}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
