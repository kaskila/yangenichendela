"use client";

import { useActionState, useId } from "react";
import { saveDeliveryFeeAction, type DeliveryFormState } from "./actions";

const initial: DeliveryFormState = { status: "idle" };

export function DeliveryFeeForm({ currentKwacha }: { currentKwacha: string }) {
  const [state, formAction, pending] = useActionState(
    saveDeliveryFeeAction,
    initial,
  );
  const id = useId();

  return (
    <form action={formAction} className="space-y-2">
      <label htmlFor={id} className="block text-sm font-medium">
        Lusaka delivery fee (kwacha)
      </label>
      <div className="flex items-center gap-2">
        <span className="text-sm text-admin-ink-muted">K</span>
        <input
          id={id}
          name="deliveryLusaka"
          type="text"
          inputMode="decimal"
          defaultValue={currentKwacha}
          placeholder="0.00"
          className="w-32 rounded border border-admin-border bg-admin-surface px-3 py-2 text-sm tabular"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-admin-ink px-3 py-2 text-sm font-medium text-admin-on-dark! disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save fee"}
        </button>
      </div>
      <p className="text-xs text-admin-ink-muted">
        Rest of Zambia and pick-up are always free — the buyer arranges carriage
        or collects.
      </p>
      {state.status === "saved" ? (
        <p className="text-xs text-success" role="status">
          Delivery fee saved.
        </p>
      ) : null}
      {state.status === "error" ? (
        <p className="text-xs text-danger" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
