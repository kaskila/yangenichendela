"use client";

import { useActionState, useId } from "react";
import type { MerchantNumber } from "@/generated/prisma/client";
import {
  createMerchantNumberAction,
  updateMerchantNumberAction,
  type MerchantFormState,
} from "./actions";

const initial: MerchantFormState = { status: "idle" };

const inputClass =
  "w-full rounded border border-admin-border bg-admin-surface px-3 py-2 text-sm";

function Field({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="block text-sm font-medium">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function MerchantNumberForm({
  merchantNumber,
}: {
  merchantNumber?: MerchantNumber;
}) {
  const isEdit = Boolean(merchantNumber);
  const [state, formAction, pending] = useActionState(
    isEdit ? updateMerchantNumberAction : createMerchantNumberAction,
    initial,
  );

  const issues = state.status === "error" ? (state.issues ?? {}) : {};
  const formError = state.status === "error" ? state.formError : undefined;

  const ids = {
    network: useId(),
    number: useId(),
    accountName: useId(),
    label: useId(),
    accountType: useId(),
  };

  return (
    <form action={formAction} className="space-y-4">
      {isEdit ? (
        <input type="hidden" name="id" value={merchantNumber!.id} />
      ) : null}

      {state.status === "saved" ? (
        <p
          className="rounded bg-success-bg px-3 py-2 text-sm text-success"
          role="status"
        >
          Saved.
        </p>
      ) : null}
      {formError ? (
        <p className="rounded bg-danger-bg px-3 py-2 text-sm text-danger" role="alert">
          {formError}
        </p>
      ) : null}

      <Field label="Network" htmlFor={ids.network} error={issues.network}>
        <select
          id={ids.network}
          name="network"
          defaultValue={merchantNumber?.network ?? "AIRTEL"}
          className={inputClass}
        >
          <option value="AIRTEL">Airtel</option>
          <option value="MTN">MTN</option>
          <option value="ZAMTEL">Zamtel</option>
        </select>
      </Field>

      <Field label="Number" htmlFor={ids.number} error={issues.number}>
        <input
          id={ids.number}
          name="number"
          inputMode="tel"
          defaultValue={merchantNumber?.number ?? ""}
          className={`${inputClass} tabular`}
          required
        />
      </Field>

      <Field label="Account type" htmlFor={ids.accountType} error={issues.accountType}>
        <select
          id={ids.accountType}
          name="accountType"
          defaultValue={merchantNumber?.accountType ?? "PERSONAL"}
          className={inputClass}
        >
          <option value="PERSONAL">Personal wallet</option>
          <option value="MERCHANT">Registered merchant</option>
        </select>
      </Field>

      <Field
        label="Account name"
        htmlFor={ids.accountName}
        error={issues.accountName}
      >
        <input
          id={ids.accountName}
          name="accountName"
          defaultValue={merchantNumber?.accountName ?? ""}
          className={inputClass}
        />
      </Field>

      <Field label="Label" htmlFor={ids.label} error={issues.label}>
        <input
          id={ids.label}
          name="label"
          placeholder="e.g. primary line"
          defaultValue={merchantNumber?.label ?? ""}
          className={inputClass}
        />
      </Field>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="isActive"
          defaultChecked={merchantNumber?.isActive ?? true}
          className="size-4"
        />
        Active
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="isPrimary"
          defaultChecked={merchantNumber?.isPrimary ?? false}
          className="size-4"
        />
        Show this number on the instructions page for its network
      </label>
      {issues.isPrimary ? (
        <p className="text-xs text-danger" role="alert">
          {issues.isPrimary}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded bg-admin-ink px-4 py-3 text-sm font-medium text-admin-on-dark! disabled:opacity-60 sm:w-auto"
      >
        {pending ? "Saving…" : isEdit ? "Save number" : "Add number"}
      </button>
    </form>
  );
}
