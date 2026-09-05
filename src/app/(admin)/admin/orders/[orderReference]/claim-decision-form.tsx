"use client";

import { useActionState, useId, useState } from "react";
import { formatMinor, parseKwachaToMinor } from "@/lib/money";
import { decideClaimAction, type DecideFormState } from "../actions";

const initial: DecideFormState = { status: "idle" };

// THE non-negotiable control (CLAUDE.md Admin section, docs §5.5): this field
// is never prefilled and never defaulted to the order total. The `required`
// attribute is the no-JS floor — a browser with JavaScript disabled still
// cannot submit an empty amount. Everything below that (the disabled state,
// the changing button label) is a JS enhancement layered on top, using the
// SAME parseKwachaToMinor() the server uses, so the cosmetic label can never
// disagree with what decideClaim() will actually do. The server re-derives
// the real outcome itself from parseKwachaToMinor + totalMinor regardless —
// this component's comparison is never trusted, only displayed.
export function ClaimDecisionForm({
  claimId,
  orderReference,
  totalMinor,
  currency,
}: {
  claimId: string;
  orderReference: string;
  totalMinor: number;
  currency: string;
}) {
  const [state, formAction, pending] = useActionState(decideClaimAction, initial);
  const [amount, setAmount] = useState("");
  const noteId = useId();
  const amountId = useId();

  const issues = state.status === "error" ? (state.issues ?? {}) : {};
  const formError = state.status === "error" ? state.formError : undefined;

  const parsed = parseKwachaToMinor(amount);
  const hasAmount = amount.trim() !== "";
  const comparison = parsed.ok
    ? parsed.minor === totalMinor
      ? "equal"
      : parsed.minor < totalMinor
        ? "under"
        : "over"
    : null;

  const buttonLabel =
    comparison === "under"
      ? "Mark as underpaid"
      : comparison === "over"
        ? "Confirm payment (overpayment)"
        : "Confirm payment";

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="claimId" value={claimId} />
      <input type="hidden" name="orderReference" value={orderReference} />

      {formError ? (
        <p className="rounded bg-danger-bg px-3 py-2 text-sm text-danger" role="alert">
          {formError}
        </p>
      ) : null}

      <div className="space-y-1">
        <label htmlFor={amountId} className="block text-sm font-medium">
          Amount you can see in the account
        </label>
        <input
          id={amountId}
          name="matchedAmountKwacha"
          inputMode="decimal"
          autoComplete="off"
          required
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          className="w-full rounded border border-admin-border bg-admin-surface px-3 py-3 text-lg tabular"
        />
        {issues.matchedAmountKwacha ? (
          <p className="text-xs text-danger" role="alert">
            {issues.matchedAmountKwacha}
          </p>
        ) : null}
        <p className="text-xs text-admin-ink-muted">
          Order total is {formatMinor(totalMinor, currency)}. Type the exact amount you observed
          — this is never filled in for you.
        </p>
      </div>

      {comparison === "over" ? (
        <div className="space-y-1">
          <label htmlFor={noteId} className="block text-sm font-medium">
            What happens to the extra amount? (required for an overpayment)
          </label>
          <textarea
            id={noteId}
            name="reviewNote"
            required
            rows={2}
            className="w-full rounded border border-admin-border bg-admin-surface px-3 py-2 text-sm"
          />
          {issues.reviewNote ? (
            <p className="text-xs text-danger" role="alert">
              {issues.reviewNote}
            </p>
          ) : null}
        </div>
      ) : (
        // Present but hidden when not needed, so the server action always has
        // a reviewNote field to read.
        <input type="hidden" name="reviewNote" value="" />
      )}

      <div className="sticky bottom-0 -mx-4 border-t border-admin-border bg-admin-surface px-4 py-3">
        <button
          type="submit"
          disabled={pending || !hasAmount}
          className="w-full rounded bg-admin-ink px-4 py-3 text-sm font-medium text-admin-on-dark! disabled:opacity-50"
        >
          {pending ? "Saving…" : buttonLabel}
        </button>
      </div>
    </form>
  );
}
