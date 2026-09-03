"use client";

import { useActionState, useId } from "react";
import { formatMinor } from "@/lib/money";
import { checkoutAction, type CheckoutState } from "./actions";

const initial: CheckoutState = { status: "idle" };

const inputClass =
  "block w-full rounded border border-border bg-surface px-3 py-2 text-base text-ink";

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-1 text-sm text-danger">
      {message}
    </p>
  );
}

export function CheckoutForm({
  bookFormatId,
  isPrint,
  deliveryLusakaMinor,
  currency,
}: {
  bookFormatId: string;
  isPrint: boolean;
  deliveryLusakaMinor: number;
  currency: string;
}) {
  const [state, action, pending] = useActionState(checkoutAction, initial);
  const err = state.status === "error" ? state : undefined;
  const v = err?.values;
  const issues = err?.issues ?? {};

  const ids = {
    name: useId(),
    email: useId(),
    phone: useId(),
    address: useId(),
  };

  return (
    <form action={action} className="mt-8 space-y-5">
      <input type="hidden" name="bookFormatId" value={bookFormatId} />

      {err?.formError ? (
        <p
          role="alert"
          className="rounded border border-danger bg-surface-raised px-3 py-2 text-sm text-danger"
        >
          {err.formError}
        </p>
      ) : null}

      <div>
        <label htmlFor={ids.name} className="block text-sm font-medium text-ink">
          Full name
        </label>
        <input
          id={ids.name}
          name="name"
          type="text"
          required
          autoComplete="name"
          defaultValue={v?.name ?? ""}
          aria-describedby={issues.name ? `${ids.name}-err` : undefined}
          className={`${inputClass} mt-1`}
        />
        <FieldError id={`${ids.name}-err`} message={issues.name} />
      </div>

      <div>
        <label htmlFor={ids.email} className="block text-sm font-medium text-ink">
          Email
        </label>
        <input
          id={ids.email}
          name="email"
          type="email"
          inputMode="email"
          required
          autoComplete="email"
          defaultValue={v?.email ?? ""}
          aria-describedby={issues.email ? `${ids.email}-err` : undefined}
          className={`${inputClass} mt-1`}
        />
        <p className="mt-1 text-xs text-ink-muted">
          Your order link and ebook (if any) go here.
        </p>
        <FieldError id={`${ids.email}-err`} message={issues.email} />
      </div>

      <div>
        <label htmlFor={ids.phone} className="block text-sm font-medium text-ink">
          Phone
        </label>
        <input
          id={ids.phone}
          name="phone"
          type="tel"
          inputMode="tel"
          required
          autoComplete="tel"
          defaultValue={v?.phone ?? ""}
          aria-describedby={issues.phone ? `${ids.phone}-err` : undefined}
          className={`${inputClass} mt-1`}
        />
        <FieldError id={`${ids.phone}-err`} message={issues.phone} />
      </div>

      {isPrint ? (
        <fieldset className="space-y-3 rounded border border-border p-4">
          <legend className="px-1 text-sm font-medium text-ink">
            How would you like to receive it?
          </legend>

          <label className="flex gap-3 text-sm text-ink">
            <input
              type="radio"
              name="deliveryZone"
              value="LUSAKA"
              defaultChecked={(v?.deliveryZone ?? "LUSAKA") === "LUSAKA"}
              className="mt-1 size-4 shrink-0"
            />
            <span>
              <span className="font-medium">Delivery in Lusaka</span> —{" "}
              {formatMinor(deliveryLusakaMinor, currency)}
            </span>
          </label>

          <label className="flex gap-3 text-sm text-ink">
            <input
              type="radio"
              name="deliveryZone"
              value="PICKUP"
              defaultChecked={v?.deliveryZone === "PICKUP"}
              className="mt-1 size-4 shrink-0"
            />
            <span>
              <span className="font-medium">Collect in person</span> — free. He
              will contact you to arrange a time and place.
            </span>
          </label>

          <label className="flex gap-3 text-sm text-ink">
            <input
              type="radio"
              name="deliveryZone"
              value="REST_OF_ZAMBIA"
              defaultChecked={v?.deliveryZone === "REST_OF_ZAMBIA"}
              className="mt-1 size-4 shrink-0"
            />
            <span>
              <span className="font-medium">Elsewhere in Zambia</span> — free,
              but <span className="font-medium">you arrange your own courier</span>.
              He will be in touch to sort out the handover.
            </span>
          </label>

          <FieldError id="deliveryZone-err" message={issues.deliveryZone} />

          <div className="ca-address">
            <label
              htmlFor={ids.address}
              className="block text-sm font-medium text-ink"
            >
              Delivery address
            </label>
            <textarea
              id={ids.address}
              name="deliveryAddress"
              rows={3}
              autoComplete="street-address"
              defaultValue={v?.deliveryAddress ?? ""}
              aria-describedby={
                issues.deliveryAddress ? `${ids.address}-err` : undefined
              }
              className={`${inputClass} mt-1`}
            />
            <FieldError
              id={`${ids.address}-err`}
              message={issues.deliveryAddress}
            />
          </div>
        </fieldset>
      ) : null}

      {/* text-ink-inverse! beats globals.css's unlayered :where(button){color:inherit} */}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded bg-surface-inverse px-4 py-3 text-sm font-medium text-ink-inverse! disabled:opacity-60"
      >
        {pending ? "Creating your order…" : "Continue to payment"}
      </button>

      <p className="text-xs text-ink-muted">
        Payment is by Airtel Money or MTN MoMo. The next page shows exactly how.
      </p>
    </form>
  );
}
