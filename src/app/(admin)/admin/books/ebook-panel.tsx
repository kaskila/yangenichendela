"use client";

import { useActionState } from "react";
import { uploadEbookAction, type CoverFormState } from "./actions";

const initialState: CoverFormState = { status: "idle" };

export function EbookPanel({
  bookId,
  bookFormatId,
  hasAsset,
  cloudinaryConfigured,
  signedViewUrl,
}: {
  bookId: string;
  bookFormatId: string;
  hasAsset: boolean;
  cloudinaryConfigured: boolean;
  signedViewUrl: string | null;
}) {
  const [state, formAction, pending] = useActionState(uploadEbookAction, initialState);

  return (
    <section className="space-y-3 rounded border border-admin-border bg-admin-surface p-4">
      <h2 className="text-sm font-semibold">Ebook file</h2>

      <p className="text-sm text-admin-ink-muted">
        {hasAsset ? (
          signedViewUrl ? (
            <>
              A PDF is uploaded.{" "}
              <a href={signedViewUrl} className="underline" target="_blank" rel="noreferrer">
                View current PDF
              </a>
            </>
          ) : (
            "A PDF is uploaded."
          )
        ) : (
          "No PDF uploaded yet — the ebook can't be delivered until one is."
        )}
      </p>

      <form action={formAction} className="space-y-2">
        <input type="hidden" name="bookId" value={bookId} />
        <input type="hidden" name="bookFormatId" value={bookFormatId} />

        {cloudinaryConfigured ? (
          <input
            type="file"
            name="ebook"
            accept="application/pdf"
            className="block w-full text-sm"
            required
          />
        ) : null}

        <p className="text-xs text-admin-ink-muted">
          {cloudinaryConfigured
            ? "PDF only, up to 9 MB. This file is never public — buyers only ever see a download link, never this storage location."
            : "Ebook uploads are not configured."}
        </p>

        {cloudinaryConfigured ? (
          // text-admin-on-dark! — `!` needed to beat globals.css's unlayered
          // `:where(button){ color: inherit }`.
          <button
            type="submit"
            disabled={pending}
            className="rounded bg-admin-ink px-3 py-2 text-sm font-medium text-admin-on-dark! disabled:opacity-60"
          >
            {pending ? "Saving…" : hasAsset ? "Replace PDF" : "Add PDF"}
          </button>
        ) : null}

        {state.status === "saved" ? (
          <p className="text-xs text-success" role="status">
            Ebook file updated.
          </p>
        ) : null}
        {state.status === "error" ? (
          <p className="text-xs text-danger" role="alert">
            {state.error}
          </p>
        ) : null}
      </form>
    </section>
  );
}
