import Link from "next/link";
import { requireAdmin } from "@/lib/auth/guards";
import { db } from "@/lib/db";

// Real counts, no widgets, no charts. A zero is stated in a sentence rather
// than dressed up as an empty state.
export default async function AdminDashboard() {
  await requireAdmin();

  const [published, draft, orders] = await Promise.all([
    db.book.count({ where: { published: true } }),
    db.book.count({ where: { published: false } }),
    db.order.count(),
  ]);

  const totalBooks = published + draft;

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">Dashboard</h1>

      <section className="rounded border border-admin-border bg-admin-surface p-4">
        <h2 className="text-sm font-semibold text-admin-ink-muted">Books</h2>
        {totalBooks === 0 ? (
          <p className="mt-1 text-sm">
            No books yet.{" "}
            <Link href="/admin/books/new" className="underline">
              Add one
            </Link>
            .
          </p>
        ) : (
          <p className="mt-1 tabular">
            <span className="text-2xl font-semibold">{published}</span> published
            {" · "}
            <span className="text-2xl font-semibold">{draft}</span> draft
          </p>
        )}
      </section>

      <section className="rounded border border-admin-border bg-admin-surface p-4">
        <h2 className="text-sm font-semibold text-admin-ink-muted">Orders</h2>
        {orders === 0 ? (
          <p className="mt-1 text-sm">No orders yet.</p>
        ) : (
          <p className="mt-1 tabular">
            <span className="text-2xl font-semibold">{orders}</span> total
          </p>
        )}
      </section>
    </div>
  );
}
