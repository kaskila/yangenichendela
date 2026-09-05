"use client";

import { useActionState, useId } from "react";
import { REJECTION_REASONS } from "@/lib/rejection-reasons";
import { rejectClaimAction, type RejectFormState } from "../actions";

const initial: RejectFormState = { status: "idle" };

// The reason list is fixed and customer-safe (REJECTION_REASONS, shared with
// the service so the code the admin picks is exactly what the buyer will
// eventually see verbatim in an email). No internal shorthand codes are shown
// here — the labels ARE the buyer-facing text.
export function RejectForm({
  claimId,
  orderReference,
}: {
  claimId: string;
  orderReference: string;
}) {
  const [state, formAction, pending] = useActionState(rejectClaimAction, initial);
  const noteId = useId();

  const issues = state.status === "error" ? (state.issues ?? {}) : {};
  const formError = state.status === "error" ? state.formError : undefined;

  return (
    <details className="rounded border border-admin-border">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-danger">
        Reject this claim
      </summary>
      <form action={formAction} className="space-y-3 border-t border-admin-border p-3">
        <input type="hidden" name="claimId" value={claimId} />
        <input type="hidden" name="orderReference" value={orderReference} />

        {formError ? (
          <p className="rounded bg-danger-bg px-3 py-2 text-sm text-danger" role="alert">
            {formError}
          </p>
        ) : null}

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Reason (shown to the buyer)</legend>
          {REJECTION_REASONS.map((reason) => (
            <label key={reason.code} className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="reasonCode"
                value={reason.code}
                required
                className="mt-0.5"
              />
              <span>{reason.label}</span>
            </label>
          ))}
          {issues.reasonCode ? (
            <p className="text-xs text-danger" role="alert">
              {issues.reasonCode}
            </p>
          ) : null}
        </fieldset>

        <div className="space-y-1">
          <label htmlFor={noteId} className="block text-sm font-medium">
            Extra detail for “Other” (optional, internal only)
          </label>
          <textarea
            id={noteId}
            name="note"
            rows={2}
            className="w-full rounded border border-admin-border bg-admin-surface px-3 py-2 text-sm"
          />
        </div>

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded border border-danger px-4 py-3 text-sm font-medium text-danger disabled:opacity-50"
        >
          {pending ? "Saving…" : "Reject claim"}
        </button>
      </form>
    </details>
  );
}
