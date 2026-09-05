"use client";

import { useActionState } from "react";
import {
  regenerateDownloadTokenAction,
  type RegenerateDownloadState,
} from "./download-actions";

const initial: RegenerateDownloadState = { status: "idle" };

export function DownloadSection({
  orderReference,
  accessToken,
  orderItemId,
  title,
  usable,
  downloadHref,
  expiresAtLabel,
  downloadsRemaining,
}: {
  orderReference: string;
  accessToken: string;
  orderItemId: string;
  title: string;
  usable: boolean;
  downloadHref: string;
  expiresAtLabel: string;
  downloadsRemaining: number;
}) {
  const [state, formAction, pending] = useActionState(
    regenerateDownloadTokenAction,
    initial,
  );

  return (
    <div className="rounded-lg border border-border bg-surface-raised p-4">
      <p className="font-medium text-ink">{title}</p>
      {usable ? (
        <>
          <a
            href={downloadHref}
            className="mt-2 inline-block rounded bg-surface-inverse px-4 py-2 text-sm font-medium text-ink-inverse!"
          >
            Download your ebook
          </a>
          <p className="mt-2 text-sm text-ink-muted">
            Expires {expiresAtLabel} · {downloadsRemaining} of 5 downloads left
          </p>
        </>
      ) : (
        <p className="mt-1 text-sm text-ink-muted">
          This link has expired or run out of downloads.
        </p>
      )}

      {state.status === "error" ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {state.error}
        </p>
      ) : null}

      <form action={formAction} className="mt-3">
        <input type="hidden" name="orderReference" value={orderReference} />
        <input type="hidden" name="accessToken" value={accessToken} />
        <input type="hidden" name="orderItemId" value={orderItemId} />
        {state.status === "saved" ? (
          <p role="status" className="text-sm text-ink">
            New link ready — download it above.
          </p>
        ) : usable ? (
          <button
            type="submit"
            disabled={pending}
            className="text-sm text-ink underline disabled:opacity-60"
          >
            {pending ? "Getting a new link…" : "Get a new link anyway"}
          </button>
        ) : (
          <button
            type="submit"
            disabled={pending}
            className="rounded bg-surface-inverse px-4 py-2 text-sm font-medium text-ink-inverse! disabled:opacity-60"
          >
            {pending ? "Getting a new link…" : "Get a new link"}
          </button>
        )}
      </form>
    </div>
  );
}
