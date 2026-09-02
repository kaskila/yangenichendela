"use client";

import { useActionState } from "react";
import { type SignInState, signInAction } from "./actions";

const initialState: SignInState = { error: null };

// One class string for both inputs so they cannot drift apart. Tailwind v4
// Preflight strips the border and background off every <input>, so the border,
// background and radius are all set explicitly here.
const inputClass =
  "block w-full rounded border border-admin-border bg-admin-surface px-3 py-2 text-sm text-admin-ink";

export function LoginForm() {
  const [state, action, pending] = useActionState(signInAction, initialState);

  return (
    <form action={action} className="space-y-4">
      <div className="space-y-1.5">
        <label
          htmlFor="email"
          className="block text-sm font-medium text-admin-ink"
        >
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className={inputClass}
        />
      </div>

      <div className="space-y-1.5">
        <label
          htmlFor="password"
          className="block text-sm font-medium text-admin-ink"
        >
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className={inputClass}
        />
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}

      {/* text-admin-on-dark! — the `!` is required: globals.css has an
          unlayered `:where(button){ color: inherit }` that otherwise beats the
          utility (unlayered wins over @layer), leaving dark text on the dark
          fill. */}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded bg-admin-ink px-4 py-2 text-sm font-medium text-admin-on-dark! disabled:opacity-60"
      >
        Sign in to admin
      </button>
    </form>
  );
}
