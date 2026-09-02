"use client";

import { useActionState } from "react";
import { uploadCoverAction, type CoverFormState } from "./actions";

const initialState: CoverFormState = { status: "idle" };

const COVER_W = 150;
const COVER_H = 225;

export function CoverPanel({
  bookId,
  coverImageUrl,
  cloudinaryConfigured,
}: {
  bookId: string;
  coverImageUrl: string | null;
  cloudinaryConfigured: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    uploadCoverAction,
    initialState,
  );

  return (
    <section className="space-y-3 rounded border border-admin-border bg-admin-surface p-4">
      <h2 className="text-sm font-semibold">Cover image</h2>

      <div className="flex items-start gap-4">
        {coverImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- admin-only, explicit dimensions, arbitrary remote host in degraded mode
          <img
            src={coverImageUrl}
            alt="Current cover"
            width={COVER_W}
            height={COVER_H}
            className="rounded border border-admin-border object-cover"
          />
        ) : (
          <div
            style={{ width: COVER_W, height: COVER_H }}
            className="flex items-center justify-center rounded border border-dashed border-admin-border text-xs text-admin-ink-muted"
          >
            No cover
          </div>
        )}

        <form action={formAction} className="min-w-0 flex-1 space-y-2">
          <input type="hidden" name="bookId" value={bookId} />

          {cloudinaryConfigured ? (
            <input
              type="file"
              name="cover"
              accept="image/png,image/jpeg,image/webp"
              className="block w-full text-sm"
              required
            />
          ) : (
            <input
              type="url"
              name="coverUrl"
              placeholder="https://…"
              className="block w-full rounded border border-admin-border bg-admin-surface px-3 py-2 text-sm"
              required
            />
          )}

          <p className="text-xs text-admin-ink-muted">
            {cloudinaryConfigured
              ? "PNG, JPEG or WebP, up to 5 MB."
              : "Image uploads are not configured — paste an https image URL."}
          </p>

          {/* text-admin-on-dark! — `!` needed to beat globals.css's unlayered
              `:where(button){ color: inherit }`. */}
          <button
            type="submit"
            disabled={pending}
            className="rounded bg-admin-ink px-3 py-2 text-sm font-medium text-admin-on-dark! disabled:opacity-60"
          >
            {pending ? "Saving…" : coverImageUrl ? "Replace cover" : "Add cover"}
          </button>

          {state.status === "saved" ? (
            <p className="text-xs text-success" role="status">
              Cover updated.
            </p>
          ) : null}
          {state.status === "error" ? (
            <p className="text-xs text-danger" role="alert">
              {state.error}
            </p>
          ) : null}
        </form>
      </div>
    </section>
  );
}
