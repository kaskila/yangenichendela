"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/guards";
import {
  isCloudinaryConfigured,
  uploadCoverImage,
} from "@/lib/cloudinary";
import {
  createBook,
  setBookCover,
  updateBook,
  type BookDraft,
  type FieldIssues,
} from "@/lib/services/books";

export type BookFormState =
  | { status: "idle" }
  | { status: "saved" }
  | { status: "error"; formError?: string; issues?: FieldIssues };

export type CoverFormState =
  | { status: "idle" }
  | { status: "saved" }
  | { status: "error"; error: string };

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}

function checked(fd: FormData, key: string): boolean {
  const v = fd.get(key);
  return v === "on" || v === "true";
}

function readDraft(fd: FormData): BookDraft {
  return {
    title: str(fd, "title"),
    subtitle: str(fd, "subtitle"),
    categoryLine: str(fd, "categoryLine"),
    authorCredit: str(fd, "authorCredit"),
    description: str(fd, "description"),
    slug: str(fd, "slug"),
    sortOrder: str(fd, "sortOrder"),
    published: checked(fd, "published"),
    print: {
      available: checked(fd, "printAvailable"),
      price: str(fd, "printPrice"),
      stockOnHand: str(fd, "printStock"),
    },
    ebook: {
      available: checked(fd, "ebookAvailable"),
      price: str(fd, "ebookPrice"),
      stockOnHand: "",
    },
  };
}

function revalidateBook(id?: string): void {
  revalidatePath("/admin");
  revalidatePath("/admin/books");
  if (id) revalidatePath(`/admin/books/${id}`);
}

export async function createBookAction(
  _prev: BookFormState,
  formData: FormData,
): Promise<BookFormState> {
  await requireAdmin();

  const result = await createBook(readDraft(formData));

  if (result.ok) {
    revalidateBook(result.id);
    redirect(`/admin/books/${result.id}`);
  }

  if (result.error === "slug_taken") {
    return { status: "error", issues: { slug: "That slug is already in use" } };
  }
  if (result.error === "invalid_input") {
    return { status: "error", issues: result.issues };
  }
  return { status: "error", formError: "That book could not be saved." };
}

export async function updateBookAction(
  _prev: BookFormState,
  formData: FormData,
): Promise<BookFormState> {
  await requireAdmin();

  const id = str(formData, "bookId");
  if (!id) return { status: "error", formError: "Missing book reference." };

  const result = await updateBook(id, readDraft(formData));

  if (result.ok) {
    revalidateBook(id);
    return { status: "saved" };
  }

  if (result.error === "slug_taken") {
    return { status: "error", issues: { slug: "That slug is already in use" } };
  }
  if (result.error === "invalid_input") {
    return { status: "error", issues: result.issues };
  }
  if (result.error === "not_found") {
    return { status: "error", formError: "That book no longer exists." };
  }
  return { status: "error", formError: "That book could not be saved." };
}

export async function uploadCoverAction(
  _prev: CoverFormState,
  formData: FormData,
): Promise<CoverFormState> {
  await requireAdmin();

  const id = str(formData, "bookId");
  if (!id) return { status: "error", error: "Missing book reference." };

  if (isCloudinaryConfigured()) {
    const file = formData.get("cover");
    if (!(file instanceof File) || file.size === 0) {
      return { status: "error", error: "Choose an image file to upload." };
    }
    const uploaded = await uploadCoverImage(file);
    if (!uploaded.ok) return { status: "error", error: uploaded.error };
    await setBookCover(id, uploaded.url);
  } else {
    // Degraded mode: no Cloudinary credentials, so accept a pasted URL.
    const url = str(formData, "coverUrl").trim();
    if (!/^https:\/\/\S+$/.test(url)) {
      return { status: "error", error: "Enter an https image URL." };
    }
    await setBookCover(id, url);
  }

  revalidateBook(id);
  return { status: "saved" };
}
