"use client";

import { useActionState, useId, useState } from "react";
import { minorToDecimalString } from "@/lib/money";
import { slugify } from "@/lib/slug";
import type { BookWithFormats } from "@/lib/services/books";
import {
  createBookAction,
  updateBookAction,
  type BookFormState,
} from "./actions";

const initialState: BookFormState = { status: "idle" };

function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="block text-sm font-medium">
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs text-admin-ink-muted">{hint}</p> : null}
      {error ? (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const inputClass =
  "w-full rounded border border-admin-border bg-admin-surface px-3 py-2 text-sm";

export function BookForm({ book }: { book?: BookWithFormats }) {
  const isEdit = Boolean(book);
  const [state, formAction, pending] = useActionState(
    isEdit ? updateBookAction : createBookAction,
    initialState,
  );

  const issues = state.status === "error" ? (state.issues ?? {}) : {};
  const formError = state.status === "error" ? state.formError : undefined;

  const print = book?.formats.find((f) => f.type === "PRINT");
  const ebook = book?.formats.find((f) => f.type === "EBOOK");

  const [title, setTitle] = useState(book?.title ?? "");
  const [slug, setSlug] = useState(book?.slug ?? "");
  const [slugEdited, setSlugEdited] = useState(isEdit);
  const shownSlug = slugEdited ? slug : slugify(title);

  const ids = {
    title: useId(),
    subtitle: useId(),
    categoryLine: useId(),
    authorCredit: useId(),
    description: useId(),
    slug: useId(),
    sortOrder: useId(),
    printPrice: useId(),
    printStock: useId(),
    ebookPrice: useId(),
  };

  return (
    <form action={formAction} className="space-y-6 pb-20">
      {isEdit ? <input type="hidden" name="bookId" value={book!.id} /> : null}

      {state.status === "saved" ? (
        <p
          className="rounded bg-success-bg px-3 py-2 text-sm text-success"
          role="status"
        >
          Saved.
        </p>
      ) : null}
      {formError ? (
        <p className="rounded bg-danger-bg px-3 py-2 text-sm text-danger" role="alert">
          {formError}
        </p>
      ) : null}

      <section className="space-y-4">
        <Field label="Title" htmlFor={ids.title} error={issues.title}>
          <input
            id={ids.title}
            name="title"
            className={inputClass}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        </Field>

        <Field label="Subtitle" htmlFor={ids.subtitle} error={issues.subtitle}>
          <input
            id={ids.subtitle}
            name="subtitle"
            className={inputClass}
            defaultValue={book?.subtitle ?? ""}
          />
        </Field>

        <Field
          label="Category line"
          htmlFor={ids.categoryLine}
          error={issues.categoryLine}
          hint="The line on the cover, e.g. “Inspiration & Leadership”."
        >
          <input
            id={ids.categoryLine}
            name="categoryLine"
            className={inputClass}
            defaultValue={book?.categoryLine ?? ""}
          />
        </Field>

        <Field
          label="Author credit"
          htmlFor={ids.authorCredit}
          error={issues.authorCredit}
          hint="Exactly as printed on THIS book's cover. Not the site name."
        >
          <input
            id={ids.authorCredit}
            name="authorCredit"
            className={inputClass}
            defaultValue={book?.authorCredit ?? ""}
            required
          />
        </Field>

        <Field
          label="Description"
          htmlFor={ids.description}
          error={issues.description}
        >
          <textarea
            id={ids.description}
            name="description"
            className={`${inputClass} min-h-32`}
            defaultValue={book?.description ?? ""}
            required
          />
        </Field>

        <Field
          label="Slug"
          htmlFor={ids.slug}
          error={issues.slug}
          hint="Auto-fills from the title. Edit it if you need to."
        >
          <input
            id={ids.slug}
            name="slug"
            className={inputClass}
            value={shownSlug}
            onChange={(e) => {
              setSlugEdited(true);
              setSlug(e.target.value);
            }}
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
        </Field>

        <Field
          label="Sort order"
          htmlFor={ids.sortOrder}
          error={issues.sortOrder}
          hint="Lower numbers come first."
        >
          <input
            id={ids.sortOrder}
            name="sortOrder"
            type="number"
            min={0}
            inputMode="numeric"
            className={inputClass}
            defaultValue={book?.sortOrder ?? 0}
          />
        </Field>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="published"
            defaultChecked={book?.published ?? false}
            className="size-4"
          />
          Published (visible on the public site)
        </label>
      </section>

      <FormatFieldset
        legend="Print edition"
        available={{ name: "printAvailable", defaultChecked: print?.isAvailable ?? false }}
        price={{
          id: ids.printPrice,
          name: "printPrice",
          defaultValue: print ? minorToDecimalString(print.priceMinor) : "",
          error: issues.printPrice,
        }}
        stock={{
          id: ids.printStock,
          name: "printStock",
          defaultValue: print?.stockOnHand ?? "",
          error: issues.printStock,
        }}
      />

      <FormatFieldset
        legend="Ebook edition"
        available={{ name: "ebookAvailable", defaultChecked: ebook?.isAvailable ?? false }}
        price={{
          id: ids.ebookPrice,
          name: "ebookPrice",
          defaultValue: ebook ? minorToDecimalString(ebook.priceMinor) : "",
          error: issues.ebookPrice,
        }}
      />

      <div className="sticky bottom-0 -mx-4 border-t border-admin-border bg-admin-surface px-4 py-3">
        {/* text-admin-on-dark! — `!` needed to beat globals.css's unlayered
            `:where(button){ color: inherit }`. */}
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded bg-admin-ink px-4 py-3 text-sm font-medium text-admin-on-dark! disabled:opacity-60 sm:w-auto"
        >
          {pending
            ? "Saving…"
            : isEdit
              ? "Save book"
              : "Create book"}
        </button>
      </div>
    </form>
  );
}

function FormatFieldset({
  legend,
  available,
  price,
  stock,
}: {
  legend: string;
  available: { name: string; defaultChecked: boolean };
  price: { id: string; name: string; defaultValue: string; error?: string };
  stock?: { id: string; name: string; defaultValue: string | number; error?: string };
}) {
  return (
    <fieldset className="space-y-3 rounded border border-admin-border bg-admin-surface p-4">
      <legend className="px-1 text-sm font-semibold">{legend}</legend>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name={available.name}
          defaultChecked={available.defaultChecked}
          className="size-4"
        />
        Available for purchase
      </label>

      <Field
        label="Price (kwacha)"
        htmlFor={price.id}
        error={price.error}
        hint="e.g. 250.00"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm text-admin-ink-muted">K</span>
          <input
            id={price.id}
            name={price.name}
            type="text"
            inputMode="decimal"
            className={inputClass}
            defaultValue={price.defaultValue}
            placeholder="0.00"
          />
        </div>
      </Field>

      {stock ? (
        <Field
          label="Stock on hand"
          htmlFor={stock.id}
          error={stock.error}
          hint="Leave blank if you are not tracking stock yet."
        >
          <input
            id={stock.id}
            name={stock.name}
            type="number"
            min={0}
            inputMode="numeric"
            className={inputClass}
            defaultValue={stock.defaultValue}
          />
        </Field>
      ) : null}
    </fieldset>
  );
}
