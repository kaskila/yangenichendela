"use client";

import { useActionState, useId } from "react";
import { submitClaimAction, type ClaimState } from "./actions";

const initial: ClaimState = { status: "idle" };

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

export function ClaimForm({
  orderReference,
  accessToken,
  defaultNetwork,
}: {
  orderReference: string;
  accessToken: string;
  defaultNetwork: string;
}) {
  const [state, action, pending] = useActionState(submitClaimAction, initial);
  const err = state.status === "error" ? state : undefined;
  const v = err?.values;
  const issues = err?.issues ?? {};

  const ids = {
    network: useId(),
    phone: useId(),
    txn: useId(),
    receipt: useId(),
  };

  return (
    <form
      action={action}
      // encType="multipart/form-data"
      className="mt-6 space-y-5 rounded-lg border border-border p-4"
    >
      <div>
        <h2 className="text-sm font-semibold text-ink">Tell us you&rsquo;ve paid</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Once your transfer has gone through, send us the details from your
          confirmation SMS.
        </p>
      </div>

      <input type="hidden" name="orderReference" value={orderReference} />
      <input type="hidden" name="accessToken" value={accessToken} />

      {err?.formError ? (
        <p
          role="alert"
          className="rounded border border-danger bg-surface-raised px-3 py-2 text-sm text-danger"
        >
          {err.formError}
        </p>
      ) : null}

      <div>
        <label htmlFor={ids.network} className="block text-sm font-medium text-ink">
          Which network did you pay from?
        </label>
        <select
          id={ids.network}
          name="network"
          defaultValue={v?.network || defaultNetwork}
          className={`${inputClass} mt-1`}
        >
          <option value="AIRTEL">Airtel Money</option>
          <option value="MTN">MTN MoMo</option>
        </select>
        <FieldError id={`${ids.network}-err`} message={issues.network} />
      </div>

      <div>
        <label htmlFor={ids.phone} className="block text-sm font-medium text-ink">
          Phone number you paid from
        </label>
        <input
          id={ids.phone}
          name="senderPhone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          required
          defaultValue={v?.senderPhone ?? ""}
          aria-describedby={issues.senderPhone ? `${ids.phone}-err` : undefined}
          className={`${inputClass} mt-1`}
        />
        <FieldError id={`${ids.phone}-err`} message={issues.senderPhone} />
      </div>

      <div>
        <label htmlFor={ids.txn} className="block text-sm font-medium text-ink">
          Transaction reference
        </label>
        <input
          id={ids.txn}
          name="transactionId"
          type="text"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          required
          defaultValue={v?.transactionId ?? ""}
          aria-describedby={`${ids.txn}-hint${issues.transactionId ? ` ${ids.txn}-err` : ""}`}
          className={`${inputClass} mt-1`}
        />
        <p id={`${ids.txn}-hint`} className="mt-1 text-xs text-ink-muted">
          The transaction ID from your confirmation SMS — a mix of letters and
          numbers, often labelled &ldquo;Txn ID&rdquo; or &ldquo;Reference&rdquo;.
          Enter the whole thing.
        </p>
        <FieldError id={`${ids.txn}-err`} message={issues.transactionId} />
      </div>

      <div>
        <label htmlFor={ids.receipt} className="block text-sm font-medium text-ink">
          Screenshot of the SMS <span className="text-ink-muted">(optional)</span>
        </label>
        <input
          id={ids.receipt}
          name="receipt"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="mt-1 block w-full text-sm text-ink"
        />
        <p className="mt-1 text-xs text-ink-muted">
          A screenshot helps us confirm faster. You can send without it.
        </p>
      </div>

      {/* text-ink-inverse! beats globals.css's unlayered :where(button){color:inherit} */}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded bg-surface-inverse px-4 py-3 text-sm font-medium text-ink-inverse! disabled:opacity-60"
      >
        {pending ? "Sending…" : "I've sent the payment"}
      </button>
    </form>
  );
}
