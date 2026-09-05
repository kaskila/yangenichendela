"use client";

import { useActionState } from "react";
import { advancePrintItemAction, type FulfilmentFormState } from "./actions";

const initial: FulfilmentFormState = { status: "idle" };

export type AdvanceStep = { to: string; label: string; tone: "primary" | "danger" };

// One <form> per row with the advance step(s) as named submit buttons — the
// clicked button's name/value ("to") rides in the FormData, so this works with
// JavaScript disabled. The optional tracking-note input shows only for the move
// to DISPATCHED and is never required, so packing stays one tap per row.
export function RowActions({
  orderItemId,
  steps,
  showTrackingNote,
  waHref,
}: {
  orderItemId: string;
  steps: AdvanceStep[];
  showTrackingNote: boolean;
  waHref: string;
}) {
  const [state, formAction, pending] = useActionState(advancePrintItemAction, initial);
  const formError = state.status === "error" ? state.formError : undefined;

  return (
    <div className="mt-3 space-y-2">
      {formError ? (
        <p className="rounded bg-danger-bg px-3 py-2 text-sm text-danger" role="alert">
          {formError}
        </p>
      ) : null}

      <form action={formAction} className="space-y-2">
        <input type="hidden" name="orderItemId" value={orderItemId} />
        {showTrackingNote ? (
          <input
            name="trackingNote"
            type="text"
            autoComplete="off"
            placeholder="Courier / waybill (optional)"
            className="w-full rounded border border-admin-border bg-admin-surface px-3 py-2 text-sm"
          />
        ) : null}
        <div className="flex flex-wrap gap-2">
          {steps.map((step) => (
            <button
              key={step.to}
              type="submit"
              name="to"
              value={step.to}
              disabled={pending}
              className={
                step.tone === "danger"
                  ? "flex-1 rounded border border-danger px-4 py-3 text-sm font-medium text-danger! disabled:opacity-50"
                  : "flex-1 rounded bg-admin-ink px-4 py-3 text-sm font-medium text-admin-on-dark! disabled:opacity-50"
              }
            >
              {pending ? "Saving…" : step.label}
            </button>
          ))}
        </div>
      </form>

      <a
        href={waHref}
        target="_blank"
        rel="noopener noreferrer"
        className="block rounded border border-admin-border px-4 py-2 text-center text-sm font-medium text-admin-ink!"
      >
        WhatsApp buyer
      </a>
    </div>
  );
}
