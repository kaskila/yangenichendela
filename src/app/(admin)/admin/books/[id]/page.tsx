import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/guards";
import { getSignedEbookUrl, isCloudinaryConfigured } from "@/lib/cloudinary";
import { getBookForAdmin } from "@/lib/services/books";
import { BookForm } from "../book-form";
import { CoverPanel } from "../cover-panel";
import { EbookPanel } from "../ebook-panel";

export default async function EditBookPage({
  params,
}: PageProps<"/admin/books/[id]">) {
  await requireAdmin();
  const { id } = await params;

  const book = await getBookForAdmin(id);
  if (!book) notFound();

  const ebookFormat = book.formats.find((f) => f.type === "EBOOK");

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="truncate text-lg font-semibold">{book.title}</h1>
        <Link href="/admin/books" className="shrink-0 text-sm underline">
          Back to books
        </Link>
      </div>

      <CoverPanel
        bookId={book.id}
        coverImageUrl={book.coverImageUrl}
        cloudinaryConfigured={isCloudinaryConfigured()}
      />

      {ebookFormat ? (
        <EbookPanel
          bookId={book.id}
          bookFormatId={ebookFormat.id}
          hasAsset={Boolean(ebookFormat.ebookAssetUrl)}
          cloudinaryConfigured={isCloudinaryConfigured()}
          signedViewUrl={
            ebookFormat.ebookAssetUrl ? getSignedEbookUrl(ebookFormat.ebookAssetUrl) : null
          }
        />
      ) : null}

      <BookForm book={book} />
    </div>
  );
}
