"use client";

import { useActionState } from "react";
import { reopenOrderAction, type ReopenFormState } from "../actions";

const initial: ReopenFormState = { status: "idle" };

// Shown only when paymentState === EXPIRED (the page decides that, server
// side). This does NOT change paymentState — it only extends
// paymentExpiresAt, so the pay page's "held until <time>" copy stays honest.
// See src/lib/services/claim-review.ts:reopenOrder for why this isn't a
// transitionPayment call.
export function ReopenForm({
  orderId,
  orderReference,
}: {
  orderId: string;
  orderReference: string;
}) {
  const [state, formAction, pending] = useActionState(reopenOrderAction, initial);
  const formError = state.status === "error" ? state.formError : undefined;

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="orderReference" value={orderReference} />
      {formError ? (
        <p className="rounded bg-danger-bg px-3 py-2 text-sm text-danger" role="alert">
          {formError}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded border border-admin-border px-4 py-3 text-sm font-medium disabled:opacity-50"
      >
        {pending ? "Reopening…" : "Reopen — give this order a fresh payment window"}
      </button>
    </form>
  );
}
