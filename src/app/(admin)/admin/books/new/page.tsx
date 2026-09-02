import Link from "next/link";
import { requireAdmin } from "@/lib/auth/guards";
import { BookForm } from "../book-form";

export default async function NewBookPage() {
  await requireAdmin();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">New book</h1>
        <Link href="/admin/books" className="text-sm underline">
          Back to books
        </Link>
      </div>
      <p className="text-sm text-admin-ink-muted">
        Add the cover image after saving.
      </p>
      <BookForm />
    </div>
  );
}
